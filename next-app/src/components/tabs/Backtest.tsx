'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ChildResult } from '../../lib/inft'
import {
  scoreChildren,
  type ScoredGenome,
  type Scoreboard,
} from '../../lib/backtest/scorer'
import ChromosomePair from '../ChromosomePair'
import '../../styles/Backtest.css'

// Demo pacing: stagger the rows so the leaderboard reveals one row at a
// time even though all 9 backtests resolve in ~30ms. Purely cosmetic.
const REVEAL_DELAY_MS: number = 220

type Props = {
  childResults: ChildResult[] | null
  onClear?: () => void
}

type RankedRow = ScoredGenome & {
  rank: number
  childTokenId: number
}

export default function Backtest({ childResults, onClear }: Props) {
  const [scoreboard, setScoreboard] = useState<Scoreboard | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string>('')
  const [revealedCount, setRevealedCount] = useState(0)

  const childCount = childResults?.length ?? 0

  // Auto-run when children show up; rerun if the user re-breeds.
  useEffect(() => {
    if (!childResults || childResults.length === 0) {
      setScoreboard(null)
      setRevealedCount(0)
      return
    }
    let cancelled = false
    setRunning(true)
    setError('')
    setScoreboard(null)
    setRevealedCount(0)
    ;(async () => {
      try {
        const board = await scoreChildren(childResults.map((c) => c.genome))
        if (cancelled) return
        setScoreboard(board)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setRunning(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [childResults])

  // Stagger the reveal so the leaderboard "completes" rows one at a time.
  useEffect(() => {
    if (!scoreboard) return
    const total = scoreboard.scored.length
    if (REVEAL_DELAY_MS === 0) {
      setRevealedCount(total)
      return
    }
    let n = 0
    setRevealedCount(0)
    const id = window.setInterval(() => {
      n += 1
      setRevealedCount(n)
      if (n >= total) window.clearInterval(id)
    }, REVEAL_DELAY_MS)
    return () => window.clearInterval(id)
  }, [scoreboard])

  // Sort by totalReturn desc and pair with the on-chain tokenId from the
  // breed flow output (same index → same child).
  const rankedRows: RankedRow[] = useMemo(() => {
    if (!scoreboard || !childResults) return []
    return scoreboard.scored
      .map((s, i) => ({
        ...s,
        childTokenId: childResults[i].tokenId || childResults[i].predictedTokenId,
      }))
      .sort((a, b) => b.result.totalReturn - a.result.totalReturn)
      .map((row, i) => ({ ...row, rank: i + 1 }))
  }, [scoreboard, childResults])

  return (
    <div className="backtest-container">
      <article className="backtest-card">
        <header className="card-header">
          <div className="card-header-text">
            <p className="eyebrow">Step 6 · Backtest</p>
            <h1 className="title">Score the F2 Children</h1>
            <p className="subtitle">
              Each newly-bred child is replayed against 7 days of 5-minute
              ETH/USDT bars using its expressed (dominant) trigger and filter
              alleles. 20% sizing per entry, 5 bps round-trip cost, long-only
              paper trades. The top performers are flagged as ready-to-deploy
              candidates.
            </p>
          </div>
          {childCount > 0 && onClear && (
            <button
              className="btn btn-ghost bt-clear-cache"
              type="button"
              onClick={() => {
                if (
                  confirm(
                    'Clear cached F2 children? You\'ll need to re-breed to score them again.',
                  )
                ) {
                  onClear()
                }
              }}
              title="Wipe the persisted children from this browser"
            >
              Clear cache
            </button>
          )}
        </header>

        {childCount === 0 && (
          <div className="bt-empty">
            <p className="bt-empty-title">No children to score yet</p>
            <p className="bt-empty-sub">
              Cross-breed two founders on the Breed tab — the resulting 9 F2
              children will land here automatically.
            </p>
          </div>
        )}

        {childCount > 0 && running && (
          <div className="bt-status">
            <span className="bt-spin" aria-hidden="true" />
            <span>Fetching ETH bars and replaying {childCount} genomes…</span>
          </div>
        )}

        {error && (
          <div className="bt-error">
            <p className="bt-error-label">Backtest failed</p>
            <p className="bt-error-text">{error}</p>
          </div>
        )}

        {scoreboard && rankedRows.length > 0 && (
          <>
            <BenchmarkStrip
              boardSize={rankedRows.length}
              benchmarkReturn={scoreboard.benchmark.totalReturn}
              best={rankedRows[0]?.result.totalReturn ?? 0}
              avg={
                rankedRows.reduce((s, r) => s + r.result.totalReturn, 0) /
                rankedRows.length
              }
            />

            <div className="bt-leaderboard">
              <div className="bt-row bt-row-header">
                <span className="bt-cell bt-rank">#</span>
                <span className="bt-cell bt-token">Token</span>
                <span className="bt-cell bt-genotype">Genotype</span>
                <span className="bt-cell bt-equity">Equity</span>
                <span className="bt-cell bt-return">Return</span>
                <span className="bt-cell bt-trades">Trades</span>
                <span className="bt-cell bt-win">Win %</span>
                <span className="bt-cell bt-badge" />
              </div>
              {rankedRows.map((row, i) => (
                <LeaderboardRow
                  key={row.childTokenId}
                  row={row}
                  benchmarkCurve={scoreboard.benchmark.equityCurve}
                  hidden={i >= revealedCount}
                />
              ))}
            </div>
          </>
        )}
      </article>
    </div>
  )
}

// =====================================================================
//                          Benchmark strip
// =====================================================================

function BenchmarkStrip({
  boardSize,
  benchmarkReturn,
  best,
  avg,
}: {
  boardSize: number
  benchmarkReturn: number
  best: number
  avg: number
}) {
  return (
    <div className="bt-summary">
      <div className="bt-summary-cell">
        <span className="bt-summary-label">Children</span>
        <span className="bt-summary-value mono">{boardSize}</span>
      </div>
      <div className="bt-summary-cell">
        <span className="bt-summary-label">ETH B&amp;H</span>
        <span className={`bt-summary-value mono ${returnClass(benchmarkReturn)}`}>
          {formatPct(benchmarkReturn)}
        </span>
      </div>
      <div className="bt-summary-cell">
        <span className="bt-summary-label">Top child</span>
        <span className={`bt-summary-value mono ${returnClass(best)}`}>
          {formatPct(best)}
        </span>
      </div>
      <div className="bt-summary-cell">
        <span className="bt-summary-label">Avg child</span>
        <span className={`bt-summary-value mono ${returnClass(avg)}`}>
          {formatPct(avg)}
        </span>
      </div>
      <div className="bt-summary-cell">
        <span className="bt-summary-label">α vs B&amp;H</span>
        <span className={`bt-summary-value mono ${returnClass(best - benchmarkReturn)}`}>
          {formatPct(best - benchmarkReturn)}
        </span>
      </div>
    </div>
  )
}

// =====================================================================
//                          Leaderboard row
// =====================================================================

function LeaderboardRow({
  row,
  benchmarkCurve,
  hidden,
}: {
  row: RankedRow
  benchmarkCurve: number[]
  hidden: boolean
}) {
  const r = row.result
  const isTop = row.rank <= 2 && r.totalReturn > 0
  return (
    <div
      className={`bt-row ${isTop ? 'top' : ''} ${hidden ? 'pending' : 'revealed'}`}
    >
      <span className="bt-cell bt-rank">{row.rank}</span>
      <span className="bt-cell bt-token mono">#{row.childTokenId}</span>
      <span className="bt-cell bt-genotype">
        <ChromosomePair genome={row.genome} size="sm" />
      </span>
      <span className="bt-cell bt-equity">
        <Sparkline
          curve={r.equityCurve}
          benchmark={benchmarkCurve}
          width={120}
          height={32}
          positive={r.totalReturn >= 0}
        />
      </span>
      <span className={`bt-cell bt-return mono ${returnClass(r.totalReturn)}`}>
        {formatPct(r.totalReturn)}
      </span>
      <span className="bt-cell bt-trades mono">{r.tradeCount}</span>
      <span className="bt-cell bt-win mono">
        {r.tradeCount > 0 ? `${Math.round(r.winRate * 100)}%` : '—'}
      </span>
      <span className="bt-cell bt-badge">
        {isTop && (
          <span className="bt-deploy-badge" title="Top performer — ready to deploy">
            ready ✦
          </span>
        )}
      </span>
    </div>
  )
}

// =====================================================================
//                          Sparkline (inline SVG)
// =====================================================================

function Sparkline({
  curve,
  benchmark,
  width,
  height,
  positive,
}: {
  curve: number[]
  benchmark: number[]
  width: number
  height: number
  positive: boolean
}) {
  if (curve.length < 2) {
    return <svg width={width} height={height} aria-hidden="true" />
  }
  // Shared y-scale across both lines so they're directly comparable.
  const all = [...curve, ...benchmark]
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const range = hi - lo || 1

  const toPath = (series: number[]): string => {
    if (series.length === 0) return ''
    const dx = width / (series.length - 1)
    return series
      .map((v, i) => {
        const x = i * dx
        const y = height - ((v - lo) / range) * height
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join(' ')
  }

  return (
    <svg
      width={width}
      height={height}
      aria-hidden="true"
      className={`bt-spark ${positive ? 'pos' : 'neg'}`}
    >
      <path d={toPath(benchmark)} className="bt-spark-bench" fill="none" />
      <path d={toPath(curve)} className="bt-spark-line" fill="none" />
    </svg>
  )
}

// =====================================================================
//                          Helpers
// =====================================================================

function formatPct(v: number): string {
  const pct = v * 100
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(2)}%`
}

function returnClass(v: number): string {
  if (v > 0.0005) return 'pos'
  if (v < -0.0005) return 'neg'
  return ''
}
