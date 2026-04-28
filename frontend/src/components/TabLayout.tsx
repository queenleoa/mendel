import { useEffect, useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import ConnectWallet from './tabs/ConnectWallet'
import UniverseParameters, {
  type UniverseParams,
  defaultUniverseParams,
  isUniverseComplete,
} from './tabs/UniverseParameters'
import AlphaParameters from './tabs/AlphaParameters'
import BacktestBreed from './tabs/BacktestBreed'
import Mint from './tabs/Mint'
import Trade from './tabs/Trade'
import '../styles/TabLayout.css'

type TabType = 'connect' | 'universe' | 'alpha' | 'backtest' | 'mint' | 'trade'

export default function TabLayout() {
  const { isConnected } = useAccount()
  const [activeTab, setActiveTab] = useState<TabType>('connect')
  const [universeParams, setUniverseParams] = useState<UniverseParams>(
    defaultUniverseParams,
  )

  const universeComplete = useMemo(
    () => isUniverseComplete(universeParams),
    [universeParams],
  )

  const isLocked = (tab: TabType): boolean => {
    if (tab === 'connect') return false
    if (!isConnected) return true
    if (tab === 'universe') return false
    return !universeComplete
  }

  useEffect(() => {
    if (isLocked(activeTab)) {
      setActiveTab(!isConnected ? 'connect' : 'universe')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, universeComplete])

  const tabs: { id: TabType; label: string }[] = [
    { id: 'connect', label: 'Connect Wallet' },
    { id: 'universe', label: 'Universe Parameters' },
    { id: 'alpha', label: 'Alpha Parameters' },
    { id: 'backtest', label: 'Backtest & Breed' },
    { id: 'mint', label: 'Mint' },
    { id: 'trade', label: 'Trade' },
  ]

  const renderContent = () => {
    switch (activeTab) {
      case 'connect':
        return <ConnectWallet onContinue={() => setActiveTab('universe')} />
      case 'universe':
        return (
          <UniverseParameters
            value={universeParams}
            onChange={setUniverseParams}
            onContinue={() => setActiveTab('alpha')}
          />
        )
      case 'alpha':
        return <AlphaParameters />
      case 'backtest':
        return <BacktestBreed />
      case 'mint':
        return <Mint />
      case 'trade':
        return <Trade />
    }
  }

  return (
    <div className="tab-layout">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">M</span>
          <div className="brand-text">
            <span className="brand-name">Mendel</span>
            <span className="brand-tagline">Research Console</span>
          </div>
        </div>
        <nav className="tab-navigation" aria-label="Workflow steps">
          {tabs.map((tab) => {
            const locked = isLocked(tab.id)
            return (
              <button
                key={tab.id}
                className={`tab-button ${activeTab === tab.id ? 'active' : ''} ${locked ? 'locked' : ''}`}
                onClick={() => !locked && setActiveTab(tab.id)}
                disabled={locked}
                title={
                  locked
                    ? !isConnected
                      ? 'Connect a wallet to unlock'
                      : 'Set universe parameters to unlock'
                    : undefined
                }
                type="button"
              >
                {locked && <span className="lock-icon" aria-hidden="true">🔒</span>}
                {tab.label}
              </button>
            )
          })}
        </nav>
      </header>

      <main className="tab-content">{renderContent()}</main>
    </div>
  )
}
