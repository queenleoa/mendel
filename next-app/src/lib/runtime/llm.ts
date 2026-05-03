// Server-side LLM gatekeeper. Routes through 0G Compute using the same
// broker the browser uses (zgInference.ts) — but the signer here is the
// hot-wallet `AGENT_PRIVATE_KEY` so cycles run autonomously, no MetaMask
// popups.
//
// Environment:
//   STUB_GATEKEEPER=1   skip the LLM call and return a deterministic
//                       accept/reject (saves OG in dev / when 0G compute
//                       is flaky). Set in .env.local for local dev,
//                       leave unset in production.
//   AGENT_PRIVATE_KEY   hex string, the hot wallet that signs broker txs
//                       and pays for inference settlement.
//   ZERO_G_RPC          override; defaults to the public Galileo RPC.
//
// The gatekeeper is called once per cycle. The first cycle on a fresh
// wallet creates the ledger + sub-account + provider acknowledgement
// (each a tx) — subsequent cycles only sign the per-call inference
// settlement.

import 'server-only'

import { JsonRpcProvider, Wallet, formatEther, parseEther } from 'ethers'
import { createZGComputeNetworkBroker } from '@0glabs/0g-serving-broker'
import type { Genome, MarketSnapshot } from './types'

const ZERO_G_RPC =
  process.env.ZERO_G_RPC ?? 'https://evmrpc-testnet.0g.ai'
// 50 gwei pin — same workaround the browser-side flow uses for 0G's
// near-zero gas estimates that leave txs stuck pending.
const TX_GAS_PRICE = 50_000_000_000

export type GateResult = {
  // 'accept' / 'reject' come from the LLM's decision.
  // 'skip' is set when alpha emitted `hold` and we never asked the LLM —
  //   different from `reject`, which means we asked and were told no.
  decision: 'accept' | 'reject' | 'skip'
  reason: string
  provider: string
  chatId: string | null
}

// =====================================================================
//                          Stub fallback
// =====================================================================

function stubGate(
  signal: 'buy' | 'sell' | 'hold',
  market: MarketSnapshot,
): GateResult {
  if (signal === 'hold') {
    return {
      decision: 'skip',
      reason: 'alpha quiet — no trade to gate',
      provider: 'shortcircuit',
      chatId: null,
    }
  }
  if (signal === 'buy' && market.fearGreed > 80) {
    return {
      decision: 'reject',
      reason: `extreme greed (${market.fearGreed}) — late-cycle buy risk`,
      provider: 'stub-v1',
      chatId: null,
    }
  }
  if (signal === 'sell' && market.fearGreed < 20) {
    return {
      decision: 'reject',
      reason: `extreme fear (${market.fearGreed}) — sell into capitulation rejected`,
      provider: 'stub-v1',
      chatId: null,
    }
  }
  return {
    decision: 'accept',
    reason: `regime ok (FNG=${market.fearGreed}, vol=${market.volatility24hBps}bps)`,
    provider: 'stub-v1',
    chatId: null,
  }
}

// =====================================================================
//                          Prompt
// =====================================================================

function summarizeGenome(genome: Genome): string {
  const trig = genome.trigger.alleles.find(
    (a) => a.type === genome.trigger.dominance,
  )
  if (!trig) return 'unknown strategy'
  // Deliberately *do not* include the vol band here. The strategy module
  // already enforces the band (alpha emits `hold` when vol is outside),
  // so by the time the LLM sees a non-hold signal the filter has passed.
  // Including the band in the prompt was tempting the model to redo the
  // arithmetic — and small models reliably hallucinate "vol exceeds
  // upper band" even when the numbers are in matching units.
  if (trig.type === 'momentum' && 'lookback' in trig && 'threshold' in trig) {
    return `momentum trigger (lookback ${trig.lookback}h, threshold ±${(trig.threshold * 100).toFixed(2)}%) — long-only ETH/USDC, vol filter already passed`
  }
  if (trig.type === 'reversion' && 'window' in trig && 'zThreshold' in trig) {
    return `mean-reversion trigger (window ${trig.window}h, z±${trig.zThreshold}) — long-only ETH/USDC, vol filter already passed`
  }
  return `${trig.type} trigger — long-only ETH/USDC, vol filter already passed`
}

