import type { Genome } from '../genome'
import { BARS_PER_HOUR, type Bar } from './data'
import {
  checkFilter,
  computeTriggerSignal,
  type TriggerSignal,
} from './signals'

// =====================================================================
//                              Knobs
// =====================================================================

const STARTING_CAPITAL = 10_000
const POSITION_PCT = 0.20 // 20% of cash sized into each long entry
const TX_COST_BPS = 5
const TX_COST = TX_COST_BPS / 10_000 // 0.0005 == 5bps round-trip-side cost
// Skip the first 48 hours so any 24h lookback / window has 2× headroom.
// Bar count scales with the interval (e.g. 576 bars at 5m, 48 at 1h).
const WARMUP_HOURS = 48
const WARMUP_BARS = Math.round(WARMUP_HOURS * BARS_PER_HOUR)

// =====================================================================
//                              Types
// =====================================================================

export type DecisionAction = 'ENTER_LONG' | 'EXIT_LONG' | 'NONE'

export type DecisionLog = {
  barIndex: number
  timestamp: number
  price: number
  signal: TriggerSignal
  filterPassed: boolean
  action: DecisionAction
  equity: number
}

export type BacktestResult = {
  totalReturn: number      // decimal, e.g. 0.087 == +8.7%
  finalEquity: number
  startingEquity: number
  tradeCount: number
  winRate: number          // 0..1
  decisions: DecisionLog[]
  equityCurve: number[]    // equity at each evaluated bar (post-warmup)
}

// =====================================================================
//                              Runner
// =====================================================================

/**
 * Run a single-pass backtest of `genome` over `bars`. Long-only paper
 * trading: enters when the trigger says LONG and the vol filter passes,
 * exits when the trigger says EXIT or the filter no longer holds.
 *
 * Tx costs are applied symmetrically on entry and exit. Any open
 * position at the end is closed at the last bar's close so the score
 * reflects realized PnL only.
 */
export function backtestGenome(genome: Genome, bars: Bar[]): BacktestResult {
  let cash = STARTING_CAPITAL
  let position = 0 // ETH held
  let entryPrice = 0
  let tradeCount = 0
  let winningTrades = 0

  const decisions: DecisionLog[] = []
  const equityCurve: number[] = []

  for (let i = WARMUP_BARS; i < bars.length; i++) {
    const bar = bars[i]
    const signal = computeTriggerSignal(genome, bars, i)
    const filterPassed = checkFilter(genome, bars, i)

    let action: DecisionAction = 'NONE'

    // Entry: LONG signal + filter ok + currently flat
    if (signal === 'LONG' && filterPassed && position === 0) {
      const sizing = cash * POSITION_PCT
      const ethBought = sizing / bar.close
      const cost = sizing * TX_COST
      position = ethBought
      cash = cash - sizing - cost
      entryPrice = bar.close
      tradeCount += 1
      action = 'ENTER_LONG'
    }
    // Exit: EXIT signal OR filter dropped, currently long
    else if ((signal === 'EXIT' || !filterPassed) && position > 0) {
      const proceeds = position * bar.close
      const cost = proceeds * TX_COST
      cash = cash + proceeds - cost
      if (bar.close > entryPrice) winningTrades += 1
      position = 0
      action = 'EXIT_LONG'
    }

    const equity = cash + position * bar.close
    decisions.push({
      barIndex: i,
      timestamp: bar.openTime,
      price: bar.close,
      signal,
      filterPassed,
      action,
      equity,
    })
    equityCurve.push(equity)
  }

  // Mark any open position to the close on the final bar.
  if (position > 0) {
    const last = bars[bars.length - 1]
    const proceeds = position * last.close
    const cost = proceeds * TX_COST
    cash = cash + proceeds - cost
    if (last.close > entryPrice) winningTrades += 1
    position = 0
  }

  const finalEquity = cash
  return {
    totalReturn: finalEquity / STARTING_CAPITAL - 1,
    finalEquity,
    startingEquity: STARTING_CAPITAL,
    tradeCount,
    winRate: tradeCount > 0 ? winningTrades / tradeCount : 0,
    decisions,
    equityCurve,
  }
}

// =====================================================================
//                       Buy-and-hold benchmark
// =====================================================================

export type BenchmarkResult = {
  totalReturn: number
  startingPrice: number
  endingPrice: number
  equityCurve: number[]
}

/**
 * Compute a simple buy-and-hold of ETH over the same window so the UI
 * can render "strategy +5.3% vs ETH +2.1%".  The curve is normalized to
 * the same starting capital as the strategy run.
 */
export function buyAndHoldBenchmark(bars: Bar[]): BenchmarkResult {
  const startBar = bars[WARMUP_BARS]
  if (!startBar) {
    return {
      totalReturn: 0,
      startingPrice: 0,
      endingPrice: 0,
      equityCurve: [],
    }
  }
  const startingPrice = startBar.close
  const ethBought = STARTING_CAPITAL / startingPrice
  const equityCurve: number[] = []
  for (let i = WARMUP_BARS; i < bars.length; i++) {
    equityCurve.push(ethBought * bars[i].close)
  }
  const endingPrice = bars[bars.length - 1].close
  return {
    totalReturn: endingPrice / startingPrice - 1,
    startingPrice,
    endingPrice,
    equityCurve,
  }
}
