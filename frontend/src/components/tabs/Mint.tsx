import { useEffect, useState } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import { walletClientToSigner } from '../../lib/zgInference'
import {
  deployMendelAgent,
  getMendelAgentAddress,
  mintFounder,
  readTokenFromChain,
  type LineageParams,
  type MintFounderResult,
  type OnChainTokenSnapshot,
} from '../../lib/inft'
import type { Genome } from '../../lib/genome'
import type { UniverseParams } from './UniverseParameters'
import '../../styles/Mint.css'

type FounderId = 'F1' | 'F2'

// =====================================================================
//                     Hardcoded founder presets
// =====================================================================
//
// Each founder is heterozygous over the same allele pool; only the
// dominance differs. Breeding F1 × F2 in v1 produces a Punnett-square
// distribution of children — Mendel's first law in code.

const NOW = new Date().toISOString()

const F1_GENOME: Genome = {
  trigger: {
    locusId: 'I',
    alleles: [
      { type: 'momentum', lookback: 24, threshold: 0.02 },
      { type: 'reversion', window: 24, zThreshold: 1.0 },
    ],
    dominance: 'momentum',
  },
  filter: {
    locusId: 'II',
    alleles: [
      { type: 'volatility-narrow', min: 0.007, max: 0.025 },
      { type: 'volatility-wide', min: 0.005, max: 0.04 },
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
      { type: 'momentum', lookback: 24, threshold: 0.02 },
      { type: 'reversion', window: 24, zThreshold: 1.0 },
    ],
    dominance: 'reversion',
  },
  filter: {
    locusId: 'II',
    alleles: [
      { type: 'volatility-narrow', min: 0.007, max: 0.025 },
      { type: 'volatility-wide', min: 0.005, max: 0.04 },
    ],
    dominance: 'volatility-wide',
  },
  parents: [],
  generation: 0,
  createdAt: NOW,
}

const FOUNDER_LABELS: Record<FounderId, string> = {
  F1: 'Founder 1',
  F2: 'Founder 2',
}

const FOUNDER_DESCRIPTIONS: Record<FounderId, string> = {
  F1: 'Momentum trigger (24h, 2.0%) · Volatility filter narrow (0.7%–2.5%)',
  F2: 'Mean-reversion trigger (24h, 1.0σ) · Volatility filter wide (0.5%–4.0%)',
}

// =====================================================================
//                    Lineage builder from universe
// =====================================================================

function buildLineageParams(universe?: UniverseParams): LineageParams {
  // Map UI selections → canonical lineage strings used for grouping
  // strategy iNFTs. Two iNFTs share lineage iff this hashes to the same
  // bytes32, so the values must be deterministic and human-readable.
  const venue =
    universe?.venue === 'uniswap' ? 'uniswap-v3' : (universe?.venue || 'uniswap-v3')
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
}

type FounderState = {
  result?: MintFounderResult
  snapshot?: OnChainTokenSnapshot
  status?: string
  error?: string
  busy: boolean
}

const emptyState: FounderState = { busy: false }