function trendDescription(closes: number[] | undefined): string {
  if (!closes || closes.length < 2) return 'recent trend: unavailable'
  // The strategy reads the full 100-bar series for lookback math; for
  // the LLM prompt we only need the last 12 (~1 hour) of trend context.
  const recent = closes.slice(-12)
  const first = recent[0]
  const last = recent[recent.length - 1]
  const pct = ((last - first) / first) * 100
  const arrow = pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'flat'
  const series = recent.map((c) => c.toFixed(2)).join(', ')
  return `last ${recent.length} × 5-min closes (${arrow} ${pct.toFixed(2)}%): [${series}]`
}

function buildPrompt(
  signal: 'buy' | 'sell' | 'hold',
  alphaReason: string,
  genome: Genome,
  market: MarketSnapshot,
): string {
  return `You are the final risk gatekeeper for an autonomous quant trading agent.
The strategy has ALREADY done its quantitative filtering — volatility regime
checks have passed and the trigger has fired. Your job is a sanity check
for unusual macro conditions the strategy can't see, NOT to second-guess
the volatility filter.

Strategy: ${summarizeGenome(genome)}
Alpha signal: ${signal.toUpperCase()} ETH/USDC — ${alphaReason}

Market context (snapshot):
  - Spot: $${market.spot.toFixed(2)}
  - 24h change: ${(market.spot24hChangeBps / 100).toFixed(2)}%
  - 24h realized vol: ${(market.volatility24hBps / 100).toFixed(2)}%
  - Funding rate (perp): ${market.fundingRateBps !== undefined ? `${market.fundingRateBps} bps` : 'n/a'}
  - Fear & Greed Index: ${market.fearGreed} (${market.fearGreedClassification})
  - ${trendDescription(market.recentCloses)}

DEFAULT TO ACCEPT. Reject only when you spot a clear, named red flag:
  • Extreme Fear & Greed (<10 or >90) that *contradicts* the signal
    (e.g. BUY when FNG > 90, or SELL when FNG < 10)
  • Funding rate diverging strongly against the trade (≥150 bps)
  • Very recent 5-min trend reversing in the wrong direction (e.g. BUY
    after the last hour fell more than 1%)

Do NOT reject on the basis of:
  • Volatility being "too high" or "too low" — the strategy already
    handled that and decided this regime is fine.
  • "It's just neutral" — neutral is fine, accept.

Respond with ONLY one line of valid JSON, no prose, no markdown:
{"decision":"accept" or "reject","reason":"<≤240 chars, name the specific red flag if rejecting>"}`
}

function parseGateResponse(text: string): {
  decision: 'accept' | 'reject'
  reason: string
} {
  // Be lenient with model output: strip markdown fences, find the first
  // JSON object, fall back to keyword sniff if parse fails.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
        decision?: string
        reason?: string
      }
      if (parsed.decision === 'accept' || parsed.decision === 'reject') {
        const trimmed = (parsed.reason ?? '').slice(0, 280)
        // Fall back to a context-aware placeholder when the LLM returns
        // an empty `reason` field — happens occasionally with smaller
        // models. Better than the generic "no reason given".
        const fallback =
          parsed.decision === 'accept'
            ? 'no red flags — regime acceptable (LLM returned empty reason)'
            : 'rejected without specific reason (LLM returned empty reason)'
        return {
          decision: parsed.decision,
          reason: trimmed || fallback,
        }
      }
    } catch {
      // fallthrough to keyword sniff
    }
  }
  // Keyword fallback — be conservative, default to reject if unsure.
  if (/\b(accept|approve|proceed|go)\b/i.test(cleaned)) {
    return { decision: 'accept', reason: cleaned.slice(0, 140) }
  }
  return {
    decision: 'reject',
    reason: `unparseable response: ${cleaned.slice(0, 100)}`,
  }
}

// =====================================================================
//                          Broker singleton
// =====================================================================
//
//  Cache the broker + provider selection across cycles so we don't
//  re-discover providers and re-acknowledge on every tick. The
//  acknowledgement tx already costs gas; doing it once and reusing the
//  result for the lifetime of the server process is fine.

type BrokerHandle = {
  broker: Awaited<ReturnType<typeof createZGComputeNetworkBroker>>
  providerAddress: string
  endpoint: string
  serviceModel: string
}

let cached: BrokerHandle | null = null

