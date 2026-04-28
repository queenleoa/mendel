import { useAccount, useBalance, useConnect, useDisconnect } from 'wagmi'
import { formatUnits } from 'viem'
import { zeroGGalileo } from '../../config/wagmi'
import '../../styles/ConnectWallet.css'

const FAUCET_URL = 'https://0g-faucet-hackathon.vercel.app/'
const FAUCET_CODE = 'OPEN-AGENT'

type Props = {
  onContinue: () => void
}

export default function ConnectWallet({ onContinue }: Props) {
  const { address, isConnected } = useAccount()
  const { connectors, connect, isPending, error } = useConnect()
  const { disconnect } = useDisconnect()
  const { data: balance, isLoading: balanceLoading } = useBalance({
    address,
    chainId: zeroGGalileo.id,
    query: { enabled: Boolean(address) },
  })

  const metaMaskConnector = connectors.find((c) => /metamask/i.test(c.name))

  const handleConnect = () => {
    if (metaMaskConnector) connect({ connector: metaMaskConnector })
  }

  const formattedBalance = balance
    ? `${Number(formatUnits(balance.value, balance.decimals)).toFixed(4)} ${balance.symbol}`
    : '—'

  return (
    <div className="connect-wallet-container">
      <article className="connect-wallet-card">
        <header className="card-header">
          <p className="eyebrow">Powered by the 0g stack + Uniswap API</p>
          <h1 className="title">No-code AI Quant Bot Builder : Strategies breed + evolve for DeFi-native non-stationary optimization</h1>
          <p className="subtitle">
            Build, cross-breed, test, deploy and trade your own autonomously reasoning AI quant strategy iNFTs in just a few clicks. 
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
                <button
                  className="btn btn-primary"
                  onClick={onContinue}
                  type="button"
                >
                  Continue →
                </button>
                <a
                  className="btn btn-ghost"
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
                Connect MetaMask to access the research, backtesting, and trading
                modules.
              </p>
              <button
                className="btn btn-primary"
                onClick={handleConnect}
                disabled={isPending || !metaMaskConnector}
                type="button"
              >
                <span className="mm-icon" aria-hidden="true">🦊</span>
                {isPending ? 'Connecting…' : 'Connect MetaMask'}
              </button>
              {error && <p className="connect-error">{error.message}</p>}
            </div>
          )}
        </section>
      </article>
    </div>
  )
}
