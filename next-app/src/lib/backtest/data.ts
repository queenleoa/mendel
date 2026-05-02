// Historical bar fetch for backtests. We pull ETH/USDT spot klines from
// Binance because (a) it has the deepest free public history and (b) USDT
// and USDC track USD within ~10 bps, which is well below our trade-cost
// model — so the resulting strategy scores are functionally identical to
// what the live ETH/USDC agent would experience.
//
// Default window: 5-minute bars × 7 days = 2016 bars. Matches the demo's
// chosen timeframe in the Universe tab. Binance caps each klines request
// at 1000 bars, so we paginate two requests via `endTime`.

const BINANCE_KLINES_URL = 'https://api.binance.com/api/v3/klines'
const PER_REQUEST_MAX = 1000
const FETCH_TIMEOUT_MS = 8_000

// =====================================================================
// Bar interval — referenced by signals.ts and runner.ts to convert the
// genome's hour-based knobs (lookback, window, vol filter) to bar counts.
// =====================================================================

export const INTERVAL = '5m' as const
export const INTERVAL_MINUTES = 5
export const BARS_PER_HOUR = 60 / INTERVAL_MINUTES // 12

const HISTORICAL_DAYS = 7
export const TARGET_BARS = HISTORICAL_DAYS * 24 * BARS_PER_HOUR // 2016

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

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

function parseRow(row: unknown[]): Bar {
  return {
    openTime: Number(row[0]),
    open: parseFloat(row[1] as string),
    high: parseFloat(row[2] as string),
    low: parseFloat(row[3] as string),
    close: parseFloat(row[4] as string),
    volume: parseFloat(row[5] as string),
  }
}

/** Fetch one page of klines. `endTime=undefined` means "up to now". */
async function fetchKlinesPage(
  endTime: number | undefined,
  limit: number,
): Promise<Bar[]> {
  const params = new URLSearchParams({
    symbol: 'ETHUSDT',
    interval: INTERVAL,
    limit: String(limit),
  })
  if (endTime !== undefined) params.set('endTime', String(endTime))
  const url = `${BINANCE_KLINES_URL}?${params.toString()}`

  const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS)
  if (!res.ok) {
    throw new Error(`Binance klines HTTP ${res.status}`)
  }
  const raw = (await res.json()) as unknown[][]
  if (!Array.isArray(raw)) {
    throw new Error('Binance klines: bad response shape')
  }
  return raw.map(parseRow)
}

/**
 * Fetch the most recent `TARGET_BARS` × `INTERVAL` bars of ETHUSDT,
 * paginating backwards through Binance's klines API as needed. Returns
 * bars in chronological order (oldest first).
 */
export async function fetchETHBars(): Promise<Bar[]> {
  if (cachedBars) return cachedBars

  let collected: Bar[] = []
  let endTime: number | undefined = undefined

  while (collected.length < TARGET_BARS) {
    const remaining = TARGET_BARS - collected.length
    const limit = Math.min(remaining, PER_REQUEST_MAX)
    const batch = await fetchKlinesPage(endTime, limit)
    if (batch.length === 0) break

    // batch is chronological. Prepend so the *oldest* bars sit at index 0.
    collected = [...batch, ...collected]

    // Next iteration: fetch bars older than the earliest one we have.
    // Subtracting 1 ms avoids re-fetching the same bar's close boundary.
    endTime = batch[0].openTime - 1

    // Binance returned fewer than we asked for → we've exhausted history.
    if (batch.length < limit) break
  }

  if (collected.length === 0) {
    throw new Error('Binance klines: empty result')
  }
  cachedBars = collected
  return cachedBars
}
