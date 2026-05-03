'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAccount, useSwitchChain, useWalletClient } from 'wagmi'
import { getZeroGSigner, walletClientToSigner } from '../../lib/zgInference'
import {
  deployMendelAgent,
  deployMendelBreeder,
  getMendelAgentAddress,
  getMendelBreederAddress,
  mintFounder,
  readAgentBreederLink,
  type LineageParams,
  type MintFounderResult,
} from '../../lib/inft'
import type { Genome } from '../../lib/genome'
import type { UniverseParams } from './UniverseParameters'
import type { RecommendedParams } from '../../lib/recommendedParams'
import {
  buildF1FromCells,
  buildF2FromCells,
  EMPTY_ALPHA_CELLS,
  type AlphaCells,
} from '../../lib/alphaCells'
import ChromosomePair from '../ChromosomePair'
import LogTicker, { stampLog, type LogEntry } from '../LogTicker'
import '../../styles/Mint.css'

type FounderId = 'F1' | 'F2'

// =====================================================================
//                  Purebred founder presets (cell-derived)
// =====================================================================
//
// Each founder is HOMOZYGOUS at every locus — both haplotypes carry the
// same allele. Visually, both chromosomes of the pair look identical,
// which is the textbook "purebred parental" generation. Breeding F1 × F2
// produces segregating F2 children (the recombination skips a generation
// internally, see lib/genome.ts).
//
// Founder construction now reads from `alphaCells` — the strategy-grid
// placements the user made on the Alpha tab — so any custom gene swap
// or per-cell threshold edit flows through to what gets minted on-chain.
// `recommendedParams` still feeds the chip defaults on Alpha, which then
// become the cells' default param values; if the user makes no edits
// the founders end up identical to what the prior phase produced.

const FOUNDER_DESCRIPTIONS: Record<FounderId, string> = {
  F1: 'Dominant strategy from Alpha tab · purebred',
  F2: 'Recessive strategy from Alpha tab · purebred',
}

// =====================================================================
//                    Lineage from universe params
// =====================================================================

