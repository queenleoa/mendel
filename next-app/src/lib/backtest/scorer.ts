import type { Genome } from '../genome'
import { fetchETHBars } from './data'
import {
  backtestGenome,
  buyAndHoldBenchmark,
  type BacktestResult,
  type BenchmarkResult,
} from './runner'

export type ScoredGenome = {
  genome: Genome
  result: BacktestResult
}

export type Scoreboard = {
  benchmark: BenchmarkResult
  scored: ScoredGenome[]
}

/**
 * Backtest a list of child genomes against the same ETH bar series and
 * return them alongside a buy-and-hold benchmark for context.
 *
 * Bars are fetched once per page session (module-level cache); the
 * 9-genome scoring loop itself is sub-100ms.
 */
export async function scoreChildren(
  childGenomes: Genome[],
): Promise<Scoreboard> {
  const bars = await fetchETHBars()
  const benchmark = buyAndHoldBenchmark(bars)
  const scored = childGenomes.map((genome) => ({
    genome,
    result: backtestGenome(genome, bars),
  }))
  return { benchmark, scored }
}
