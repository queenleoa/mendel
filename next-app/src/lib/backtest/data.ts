// Historical bar fetch for backtests. We pull ETH/USDT spot klines from
// Binance because (a) it has the deepest free public history and (b) USDT
// and USDC track USD within ~10 bps, which is well below our trade-cost
// model — so the resulting strategy scores are functionally identical to
// what the live ETH/USDC agent would experience.

const BINANCE_KLINES_URL = 'https://api.binance.com/api/v3/klines'

export type Bar = {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// Module-level cache so multiple genome backtests in a single page session
// share the same bar series. Lifetime = page load.
let cachedBars: Bar[] | null = null

export function clearBarsCache(): void {
  cachedBars = null
}

const FETCH_TIMEOUT_MS = 8_000

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

/**
 * Fetch the last 720 hourly closes (~30 days) of ETHUSDT spot from Binance.
 * Caches in module memory after the first successful call.
 */
export async function fetchETHBars(): Promise<Bar[]> {
  if (cachedBars) return cachedBars

  const url = `${BINANCE_KLINES_URL}?symbol=ETHUSDT&interval=1h&limit=720`
  const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS)
  if (!res.ok) {
    throw new Error(`Binance klines HTTP ${res.status}`)
  }
  const raw = (await res.json()) as unknown[][]
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('Binance klines: empty response')
  }

  cachedBars = raw.map((row) => ({
    openTime: Number(row[0]),
    open: parseFloat(row[1] as string),
    high: parseFloat(row[2] as string),
    low: parseFloat(row[3] as string),
    close: parseFloat(row[4] as string),
    volume: parseFloat(row[5] as string),
  }))
  return cachedBars
}
