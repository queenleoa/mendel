'use client'

import { useEffect, useState } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import { walletClientToSigner } from '../../lib/zgInference'
import {
  decryptGenome,
  deriveGenomeKey,
  downloadGenome,
} from '../../lib/genome'
import {
  parseRootHashFromUri,
  readTokenFromChain,
  computeLineageHash,
  type LineageParams,
} from '../../lib/inft'
import {
  activateAgent,
  checkRuntimeHealth,
  listCycles,
  tickAgent,
  RUNTIME_BASE_URL,
  type RuntimeAgent,
  type RuntimeCycle,
} from '../../lib/agentRuntime'
import '../../styles/Trade.css'

// Default lineage used when activating — matches what the Mint tab writes.
// In a richer build, we'd reconstruct this from the on-chain lineageHash;
// for v1 the user confirms the same params they minted with.
const DEFAULT_LINEAGE: LineageParams = {
  asset: 'ETH/USDC',
  venue: 'uniswap-v3',
  barInterval: '1h',
  hasGrid: true,
  loci: ['trigger', 'filter'],
}

type Status = 'idle' | 'activating' | 'ticking' | 'error'

export default function Trade() {
  const { address, isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const [tokenIdStr, setTokenIdStr] = useState<string>('1')
  const [agent, setAgent] = useState<RuntimeAgent | null>(null)
  const [cycles, setCycles] = useState<RuntimeCycle[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string>('')
  const [healthOk, setHealthOk] = useState<boolean | null>(null)

  // Health probe on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const h = await checkRuntimeHealth()
        if (!cancelled) setHealthOk(h.ok)
      } catch {
        if (!cancelled) setHealthOk(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Poll cycles whenever an agent is active.
  useEffect(() => {
    if (!agent) return
    let cancelled = false
    const refresh = async () => {
      try {
        const { cycles: cs } = await listCycles(agent.tokenId, 50)
        if (!cancelled) setCycles(cs)
      } catch {
        // ignore transient errors during polling
      }
    }
    refresh()
    const id = window.setInterval(refresh, 5_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [agent])

  const handleActivate = async () => {
    setError('')
    setStatus('activating')
    try {
      const tokenId = Number(tokenIdStr)
      if (!Number.isFinite(tokenId) || tokenId <= 0) {
        throw new Error('Enter a valid tokenId')
      }
      if (!walletClient || !address) {
        throw new Error('Connect MetaMask first.')
      }
      const signer = await walletClientToSigner(walletClient)

      // Pull encryptedURI from the agent contract, download the cipher, decrypt.
      const snapshot = await readTokenFromChain(tokenId, signer)
      const blob = await downloadGenome(parseRootHashFromUri(snapshot.encryptedURI))
      const key = await deriveGenomeKey(signer, tokenId)
      const genome = await decryptGenome(blob, key)

      // Sanity-check that the lineage we'll send matches what was minted.
      const expectedHash = computeLineageHash(DEFAULT_LINEAGE)
      if (
        snapshot.lineageHash.toLowerCase() !== expectedHash.toLowerCase()
      ) {
        // Non-fatal — we still activate, just warn in the error slot.
        setError(
          `note: token #${tokenId} lineageHash differs from default ETH/USDC v3 — activating anyway`,
        )
      }

      const { agent: a } = await activateAgent({
        tokenId,
        ownerAddress: address,
        genome,
        lineage: DEFAULT_LINEAGE,
      })
      setAgent(a)
      setStatus('idle')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  const handleTickNow = async () => {
    if (!agent) return
    setStatus('ticking')
    setError('')
    try {
      await tickAgent(agent.tokenId)
      // listCycles polling will pick up the new row within 5s.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStatus('idle')
    }
  }

  return (
    <div className="trade-container">
      <article className="trade-card">
        <header className="card-header">
          <div className="card-header-text">
            <p className="eyebrow">Step 7 · Trade · Autonomous Agent (Phase 1)</p>
            <h1 className="title">Activate &amp; Run</h1>
            <p className="subtitle">
              Decrypts the iNFT's genome locally and ships it to the
              agent-runtime backend, which evaluates the strategy against live
              market data each cycle. Phase 1 stubs the gatekeeper LLM and
              the Uniswap swap — Phase 2 wires real 0G Compute and Base
              Sepolia execution.
            </p>
          </div>
        </header>

        <section className="runtime-status">
          <span className="runtime-label">Runtime</span>
          <code className="runtime-url">{RUNTIME_BASE_URL}</code>
          {healthOk === null && <span className="runtime-pill pending">checking…</span>}
          {healthOk === true && <span className="runtime-pill ok">healthy</span>}
          {healthOk === false && (
            <span className="runtime-pill fail">unreachable</span>
          )}
        </section>

        <section className="activate-row">
          <div className="parent-input">
            <label htmlFor="trade-token">Token id</label>
            <input
              id="trade-token"
              type="number"
              min={1}
              value={tokenIdStr}
              onChange={(e) => setTokenIdStr(e.target.value)}
              disabled={status === 'activating'}
            />
          </div>
          <button
            className="btn btn-primary"
            type="button"
            disabled={!isConnected || status === 'activating' || healthOk === false}
            onClick={handleActivate}
          >
            {status === 'activating' ? 'Activating…' : 'Activate agent'}
          </button>
          {agent && (
            <button
              className="btn btn-ghost"
              type="button"
              disabled={status === 'ticking'}
              onClick={handleTickNow}
            >
              {status === 'ticking' ? 'Running…' : 'Run cycle now'}
            </button>
          )}
        </section>

        {error && <p className="trade-error">{error}</p>}

        {agent && (
          <section className="agent-summary">
            <p className="summary-label">Agent #{agent.tokenId}</p>
            <dl className="summary-grid">
              <div>
                <dt>status</dt>
                <dd>{agent.status}</dd>
              </div>
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
                <dt>realised pnl</dt>
                <dd className="mono">{agent.realizedPnlBps} bps</dd>
              </div>
              <div>
                <dt>trades</dt>
                <dd className="mono">{agent.cumulativeTrades}</dd>
              </div>
              <div>
                <dt>activated</dt>
                <dd className="mono small">
                  {new Date(agent.activatedAt).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt>last cycle</dt>
                <dd className="mono small">
                  {agent.lastCycleAt
                    ? new Date(agent.lastCycleAt).toLocaleString()
                    : '—'}
                </dd>
              </div>
            </dl>
          </section>
        )}

        {agent && (
          <section className="cycles-section">
            <p className="summary-label">Recent cycles ({cycles.length})</p>
            {cycles.length === 0 ? (
              <p className="empty">
                No cycles yet. Click "Run cycle now" to fire one, or wait for
                the cron tick.
              </p>
            ) : (
              <ol className="cycles-list">
                {cycles.map((c) => (
                  <CycleRow key={c.id} cycle={c} />
                ))}
              </ol>
            )}
          </section>
        )}
      </article>
    </div>
  )
}

function CycleRow({ cycle }: { cycle: RuntimeCycle }) {
  const m = cycle.marketSnapshot
  const klass = `cycle-row signal-${cycle.alphaSignal} ${cycle.llmDecision === 'accept' ? 'gate-accept' : 'gate-reject'}`
  return (
    <li className={klass}>
      <header className="cycle-row-header">
        <span className="cycle-no">#{cycle.cycleNo}</span>
        <span className="cycle-ts">{new Date(cycle.ts).toLocaleTimeString()}</span>
        <span className={`pill signal-${cycle.alphaSignal}`}>
          {cycle.alphaSignal}
        </span>
        <span className={`pill gate-${cycle.llmDecision}`}>
          {cycle.llmDecision ?? '—'}
        </span>
        <span className={`pill trade-${cycle.tradeAction}`}>
          {cycle.tradeAction ?? 'skip'}
        </span>
        {cycle.pnlBpsCumulative !== null && (
          <span className="pnl mono">{cycle.pnlBpsCumulative} bps</span>
        )}
      </header>
      <div className="cycle-row-body">
        <div className="cycle-market mono">
          ETH ${m.spot.toFixed(2)} · 24h {(m.spot24hChangeBps / 100).toFixed(2)}% ·
          FNG {m.fearGreed} ({m.fearGreedClassification}) · vol{' '}
          {(m.volatility24hBps / 100).toFixed(2)}%
          {m.fundingRateBps !== undefined &&
            ` · funding ${m.fundingRateBps}bps`}
        </div>
        {cycle.alphaReason && (
          <div className="cycle-reason">
            <span>α</span> {cycle.alphaReason}
          </div>
        )}
        {cycle.llmReason && (
          <div className="cycle-reason">
            <span>🛡</span> {cycle.llmReason}
          </div>
        )}
        {cycle.tradePrice !== null && (
          <div className="cycle-reason mono">
            ↳ {cycle.tradeAction} @ ${cycle.tradePrice.toFixed(2)} ·{' '}
            {cycle.tradeQty} ETH{cycle.tradeTxHash ? ` · tx ${cycle.tradeTxHash.slice(0, 10)}…` : ''}
          </div>
        )}
      </div>
    </li>
  )
}
