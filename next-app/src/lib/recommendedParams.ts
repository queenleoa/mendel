// Live-market-tuned defaults for the Alpha + Mint tabs.
//
// Called once when the user crosses Universe → Alpha. Pulls today's
// Binance ETH/USDT 24h ticker and synthesises a set of momentum,
// reversion, and volatility-band knobs calibrated so triggers will
// actually fire in the current regime — useful because the genome
// founders we hardcode otherwise sit at fixed thresholds (0.5% / 0.7σ)
// that quiet weeks like today (24h change ≈ 0.17%) can't satisfy.
//
// The math is intentionally lightweight:
//   - momentum threshold ≈ 40% of |today's 24h change|, with a 0.05%
//     floor so dead-flat days still pick *something*. Picks a value
//     that today's bar can plausibly cross, without being so small it
//     fires on every tick.
//   - reversion zThreshold = 0.2σ — a fixed level that catches normal
//     intraday z-score wobbles (z ≈ 0.3-0.6 is typical) without firing
//     constantly.
//   - vol bands wrap the current 24h realized vol so the filter passes
//     on most ticks: narrow ≈ [0.5×, 1.5×] of current vol, wide ≈
//     [0.3×, 2.0×]. Same band semantics as the original founders, just
//     centred on today's regime instead of 2024-era assumptions.
//
// All values are in *decimal form* (0.01 = 1%) — the same shape the
// genome stores. The Alpha tab's chip UI displays them as percentages
// so we ×100 there.
//
// On any failure (network blip, Binance rate limit, etc.) we fall back
// to the original hardcoded defaults. The flow never blocks.

export type RecommendedParams = {
  momentum: {
    lookback: number // hours
    threshold: number // decimal, e.g. 0.001 == 0.1%
  }
  reversion: {
    window: number // hours
    zThreshold: number // sigmas
  }
  volatility: {
    narrow: { min: number; max: number } // decimal vol, e.g. 0.01 == 1%
    wide: { min: number; max: number }
  }
  market: {
    spot: number
    change24hPct: number // signed, % units (e.g. -0.23)
    vol24hPct: number // unsigned, % units (e.g. 2.02)
  }
  computedAt: string
}

const STATIC_FALLBACK: Omit<RecommendedParams, 'computedAt'> = {
  momentum: { lookback: 4, threshold: 0.001 },
  reversion: { window: 4, zThreshold: 0.3 },
  volatility: {
    narrow: { min: 0.007, max: 0.025 },
    wide: { min: 0.005, max: 0.04 },
  },
  market: { spot: 0, change24hPct: 0, vol24hPct: 0 },
}

export const FALLBACK_PARAMS: RecommendedParams = {
  ...STATIC_FALLBACK,
  computedAt: '1970-01-01T00:00:00Z',
}

const round = (n: number, places: number): number => {
  const f = 10 ** places
  return Math.round(n * f) / f
}

/** Fetch live Binance data and synthesise market-tuned defaults. */
export async function fetchRecommendedParams(): Promise<RecommendedParams> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4_000)
    const res = await fetch(
      'https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT',
      { signal: ctrl.signal },
    )
    clearTimeout(t)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const d = (await res.json()) as {
      lastPrice: string
      priceChangePercent: string
      highPrice: string
      lowPrice: string
    }

    const spot = parseFloat(d.lastPrice)
    const change = parseFloat(d.priceChangePercent) / 100 // -0.0023 for -0.23%
    const high = parseFloat(d.highPrice)
    const low = parseFloat(d.lowPrice)
    const mid = (high + low) / 2 || spot
    const vol = mid > 0 ? (high - low) / mid : 0.02

    const momentumThreshold = Math.max(0.0005, Math.abs(change) * 0.4)
    const zThreshold = 0.2

    return {
      momentum: { lookback: 4, threshold: round(momentumThreshold, 5) },
      reversion: { window: 4, zThreshold },
      volatility: {
        narrow: { min: round(vol * 0.5, 4), max: round(vol * 1.5, 4) },
        wide: { min: round(vol * 0.3, 4), max: round(vol * 2.0, 4) },
      },
      market: {
        spot: round(spot, 2),
        change24hPct: round(change * 100, 3),
        vol24hPct: round(vol * 100, 3),
      },
      computedAt: new Date().toISOString(),
    }
  } catch {
    return { ...STATIC_FALLBACK, computedAt: new Date().toISOString() }
  }
}
