// Shared shape for the Alpha tab's strategy-grid placements + helpers
// that turn those placements into the founder genomes the Mint tab will
// commit on-chain.
//
// Before this module the Alpha cells lived in component-local state and
// `Mint.tsx` rebuilt founders from `recommendedParams` directly, which
// meant any tweaks the user made on Alpha (different gene placement,
// custom param values) were silently dropped. With this module the
// pipeline is:
//
//   Alpha tab cells  ─►  TabLayout state  ─►  Mint  ─►  on-chain genome
//
// `recommendedParams` still feeds the Alpha tab's *chip* defaults, which
// in turn become the cell defaults at drop time. So a user who makes no
// edits in Alpha gets a Mint identical to what Phase A produced — but
// every gene swap or threshold tweak now flows through to the founders.

import type { Allele, Genome } from './genome'
import type { RecommendedParams } from './recommendedParams'
import { FALLBACK_PARAMS } from './recommendedParams'

export type CellKey =
  | 'dom-trigger'
  | 'rec-trigger'
  | 'dom-filter'
  | 'rec-filter'

export type CellState = {
  geneId: string
  params: Record<string, string>
} | null

export type AlphaCells = Record<CellKey, CellState>

export const EMPTY_ALPHA_CELLS: AlphaCells = {
  'dom-trigger': null,
  'rec-trigger': null,
  'dom-filter': null,
  'rec-filter': null,
}

const num = (s: string | undefined, fallback: number): number => {
  if (s === undefined || s === '') return fallback
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : fallback
}

// =====================================================================
// Allele constructors
// =====================================================================
//
// The Alpha tab represents thresholds in user-friendly units (e.g. "0.5"
// for 0.5%, "0.7" for 0.7σ, vol band "0.7" for 0.7%). The genome stores
// thresholds as decimals (0.005, 0.007). All %-style fields get / 100.

type TriggerAllele = Extract<Allele, { type: 'momentum' | 'reversion' }>
type FilterAllele = Extract<Allele, { type: `volatility-${string}` }>

function triggerFromCell(
  cell: CellState,
  defaultsForFallback: TriggerAllele,
): TriggerAllele {
  if (cell?.geneId === 'momentum') {
    return {
      type: 'momentum',
      lookback: num(
        cell.params.lookback,
        defaultsForFallback.type === 'momentum'
          ? defaultsForFallback.lookback
          : 4,
      ),
      threshold:
        num(
          cell.params.threshold,
          defaultsForFallback.type === 'momentum'
            ? defaultsForFallback.threshold * 100
            : 0.5,
        ) / 100,
    }
  }
  if (cell?.geneId === 'mean-reversion') {
    return {
      type: 'reversion',
      window: num(
        cell.params.window,
        defaultsForFallback.type === 'reversion'
          ? defaultsForFallback.window
          : 4,
      ),
      zThreshold: num(
        cell.params.threshold,
        defaultsForFallback.type === 'reversion'
          ? defaultsForFallback.zThreshold
          : 0.3,
      ),
    }
  }
  // Empty cell or unknown gene type → fall back to defaults.
  return defaultsForFallback
}

function filterFromCell(
  cell: CellState,
  filterType: 'volatility-narrow' | 'volatility-wide',
  defaults: { min: number; max: number },
): FilterAllele {
  if (cell?.geneId === 'volatility-band') {
    return {
      type: filterType,
      min: num(cell.params.low, defaults.min * 100) / 100,
      max: num(cell.params.high, defaults.max * 100) / 100,
    }
  }
  return { type: filterType, min: defaults.min, max: defaults.max }
}

// =====================================================================
// Founder genome builders
// =====================================================================
//
// Each founder is HOMOZYGOUS (both haplotypes identical). F1 = the
// "dominant strategy" cells, F2 = the "recessive strategy" cells. The
// recombination logic in genome.ts skips a generation internally so the
// breed of homozygous P parents yields a properly-segregating F2.

export function buildF1FromCells(
  cells: AlphaCells,
  rec: RecommendedParams | null,
): Genome {
  const r = rec ?? FALLBACK_PARAMS
  const triggerDefault: TriggerAllele = {
    type: 'momentum',
    lookback: r.momentum.lookback,
    threshold: r.momentum.threshold,
  }
  const trigger = triggerFromCell(cells['dom-trigger'], triggerDefault)
  const filter = filterFromCell(
    cells['dom-filter'],
    'volatility-narrow',
    r.volatility.narrow,
  )
  return {
    trigger: {
      locusId: 'I',
      alleles: [trigger, trigger],
      dominance: trigger.type,
    },
    filter: {
      locusId: 'II',
      alleles: [filter, filter],
      dominance: filter.type,
    },
    parents: [],
    generation: 0,
    createdAt: new Date().toISOString(),
  }
}

export function buildF2FromCells(
  cells: AlphaCells,
  rec: RecommendedParams | null,
): Genome {
  const r = rec ?? FALLBACK_PARAMS
  const triggerDefault: TriggerAllele = {
    type: 'reversion',
    window: r.reversion.window,
    zThreshold: r.reversion.zThreshold,
  }
  const trigger = triggerFromCell(cells['rec-trigger'], triggerDefault)
  const filter = filterFromCell(
    cells['rec-filter'],
    'volatility-wide',
    r.volatility.wide,
  )
  return {
    trigger: {
      locusId: 'I',
      alleles: [trigger, trigger],
      dominance: trigger.type,
    },
    filter: {
      locusId: 'II',
      alleles: [filter, filter],
      dominance: filter.type,
    },
    parents: [],
    generation: 0,
    createdAt: new Date().toISOString(),
  }
}
