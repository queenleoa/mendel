import type { Genome } from '../lib/genome'
import '../styles/ChromosomePair.css'

// Color + abbreviation map. Trigger alleles use the gene-library tones
// from the Alpha tab; volatility variants split off the original teal.
const ALLELE_INFO: Record<
  string,
  { abbr: string; color: string; full: string }
> = {
  momentum: { abbr: 'M', color: '#f59e0b', full: 'Momentum' },
  reversion: { abbr: 'R', color: '#8b5cf6', full: 'Reversion' },
  // Narrow keeps the original Volatility-Band teal from the Alpha tab;
  // Wide is pink to make the two filter alleles immediately distinguishable.
  'volatility-narrow': { abbr: 'N', color: '#14b8a6', full: 'Vol-Narrow' },
  'volatility-wide': { abbr: 'W', color: '#ec4899', full: 'Vol-Wide' },
}

function info(type: string) {
  return ALLELE_INFO[type] ?? { abbr: '?', color: '#888', full: type }
}

export type ChromosomeSize = 'sm' | 'md' | 'lg'

type Props = {
  genome: Genome
  size?: ChromosomeSize
}

/**
 * Diploid chromosome pair: two thick vertical bars side-by-side.
 * Each bar = one haplotype. Top arm carries the trigger allele,
 * bottom arm carries the filter allele, separated by a centromere.
 *
 * Dominant alleles get a small white dot on their arm.
 */
export default function ChromosomePair({ genome, size = 'md' }: Props) {
  const triggerDom = genome.trigger.dominance
  const filterDom = genome.filter.dominance
  return (
    <div className={`chromosome-pair size-${size}`} aria-hidden="true">
      <div className="chromosome-pair-bars">
        {[0, 1].map((i) => {
          const t = genome.trigger.alleles[i]
          const f = genome.filter.alleles[i]
          return (
            <Chromosome
              key={i}
              triggerType={t.type}
              filterType={f.type}
              triggerDominant={t.type === triggerDom}
              filterDominant={f.type === filterDom}
            />
          )
        })}
      </div>
    </div>
  )
}

function Chromosome({
  triggerType,
  filterType,
  triggerDominant,
  filterDominant,
}: {
  triggerType: string
  filterType: string
  triggerDominant: boolean
  filterDominant: boolean
}) {
  const t = info(triggerType)
  const f = info(filterType)
  return (
    <div className="chromosome">
      <div
        className={`chromosome-arm chromosome-arm-top ${triggerDominant ? 'dom' : 'rec'}`}
        style={{ ['--arm-color' as string]: t.color }}
        title={`${t.full}${triggerDominant ? ' (dominant)' : ''}`}
      >
        <span className="allele-letter">{t.abbr}</span>
      </div>
      <div className="centromere" />
      <div
        className={`chromosome-arm chromosome-arm-bottom ${filterDominant ? 'dom' : 'rec'}`}
        style={{ ['--arm-color' as string]: f.color }}
        title={`${f.full}${filterDominant ? ' (dominant)' : ''}`}
      >
        <span className="allele-letter">{f.abbr}</span>
      </div>
    </div>
  )
}

/** Empty placeholder shown while a child slot is still uploading. */
export function ChromosomePairPlaceholder({
  size = 'md',
}: {
  size?: ChromosomeSize
}) {
  return (
    <div
      className={`chromosome-pair size-${size} placeholder`}
      aria-hidden="true"
    >
      <div className="chromosome-pair-bars">
        <div className="chromosome chromosome-empty" />
        <div className="chromosome chromosome-empty" />
      </div>
    </div>
  )
}
