import type { Allele, Genome, Locus } from '../genome'
import { BARS_PER_HOUR, INTERVAL_MINUTES, type Bar } from './data'

// =====================================================================
//                         Dominance helper
// =====================================================================

/**
 * Pick the allele the locus is currently expressing. The dominant allele
 * is identified by `locus.dominance`; if no allele in the pool matches,
 * fall back to the first allele (homozygous-recessive case).
 */
export function getExpressedAllele<T extends Allele>(locus: Locus<T>): T {
  return locus.alleles.find((a) => a.type === locus.dominance) ?? locus.alleles[0]
}

// =====================================================================
//                        Trigger signal
// =====================================================================

export type TriggerSignal = 'LONG' | 'EXIT' | 'NEUTRAL'

/**
 * Compute the trigger signal for `bars[i]` from the genome's expressed
 * trigger allele. The genome carries lookback / window in *hours* per the
 * Universe-tab spec; this helper converts to bar count using
 * `BARS_PER_HOUR` so the same genome runs against any bar interval.
 */
export function computeTriggerSignal(
  genome: Genome,
  bars: Bar[],
  i: number,
): TriggerSignal {
  const allele = getExpressedAllele(genome.trigger)

  if (allele.type === 'momentum') {
    const lookbackBars = Math.round(allele.lookback * BARS_PER_HOUR)
    const threshold = allele.threshold
    if (i < lookbackBars) return 'NEUTRAL'

    const prev = bars[i - lookbackBars].close
    if (prev <= 0) return 'NEUTRAL'
    const pctChange = bars[i].close / prev - 1
    if (pctChange > threshold) return 'LONG'
    if (pctChange < -threshold) return 'EXIT'
    return 'NEUTRAL'
  }

  if (allele.type === 'reversion') {
    const windowBars = Math.round(allele.window * BARS_PER_HOUR)
    const zThreshold = allele.zThreshold
    if (i < windowBars) return 'NEUTRAL'

    const recent = bars.slice(i - windowBars, i).map((b) => b.close)
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length
    const variance =
      recent.reduce((acc, x) => acc + (x - mean) ** 2, 0) / recent.length
    const std = Math.sqrt(variance)
    if (std === 0) return 'NEUTRAL' // pathological flat-price window
    const z = (bars[i].close - mean) / std

    if (z < -zThreshold) return 'LONG' // oversold → buy
    if (z > zThreshold) return 'EXIT' // overbought → sell
    return 'NEUTRAL'
  }

  return 'NEUTRAL'
}

// =====================================================================
//                        Filter (vol band)
// =====================================================================

const FILTER_VOL_HOURS = 24
const FILTER_VOL_BARS = Math.round(FILTER_VOL_HOURS * BARS_PER_HOUR)
const PERIODS_PER_DAY = (24 * 60) / INTERVAL_MINUTES // 288 at 5m, 24 at 1h

/**
 * Volatility filter — true iff the **daily realized volatility** over the
 * trailing 24h sits inside the expressed allele's `[min, max]` band.
 *
 * Daily realized vol is the standard market measure of "how volatile is
 * the asset" and is what the user-facing band labels mean by e.g. `0.7`
 * → 0.7% daily vol. Computed as `std(per-bar returns) × √(periods/day)`,
 * which scales correctly across bar intervals (5m → ×√288, 1h → ×√24,
 * etc.) so the same allele bands work at any timeframe.
 *
 * NOTE: prior versions computed `std(closes) / mean(closes)`, which has
 * totally different units (price-spread fraction, not return-vol) and
 * was off by ~3-4× in magnitude for ETH at typical levels — most trades
 * were being silently filtered out.
 */
export function checkFilter(genome: Genome, bars: Bar[], i: number): boolean {
  if (i < FILTER_VOL_BARS + 1) return false
  const allele = getExpressedAllele(genome.filter)
  // Type-narrow: both volatility variants carry min/max — defensive guard
  // in case the union widens later.
  if (!('min' in allele && 'max' in allele)) return false

  const returns: number[] = []
  for (let j = i - FILTER_VOL_BARS + 1; j <= i; j++) {
    const prev = bars[j - 1].close
    if (prev <= 0) continue
    returns.push(bars[j].close / prev - 1)
  }
  if (returns.length === 0) return false

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance =
    returns.reduce((acc, x) => acc + (x - mean) ** 2, 0) / returns.length
  const stdReturns = Math.sqrt(variance)
  const dailyVol = stdReturns * Math.sqrt(PERIODS_PER_DAY)

  return dailyVol >= allele.min && dailyVol <= allele.max
}
