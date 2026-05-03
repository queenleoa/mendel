'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  useAccount,
  useBalance,
  useSwitchChain,
  useWalletClient,
} from 'wagmi'
import { formatUnits, parseEther } from 'viem'
import { walletClientToSigner } from '../../lib/zgInference'
import {
  decryptGenome,
  deriveGenomeKey,
  downloadGenome,
} from '../../lib/genome'
import {
  parseRootHashFromUri,
  readTokenFromChain,
  type BreedFlowResult,
  type LineageParams,
} from '../../lib/inft'
import {
  activateAgent,
  listAgents,
  listCycles,
  setAgentRuntimeStatus,
  tickAgent,
  type RuntimeAgent,
  type RuntimeCycle,
} from '../../lib/agentRuntime'
import { AGENT_WALLET_ADDRESS, shortAgentAddress } from '../../lib/agentWallet'
import { baseSepolia, zeroGGalileo } from '../../config/wagmi'
import ChromosomePair from '../ChromosomePair'
import type { Genome } from '../../lib/genome'
import '../../styles/Trade.css'

// =====================================================================
//                              Constants
// =====================================================================

const SLOT_COUNT = 3
const POLL_MS = 5_000
const SLOTS_STORAGE_KEY = 'mendel.tradeSlots'
const AUTOBREED_STORAGE_KEY = 'mendel.autobreed'
const AUTOTICK_STORAGE_KEY = 'mendel.autotickSeconds'

// Auto-tick interval choices for the local-demo toggle. Vercel's
// `*/5 * * * *` cron only fires in production; locally this stand-in
// fakes that loop so the UI shows live cycles without a deploy.
const AUTOTICK_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 30, label: '30 s' },
  { value: 60, label: '60 s' },
  { value: 300, label: '5 min' },
] as const

// Default lineage used at activation; matches what the Mint tab writes.
// In a richer build we'd reconstruct from on-chain lineageHash; for v1
// the user accepts the same params they minted with.
const DEFAULT_LINEAGE: LineageParams = {
  asset: 'ETH/USDC',
  venue: 'uniswap-v3',
  barInterval: '1h',
  hasGrid: true,
  loci: ['trigger', 'filter'],
}

// 0G testnet RPC sometimes hands MetaMask a near-zero gas estimate, so
// pin a price for plain ETH transfers from the user's wallet to the
// agent address. Base Sepolia behaves normally so we let MetaMask
// estimate there.
const ZERO_G_GAS_PRICE_GWEI = 50n * 1_000_000_000n

type TopUpChain = 'zg' | 'base'

// =====================================================================
//                         Persisted slot inputs
// =====================================================================

function readSlotsFromStorage(): (number | null)[] {
  if (typeof window === 'undefined') return Array(SLOT_COUNT).fill(null)
  try {
    const raw = window.localStorage.getItem(SLOTS_STORAGE_KEY)
    if (!raw) return Array(SLOT_COUNT).fill(null)
    const parsed = JSON.parse(raw) as unknown[]
    return Array.from({ length: SLOT_COUNT }, (_, i) => {
      const v = parsed[i]
      return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
    })
  } catch {
    return Array(SLOT_COUNT).fill(null)
  }
}

function writeSlotsToStorage(slots: (number | null)[]): void {
  try {
    window.localStorage.setItem(SLOTS_STORAGE_KEY, JSON.stringify(slots))
  } catch {
    // best-effort
  }
}

// =====================================================================
//                              Trade tab
// =====================================================================

type Props = {
  breedResult: BreedFlowResult | null
}

