import { useEffect, useState } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import { walletClientToSigner } from '../../lib/zgInference'
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
import ChromosomePair from '../ChromosomePair'
import LogTicker, { stampLog, type LogEntry } from '../LogTicker'
import '../../styles/Mint.css'

type FounderId = 'F1' | 'F2'

// =====================================================================
//                  Hardcoded purebred founder presets
// =====================================================================
//
// Each founder is HOMOZYGOUS at every locus — both haplotypes carry the
// same allele. Visually, both chromosomes of the pair look identical,
// which is the textbook "purebred parental" generation. Breeding F1 × F2
// produces uniformly heterozygous F2 children (per spec, gen=2 in JSON).

const NOW = new Date().toISOString()

const F1_GENOME: Genome = {
  trigger: {
    locusId: 'I',
    alleles: [
      { type: 'momentum', lookback: 24, threshold: 0.02 },
      { type: 'momentum', lookback: 24, threshold: 0.02 },
    ],
    dominance: 'momentum',
  },
  filter: {
    locusId: 'II',
    alleles: [
      { type: 'volatility-narrow', min: 0.007, max: 0.025 },
      { type: 'volatility-narrow', min: 0.007, max: 0.025 },
    ],
    dominance: 'volatility-narrow',
  },
  parents: [],
  generation: 0,
  createdAt: NOW,
}

const F2_GENOME: Genome = {
  trigger: {
    locusId: 'I',
    alleles: [
      { type: 'reversion', window: 24, zThreshold: 1.0 },
      { type: 'reversion', window: 24, zThreshold: 1.0 },
    ],
    dominance: 'reversion',
  },
  filter: {
    locusId: 'II',
    alleles: [
      { type: 'volatility-wide', min: 0.005, max: 0.04 },
      { type: 'volatility-wide', min: 0.005, max: 0.04 },
    ],
    dominance: 'volatility-wide',
  },
  parents: [],
  generation: 0,
  createdAt: NOW,
}

const FOUNDER_DESCRIPTIONS: Record<FounderId, string> = {
  F1: 'Momentum × Volatility-Narrow · purebred',
  F2: 'Mean-Reversion × Volatility-Wide · purebred',
}

function genomeFor(id: FounderId): Genome {
  return id === 'F1' ? F1_GENOME : F2_GENOME
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
}

type FounderState = {
  result?: MintFounderResult
  busy: boolean
}

const emptyState: FounderState = { busy: false }

export default function Mint({ universeParams, onContinue }: Props) {
  const { isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const [agentAddress, setAgentAddress] = useState<string | null>(
    getMendelAgentAddress(),
  )
  const [breederAddress, setBreederAddress] = useState<string | null>(
    getMendelBreederAddress(),
  )
  const [agentBreederLink, setAgentBreederLink] = useState<string | null>(null)
  const [deploying, setDeploying] = useState(false)
  const [breederDeploying, setBreederDeploying] = useState(false)
  const [f1, setF1] = useState<FounderState>(emptyState)
  const [f2, setF2] = useState<FounderState>(emptyState)
  const [logs, setLogs] = useState<LogEntry[]>([])

  const appendLog = (message: string) =>
    setLogs((prev) => [...prev, stampLog(message)])

  useEffect(() => {
    setAgentAddress(getMendelAgentAddress())
    setBreederAddress(getMendelBreederAddress())
  }, [])

  useEffect(() => {
    if (!agentAddress || !breederAddress || !walletClient) {
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
      const signer = await walletClientToSigner(walletClient)
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
      const signer = await walletClientToSigner(walletClient)
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
      const signer = await walletClientToSigner(walletClient)
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
              />
              <FounderPanel
                id="F2"
                state={f2}
                ready={!!ready}
                onMint={handleMint}
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
}

function FounderPanel({ id, state, ready, onMint }: FounderPanelProps) {
  const genome = genomeFor(id)
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
