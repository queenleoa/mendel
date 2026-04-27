import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import ConnectWallet from './tabs/ConnectWallet'
import UniverseParameters from './tabs/UniverseParameters'
import AlphaParameters from './tabs/AlphaParameters'
import BacktestBreed from './tabs/BacktestBreed'
import Mint from './tabs/Mint'
import Trade from './tabs/Trade'
import '../styles/TabLayout.css'

type TabType = 'connect' | 'universe' | 'alpha' | 'backtest' | 'mint' | 'trade'

export default function TabLayout() {
  const { isConnected } = useAccount()
  const [activeTab, setActiveTab] = useState<TabType>('connect')

  useEffect(() => {
    if (!isConnected && activeTab !== 'connect') {
      setActiveTab('connect')
    }
  }, [isConnected, activeTab])

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
        return <ConnectWallet />
      case 'universe':
        return <UniverseParameters />
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
            const locked = tab.id !== 'connect' && !isConnected
            return (
              <button
                key={tab.id}
                className={`tab-button ${activeTab === tab.id ? 'active' : ''} ${locked ? 'locked' : ''}`}
                onClick={() => !locked && setActiveTab(tab.id)}
                disabled={locked}
                title={locked ? 'Connect a wallet to unlock' : undefined}
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