function buildLineageParams(universe?: UniverseParams): LineageParams {
  const venue =
    universe?.venue === 'uniswap'
      ? 'uniswap-v3'
      : universe?.venue || 'uniswap-v3'
  const asset = universe?.pair
    ? universe.pair.toUpperCase().replace(/\//g, '/')
    : 'ETH/USDC'
  const barInterval = universe?.timeframe || '1h'
  return {
    asset,
    venue,
    barInterval,
    hasGrid: true,
    loci: ['trigger', 'filter'],
  }
}

// =====================================================================
//                              Component
// =====================================================================

type Props = {
  universeParams?: UniverseParams
  onContinue?: () => void
  recommendedParams?: RecommendedParams | null
  alphaCells?: AlphaCells
}

type FounderState = {
  result?: MintFounderResult
  busy: boolean
}

const emptyState: FounderState = { busy: false }

export default function Mint({
  universeParams,
  onContinue,
  recommendedParams = null,
  alphaCells = EMPTY_ALPHA_CELLS,
}: Props) {
  // Memoize the founder genomes so they only rebuild when either the
  // user's Alpha-tab placements change OR the live recommendation
  // refreshes — avoids a fresh `createdAt` on every render, which would
  // invalidate child genome equality checks.
  const founderGenomes = useMemo(
    () => ({
      F1: buildF1FromCells(alphaCells, recommendedParams),
      F2: buildF2FromCells(alphaCells, recommendedParams),
    }),
    [alphaCells, recommendedParams],
  )
  const genomeFor = (id: FounderId): Genome => founderGenomes[id]
  const { isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()
  const [agentAddress, setAgentAddress] = useState<string | null>(null)
  const [breederAddress, setBreederAddress] = useState<string | null>(null)
  const [agentBreederLink, setAgentBreederLink] = useState<string | null>(null)
  const [deploying, setDeploying] = useState(false)
  const [breederDeploying, setBreederDeploying] = useState(false)
  const [f1, setF1] = useState<FounderState>(emptyState)
  const [f2, setF2] = useState<FounderState>(emptyState)
  const [logs, setLogs] = useState<LogEntry[]>([])

  const appendLog = (message: string) =>
    setLogs((prev) => [...prev, stampLog(message)])

  // Hydrate once on mount — getMendelAgentAddress reads localStorage which is
  // unavailable during SSR.
  useEffect(() => {
    setAgentAddress(getMendelAgentAddress())
    setBreederAddress(getMendelBreederAddress())
  }, [])

  useEffect(() => {
    if (!agentAddress || !breederAddress || !walletClient) {
      setAgentBreederLink(null)
      return
    }
    // The MendelAgent contract only exists on 0G Galileo. If the wallet's
    // currently on Base Sepolia (likely after a Trade-tab top-up), skip
    // the read instead of forcing a chain-switch popup just for a status
    // tick — user will see "—" and the deploy/mint flows will switch the
    // chain as needed when they actually act.
    if (walletClient.chain.id !== 16602) {
      setAgentBreederLink(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const signer = await walletClientToSigner(walletClient)
        const linked = await readAgentBreederLink(signer)
        if (!cancelled) setAgentBreederLink(linked)
      } catch {
        if (!cancelled) setAgentBreederLink(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [agentAddress, breederAddress, walletClient])

  const lineageParams = buildLineageParams(universeParams)

  const handleDeploy = async () => {
    if (!walletClient) return
    setDeploying(true)
    appendLog('Submitting MendelAgent deploy tx (approve in MetaMask)…')
    try {
      const signer = await getZeroGSigner(walletClient, switchChainAsync)
      const { address, txHash } = await deployMendelAgent(signer)
      setAgentAddress(address)
      appendLog(
        `MendelAgent deployed at ${address} (tx ${txHash.slice(0, 10)}…).`,
      )
    } catch (e) {
      appendLog(`Agent deploy failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setDeploying(false)
    }
  }

  const handleDeployBreeder = async () => {
    if (!walletClient) return
    setBreederDeploying(true)
    appendLog('Deploying MendelBreeder (approve in MetaMask)…')
    try {
      const signer = await getZeroGSigner(walletClient, switchChainAsync)
      const { breederAddress: b, deployTxHash, setBreederTxHash } =
        await deployMendelBreeder(signer)
      setBreederAddress(b)
      const linked = await readAgentBreederLink(signer)
      setAgentBreederLink(linked)
      appendLog(
        `MendelBreeder deployed at ${b} (deploy ${deployTxHash.slice(0, 10)}…, link ${setBreederTxHash.slice(0, 10)}…).`,
      )
    } catch (e) {
      appendLog(`Breeder deploy failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBreederDeploying(false)
    }
  }

  const setFounder = (id: FounderId, patch: Partial<FounderState>) => {
    if (id === 'F1') setF1((prev) => ({ ...prev, ...patch }))
    else setF2((prev) => ({ ...prev, ...patch }))
  }

  const handleMint = async (id: FounderId) => {
    if (!walletClient) return
    const genome = genomeFor(id)
    setFounder(id, { busy: true, result: undefined })
    appendLog(`${id}: starting mint…`)
    try {
      const signer = await getZeroGSigner(walletClient, switchChainAsync)
      const result = await mintFounder(genome, lineageParams, signer, (m) =>
        appendLog(`${id}: ${m}`),
      )
      setFounder(id, { result, busy: false })
      appendLog(
        `${id}: minted as token #${result.tokenId} (mint ${result.txHash.slice(0, 10)}…).`,
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      appendLog(`${id}: mint failed — ${msg}`)
      setFounder(id, { busy: false })
    }
  }

  const ready = isConnected && agentAddress

  return (
    <div className="mint-container">
      <article className="mint-card">
        <header className="card-header">
          <div className="card-header-text">
            <p className="eyebrow">Step 4 · Mint iNFTs</p>
            <h1 className="title">Mint Founder Strategies</h1>
            <p className="subtitle">
              Each founder is encrypted client-side with a wallet-derived key,
              uploaded to 0G Storage, and minted as an iNFT on the MendelAgent
              contract. Both haplotypes carry the same allele — purebred
              parental stock.
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

        {/* ---- Compact contract strip ---- */}
        <section className="contract-strip">
          <ContractBadge
            label="MendelAgent"
            address={agentAddress}
            onReset={() => {
              if (
                confirm('Reset MendelAgent address? (Also clears breeder.)')
              ) {
                window.localStorage.removeItem('mendel.agentAddress')
                window.localStorage.removeItem('mendel.breederAddress')
                setAgentAddress(null)
                setBreederAddress(null)
                setAgentBreederLink(null)
              }
            }}
            onDeploy={handleDeploy}
            deploying={deploying}
            canDeploy={!!isConnected}
          />
          <ContractBadge
            label="MendelBreeder"
            address={breederAddress}
            onReset={() => {
              if (confirm('Reset MendelBreeder address?')) {
                window.localStorage.removeItem('mendel.breederAddress')
                setBreederAddress(null)
                setAgentBreederLink(null)
              }
            }}
            onDeploy={handleDeployBreeder}
            deploying={breederDeploying}
            canDeploy={!!isConnected && !!agentAddress}
            disabledHint={!agentAddress ? 'deploy agent first' : undefined}
            link={agentBreederLink}
          />
        </section>

        {/* ---- Main grid: founders + logs sidebar ---- */}
        <div className="mint-layout">
          <div className="mint-main">
            <section className="founders-row">
              <FounderPanel
                id="F1"
                state={f1}
                ready={!!ready}
                onMint={handleMint}
                genome={founderGenomes.F1}
              />
              <FounderPanel
                id="F2"
                state={f2}
                ready={!!ready}
                onMint={handleMint}
                genome={founderGenomes.F2}
              />
            </section>

            <section className="lineage-summary">
              <p className="lineage-label">
                Lineage params (committed in lineageHash)
              </p>
              <pre className="lineage-pre">
                {JSON.stringify(lineageParams, null, 2)}
              </pre>
            </section>
          </div>

          <aside className="mint-sidebar">
            <LogTicker
              logs={logs}
              label="Mint log"
              emptyHint="Deploy contracts and click Mint to start."
              fill
            />
          </aside>
        </div>
      </article>
    </div>
  )
}

// =====================================================================
//                          Contract badge
// =====================================================================

type ContractBadgeProps = {
  label: string
  address: string | null
  link?: string | null
  onReset: () => void
  onDeploy: () => void
  deploying: boolean
  canDeploy: boolean
  disabledHint?: string
}

function ContractBadge({
  label,
  address,
  link,
  onReset,
  onDeploy,
  deploying,
  canDeploy,
  disabledHint,
}: ContractBadgeProps) {
  if (address) {
    const linked = link
      ? link.toLowerCase() === address.toLowerCase()
      : null
    return (
      <div className="contract-badge configured">
        <span className="contract-badge-label">{label}</span>
        <code className="contract-badge-address" title={address}>
          {address.slice(0, 8)}…{address.slice(-4)}
        </code>
        {linked === true && (
          <span className="contract-badge-tick" title="agent.breeder() matches">
            ✓
          </span>
        )}
        {linked === false && (
          <span className="contract-badge-warn" title="agent.breeder() mismatch">
            ⚠
          </span>
        )}
        <button className="btn-link" type="button" onClick={onReset}>
          reset
        </button>
      </div>
    )
  }
  return (
    <div className="contract-badge unconfigured">
      <span className="contract-badge-label">{label}</span>
      <button
        className="btn btn-primary contract-badge-deploy"
        type="button"
        onClick={onDeploy}
        disabled={!canDeploy || deploying}
        title={disabledHint}
      >
        {deploying ? 'Deploying…' : `Deploy ${label}`}
      </button>
    </div>
  )
}

// =====================================================================
//                            Founder panel
// =====================================================================

type FounderPanelProps = {
  id: FounderId
  state: FounderState
  ready: boolean
  onMint: (id: FounderId) => void
  genome: Genome
}

function FounderPanel({ id, state, ready, onMint, genome }: FounderPanelProps) {
  return (
    <div className={`founder-panel founder-${id.toLowerCase()}`}>
      <header className="founder-panel-header">
        <span className="founder-panel-tag">{id}</span>
        {state.result?.tokenId ? (
          <span className="founder-panel-token">
            token #{state.result.tokenId}
          </span>
        ) : (
          <span className="founder-panel-token muted">unminted</span>
        )}
      </header>

      <div className="founder-panel-viz">
        <ChromosomePair genome={genome} size="lg" />
      </div>

      <p className="founder-panel-desc">{FOUNDER_DESCRIPTIONS[id]}</p>

      {state.result ? (
        <a
          className="founder-panel-link"
          href={`https://chainscan-galileo.0g.ai/tx/${state.result.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          view mint tx ↗
        </a>
      ) : (
        <button
          className="btn btn-primary founder-panel-button"
          onClick={() => onMint(id)}
          disabled={!ready || state.busy}
          type="button"
        >
          {state.busy ? 'Minting…' : `Mint ${id}`}
        </button>
      )}
    </div>
  )
}