async function getBroker(): Promise<BrokerHandle> {
  if (cached) return cached

  const pk = process.env.AGENT_PRIVATE_KEY
  if (!pk) throw new Error('AGENT_PRIVATE_KEY not set')

  const provider = new JsonRpcProvider(ZERO_G_RPC)
  const wallet = new Wallet(pk, provider)

  // The broker SDK accepts an ethers Signer; Wallet implements it.
  const broker = await createZGComputeNetworkBroker(wallet as never)

  // Discover providers and pick a TEE-verified chatbot if available.
  const services = await broker.inference.listService()
  const chatbots = (services as unknown as unknown[][]).filter(
    (s) => s[1] === 'chatbot',
  )
  if (chatbots.length === 0) {
    throw new Error('No 0G chatbot providers available right now')
  }
  const selected = chatbots.find((s) => s[10] === true) ?? chatbots[0]
  const providerAddress = selected[0] as string

  // First-time funding only — same logic as zgInference.ts. After this
  // the wallet's existing ledger + sub-account just keep working until
  // the user manually tops up.
  let ledgerExists = false
  try {
    await broker.ledger.getLedger()
    ledgerExists = true
  } catch {
    // not yet created
  }
  if (!ledgerExists) {
    const ledgerApi = broker.ledger as unknown as {
      addLedger?: (n: number, gasPrice?: number) => Promise<unknown>
    }
    if (ledgerApi.addLedger) {
      await ledgerApi.addLedger(3, TX_GAS_PRICE)
    } else {
      await broker.ledger.depositFund(3, TX_GAS_PRICE)
    }
  }

  let subExists = false
  try {
    const sub = (await broker.inference.getAccount(
      providerAddress,
    )) as unknown as bigint[] & { balance?: bigint }
    const raw = sub[2] ?? sub.balance ?? 0n
    if (parseFloat(formatEther(raw as bigint)) >= 0) subExists = true
  } catch {
    subExists = false
  }
  if (!subExists) {
    await broker.ledger.transferFund(
      providerAddress,
      'inference',
      parseEther('1'),
      TX_GAS_PRICE,
    )
  }

  let isAcked = false
  try {
    isAcked = await broker.inference.acknowledged(providerAddress)
  } catch {
    // assume not acknowledged
  }
  if (!isAcked) {
    try {
      await broker.inference.acknowledgeProviderSigner(
        providerAddress,
        TX_GAS_PRICE,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!/already|acknowledged/i.test(msg)) throw err
    }
  }

  const { endpoint, model: serviceModel } =
    await broker.inference.getServiceMetadata(providerAddress)

  cached = { broker, providerAddress, endpoint, serviceModel }
  return cached
}

// =====================================================================
//                          Public entrypoint
// =====================================================================

/**
 * The cycle's gatekeeper call. Replaces the old `stubGatekeeper`.
 *
 * - In stub mode (`STUB_GATEKEEPER=1`): same deterministic logic as
 *   before, no network calls, no OG spend.
 * - In live mode: 0G compute call with full market context.
 *
 * Network or parse failures fall back to a conservative reject so a
 * single flaky response can't accidentally green-light a trade.
 */
export async function llmGatekeeper(
  signal: 'buy' | 'sell' | 'hold',
  alphaReason: string,
  genome: Genome,
  market: MarketSnapshot,
): Promise<GateResult> {
  if (process.env.STUB_GATEKEEPER === '1') {
    return stubGate(signal, market)
  }
  if (signal === 'hold') {
    // Don't burn an LLM call when the alpha already said hold.
    return {
      decision: 'skip',
      reason: 'alpha quiet — no trade to gate',
      provider: 'shortcircuit',
      chatId: null,
    }
  }

  try {
    const { broker, providerAddress, endpoint, serviceModel } =
      await getBroker()

    const headers = await broker.inference.getRequestHeaders(providerAddress)
    const prompt = buildPrompt(signal, alphaReason, genome, market)

    const res = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers as unknown as Record<string, string>),
      },
      body: JSON.stringify({
        model: serviceModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 120,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`inference HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    const data = (await res.json()) as {
      id?: string
      usage?: unknown
      choices?: { message?: { content?: string } }[]
    }
    const content = data?.choices?.[0]?.message?.content ?? ''
    const chatId =
      res.headers.get('ZG-Res-Key') ||
      res.headers.get('zg-res-key') ||
      data?.id ||
      null

    // Settle on-chain — fee accounting for this call.
    try {
      await broker.inference.processResponse(
        providerAddress,
        chatId ?? undefined,
        JSON.stringify(data?.usage ?? {}),
      )
    } catch (err) {
      // Settlement failure shouldn't block the trade decision, but log
      // it so the wallet's ledger drift gets noticed.
      console.warn('[llm] settlement failed', err)
    }

    const { decision, reason } = parseGateResponse(content)
    return { decision, reason, provider: providerAddress, chatId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      decision: 'reject',
      reason: `gatekeeper error — ${msg.slice(0, 140)}`,
      provider: 'error-fallback',
      chatId: null,
    }
  }
}
