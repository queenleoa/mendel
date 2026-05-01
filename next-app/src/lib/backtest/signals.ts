import type { Allele, Genome, Locus } from '../genome'
import type { Bar } from './data'

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
 * trigger allele.  Returns `NEUTRAL` until enough history has accrued for
 * the lookback / window.
 */
export function computeTriggerSignal(
  genome: Genome,
  bars: Bar[],
  i: number,
): TriggerSignal {
  const allele = getExpressedAllele(genome.trigger)

  if (allele.type === 'momentum') {
    const lookback = allele.lookback
    const threshold = allele.threshold
    if (i < lookback) return 'NEUTRAL'

    const prev = bars[i - lookback].close
    if (prev <= 0) return 'NEUTRAL'
    const pctChange = bars[i].close / prev - 1
    if (pctChange > threshold) return 'LONG'
    if (pctChange < -threshold) return 'EXIT'
    return 'NEUTRAL'
  }

  if (allele.type === 'reversion') {
    const window = allele.window
    const zThreshold = allele.zThreshold
    if (i < window) return 'NEUTRAL'

    const recent = bars.slice(i - window, i).map((b) => b.close)
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

const FILTER_VOL_WINDOW = 24 // hours

/**
 * Volatility filter — true iff the rolling-window vol ratio (std/mean of
 * the last 24 closes) sits inside the expressed allele's [min, max] band.
 * Both `volatility-narrow` and `volatility-wide` carry the same shape.
 */
export function checkFilter(genome: Genome, bars: Bar[], i: number): boolean {
  if (i < FILTER_VOL_WINDOW) return false
  const allele = getExpressedAllele(genome.filter)
  // Type-narrow: both volatility variants carry min/max — defensive guard
  // in case the union widens later.
  if (!('min' in allele && 'max' in allele)) return false

  const recent = bars.slice(i - FILTER_VOL_WINDOW, i).map((b) => b.close)
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length
  if (mean <= 0) return false
  const variance =
    recent.reduce((acc, x) => acc + (x - mean) ** 2, 0) / recent.length
  const std = Math.sqrt(variance)
  const volRatio = std / mean // e.g. 0.012 == 1.2% intraday vol

  return volRatio >= allele.min && volRatio <= allele.max
}
