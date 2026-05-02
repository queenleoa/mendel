// Sanity-check the new filter formula against real ETH data: pulls the
// last 7 days of 5-minute klines and reports (a) daily realized vol at
// each evaluable bar, (b) how often each band passes.
//
// Run: node scripts/verify-vol-filter.mjs

const BINANCE = 'https://api.binance.com/api/v3/klines'
const PER_REQ = 1000
const INTERVAL_MIN = 5
const BARS_PER_HOUR = 60 / INTERVAL_MIN
const FILTER_VOL_BARS = 24 * BARS_PER_HOUR // 288
const PERIODS_PER_DAY = (24 * 60) / INTERVAL_MIN // 288
const TARGET = 7 * 24 * BARS_PER_HOUR // 2016

async function fetchPage(endTime, limit) {
  const u = new URL(BINANCE)
  u.searchParams.set('symbol', 'ETHUSDT')
  u.searchParams.set('interval', '5m')
  u.searchParams.set('limit', String(limit))
  if (endTime !== undefined) u.searchParams.set('endTime', String(endTime))
  const res = await fetch(u.toString())
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const raw = await res.json()
  return raw.map((row) => ({ openTime: Number(row[0]), close: parseFloat(row[4]) }))
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

console.log(`Fetched ${bars.length} bars  ($${bars[0].close} → $${bars[bars.length - 1].close})`)

const NARROW = { min: 0.007, max: 0.025 }
const WIDE = { min: 0.005, max: 0.04 }

const dailyVols = []
let narrowPasses = 0
let widePasses = 0
let evaluable = 0

for (let i = FILTER_VOL_BARS + 1; i < bars.length; i++) {
  const returns = []
  for (let j = i - FILTER_VOL_BARS + 1; j <= i; j++) {
    const prev = bars[j - 1].close
    if (prev > 0) returns.push(bars[j].close / prev - 1)
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((acc, x) => acc + (x - mean) ** 2, 0) / returns.length
  const std = Math.sqrt(variance)
  const dailyVol = std * Math.sqrt(PERIODS_PER_DAY)
  dailyVols.push(dailyVol)
  evaluable++
  if (dailyVol >= NARROW.min && dailyVol <= NARROW.max) narrowPasses++
  if (dailyVol >= WIDE.min && dailyVol <= WIDE.max) widePasses++
}

dailyVols.sort((a, b) => a - b)
const pct = (p) => dailyVols[Math.floor(p * dailyVols.length)]

console.log(`\nDaily realized vol distribution across ${evaluable} bars:`)
console.log(`  min:    ${(dailyVols[0] * 100).toFixed(3)}%`)
console.log(`  p10:    ${(pct(0.1) * 100).toFixed(3)}%`)
console.log(`  p25:    ${(pct(0.25) * 100).toFixed(3)}%`)
console.log(`  median: ${(pct(0.5) * 100).toFixed(3)}%`)
console.log(`  p75:    ${(pct(0.75) * 100).toFixed(3)}%`)
console.log(`  p90:    ${(pct(0.9) * 100).toFixed(3)}%`)
console.log(`  max:    ${(dailyVols[dailyVols.length - 1] * 100).toFixed(3)}%`)

console.log(`\nFilter pass rate:`)
console.log(`  narrow [0.7%, 2.5%]: ${narrowPasses}/${evaluable} = ${((narrowPasses / evaluable) * 100).toFixed(1)}%`)
console.log(`  wide   [0.5%, 4.0%]: ${widePasses}/${evaluable} = ${((widePasses / evaluable) * 100).toFixed(1)}%`)
