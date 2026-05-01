'use client'

import { useState } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import { runInference, walletClientToSigner } from '../../lib/zgInference'
import '../../styles/Backtest.css'

const QUESTION = 'What is 2 + 2? Reply with only the integer answer.'

type Meta = { model: string; providerAddress: string }

export default function Backtest() {
  const { isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const [meta, setMeta] = useState<Meta | null>(null)

  const handleAsk = async () => {
    setRunning(true)
    setStatus('')
    setAnswer('')
    setError('')
    setMeta(null)
    try {
      if (!walletClient) {
        throw new Error('Wallet client not ready — reconnect from the first tab')
      }
      const signer = await walletClientToSigner(walletClient)
      const result = await runInference(QUESTION, signer, setStatus)
      setAnswer(result.answer)
      setMeta({ model: result.model, providerAddress: result.providerAddress })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="backtest-container">
      <article className="backtest-card">
        <header className="card-header">
          <p className="eyebrow">0G Compute · Smoke Test</p>
          <h1 className="title">Direct Inference Test</h1>
          <p className="subtitle">
            Sends the question below to the first available chatbot provider on
            the 0G Compute Network using your already-connected wallet. On
            first run you'll be asked to approve a small ledger deposit and a
            sub-account transfer; after that, only the inference settlement
            transaction is signed.
          </p>
        </header>

        <section className="prompt-block">
          <p className="prompt-label">Prompt</p>
          <p className="prompt-text">{QUESTION}</p>
        </section>

        <div className="action-row">
          <button
            className="btn btn-primary"
            onClick={handleAsk}
            disabled={running || !isConnected}
            type="button"
          >
            {running ? 'Running…' : 'Ask 0G Compute'}
          </button>
          {!isConnected && (
            <span className="hint">Connect MetaMask first.</span>
          )}
        </div>

        {(running || status) && (
          <div className="status-block">
            <p className="status-label">Status</p>
            <p className="status-text">
              {status || 'Idle'}
              {running && <span className="dot-pulse" aria-hidden="true" />}
            </p>
          </div>
        )}

        {answer && (
          <div className="answer-block">
            <p className="answer-label">Answer</p>
            <p className="answer-text">{answer}</p>
            {meta && (
              <dl className="meta-grid">
                <div>
                  <dt>Model</dt>
                  <dd className="mono">{meta.model}</dd>
                </div>
                <div>
                  <dt>Provider</dt>
                  <dd className="mono">{meta.providerAddress}</dd>
                </div>
              </dl>
            )}
          </div>
        )}

        {error && (
          <div className="error-block">
            <p className="error-label">Error</p>
            <p className="error-text">{error}</p>
          </div>
        )}
      </article>
    </div>
  )
}
