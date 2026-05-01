import type { Genome, MarketSnapshot } from './types'

export type AlphaResult = {
  signal: 'buy' | 'sell' | 'hold'
  reason: string
}

/**
 * Evaluate the strategy genome against a market snapshot. v1 implements
 * the two active triggers: momentum and reversion. The genome's expressed
 * (dominant) trigger picks the rule, and its expressed filter (volatility
 * range) gates whether the rule is allowed to fire at all.
 *
 * Return is one of buy / sell / hold + a one-line reason for the log.
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

  // 24h change in fractional terms (e.g. 0.025 == +2.5%).
  const change = market.spot24hChangeBps / 10_000

  if (dominantTrigger.type === 'momentum') {
    const threshold =
      'threshold' in dominantTrigger ? Number(dominantTrigger.threshold) : 0.02
    if (position === 'flat' && change > threshold) {
      return {
        signal: 'buy',
        reason: `momentum: 24h ${(change * 100).toFixed(2)}% > +${(threshold * 100).toFixed(2)}%`,
      }
    }
    if (position === 'long' && change < -threshold) {
      return {
        signal: 'sell',
        reason: `momentum exit: 24h ${(change * 100).toFixed(2)}% < -${(threshold * 100).toFixed(2)}%`,
      }
    }
    return {
      signal: 'hold',
      reason: `momentum quiet: 24h ${(change * 100).toFixed(2)}% inside ±${(threshold * 100).toFixed(2)}%`,
    }
  }

  if (dominantTrigger.type === 'reversion') {
    // Use the 24h change as a proxy for z-score against a flat mean of 0,
    // scaled by a fixed sigma of 2% for v1 (hackathon-grade).
    const SIGMA = 0.02
    const zThreshold =
      'zThreshold' in dominantTrigger
        ? Number(dominantTrigger.zThreshold)
        : 1.0
    const z = change / SIGMA
    if (position === 'flat' && z < -zThreshold) {
      return {
        signal: 'buy',
        reason: `reversion: z=${z.toFixed(2)} < -${zThreshold}`,
      }
    }
    if (position === 'long' && z > zThreshold) {
      return {
        signal: 'sell',
        reason: `reversion exit: z=${z.toFixed(2)} > +${zThreshold}`,
      }
    }
    return {
      signal: 'hold',
      reason: `reversion quiet: z=${z.toFixed(2)} inside ±${zThreshold}`,
    }
  }

  return { signal: 'hold', reason: `trigger ${dominantTrigger.type} not implemented` }
}
