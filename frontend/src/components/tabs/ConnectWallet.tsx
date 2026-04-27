import { useState } from 'react'
import { useAccount, useBalance, useConnect, useDisconnect } from 'wagmi'
import { formatUnits } from 'viem'
import { zeroGGalileo } from '../../config/wagmi'
import '../../styles/ConnectWallet.css'

const FAUCET_URL = 'https://0g-faucet-hackathon.vercel.app/'
const FAUCET_CODE = 'OPEN-AGENT'

function connectorLabel(name: string) {
  if (/metamask/i.test(name)) return 'MetaMask'
  if (/coinbase/i.test(name)) return 'Coinbase Wallet'
  if (/injected/i.test(name)) return 'Browser Wallet'
  return name
}

function connectorIcon(name: string) {
  if (/metamask/i.test(name)) return '🦊'
  if (/coinbase/i.test(name)) return '🔵'
  return '👛'
}

export default function ConnectWallet() {
  const { address, isConnected } = useAccount()
  const { connectors, connect, isPending, error } = useConnect()
  const { disconnect } = useDisconnect()
  const { data: balance, isLoading: balanceLoading } = useBalance({
    address,
    chainId: zeroGGalileo.id,
    query: { enabled: Boolean(address) },
  })
  const [pickerOpen, setPickerOpen] = useState(false)

  const formattedBalance = balance
    ? `${Number(formatUnits(balance.value, balance.decimals)).toFixed(4)} ${balance.symbol}`
    : '—'

  return (
    <div className="connect-wallet-container">
      <article className="connect-wallet-card">
        <header className="card-header">
          <p className="eyebrow">Mendel · Research Console</p>
          <h1 className="title">No-code AI Quant Bot Builder for DeFi</h1>
          <p className="subtitle">
            Build, evolve, and trade autonomous AI quant strategies using genetic
            algorithms and multi-copy signal redundancy.
          </p>
        </header>

        <section className="wallet-status">
          {isConnected ? (
            <div className="connected">
              <div className="status-row">
                <span className="status-dot connected-dot" />
                <span className="status-label">Wallet connected</span>
              </div>

              <dl className="meta">
                <div className="meta-row">
                  <dt>Address</dt>
                  <dd className="mono">
                    {address?.slice(0, 6)}…{address?.slice(-4)}
                  </dd>
                </div>
                <div className="meta-row">
                  <dt>Network</dt>
                  <dd>0G Galileo Testnet</dd>
                </div>
                <div className="meta-row">
                  <dt>Balance</dt>
                  <dd className="mono">
                    {balanceLoading ? 'Loading…' : formattedBalance}
                  </dd>
                </div>
              </dl>

              <div className="action-row">
                <a
                  className="btn btn-primary"
                  href={FAUCET_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Fund with Faucet
                </a>
                <button
                  className="btn btn-ghost"
                  onClick={() => disconnect()}
                  type="button"
                >
                  Disconnect
                </button>
              </div>

              <p className="faucet-hint">
                Faucet code: <code>{FAUCET_CODE}</code>
              </p>
            </div>
          ) : (
            <div className="disconnected">
              <div className="status-row">
                <span className="status-dot" />
                <span className="status-label">No wallet connected</span>
              </div>
              <p className="hint">
                Connect a wallet to access the research, backtesting, and trading
                modules.
              </p>
              <button
                className="btn btn-primary"
                onClick={() => setPickerOpen(true)}
                type="button"
              >
                Connect Wallet
              </button>
            </div>
          )}
        </section>
      </article>

      {pickerOpen && !isConnected && (
        <div
          className="modal-overlay"
          onClick={() => !isPending && setPickerOpen(false)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-header">
              <h2>Choose a wallet</h2>
              <button
                className="modal-close"
                onClick={() => setPickerOpen(false)}
                aria-label="Close"
                type="button"
              >
                ×
              </button>
            </header>
            <ul className="connector-list">
              {connectors.map((connector) => (
                <li key={connector.uid}>
                  <button
                    className="connector-button"
                    onClick={() => {
                      connect(
                        { connector },
                        { onSuccess: () => setPickerOpen(false) },
                      )
                    }}
                    disabled={isPending}
                    type="button"
                  >
                    <span className="connector-icon" aria-hidden="true">
                      {connectorIcon(connector.name)}
                    </span>
                    <span className="connector-label">
                      {connectorLabel(connector.name)}
                    </span>
                    {isPending && <span className="connector-spinner" />}
                  </button>
                </li>
              ))}
            </ul>
            {error && <p className="modal-error">{error.message}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
