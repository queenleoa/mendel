'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
import type { BreedFlowResult } from '../lib/inft'
import {
  fetchRecommendedParams,
  type RecommendedParams,
} from '../lib/recommendedParams'
import { EMPTY_ALPHA_CELLS, type AlphaCells } from '../lib/alphaCells'
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

const BREED_RESULT_STORAGE_KEY = 'mendel.breedResult'

export default function TabLayout() {
  const { isConnected } = useAccount()
  const [view, setView] = useState<View>('main')
  const [activeTab, setActiveTab] = useState<TabType>('connect')
  const [universeParams, setUniverseParams] = useState<UniverseParams>(
    defaultUniverseParams,
  )
  // The full breed result (parents, seed, tx hashes, all 9 children) is
  // lifted out of BreedingFlow so (a) the Backtest tab can score the same
  // children without re-fetching from chain and (b) a page reload doesn't
  // wipe the family tree on the Breed tab. Persisted to localStorage.
  const [breedResult, setBreedResultState] = useState<BreedFlowResult | null>(
    null,
  )

  // Live-market-tuned defaults for Alpha + Mint. Computed once on the
  // Universe → Alpha transition (see `handleUniverseContinue` below) so
  // the chip defaults and founder genomes match today's regime instead
  // of stale 2024-era constants. Falls back gracefully on fetch failure.
  const [recommendedParams, setRecommendedParams] =
    useState<RecommendedParams | null>(null)
  const [computingParams, setComputingParams] = useState(false)

  // Alpha tab's strategy-grid placements lifted up so Mint can build
  // founder genomes from the user's actual choices (gene + per-cell
  // params), not from `recommendedParams` directly.
  const [alphaCells, setAlphaCells] = useState<AlphaCells>(EMPTY_ALPHA_CELLS)

  const handleUniverseContinue = async () => {
    setComputingParams(true)
    try {
      const params = await fetchRecommendedParams()
      setRecommendedParams(params)
    } finally {
      setComputingParams(false)
      setActiveTab('alpha')
    }
  }

  // Hydrate from localStorage once on mount (client-only — guarded against
  // SSR + private-mode quota exceptions).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(BREED_RESULT_STORAGE_KEY)
      if (raw) setBreedResultState(JSON.parse(raw) as BreedFlowResult)
    } catch {
      // bad JSON / disabled storage — start with no cached breed
    }
  }, [])

  const setBreedResult = useCallback((result: BreedFlowResult | null) => {
    setBreedResultState(result)
    try {
      if (result) {
        window.localStorage.setItem(
          BREED_RESULT_STORAGE_KEY,
          JSON.stringify(result),
        )
      } else {
        window.localStorage.removeItem(BREED_RESULT_STORAGE_KEY)
      }
    } catch {
      // quota / disabled — persistence is best-effort
    }
  }, [])

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
          onContinue={handleUniverseContinue}
          computing={computingParams}
        />
      </div>
      <div hidden={activeTab !== 'alpha'} className="tab-pane">
        <AlphaParameters
          onContinue={() => setActiveTab('mint')}
          recommendedParams={recommendedParams}
          cells={alphaCells}
          onCellsChange={setAlphaCells}
        />
      </div>
      <div hidden={activeTab !== 'mint'} className="tab-pane">
        <Mint
          universeParams={universeParams}
          onContinue={() => setActiveTab('breed')}
          recommendedParams={recommendedParams}
          alphaCells={alphaCells}
        />
      </div>
      <div hidden={activeTab !== 'breed'} className="tab-pane">
        <Breed
          onContinue={() => setActiveTab('backtest')}
          onBreedComplete={setBreedResult}
          initialResult={breedResult}
        />
      </div>
      <div hidden={activeTab !== 'backtest'} className="tab-pane">
        <Backtest
          childResults={breedResult?.children ?? null}
          onClear={() => setBreedResult(null)}
        />
      </div>
      <div hidden={activeTab !== 'trade'} className="tab-pane">
        <Trade breedResult={breedResult} />
      </div>
    </>
  )

  return (
    <div className="tab-layout">
      <header className="app-header">
        <div className="header-top">
          <div className="header-left" />
          <div className="brand">
            <img src="/mendel-logo.png" alt="Mendel" className="brand-logo" />
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
