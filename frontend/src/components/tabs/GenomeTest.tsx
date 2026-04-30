import { useState } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import { walletClientToSigner } from '../../lib/zgInference'
import {
  blobHash,
  decryptGenome,
  deriveGenomeKey,
  deriveKeyCommitment,
  downloadGenome,
  encryptGenome,
  sealKey,
  uploadGenome,
  type Genome,
} from '../../lib/genome'
import '../../styles/GenomeTest.css'

const TEST_TOKEN_ID = 999

const sampleGenome: Genome = {
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
  createdAt: new Date('2026-04-30T00:00:00Z').toISOString(),
}

type LogKind = 'info' | 'success' | 'error' | 'step'
type LogEntry = {
  step: string
  message: string
  detail?: string
  kind: LogKind
  ts: string
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const stamp = () => new Date().toLocaleTimeString(undefined, { hour12: false })

export default function GenomeTest() {
  const { address, isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [verdict, setVerdict] = useState<'pending' | 'pass' | 'fail' | null>(null)
  const [rootHash, setRootHash] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  const append = (entry: Omit<LogEntry, 'ts'>) => {
    setLogs((prev) => [...prev, { ...entry, ts: stamp() }])
  }

  const handleRun = async () => {
    setRunning(true)
    setLogs([])
    setVerdict('pending')
    setRootHash(null)
    setTxHash(null)
    try {
      if (!walletClient || !address) {
        throw new Error('Wallet not ready — reconnect from the first tab')
      }

      // ---- 1. Derive key ----
      append({ step: '1. Derive key', kind: 'step', message: `Signing for tokenId=${TEST_TOKEN_ID}…` })
      const signer = await walletClientToSigner(walletClient)
      const key = await deriveGenomeKey(signer, TEST_TOKEN_ID)
      const commitment = deriveKeyCommitment(address, TEST_TOKEN_ID)
      const sealed = sealKey(key, address)
      append({
        step: '1. Derive key',
        kind: 'success',
        message: `key (32B) derived; cached for session.`,
        detail: `keyCommitment = ${commitment}\nsealedKey      = ${sealed}`,
      })

      // ---- 2. Sample genome ----
      append({
        step: '2. Sample genome',
        kind: 'step',
        message: `Built sample genome (gen=${sampleGenome.generation}, trigger=${sampleGenome.trigger.dominance}, filter=${sampleGenome.filter.dominance}).`,
        detail: JSON.stringify(sampleGenome, null, 2),
      })

      // ---- 3. Encrypt ----
      append({ step: '3. Encrypt', kind: 'step', message: 'AES-256-GCM with HKDF salt…' })
      const encrypted = await encryptGenome(sampleGenome, key)
      const encBlobHash = blobHash(encrypted)
      append({
        step: '3. Encrypt',
        kind: 'success',
        message: `${encrypted.length} bytes (salt 16 | iv 12 | ct+tag ${encrypted.length - 28}).`,
        detail: `keccak256(blob) = ${encBlobHash}`,
      })

      // ---- 4. Upload ----
      append({ step: '4. Upload', kind: 'step', message: 'Uploading to 0G Storage (approve in MetaMask)…' })
      const upload = await uploadGenome(encrypted, signer)
      setRootHash(upload.rootHash)
      setTxHash(upload.txHash)
      append({
        step: '4. Upload',
        kind: 'success',
        message: `rootHash committed.`,
        detail: `rootHash = ${upload.rootHash}\ntxHash   = ${upload.txHash}`,
      })

      // ---- 5. Settle, then download ----
      append({ step: '5. Download', kind: 'step', message: 'Waiting 5s for storage propagation, then fetching by rootHash…' })
      await sleep(5000)
      const downloaded = await downloadGenome(upload.rootHash)
      const downBlobHash = blobHash(downloaded)
      const blobMatches = downBlobHash === encBlobHash
      append({
        step: '5. Download',
        kind: blobMatches ? 'success' : 'error',
        message: `${downloaded.length} bytes returned. blob hash ${blobMatches ? 'matches' : 'MISMATCH'}.`,
        detail: `keccak256(blob) = ${downBlobHash}`,
      })
      if (!blobMatches) {
        throw new Error('Downloaded blob hash does not match uploaded blob.')
      }

      // ---- 6. Decrypt ----
      append({ step: '6. Decrypt', kind: 'step', message: 'AES-256-GCM with HKDF salt from blob header…' })
      const decoded = await decryptGenome(downloaded, key)
      append({
        step: '6. Decrypt',
        kind: 'success',
        message: `Plaintext recovered.`,
        detail: JSON.stringify(decoded, null, 2),
      })

      // ---- 7. Deep equality ----
      const equal =
        JSON.stringify(decoded) === JSON.stringify(sampleGenome)
      append({
        step: '7. Verify',
        kind: equal ? 'success' : 'error',
        message: equal
          ? 'Round-trip OK — decrypted genome deepEqual to original.'
          : 'Round-trip FAILED — decrypted genome differs from original.',
      })
      setVerdict(equal ? 'pass' : 'fail')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      append({ step: 'ERROR', kind: 'error', message: msg })
      setVerdict('fail')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="genome-test-container">
      <article className="genome-test-card">
        <header className="card-header">
          <p className="eyebrow">Dev · Genome Encryption + 0G Storage</p>
          <h1 className="title">Round-trip test</h1>
          <p className="subtitle">
            Signs a derivation message in MetaMask, encrypts a sample
            genome with AES-256-GCM, uploads the ciphertext to 0G Storage,
            downloads it by root hash, decrypts, and asserts deep equality
            with the original. Uses tokenId={TEST_TOKEN_ID} as a placeholder.
          </p>
        </header>

        <div className="action-row">
          <button
            className="btn btn-primary"
            onClick={handleRun}
            disabled={running || !isConnected}
            type="button"
          >
            {running ? 'Running…' : 'Run round-trip test'}
          </button>
          {!isConnected && (
            <span className="hint">Connect MetaMask first.</span>
          )}
          {verdict && (
            <span className={`verdict verdict-${verdict}`}>
              {verdict === 'pending' ? 'Running' : verdict === 'pass' ? '✓ Pass' : '✗ Fail'}
            </span>
          )}
        </div>

        {(rootHash || txHash) && (
          <div className="result-summary">
            {rootHash && (
              <div className="result-row">
                <span className="result-label">rootHash</span>
                <code className="result-value">{rootHash}</code>
              </div>
            )}
            {txHash && (
              <div className="result-row">
                <span className="result-label">submission tx</span>
                <a
                  className="result-link"
                  href={`https://chainscan-galileo.0g.ai/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {txHash}
                </a>
              </div>
            )}
          </div>
        )}

        {logs.length > 0 && (
          <ol className="log-feed">
            {logs.map((entry, i) => (
              <li key={i} className={`log-entry log-${entry.kind}`}>
                <header className="log-header">
                  <span className="log-step">{entry.step}</span>
                  <span className="log-ts">{entry.ts}</span>
                </header>
                <p className="log-message">{entry.message}</p>
                {entry.detail && <pre className="log-detail">{entry.detail}</pre>}
              </li>
            ))}
          </ol>
        )}
      </article>
    </div>
  )
}
