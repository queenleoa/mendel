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
  decision: 'accept' | 'reject'
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
      decision: 'reject',
      reason: 'no actionable signal',
      provider: 'stub-v1',
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
  const filt = genome.filter.alleles.find(
    (a) => a.type === genome.filter.dominance,
  )
  if (!trig || !filt) return 'unknown strategy'
  if (trig.type === 'momentum' && 'lookback' in trig && 'threshold' in trig) {
    return `momentum trigger (lookback ${trig.lookback}h, threshold ±${(trig.threshold * 100).toFixed(2)}%) gated by ${filt.type} filter (vol band ${('min' in filt ? filt.min : '?')}–${('max' in filt ? filt.max : '?')})`
  }
  if (trig.type === 'reversion' && 'window' in trig && 'zThreshold' in trig) {
    return `mean-reversion trigger (window ${trig.window}h, z±${trig.zThreshold}) gated by ${filt.type} filter (vol band ${('min' in filt ? filt.min : '?')}–${('max' in filt ? filt.max : '?')})`
  }
  return `${trig.type} trigger gated by ${filt.type} filter`
}

function trendDescription(closes: number[] | undefined): string {
  if (!closes || closes.length < 2) return 'recent trend: unavailable'
  const first = closes[0]
  const last = closes[closes.length - 1]
  const pct = ((last - first) / first) * 100
  const arrow = pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'flat'
  const series = closes.map((c) => c.toFixed(2)).join(', ')
  return `last ${closes.length} × 5-min closes (${arrow} ${pct.toFixed(2)}%): [${series}]`
}

function buildPrompt(
  signal: 'buy' | 'sell' | 'hold',
  alphaReason: string,
  genome: Genome,
  market: MarketSnapshot,
): string {
  return `You are a risk gatekeeper for an autonomous quant trading agent.

Strategy: ${summarizeGenome(genome)}
Alpha signal: ${signal.toUpperCase()} ETH/USDC (reason: ${alphaReason})

Market context:
  - Spot: $${market.spot.toFixed(2)}
  - 24h change: ${(market.spot24hChangeBps / 100).toFixed(2)}%
  - 24h realized vol: ${(market.volatility24hBps / 100).toFixed(2)}%
  - Funding rate (perp): ${market.fundingRateBps !== undefined ? `${market.fundingRateBps} bps` : 'n/a'}
  - Fear & Greed Index: ${market.fearGreed} (${market.fearGreedClassification})
  - ${trendDescription(market.recentCloses)}

Decide: should this trade execute, or be rejected as a regime mismatch?
Respond with ONLY a single line of valid JSON, no prose, no markdown:
{"decision":"accept" or "reject","reason":"<one sentence, ≤140 chars>"}`
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
        return {
          decision: parsed.decision,
          reason: (parsed.reason ?? '').slice(0, 200) || 'no reason given',
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
      decision: 'reject',
      reason: 'no actionable signal',
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
