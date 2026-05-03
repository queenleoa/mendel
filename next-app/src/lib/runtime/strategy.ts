import type { Genome, MarketSnapshot } from './types'

export type AlphaResult = {
  signal: 'buy' | 'sell' | 'hold'
  reason: string
}

// =====================================================================
//                       Lookback helpers
// =====================================================================
//
// The market snapshot carries `recentCloses` — the last 100 × 5-minute
// ETHUSDT closes. Strategy logic prefers this in-memory series over the
// snapshot's coarse `spot24hChangeBps`, so the genome's `lookback` and
// `window` fields actually control what the live runtime sees. When the
// series is too short (e.g. snapshot fetch failed and `recentCloses` is
// undefined / empty), we fall back to the 24h-derived values so the
// cycle still produces a coherent decision.

const BARS_PER_HOUR = 12 // 5-minute bars

function lookbackChange(
  market: MarketSnapshot,
  lookbackHours: number,
): { change: number; source: 'klines' | '24h-fallback' } {
  const closes = market.recentCloses
  const lookbackBars = Math.max(1, Math.round(lookbackHours * BARS_PER_HOUR))
  if (closes && closes.length > lookbackBars) {
    const cur = closes[closes.length - 1]
    const past = closes[closes.length - 1 - lookbackBars]
    if (past > 0 && Number.isFinite(cur) && Number.isFinite(past)) {
      return { change: cur / past - 1, source: 'klines' }
    }
  }
  // Snapshot's 24h pct change as a fallback. Less granular (always 24h)
  // but always present.
  return {
    change: market.spot24hChangeBps / 10_000,
    source: '24h-fallback',
  }
}

function rollingZScore(
  market: MarketSnapshot,
  windowHours: number,
): { z: number; source: 'klines' | '24h-fallback' } {
  const closes = market.recentCloses
  const windowBars = Math.max(2, Math.round(windowHours * BARS_PER_HOUR))
  if (closes && closes.length > windowBars) {
    // Window: the `windowBars` closes immediately preceding the current
    // bar (exclude current to avoid mean drift toward it). z is computed
    // for the current close vs that window's mean and std.
    const cur = closes[closes.length - 1]
    const window = closes.slice(closes.length - 1 - windowBars, closes.length - 1)
    const mean = window.reduce((a, b) => a + b, 0) / window.length
    const variance =
      window.reduce((acc, x) => acc + (x - mean) ** 2, 0) / window.length
    const std = Math.sqrt(variance)
    if (std > 0 && Number.isFinite(cur)) {
      return { z: (cur - mean) / std, source: 'klines' }
    }
  }
  // Fall back to the 24h proxy: change ÷ realized vol. Less honest than
  // proper rolling z-score but never undefined.
  const change = market.spot24hChangeBps / 10_000
  const sigma =
    market.volatility24hBps > 0 ? market.volatility24hBps / 10_000 : 0.01
  return { z: change / sigma, source: '24h-fallback' }
}

// =====================================================================
//                       Strategy evaluation
// =====================================================================

/**
 * Evaluate the strategy genome against a market snapshot. v1 implements
 * the two active triggers: momentum and reversion. The genome's expressed
 * (dominant) trigger picks the rule, and its expressed filter (volatility
 * range) gates whether the rule is allowed to fire at all.
 *
 * Returns one of buy / sell / hold + a one-line reason for the log.
 */
export function evaluateStrategy(
  genome: Genome,
  market: MarketSnapshot,
  position: 'flat' | 'long',
): AlphaResult {
  // Filter (vol band): allow firing only inside the dominant filter's range.
  const dominantFilter = genome.filter.alleles.find(
    (a) => a.type === genome.filter.dominance,
  )
  if (!dominantFilter) {
    return { signal: 'hold', reason: 'no dominant filter expressed' }
  }
  const volPct = market.volatility24hBps / 10_000
  if ('min' in dominantFilter && 'max' in dominantFilter) {
    if (volPct < dominantFilter.min || volPct > dominantFilter.max) {
      return {
        signal: 'hold',
        reason: `vol ${volPct.toFixed(3)} outside ${dominantFilter.min}–${dominantFilter.max}`,
      }
    }
  }

  // Trigger: dominant trigger gene determines the rule.
  const dominantTrigger = genome.trigger.alleles.find(
    (a) => a.type === genome.trigger.dominance,
  )
  if (!dominantTrigger) {
    return { signal: 'hold', reason: 'no dominant trigger expressed' }
  }

  if (dominantTrigger.type === 'momentum') {
    const lookback =
      'lookback' in dominantTrigger ? Number(dominantTrigger.lookback) : 4
    const threshold =
      'threshold' in dominantTrigger ? Number(dominantTrigger.threshold) : 0.02
    const { change, source } = lookbackChange(market, lookback)
    const tag =
      source === '24h-fallback'
        ? `24h ${(change * 100).toFixed(2)}%`
        : `${lookback}h ${(change * 100).toFixed(2)}%`

    if (position === 'flat' && change > threshold) {
      return {
        signal: 'buy',
        reason: `momentum: ${tag} > +${(threshold * 100).toFixed(2)}%`,
      }
    }
    if (position === 'long' && change < -threshold) {
      return {
        signal: 'sell',
        reason: `momentum exit: ${tag} < -${(threshold * 100).toFixed(2)}%`,
      }
    }
    return {
      signal: 'hold',
      reason: `momentum quiet: ${tag} inside ±${(threshold * 100).toFixed(2)}%`,
    }
  }

  if (dominantTrigger.type === 'reversion') {
    const window =
      'window' in dominantTrigger ? Number(dominantTrigger.window) : 4
    const zThreshold =
      'zThreshold' in dominantTrigger
        ? Number(dominantTrigger.zThreshold)
        : 1.0
    const { z, source } = rollingZScore(market, window)
    const tag =
      source === '24h-fallback'
        ? `z=${z.toFixed(2)} (24h fallback)`
        : `z=${z.toFixed(2)} over ${window}h`

    if (position === 'flat' && z < -zThreshold) {
      return {
        signal: 'buy',
        reason: `reversion: ${tag} < -${zThreshold}`,
      }
    }
    if (position === 'long' && z > zThreshold) {
      return {
        signal: 'sell',
        reason: `reversion exit: ${tag} > +${zThreshold}`,
      }
    }
    return {
      signal: 'hold',
      reason: `reversion quiet: ${tag} inside ±${zThreshold}`,
    }
  }

  return { signal: 'hold', reason: `trigger ${dominantTrigger.type} not implemented` }
}