export default function Trade({ breedResult }: Props) {
  const [slotTokenIds, setSlotTokenIds] = useState<(number | null)[]>(() =>
    Array(SLOT_COUNT).fill(null),
  )
  const [autobreed, setAutobreed] = useState(false)
  const [autotickSeconds, setAutotickSeconds] = useState(0)

  // Hydrate persisted slot inputs + autobreed pref once on mount
  useEffect(() => {
    const stored = readSlotsFromStorage()
    // If nothing persisted yet, pre-fill from breedResult's children (in
    // listed order — the Backtest tab sorts by return but this tab does
    // not auto-rank, per spec).
    if (
      stored.every((v) => v === null) &&
      breedResult &&
      breedResult.children.length > 0
    ) {
      setSlotTokenIds(
        Array.from({ length: SLOT_COUNT }, (_, i) =>
          breedResult.children[i]?.tokenId ?? null,
        ),
      )
    } else {
      setSlotTokenIds(stored)
    }
    try {
      setAutobreed(window.localStorage.getItem(AUTOBREED_STORAGE_KEY) === '1')
      const stored = Number(window.localStorage.getItem(AUTOTICK_STORAGE_KEY))
      const valid = AUTOTICK_OPTIONS.find((o) => o.value === stored)
      if (valid) setAutotickSeconds(valid.value)
    } catch {
      // noop
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateSlot = (index: number, tokenId: number | null) => {
    setSlotTokenIds((prev) => {
      const next = [...prev]
      next[index] = tokenId
      writeSlotsToStorage(next)
      return next
    })
  }

  const toggleAutobreed = (next: boolean) => {
    setAutobreed(next)
    try {
      window.localStorage.setItem(AUTOBREED_STORAGE_KEY, next ? '1' : '0')
    } catch {
      // noop
    }
  }

  const updateAutotick = (seconds: number) => {
    setAutotickSeconds(seconds)
    try {
      window.localStorage.setItem(AUTOTICK_STORAGE_KEY, String(seconds))
    } catch {
      // noop
    }
  }

  // Local stand-in for Vercel cron: ticks every active agent on the
  // chosen interval so the demo shows live cycles when running on
  // localhost. Pulls the active list each iteration so newly-activated
  // slots get picked up automatically.
  useEffect(() => {
    if (autotickSeconds <= 0) return
    let cancelled = false
    const fire = async () => {
      try {
        const { agents } = await listAgents()
        if (cancelled) return
        const active = agents.filter((a) => a.status === 'active')
        for (const a of active) {
          if (cancelled) return
          try {
            await tickAgent(a.tokenId)
          } catch {
            // skip — individual tick failures are surfaced by the slot's
            // own polling on its next refresh
          }
        }
      } catch {
        // listAgents transient failure — try again next interval
      }
    }
    const id = window.setInterval(fire, autotickSeconds * 1000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [autotickSeconds])

  return (
    <div className="trade-container">
      <article className="trade-card">
        <header className="card-header">
          <div className="card-header-text">
            <p className="eyebrow">Step 7 · Trade · Autonomous Agents</p>
            <h1 className="title">Activate &amp; Run</h1>
            <p className="subtitle">
              Pick three minted iNFTs to deploy as autonomous trading agents.
              Each agent ticks every 5 minutes against live market data —
              alpha trigger fires, an LLM gatekeeper sanity-checks the
              regime, and (when wired) a real Uniswap V3 swap settles on
              Base Sepolia. Agents share one hot-wallet runtime{' '}
              <code title={AGENT_WALLET_ADDRESS}>
                {shortAgentAddress()}
              </code>{' '}
              that you fund through the top-up buttons below.
            </p>
          </div>
        </header>

        <TopUpStrip />

        <AutoTickStrip
          value={autotickSeconds}
          onChange={updateAutotick}
        />

        <AutoBreedToggle value={autobreed} onChange={toggleAutobreed} />

        <section className="agent-grid">
          {Array.from({ length: SLOT_COUNT }, (_, i) => (
            <AgentSlot
              key={i}
              slotIndex={i}
              tokenIdInput={slotTokenIds[i]}
              onTokenIdChange={(v) => updateSlot(i, v)}
              breedResult={breedResult}
            />
          ))}
        </section>
      </article>
    </div>
  )
}

// =====================================================================
//                          Top-up strip
// =====================================================================
//
//  Two buttons — one for OG on 0G Galileo (LLM gatekeeper budget), one
//  for ETH on Base Sepolia (swap gas + WETH balance). Both transfer
//  from the user's MetaMask wallet to AGENT_WALLET_ADDRESS. Network
//  switch happens via wagmi's `useSwitchChain` before signing.

function TopUpStrip() {
  const { isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()

  const { data: ogBalance, refetch: refetchOg } = useBalance({
    address: AGENT_WALLET_ADDRESS,
    chainId: zeroGGalileo.id,
    query: { enabled: isConnected, refetchInterval: 15_000 },
  })
  const { data: ethBalance, refetch: refetchEth } = useBalance({
    address: AGENT_WALLET_ADDRESS,
    chainId: baseSepolia.id,
    query: { enabled: isConnected, refetchInterval: 15_000 },
  })

  const [busy, setBusy] = useState<TopUpChain | null>(null)
  const [error, setError] = useState('')
  const [lastTxHash, setLastTxHash] = useState('')

  const handleTopUp = async (chain: TopUpChain, amount: string) => {
    setError('')
    setLastTxHash('')
    if (!walletClient) {
      setError('Connect MetaMask first.')
      return
    }
    const targetChainId =
      chain === 'zg' ? zeroGGalileo.id : baseSepolia.id
    setBusy(chain)
    try {
      // Switch network if needed — wagmi resolves once the user accepts.
      if (walletClient.chain.id !== targetChainId) {
        await switchChainAsync({ chainId: targetChainId })
      }
      // Get a fresh signer post-switch.
      const signer = await walletClientToSigner(walletClient)
      const tx = await signer.sendTransaction({
        to: AGENT_WALLET_ADDRESS,
        value: parseEther(amount),
        ...(chain === 'zg' ? { gasPrice: ZERO_G_GAS_PRICE_GWEI } : {}),
      })
      setLastTxHash(tx.hash)
      await tx.wait()
      if (chain === 'zg') refetchOg()
      else refetchEth()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const fmtBalance = (b: typeof ogBalance) =>
    b
      ? `${Number(formatUnits(b.value, b.decimals)).toFixed(4)} ${b.symbol}`
      : '—'

  return (
    <section className="topup-strip">
      <div className="topup-cell">
        <span className="topup-label">0G Galileo (LLM gatekeeper)</span>
        <code className="topup-balance mono">{fmtBalance(ogBalance)}</code>
        <button
          className="btn btn-primary topup-btn"
          type="button"
          disabled={!isConnected || busy === 'zg'}
          onClick={() => handleTopUp('zg', '5')}
          title="Send 5 OG from your wallet to the agent runtime"
        >
          {busy === 'zg' ? 'Sending…' : '+ 5 OG'}
        </button>
      </div>
      <div className="topup-cell">
        <span className="topup-label">Base Sepolia (Uniswap swaps)</span>
        <code className="topup-balance mono">{fmtBalance(ethBalance)}</code>
        <button
          className="btn btn-primary topup-btn"
          type="button"
          disabled={!isConnected || busy === 'base'}
          onClick={() => handleTopUp('base', '0.5')}
          title="Send 0.5 ETH from your wallet to the agent runtime"
        >
          {busy === 'base' ? 'Sending…' : '+ 0.5 ETH'}
        </button>
      </div>
      {(error || lastTxHash) && (
        <div className="topup-status">
          {error && <span className="topup-error">{error}</span>}
          {lastTxHash && (
            <span className="topup-success">
              Sent · <code className="mono">{lastTxHash.slice(0, 12)}…</code>
            </span>
          )}
        </div>
      )}
    </section>
  )
}

// =====================================================================
//                          Auto-breed toggle (cosmetic)
// =====================================================================

function AutoTickStrip({
  value,
  onChange,
}: {
  value: number
  onChange: (seconds: number) => void
}) {
  return (
    <section className="autotick-strip">
      <span className="autotick-label">Live ticks</span>
      <div className="autotick-options">
        {AUTOTICK_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`autotick-pill ${value === opt.value ? 'active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <span className="autotick-hint">
        {value > 0
          ? `Firing one cycle per active agent every ${value}s (local stand-in for the Vercel cron)`
          : 'Off — cycles only fire when you click "Run cycle now" or when the Vercel cron ticks (deployed only)'}
      </span>
    </section>
  )
}

function AutoBreedToggle({
  value,
  onChange,
}: {
  value: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <section className="autobreed-strip">
      <label className="autobreed-label">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>Auto-breed top performers every 6 hours</span>
      </label>
      <span
        className="autobreed-hint"
        title="Phase 2 — evolutionary loop pending"
      >
        ⓘ pending
      </span>
    </section>
  )
}

// =====================================================================
//                          Agent slot
// =====================================================================

type AgentSlotProps = {
  slotIndex: number
  tokenIdInput: number | null
  onTokenIdChange: (v: number | null) => void
  breedResult: BreedFlowResult | null
}

type SlotState = 'idle' | 'activating' | 'ticking' | 'changing-status' | 'error'

function AgentSlot({
  slotIndex,
  tokenIdInput,
  onTokenIdChange,
  breedResult,
}: AgentSlotProps) {
  const { address, isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const [agent, setAgent] = useState<RuntimeAgent | null>(null)
  const [cycles, setCycles] = useState<RuntimeCycle[]>([])
  const [state, setState] = useState<SlotState>('idle')
  const [error, setError] = useState('')

  // On mount: if there's a tokenId already in this slot AND it's already
  // an active agent server-side, hydrate from the runtime state so a
  // page reload doesn't show "Activate" for an already-running agent.
  useEffect(() => {
    if (!tokenIdInput) return
    let cancelled = false
    ;(async () => {
      try {
        const { agents } = await listAgents()
        const found = agents.find(
          (a) => a.tokenId === tokenIdInput && a.status === 'active',
        )
        if (found && !cancelled) setAgent(found)
      } catch {
        // first-time fetch failure is not fatal — show empty state
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Poll cycles + agent state every 5s while active.
  useEffect(() => {
    if (!agent) return
    let cancelled = false
    const refresh = async () => {
      try {
        const [{ cycles: cs }, { agents: ags }] = await Promise.all([
          listCycles(agent.tokenId, 50),
          listAgents(),
        ])
        if (cancelled) return
        setCycles(cs)
        const fresh = ags.find((a) => a.tokenId === agent.tokenId)
        if (fresh) setAgent(fresh)
      } catch {
        // transient — skip this tick
      }
    }
    refresh()
    const id = window.setInterval(refresh, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [agent])

  const handleActivate = async () => {
    if (!tokenIdInput || !walletClient || !address) return
    setState('activating')
    setError('')
    try {
      const signer = await walletClientToSigner(walletClient)
      // Prefer the in-memory genome from the breed result so we don't
      // need to re-fetch + re-decrypt for tokens we just minted. Fall
      // back to chain decrypt for tokens that aren't in the cached set.
      const cached = breedResult?.children.find(
        (c) => c.tokenId === tokenIdInput,
      )
      let genome
      if (cached) {
        genome = cached.genome
      } else {
        const snapshot = await readTokenFromChain(tokenIdInput, signer)
        const blob = await downloadGenome(
          parseRootHashFromUri(snapshot.encryptedURI),
        )
        const key = await deriveGenomeKey(signer, tokenIdInput)
        genome = await decryptGenome(blob, key)
      }
      const { agent: a } = await activateAgent({
        tokenId: tokenIdInput,
        ownerAddress: address,
        genome,
        lineage: DEFAULT_LINEAGE,
      })
      setAgent(a)
      setState('idle')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setState('error')
    }
  }

  const handleTick = async () => {
    if (!agent) return
    setState('ticking')
    setError('')
    try {
      await tickAgent(agent.tokenId)
      // The poll loop picks up the new row within ~5s.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setState('idle')
    }
  }

  const handleStatusChange = async (next: 'active' | 'paused') => {
    if (!agent) return
    setState('changing-status')
    setError('')
    try {
      await setAgentRuntimeStatus(agent.tokenId, next)
      // Optimistic local update; the polling loop will re-confirm soon.
      setAgent({ ...agent, status: next })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setState('idle')
    }
  }

  return (
    <article className="agent-slot">
      <header className="agent-slot-header">
        <span className="agent-slot-tag">Agent {slotIndex + 1}</span>
        {agent ? (
          <span className={`agent-slot-pill status-${agent.status}`}>
            {agent.status}
          </span>
        ) : (
          <span className="agent-slot-pill status-empty">empty</span>
        )}
      </header>

      {!agent ? (
        <ActivateForm
          tokenIdInput={tokenIdInput}
          onTokenIdChange={onTokenIdChange}
          breedResult={breedResult}
          state={state}
          isConnected={isConnected}
          onActivate={handleActivate}
        />
      ) : (
        <ActiveAgent
          agent={agent}
          cycles={cycles}
          onTick={handleTick}
          ticking={state === 'ticking'}
          onStatusChange={handleStatusChange}
          changingStatus={state === 'changing-status'}
        />
      )}

      {error && <p className="agent-slot-error">{error}</p>}
    </article>
  )
}

// =====================================================================
//                          Activate form
// =====================================================================

type ActivateFormProps = {
  tokenIdInput: number | null
  onTokenIdChange: (v: number | null) => void
  breedResult: BreedFlowResult | null
  state: SlotState
  isConnected: boolean
  onActivate: () => void
}

function ActivateForm({
  tokenIdInput,
  onTokenIdChange,
  breedResult,
  state,
  isConnected,
  onActivate,
}: ActivateFormProps) {
  const childIds = useMemo(
    () => breedResult?.children.map((c) => c.tokenId) ?? [],
    [breedResult],
  )

  return (
    <div className="activate-form">
      <label className="activate-label">
        Token id
        <input
          type="number"
          min={1}
          value={tokenIdInput ?? ''}
          onChange={(e) => {
            const v = Number(e.target.value)
            onTokenIdChange(Number.isFinite(v) && v > 0 ? v : null)
          }}
          placeholder="e.g. 7"
        />
      </label>

      {childIds.length > 0 && (
        <div className="activate-children">
          <span className="activate-children-label">From last breed:</span>
          {childIds.map((id) => (
            <button
              key={id}
              className="activate-child-chip"
              type="button"
              onClick={() => onTokenIdChange(id)}
            >
              #{id}
            </button>
          ))}
        </div>
      )}

      <button
        className="btn btn-primary activate-btn"
        type="button"
        disabled={
          !isConnected || !tokenIdInput || state === 'activating'
        }
        onClick={onActivate}
      >
        {state === 'activating' ? 'Activating…' : 'Activate'}
      </button>
      {!isConnected && (
        <p className="activate-hint">Connect MetaMask first.</p>
      )}
    </div>
  )
}

// =====================================================================
//                          Active agent
// =====================================================================

function ActiveAgent({
  agent,
  cycles,
  onTick,
  ticking,
  onStatusChange,
  changingStatus,
}: {
  agent: RuntimeAgent
  cycles: RuntimeCycle[]
  onTick: () => void
  ticking: boolean
  onStatusChange: (next: 'active' | 'paused') => void
  changingStatus: boolean
}) {
  const paused = agent.status === 'paused'
  return (
    <>
      <div className="agent-genome-strip">
        <ChromosomePair genome={agent.genome as Genome} size="sm" />
        <div className="agent-genome-meta">
          <span className="mono">#{agent.tokenId}</span>
          <span className="agent-genome-trait">
            {agent.genome.trigger.dominance} ·{' '}
            {agent.genome.filter.dominance}
          </span>
        </div>
      </div>

      <dl className="agent-stats">
        <div>
          <dt>position</dt>
          <dd>
            {agent.position}
            {agent.position === 'long' && agent.positionOpenPrice
              ? ` @ $${agent.positionOpenPrice.toFixed(2)}`
              : ''}
          </dd>
        </div>
        <div>
          <dt>pnl</dt>
          <dd className="mono">{agent.realizedPnlBps} bps</dd>
        </div>
        <div>
          <dt>trades</dt>
          <dd className="mono">{agent.cumulativeTrades}</dd>
        </div>
        <div>
          <dt>status</dt>
          <dd>{agent.status}</dd>
        </div>
      </dl>

      <div className="agent-controls">
        <button
          className="btn btn-ghost agent-tick-btn"
          type="button"
          onClick={onTick}
          disabled={ticking || paused}
          title={paused ? 'Resume the agent first' : undefined}
        >
          {ticking ? 'Running…' : 'Run cycle now'}
        </button>
        <button
          className={`btn agent-status-btn ${paused ? 'btn-primary' : 'btn-ghost-danger'}`}
          type="button"
          onClick={() => onStatusChange(paused ? 'active' : 'paused')}
          disabled={changingStatus}
        >
          {changingStatus ? '…' : paused ? 'Resume' : 'Stop'}
        </button>
      </div>

      <CycleLog cycles={cycles} />
    </>
  )
}

// =====================================================================
//                          Cycle log
// =====================================================================

function CycleLog({ cycles }: { cycles: RuntimeCycle[] }) {
  if (cycles.length === 0) {
    return (
      <div className="cycle-log empty">
        <p>No cycles yet. Click Run cycle now or wait for the cron tick.</p>
      </div>
    )
  }
  return (
    <ol className="cycle-log">
      {cycles.map((c) => (
        <li key={c.id} className={`cycle-entry signal-${c.alphaSignal}`}>
          <header className="cycle-entry-head">
            <span className="cycle-no mono">#{c.cycleNo}</span>
            <span className="cycle-ts mono">
              {new Date(c.ts).toLocaleTimeString(undefined, { hour12: false })}
            </span>
            <span className={`pill signal-${c.alphaSignal}`}>
              {c.alphaSignal}
            </span>
            <span className={`pill gate-${c.llmDecision ?? 'none'}`}>
              {c.llmDecision ?? '—'}
            </span>
            <span className={`pill trade-${c.tradeAction ?? 'skip'}`}>
              {c.tradeAction ?? 'skip'}
            </span>
          </header>
          <div className="cycle-entry-body">
            <span className="mono cycle-market">
              ${c.marketSnapshot.spot.toFixed(2)} ·{' '}
              FNG {c.marketSnapshot.fearGreed} ·{' '}
              vol {(c.marketSnapshot.volatility24hBps / 100).toFixed(2)}%
            </span>
            {c.alphaReason && (
              <p className="cycle-reason">
                <span className="cycle-reason-tag">α</span> {c.alphaReason}
              </p>
            )}
            {c.llmReason && (
              <p className="cycle-reason">
                <span className="cycle-reason-tag">🛡</span> {c.llmReason}
              </p>
            )}
            {c.tradePrice !== null && (
              <p className="cycle-reason mono">
                ↳ {c.tradeAction} @ ${c.tradePrice.toFixed(2)}
                {c.tradeTxHash ? (
                  <>
                    {' · '}
                    <a
                      href={`https://sepolia.basescan.org/tx/${c.tradeTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={c.tradeTxHash}
                    >
                      tx {c.tradeTxHash.slice(0, 10)}…
                    </a>
                  </>
                ) : null}
              </p>
            )}
            {c.decisionLogRootHash && (
              <p
                className="cycle-reason mono cycle-reason-storage"
                title={`Decision log on 0G Storage: 0g://${c.decisionLogRootHash}`}
              >
                <span className="cycle-reason-tag">📦</span>
                0g://{c.decisionLogRootHash.slice(0, 10)}…
                {c.decisionLogRootHash.slice(-6)}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
