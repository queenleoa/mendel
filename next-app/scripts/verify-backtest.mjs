// Mirrors the production backtest end-to-end (5m bars, 7d window, same
// signal + filter + entry/exit logic) against real ETH data so we can
// see exactly what each of the four phenotype combos does.
//
// Run: node scripts/verify-backtest.mjs

const BINANCE = 'https://api.binance.com/api/v3/klines'
const PER_REQ = 1000
const INTERVAL_MIN = 5
const BARS_PER_HOUR = 60 / INTERVAL_MIN // 12
const PERIODS_PER_DAY = (24 * 60) / INTERVAL_MIN // 288
const TARGET = 7 * 24 * BARS_PER_HOUR // 2016
const WARMUP = Math.round(48 * BARS_PER_HOUR) // 576
const FILTER_VOL_BARS = 24 * BARS_PER_HOUR // 288

// =====================================================================
// Fetch
// =====================================================================

async function fetchPage(endTime, limit) {
  const u = new URL(BINANCE)
  u.searchParams.set('symbol', 'ETHUSDT')
  u.searchParams.set('interval', '5m')
  u.searchParams.set('limit', String(limit))
  if (endTime !== undefined) u.searchParams.set('endTime', String(endTime))
  const res = await fetch(u.toString())
  const raw = await res.json()
  return raw.map((row) => ({
    openTime: Number(row[0]),
    close: parseFloat(row[4]),
  }))
}

let bars = []
let endTime
while (bars.length < TARGET) {
  const need = Math.min(TARGET - bars.length, PER_REQ)
  const batch = await fetchPage(endTime, need)
  if (batch.length === 0) break
  bars = [...batch, ...bars]
  endTime = batch[0].openTime - 1
  if (batch.length < need) break
}

console.log(
  `\nFetched ${bars.length} bars  ($${bars[0].close} → $${bars[bars.length - 1].close})`,
)
console.log(
  `7-day return: ${(((bars[bars.length - 1].close / bars[0].close) - 1) * 100).toFixed(2)}%`,
)

// =====================================================================
// Signal + filter mirrors of signals.ts
// =====================================================================

function checkFilter(bars, i, allele) {
  if (i < FILTER_VOL_BARS + 1) return false
  const returns = []
  for (let j = i - FILTER_VOL_BARS + 1; j <= i; j++) {
    const prev = bars[j - 1].close
    if (prev > 0) returns.push(bars[j].close / prev - 1)
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance =
    returns.reduce((acc, x) => acc + (x - mean) ** 2, 0) / returns.length
  const std = Math.sqrt(variance)
  const dailyVol = std * Math.sqrt(PERIODS_PER_DAY)
  return dailyVol >= allele.min && dailyVol <= allele.max
}

function momentum(bars, i, { lookback, threshold }) {
  const lb = lookback * BARS_PER_HOUR
  if (i < lb) return 'NEUTRAL'
  const prev = bars[i - lb].close
  if (prev <= 0) return 'NEUTRAL'
  const pct = bars[i].close / prev - 1
  if (pct > threshold) return 'LONG'
  if (pct < -threshold) return 'EXIT'
  return 'NEUTRAL'
}

function reversion(bars, i, { window, zThreshold }) {
  const w = window * BARS_PER_HOUR
  if (i < w) return 'NEUTRAL'
  const recent = bars.slice(i - w, i).map((b) => b.close)
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length
  const variance =
    recent.reduce((acc, x) => acc + (x - mean) ** 2, 0) / recent.length
  const std = Math.sqrt(variance)
  if (std === 0) return 'NEUTRAL'
  const z = (bars[i].close - mean) / std
  if (z < -zThreshold) return 'LONG'
  if (z > zThreshold) return 'EXIT'
  return 'NEUTRAL'
}

// =====================================================================
// Runner mirror
// =====================================================================

function backtest(name, triggerFn, triggerArgs, filterAllele) {
  const STARTING = 10000
  const SIZING = 0.20
  const TX = 0.0005

  let cash = STARTING
  let position = 0
  let entryPrice = 0
  let trades = 0
  let wins = 0
  let lonGFires = 0
  let exitFires = 0
  let filterPasses = 0

  for (let i = WARMUP; i < bars.length; i++) {
    const bar = bars[i]
    const signal = triggerFn(bars, i, triggerArgs)
    const filterOk = checkFilter(bars, i, filterAllele)

    if (signal === 'LONG') lonGFires++
    if (signal === 'EXIT') exitFires++
    if (filterOk) filterPasses++

    if (signal === 'LONG' && filterOk && position === 0) {
      const size = cash * SIZING
      position = size / bar.close
      cash -= size + size * TX
      entryPrice = bar.close
      trades++
    } else if ((signal === 'EXIT' || !filterOk) && position > 0) {
      const proceeds = position * bar.close
      cash += proceeds - proceeds * TX
      if (bar.close > entryPrice) wins++
      position = 0
    }
  }

  if (position > 0) {
    const last = bars[bars.length - 1]
    cash += position * last.close * (1 - TX)
    if (last.close > entryPrice) wins++
  }

  const evaluable = bars.length - WARMUP
  const ret = (cash / STARTING - 1) * 100
  console.log(`\n[${name}]`)
  console.log(
    `  trades: ${trades}  wins: ${wins}  return: ${ret > 0 ? '+' : ''}${ret.toFixed(2)}%`,
  )
  console.log(
    `  signals: LONG ${lonGFires}/${evaluable} (${((lonGFires / evaluable) * 100).toFixed(1)}%)  EXIT ${exitFires}/${evaluable} (${((exitFires / evaluable) * 100).toFixed(1)}%)`,
  )
  console.log(
    `  filter pass: ${filterPasses}/${evaluable} (${((filterPasses / evaluable) * 100).toFixed(1)}%)`,
  )
}

const NARROW = { min: 0.007, max: 0.025 }
const WIDE = { min: 0.005, max: 0.04 }

backtest('Momentum + Narrow (M-N)', momentum, { lookback: 4, threshold: 0.005 }, NARROW)
backtest('Momentum + Wide   (M-W)', momentum, { lookback: 4, threshold: 0.005 }, WIDE)
backtest('Reversion + Narrow (R-N)', reversion, { window: 4, zThreshold: 0.7 }, NARROW)
backtest('Reversion + Wide   (R-W)', reversion, { window: 4, zThreshold: 0.7 }, WIDE)