export default function Mint({ universeParams }: Props) {
  const { isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const [agentAddress, setAgentAddress] = useState<string | null>(
    getMendelAgentAddress(),
  )
  const [deploying, setDeploying] = useState(false)
  const [deployStatus, setDeployStatus] = useState<string>('')
  const [deployError, setDeployError] = useState<string>('')
  const [f1, setF1] = useState<FounderState>(emptyState)
  const [f2, setF2] = useState<FounderState>(emptyState)

  // Refresh address from localStorage on mount in case it was set elsewhere.
  useEffect(() => {
    setAgentAddress(getMendelAgentAddress())
  }, [])

  const lineageParams = buildLineageParams(universeParams)

  const handleDeploy = async () => {
    if (!walletClient) return
    setDeploying(true)
    setDeployStatus('Submitting deploy tx (approve in MetaMask)…')
    setDeployError('')
    try {
      const signer = await walletClientToSigner(walletClient)
      const { address, txHash } = await deployMendelAgent(signer)
      setAgentAddress(address)
      setDeployStatus(`Deployed at ${address} (tx ${txHash.slice(0, 10)}…).`)
    } catch (e) {
      setDeployError(e instanceof Error ? e.message : String(e))
      setDeployStatus('')
    } finally {
      setDeploying(false)
    }
  }

  const setFounder = (id: FounderId, patch: Partial<FounderState>) => {
    if (id === 'F1') setF1((prev) => ({ ...prev, ...patch }))
    else setF2((prev) => ({ ...prev, ...patch }))
  }

  const handleMint = async (id: FounderId) => {
    if (!walletClient) return
    const genome = id === 'F1' ? F1_GENOME : F2_GENOME
    setFounder(id, { busy: true, status: '', error: '', result: undefined, snapshot: undefined })
    try {
      const signer = await walletClientToSigner(walletClient)
      const result = await mintFounder(genome, lineageParams, signer, (m) =>
        setFounder(id, { status: m }),
      )
      setFounder(id, { result, status: 'Reading back from chain…' })
      const snapshot = await readTokenFromChain(result.tokenId, signer)
      setFounder(id, { snapshot, status: 'Done.', busy: false })
    } catch (e) {
      setFounder(id, {
        error: e instanceof Error ? e.message : String(e),
        status: '',
        busy: false,
      })
    }
  }

  return (
    <div className="mint-container">
      <article className="mint-card">
        <header className="card-header">
          <p className="eyebrow">Step 4 · Mint iNFTs</p>
          <h1 className="title">Mint Founder Strategies</h1>
          <p className="subtitle">
            Each founder is encrypted client-side with a wallet-derived key,
            uploaded to 0G Storage, and minted as an iNFT on the MendelAgent
            contract. The on-chain commitments are read back below for
            verification.
          </p>
        </header>

        <section className="agent-status">
          <p className="agent-status-label">MendelAgent contract</p>
          {agentAddress ? (
            <div className="agent-status-row">
              <code className="agent-address">{agentAddress}</code>
              <button
                className="btn-link"
                type="button"
                onClick={() => {
                  if (confirm('Reset MendelAgent address?')) {
                    window.localStorage.removeItem('mendel.agentAddress')
                    setAgentAddress(null)
                  }
                }}
              >
                reset
              </button>
            </div>
          ) : (
            <div className="agent-status-row column">
              <p className="agent-hint">
                No address configured. Deploy a fresh contract from your wallet
                — the address is cached in your browser for subsequent runs.
              </p>
              <button
                className="btn btn-primary"
                onClick={handleDeploy}
                disabled={deploying || !isConnected}
                type="button"
              >
                {deploying ? 'Deploying…' : 'Deploy MendelAgent'}
              </button>
              {deployStatus && <p className="deploy-status">{deployStatus}</p>}
              {deployError && <p className="deploy-error">{deployError}</p>}
            </div>
          )}
        </section>

        <section className="lineage-summary">
          <p className="lineage-label">Lineage params (committed in lineageHash)</p>
          <pre className="lineage-pre">{JSON.stringify(lineageParams, null, 2)}</pre>
        </section>

        <div className="founder-grid">
          <FounderCard
            id="F1"
            state={f1}
            disabled={!agentAddress || !isConnected}
            onMint={handleMint}
          />
          <FounderCard
            id="F2"
            state={f2}
            disabled={!agentAddress || !isConnected}
            onMint={handleMint}
          />
        </div>
      </article>
    </div>
  )
}

// =====================================================================
//                            Founder card
// =====================================================================

type FounderCardProps = {
  id: FounderId
  state: FounderState
  disabled: boolean
  onMint: (id: FounderId) => void
}

function FounderCard({ id, state, disabled, onMint }: FounderCardProps) {
  return (
    <div className={`founder-card founder-${id.toLowerCase()}`}>
      <header className="founder-header">
        <span className="founder-tag">{id}</span>
        <span className="founder-name">{FOUNDER_LABELS[id]}</span>
      </header>
      <p className="founder-desc">{FOUNDER_DESCRIPTIONS[id]}</p>

      <button
        className="btn btn-primary founder-mint"
        onClick={() => onMint(id)}
        disabled={disabled || state.busy}
        type="button"
      >
        {state.busy ? 'Minting…' : `Mint ${FOUNDER_LABELS[id]}`}
      </button>

      {state.status && (
        <p className="founder-status">{state.status}</p>
      )}
      {state.error && (
        <p className="founder-error">{state.error}</p>
      )}

      {state.result && (
        <div className="founder-result">
          <p className="result-section-label">Mint result</p>
          <dl className="result-dl">
            <div>
              <dt>tokenId</dt>
              <dd className="mono accent">#{state.result.tokenId}</dd>
            </div>
            <div>
              <dt>mint tx</dt>
              <dd>
                <a
                  href={`https://chainscan-galileo.0g.ai/tx/${state.result.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mono link"
                >
                  view transaction
                </a>
              </dd>
            </div>
            <div>
              <dt>storage tx</dt>
              <dd>
                {state.result.uploadTxHash ? (
                  <a
                    href={`https://chainscan-galileo.0g.ai/tx/${state.result.uploadTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mono link"
                  >
                    view transaction
                  </a>
                ) : (
                  <span className="mono">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt>rootHash</dt>
              <dd className="mono break">{state.result.rootHash}</dd>
            </div>
            <div>
              <dt>encryptedURI</dt>
              <dd className="mono break">{state.result.encryptedURI}</dd>
            </div>
          </dl>
        </div>
      )}

      {state.snapshot && (
        <div className="founder-result onchain">
          <p className="result-section-label">Read back from MendelAgent</p>
          <dl className="result-dl">
            <div>
              <dt>owner</dt>
              <dd className="mono break">{state.snapshot.owner}</dd>
            </div>
            <div>
              <dt>generation</dt>
              <dd className="mono">{state.snapshot.generation}</dd>
            </div>
            <div>
              <dt>parents</dt>
              <dd className="mono">
                ({state.snapshot.parentA}, {state.snapshot.parentB})
              </dd>
            </div>
            <div>
              <dt>encryptedURI</dt>
              <dd className="mono break">{state.snapshot.encryptedURI}</dd>
            </div>
            <div>
              <dt>metadataHash</dt>
              <dd className="mono break">{state.snapshot.metadataHash}</dd>
            </div>
            <div>
              <dt>blobHash</dt>
              <dd className="mono break">{state.snapshot.blobHash}</dd>
            </div>
            <div>
              <dt>keyCommitment</dt>
              <dd className="mono break">{state.snapshot.keyCommitment}</dd>
            </div>
            <div>
              <dt>lineageHash</dt>
              <dd className="mono break">{state.snapshot.lineageHash}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  )
}
