import type { MarketSnapshot } from './types'

const BINANCE = 'https://api.binance.com'
const BINANCE_FUTURES = 'https://fapi.binance.com'
const FNG = 'https://api.alternative.me/fng/'

// Map our internal asset labels to Binance symbols.
// We pull data for ETH/USDT (deepest liquidity) and treat it as the
// reference price for ETH/USDC; the basis is < 5 bps in normal markets.
const ASSET_TO_BINANCE: Record<string, { spot: string; perp: string }> = {
  'ETH/USDC': { spot: 'ETHUSDT', perp: 'ETHUSDT' },
}

async function fetchJson<T>(url: string, timeoutMs = 4000): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(t)
  }
}

export async function fetchMarketSnapshot(
  asset: string,
): Promise<MarketSnapshot> {
  const symbols = ASSET_TO_BINANCE[asset] ?? ASSET_TO_BINANCE['ETH/USDC']

  // Spot 24h ticker → mid price + 24h change.
  type SpotTicker = {
    lastPrice: string
    priceChangePercent: string
    highPrice: string
    lowPrice: string
  }
  const spotTickerP = fetchJson<SpotTicker>(
    `${BINANCE}/api/v3/ticker/24hr?symbol=${symbols.spot}`,
  )

  // Perp funding rate.
  type FundingRate = { symbol: string; fundingRate: string; fundingTime: number }
  const fundingP = fetchJson<FundingRate[]>(
    `${BINANCE_FUTURES}/fapi/v1/fundingRate?symbol=${symbols.perp}&limit=1`,
  ).catch(() => null)

  // Fear & Greed Index (alternative.me).
  type Fng = {
    data: { value: string; value_classification: string; timestamp: string }[]
  }
  const fngP = fetchJson<Fng>(`${FNG}?limit=1`).catch(() => null)

  const [spot, funding, fng] = await Promise.all([
    spotTickerP,
    fundingP,
    fngP,
  ])

  const last = Number(spot.lastPrice)
  const high = Number(spot.highPrice)
  const low = Number(spot.lowPrice)
  // Realized 24h vol approximated from intraday high/low range as a
  // percentage of mid — crude but adequate for a v1 risk gate.
  const mid = (high + low) / 2 || last
  const volatility24hBps = mid > 0 ? Math.round(((high - low) / mid) * 10_000) : 0

  const fundingRateBps =
    funding && funding[0]
      ? Math.round(Number(funding[0].fundingRate) * 10_000)
      : undefined

  const fearGreedItem = fng?.data?.[0]
  const fearGreed = fearGreedItem ? Number(fearGreedItem.value) : 50
  const fearGreedClassification = fearGreedItem?.value_classification ?? 'Neutral'

  return {
    asset,
    spot: last,
    spot24hChangeBps: Math.round(Number(spot.priceChangePercent) * 100),
    fearGreed,
    fearGreedClassification,
    fundingRateBps,
    volatility24hBps,
    fetchedAt: new Date().toISOString(),
  }
}
