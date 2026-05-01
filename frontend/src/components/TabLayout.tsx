import { useEffect, useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import ConnectWallet from './tabs/ConnectWallet'
import UniverseParameters, {
  type UniverseParams,
  defaultUniverseParams,
  isUniverseComplete,
} from './tabs/UniverseParameters'
import AlphaParameters from './tabs/AlphaParameters'
import Mint from './tabs/Mint'
import Breed from './tabs/Breed'
import Backtest from './tabs/Backtest'
import Trade from './tabs/Trade'
import About from './About'
import logo from '../assets/mendel-logo.png'
import '../styles/TabLayout.css'

type TabType =
  | 'connect'
  | 'universe'
  | 'alpha'
  | 'mint'
  | 'breed'
  | 'backtest'
  | 'trade'
type View = 'main' | 'about'

export default function TabLayout() {
  const { isConnected } = useAccount()
  const [view, setView] = useState<View>('main')
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
    { id: 'mint', label: 'Mint iNFTs' },
    { id: 'breed', label: 'Breed' },
    { id: 'backtest', label: 'Backtest' },
    { id: 'trade', label: 'Trade' },
  ]

  // All main-tab components stay mounted so each one preserves its own
  // local state (Alpha grid placements, Mint results, Backtest output, …)
  // when the user switches tabs. The `hidden` attribute applies CSS
  // `display: none` while keeping the subtree in the DOM.
  const renderTabContent = () => (
    <>
      <div hidden={activeTab !== 'connect'} className="tab-pane">
        <ConnectWallet onContinue={() => setActiveTab('universe')} />
      </div>
      <div hidden={activeTab !== 'universe'} className="tab-pane">
        <UniverseParameters
          value={universeParams}
          onChange={setUniverseParams}
          onContinue={() => setActiveTab('alpha')}
        />
      </div>
      <div hidden={activeTab !== 'alpha'} className="tab-pane">
        <AlphaParameters onContinue={() => setActiveTab('mint')} />
      </div>
      <div hidden={activeTab !== 'mint'} className="tab-pane">
        <Mint
          universeParams={universeParams}
          onContinue={() => setActiveTab('breed')}
        />
      </div>
      <div hidden={activeTab !== 'breed'} className="tab-pane">
        <Breed onContinue={() => setActiveTab('backtest')} />
      </div>
      <div hidden={activeTab !== 'backtest'} className="tab-pane">
        <Backtest />
      </div>
      <div hidden={activeTab !== 'trade'} className="tab-pane">
        <Trade />
      </div>
    </>
  )

  return (
    <div className="tab-layout">
      <header className="app-header">
        <div className="header-top">
          <div className="header-left" />
          <div className="brand">
            <img src={logo} alt="Mendel" className="brand-logo" />
          </div>
          <div className="header-right">
            {view === 'main' ? (
              <button
                className="header-action"
                onClick={() => setView('about')}
                type="button"
              >
                Learn More
              </button>
            ) : (
              <button
                className="header-action"
                onClick={() => setView('main')}
                type="button"
              >
                ← Back
              </button>
            )}
          </div>
        </div>

        {view === 'main' && (
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
                  {locked && (
                    <span className="lock-icon" aria-hidden="true">
                      🔒
                    </span>
                  )}
                  {tab.label}
                </button>
              )
            })}
          </nav>
        )}
      </header>

      <main className="tab-content">
        {view === 'about' ? <About /> : renderTabContent()}
      </main>
    </div>
  )
}
