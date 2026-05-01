'use client'

import { useEffect, useState } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import { walletClientToSigner } from '../lib/zgInference'
import {
  breedFlow,
  getMendelAgentAddress,
  getMendelBreederAddress,
  verifyChildDecryption,
  type ChildResult,
} from '../lib/inft'
import type { BreedFlowEvent } from '../lib/inft'
import type { Genome } from '../lib/genome'
import ChromosomePair, {
  ChromosomePairPlaceholder,
} from './ChromosomePair'
import LogTicker, { stampLog, type LogEntry } from './LogTicker'
import '../styles/BreedingFlow.css'

type ChildSlot = {
  index: number
  genome?: Genome
  predictedTokenId?: number
  tokenId?: number
  rootHash?: string
  uploadTxHash?: string
  decryptOk?: boolean
  status: 'empty' | 'recombined' | 'uploaded' | 'minted'
}

const EMPTY_SLOTS: ChildSlot[] = Array.from({ length: 9 }, (_, i) => ({
  index: i,
  status: 'empty' as const,
}))

type BreedingFlowProps = {
  onContinue?: () => void
}

export default function BreedingFlow({ onContinue }: BreedingFlowProps) {
  const { isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const [parentA, setParentA] = useState<number>(1)
  const [parentB, setParentB] = useState<number>(2)
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [error, setError] = useState<string>('')
  const [parentAGenome, setParentAGenome] = useState<Genome | null>(null)
  const [parentBGenome, setParentBGenome] = useState<Genome | null>(null)
  const [requestId, setRequestId] = useState<number | null>(null)
  const [seed, setSeed] = useState<string>('')
  const [requestTxHash, setRequestTxHash] = useState<string>('')
  const [fulfillTxHash, setFulfillTxHash] = useState<string>('')
  const [childSlots, setChildSlots] = useState<ChildSlot[]>(EMPTY_SLOTS)
  const [childResults, setChildResults] = useState<ChildResult[] | null>(null)

  const agentAddress = getMendelAgentAddress()
  const breederAddress = getMendelBreederAddress()
  const ready =
    isConnected && !!walletClient && !!agentAddress && !!breederAddress

  const appendLog = (message: string) =>
    setLogs((prev) => [...prev, stampLog(message)])

  const handleEvent = (event: BreedFlowEvent) => {
    switch (event.type) {
      case 'log':
        appendLog(event.message)
        break
      case 'parents-decrypted':
        setParentAGenome(event.parentAGenome)
        setParentBGenome(event.parentBGenome)
        break
      case 'request-registered':
        setRequestId(event.requestId)
        setSeed(event.seed)
        setRequestTxHash(event.txHash)
        break
      case 'recombined':
        // Pre-stage all 9 slot genomes so the layout reserves space, but
        // keep them invisible (status: 'empty') until each upload completes.
        setChildSlots(
          event.childGenomes.map((g, i) => ({
            index: i,
            genome: g,
            status: 'recombined' as const,
          })),
        )
        break
      case 'child-uploaded':
        setChildSlots((prev) =>
          prev.map((s) =>
            s.index === event.index
              ? {
                  ...s,
                  genome: event.child.genome,
                  predictedTokenId: event.child.predictedTokenId,
                  rootHash: event.child.rootHash,
                  uploadTxHash: event.child.uploadTxHash,
                  status: 'uploaded' as const,
                }
              : s,
          ),
        )
        break
      case 'fulfilled':
        setFulfillTxHash(event.txHash)
        setChildSlots((prev) =>
          prev.map((s, i) => ({
            ...s,
            tokenId: event.childTokenIds[i],
            status: 'minted' as const,
          })),
        )
        break
    }
  }

  // After fulfillment, kick off the round-trip decrypt verification.
  useEffect(() => {
    if (!childResults || !walletClient) return
    let cancelled = false
    ;(async () => {
      try {
        const signer = await walletClientToSigner(walletClient)
        for (const child of childResults) {
          const v = await verifyChildDecryption(child, signer)
          if (cancelled) return
          setChildSlots((prev) =>
            prev.map((s) =>
              s.tokenId === child.tokenId
                ? { ...s, decryptOk: v.ok }
                : s,
            ),
          )
        }
        if (!cancelled) {
          appendLog('Decryption verified for all children. ✓')
        }
      } catch (e) {
        if (!cancelled) {
          appendLog(
            `Verification error: ${
              e instanceof Error ? e.message : String(e)
            }`,
          )
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childResults])

  const handleBreed = async () => {
    if (!walletClient) return
    setRunning(true)
    setLogs([])
    setError('')
    setParentAGenome(null)
    setParentBGenome(null)
    setRequestId(null)
    setSeed('')
    setRequestTxHash('')
    setFulfillTxHash('')
    setChildSlots(EMPTY_SLOTS)
    setChildResults(null)
    try {
      const signer = await walletClientToSigner(walletClient)
      const r = await breedFlow(parentA, parentB, signer, handleEvent)
      setChildResults(r.children)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="breed-container">
      <article className="breed-card">
        <header className="card-header">
          <div className="card-header-text">
            <p className="eyebrow">Step 5 · Breed</p>
            <h1 className="title">Cross-Breed Founders</h1>
            <p className="subtitle">
              Decrypts both parents in your browser, requests a breed on-chain
              for an unpredictable seed, samples 9 children deterministically,
              encrypts each under a token-id-bound key, uploads to 0G Storage,
              and submits a single EIP-712-signed
              <code> fulfillBreeding</code> tx to mint all 9.
            </p>
          </div>
          {onContinue && (
            <button
              className="btn btn-primary card-header-continue"
              type="button"
              onClick={onContinue}
            >
              Continue →
            </button>
          )}
        </header>

        {/* Compact action strip on top */}
        <section className="action-strip">
          <div className="parent-input">
            <label htmlFor="parentA">Parent A</label>
            <input
              id="parentA"
              type="number"
              min={1}
              value={parentA}
              onChange={(e) => setParentA(Number(e.target.value))}
              disabled={running}
            />
          </div>
          <div className="cross-mini">×</div>
          <div className="parent-input">
            <label htmlFor="parentB">Parent B</label>
            <input
              id="parentB"
              type="number"
              min={1}
              value={parentB}
              onChange={(e) => setParentB(Number(e.target.value))}
              disabled={running}
            />
          </div>
          <button
            className="btn btn-primary action-strip-button"
            onClick={handleBreed}
            disabled={!ready || running || parentA === parentB}
            type="button"
          >
            {running ? 'Breeding…' : 'Breed founders'}
          </button>
          {requestId !== null && (
            <span className="action-strip-meta">
              request <strong>#{requestId}</strong> · seed{' '}
              <code>{seed.slice(0, 12)}…</code>
            </span>
          )}
        </section>

        {!agentAddress && (
          <p className="hint">Deploy MendelAgent on the Mint tab first.</p>
        )}
        {agentAddress && !breederAddress && (
          <p className="hint">Deploy MendelBreeder on the Mint tab first.</p>
        )}

        {error && (
          <div className="breed-error">
            <p className="breed-error-label">Error</p>
            <p className="breed-error-text">{error}</p>
          </div>
        )}

        {/* Main grid: family tree + logs sidebar */}
        <div className="breed-layout">
          <div className="breed-main">
            <FamilyTree
              parentA={parentA}
              parentB={parentB}
              parentAGenome={parentAGenome}
              parentBGenome={parentBGenome}
              slots={childSlots}
              requestId={requestId}
              seed={seed}
              requestTxHash={requestTxHash}
              fulfillTxHash={fulfillTxHash}
            />
          </div>
          <aside className="breed-sidebar">
            <LogTicker
              logs={logs}
              label="Breeding log"
              emptyHint="Click Breed founders to start the flow."
              fill
            />
          </aside>
        </div>
      </article>
    </div>
  )
}

// =====================================================================
//                            Family tree
// =====================================================================

type FamilyTreeProps = {
  parentA: number
  parentB: number
  parentAGenome: Genome | null
  parentBGenome: Genome | null
  slots: ChildSlot[]
  requestId: number | null
  seed: string
  requestTxHash: string
  fulfillTxHash: string
}

function FamilyTree({
  parentA,
  parentB,
  parentAGenome,
  parentBGenome,
  slots,
  requestId,
  seed,
  requestTxHash,
  fulfillTxHash,
}: FamilyTreeProps) {
  return (
    <section className="family-tree">
      <header className="family-tree-header">
        <p className="eyebrow">Lineage</p>
        {requestId !== null && (
          <div className="breed-meta">
            <span>
              request <strong>#{requestId}</strong>
            </span>
            <span>
              seed <code>{seed.slice(0, 18)}…</code>
            </span>
            {requestTxHash && (
              <a
                href={`https://chainscan-galileo.0g.ai/tx/${requestTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                request tx
              </a>
            )}
            {fulfillTxHash && (
              <a
                href={`https://chainscan-galileo.0g.ai/tx/${fulfillTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                fulfill tx
              </a>
            )}
          </div>
        )}
      </header>

      <div className="parents-row">
        <ParentPanel
          tokenId={parentA}
          genome={parentAGenome}
          role="A"
        />
        <div className="cross-symbol">×</div>
        <ParentPanel
          tokenId={parentB}
          genome={parentBGenome}
          role="B"
        />
      </div>

      <div className="lineage-bar" aria-hidden="true" />

      <div className="children-grid">
        {slots.map((slot) => (
          <ChildSlotCard key={slot.index} slot={slot} />
        ))}
      </div>
    </section>
  )
}

function ParentPanel({
  tokenId,
  genome,
  role,
}: {
  tokenId: number
  genome: Genome | null
  role: 'A' | 'B'
}) {
  return (
    <div className="parent-panel">
      <header className="parent-panel-header">
        <span className="parent-panel-tag">F{role}</span>
        <span className="parent-panel-id">#{tokenId}</span>
      </header>
      {genome ? (
        <ChromosomePair genome={genome} size="lg" />
      ) : (
        <ChromosomePairPlaceholder size="lg" />
      )}
    </div>
  )
}

function ChildSlotCard({ slot }: { slot: ChildSlot }) {
  const showChromosomes = slot.status === 'uploaded' || slot.status === 'minted'
  const verifyMark =
    slot.decryptOk === true
      ? '✓'
      : slot.decryptOk === false
      ? '✗'
      : null
  const verifyClass =
    slot.decryptOk === true
      ? 'verify-pass'
      : slot.decryptOk === false
      ? 'verify-fail-mark'
      : ''
  return (
    <div className={`child-slot status-${slot.status}`}>
      <header className="child-slot-header">
        <span className="child-slot-id">
          {slot.tokenId
            ? `#${slot.tokenId}`
            : slot.predictedTokenId
            ? `#${slot.predictedTokenId}?`
            : '—'}
        </span>
        {verifyMark && (
          <span className={`verify-mark ${verifyClass}`}>{verifyMark}</span>
        )}
        {slot.status === 'minted' && slot.tokenId !== undefined && (
          <a
            className="child-slot-link"
            href={`https://chainscan-galileo.0g.ai/token/${getMendelAgentAddress()}?a=${slot.tokenId}`}
            target="_blank"
            rel="noopener noreferrer"
            title="View on ChainScan"
          >
            ↗
          </a>
        )}
      </header>
      <div className="child-slot-viz">
        {showChromosomes && slot.genome ? (
          <ChromosomePair genome={slot.genome} size="sm" />
        ) : (
          <ChromosomePairPlaceholder size="sm" />
        )}
      </div>
      <footer className="child-slot-footer">
        <span className="fitness-placeholder">fitness —</span>
      </footer>
    </div>
  )
}
