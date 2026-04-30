import { useState } from 'react'
import type { DragEvent } from 'react'
import '../../styles/AlphaParameters.css'

type GeneType = 'trigger' | 'filter'

type Gene = {
  id: string
  label: string
  type: GeneType
  active: boolean
  color: string
}

const GENES: Gene[] = [
  // Active triggers
  { id: 'momentum', label: 'Momentum', type: 'trigger', active: true, color: '#f59e0b' },
  { id: 'mean-reversion', label: 'Mean Reversion', type: 'trigger', active: true, color: '#8b5cf6' },
  // V2 triggers
  { id: 'breakout', label: 'Breakout', type: 'trigger', active: false, color: '#ef4444' },
  { id: 'volume-surge', label: 'Volume Surge', type: 'trigger', active: false, color: '#06b6d4' },
  { id: 'macd-crossover', label: 'MACD Crossover', type: 'trigger', active: false, color: '#10b981' },
  { id: 'rsi-bounce', label: 'RSI Bounce', type: 'trigger', active: false, color: '#ec4899' },
  { id: 'range-reversal', label: 'Range Reversal', type: 'trigger', active: false, color: '#eab308' },
  { id: 'news-sentiment', label: 'News Sentiment', type: 'trigger', active: false, color: '#3b82f6' },
  // Active filter
  { id: 'volatility-band', label: 'Volatility Band', type: 'filter', active: true, color: '#14b8a6' },
  // V2 filters
  { id: 'trend-strength', label: 'Trend Strength', type: 'filter', active: false, color: '#d946ef' },
  { id: 'volume-confirm', label: 'Volume Confirm', type: 'filter', active: false, color: '#84cc16' },
  { id: 'time-of-day', label: 'Time-of-Day', type: 'filter', active: false, color: '#fb923c' },
  { id: 'correlation', label: 'Correlation', type: 'filter', active: false, color: '#34d399' },
  { id: 'funding-rate', label: 'Funding Rate', type: 'filter', active: false, color: '#fbbf24' },
  { id: 'drawdown-brake', label: 'Drawdown Brake', type: 'filter', active: false, color: '#dc2626' },
]

type CellKey = 'dom-trigger' | 'rec-trigger' | 'dom-filter' | 'rec-filter'

const CELL_TYPES: Record<CellKey, GeneType> = {
  'dom-trigger': 'trigger',
  'rec-trigger': 'trigger',
  'dom-filter': 'filter',
  'rec-filter': 'filter',
}

type Variant = '' | '2x2' | '2x3' | '2x4' | '3x2' | '3x3' | '3x4'

const VARIANT_OPTIONS: { value: Variant; label: string; disabled?: boolean }[] = [
  { value: '2x2', label: '2 × 2' },
  { value: '2x3', label: '2 × 3', disabled: true },
  { value: '2x4', label: '2 × 4', disabled: true },
  { value: '3x2', label: '3 × 2', disabled: true },
  { value: '3x3', label: '3 × 3', disabled: true },
  { value: '3x4', label: '3 × 4', disabled: true },
]

type ParamField = {
  key: string
  label: string
  defaultValue: string
  prefix?: string
  suffix?: string
}

type CellState = { geneId: string; params: Record<string, string> } | null

const GENE_PARAMS: Record<string, ParamField[]> = {
  momentum: [
    { key: 'lookback', label: 'Lookback', defaultValue: '24', suffix: 'h' },
    { key: 'threshold', label: 'Threshold', prefix: '±', defaultValue: '2', suffix: '%' },
  ],
  'mean-reversion': [
    { key: 'window', label: 'Window', defaultValue: '24', suffix: 'h' },
    { key: 'threshold', label: 'Threshold', prefix: '±', defaultValue: '1', suffix: 'σ' },
  ],
  'volatility-band': [
    { key: 'low', label: 'Low', defaultValue: '0.7' },
    { key: 'high', label: 'High', defaultValue: '2.5' },
  ],
}

const buildDefaultParams = (geneId: string): Record<string, string> => {
  const params: Record<string, string> = {}
  ;(GENE_PARAMS[geneId] ?? []).forEach((p) => {
    params[p.key] = p.defaultValue
  })
  return params
}

const findGene = (id: string | null) => GENES.find((g) => g.id === id) ?? null

type ChipProps = {
  gene: Gene
  shaking: boolean
  onTryDragV2: (label: string, id: string) => void
}

function GeneChip({ gene, shaking, onTryDragV2 }: ChipProps) {
  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    if (!gene.active) {
      e.preventDefault()
      onTryDragV2(gene.label, gene.id)
      return
    }
    e.dataTransfer.setData('text/plain', gene.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div
      className={`gene-chip ${shaking ? 'shaking' : ''}`}
      draggable
      onDragStart={handleDragStart}
      style={{ ['--gene-color' as string]: gene.color }}
      title="Drag onto the strategy grid"
    >
      <span className="gene-chip-label">{gene.label}</span>
    </div>
  )
}

type CellProps = {
  cellKey: CellKey
  state: CellState
  onDrop: (cellKey: CellKey, geneId: string) => void
  onClear: (cellKey: CellKey) => void
  onParamChange: (cellKey: CellKey, paramKey: string, value: string) => void
}

function StrategyCell({ cellKey, state, onDrop, onClear, onParamChange }: CellProps) {
  const [hovering, setHovering] = useState(false)
  const [reject, setReject] = useState(false)
  const gene = state ? findGene(state.geneId) : null
  const expectedType = CELL_TYPES[cellKey]
  const columnClass = cellKey.startsWith('dom-') ? 'col-dominant' : 'col-recessive'
  const params = state ? GENE_PARAMS[state.geneId] ?? [] : []

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!hovering) setHovering(true)
  }

  const handleDragLeave = () => setHovering(false)

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setHovering(false)
    const id = e.dataTransfer.getData('text/plain')
    if (!id) return
    const dragged = findGene(id)
    if (!dragged) return
    if (dragged.type !== expectedType) {
      setReject(true)
      setTimeout(() => setReject(false), 350)
      return
    }
    onDrop(cellKey, id)
  }

  return (
    <div
      className={`strategy-cell ${columnClass} ${hovering ? 'hovering' : ''} ${reject ? 'rejecting' : ''} ${gene ? 'filled' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {gene && state ? (
        <div
          className="placed-gene"
          style={{ ['--gene-color' as string]: gene.color }}
        >
          <header className="placed-gene-header">
            <span className="placed-gene-label">{gene.label}</span>
            <button
              className="placed-gene-clear"
              type="button"
              onClick={() => onClear(cellKey)}
              aria-label="Remove"
            >
              ×
            </button>
          </header>
          {params.length > 0 && (
            <div className="placed-gene-params">
              {params.map((p) => (
                <div className="placed-gene-param" key={p.key}>
                  <label htmlFor={`${cellKey}-${p.key}`}>{p.label}</label>
                  <div className="placed-gene-input">
                    {p.prefix && <span className="placed-gene-affix">{p.prefix}</span>}
                    <input
                      id={`${cellKey}-${p.key}`}
                      type="text"
                      inputMode="decimal"
                      value={state.params[p.key] ?? ''}
                      onChange={(e) =>
                        onParamChange(cellKey, p.key, e.target.value)
                      }
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                    {p.suffix && <span className="placed-gene-affix">{p.suffix}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="cell-placeholder">
          <span className="cell-placeholder-icon">+</span>
          <span>Drop {expectedType}</span>
        </div>
      )}
    </div>
  )
}

export default function AlphaParameters() {
  const [variant, setVariant] = useState<Variant>('')
  const [cells, setCells] = useState<Record<CellKey, CellState>>({
    'dom-trigger': null,
    'rec-trigger': null,
    'dom-filter': null,
    'rec-filter': null,
  })
  const [shakingId, setShakingId] = useState<string | null>(null)
  const [v2Toast, setV2Toast] = useState<string | null>(null)

  const handleTryDragV2 = (label: string, id: string) => {
    setShakingId(id)
    setV2Toast(label)
    window.setTimeout(() => setShakingId(null), 380)
    window.setTimeout(() => setV2Toast(null), 1600)
  }

  const handleDropOnCell = (cellKey: CellKey, geneId: string) => {
    setCells((prev) => ({
      ...prev,
      [cellKey]: { geneId, params: buildDefaultParams(geneId) },
    }))
  }

  const handleClearCell = (cellKey: CellKey) => {
    setCells((prev) => ({ ...prev, [cellKey]: null }))
  }

  const handleParamChange = (
    cellKey: CellKey,
    paramKey: string,
    value: string,
  ) => {
    setCells((prev) => {
      const current = prev[cellKey]
      if (!current) return prev
      return {
        ...prev,
        [cellKey]: {
          ...current,
          params: { ...current.params, [paramKey]: value },
        },
      }
    })
  }

  const triggers = GENES.filter((g) => g.type === 'trigger')
  const filters = GENES.filter((g) => g.type === 'filter')

  const variantSelected = variant === '2x2'

  return (
    <div className="alpha-container">
      <header className="alpha-header">
        <div>
          <p className="eyebrow">Step 3 · Alpha</p>
          <h1 className="title">Create the Founding Strategies</h1>
          <p className="subtitle">
            Choose the signal layout, then drag genes from the gene library
            onto the dominant and recessive strategy slots. Each strategy is
            built from one trigger and one filter.
          </p>
        </div>
        <div className="variant-picker">
          <label htmlFor="variant">Signal categories and alpha variants</label>
          <select
            id="variant"
            value={variant}
            onChange={(e) => setVariant(e.target.value as Variant)}
          >
            <option value="">Select layout…</option>
            {VARIANT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {variantSelected ? (
        <div className="alpha-body">
          <aside className="gene-library" aria-label="Gene library">
            <section className="gene-group">
              <h2 className="gene-group-title">Triggers</h2>
              <div className="gene-grid">
                {triggers.map((g) => (
                  <GeneChip
                    key={g.id}
                    gene={g}
                    shaking={shakingId === g.id}
                    onTryDragV2={handleTryDragV2}
                  />
                ))}
              </div>
            </section>

            <section className="gene-group">
              <h2 className="gene-group-title">Filters</h2>
              <div className="gene-grid">
                {filters.map((g) => (
                  <GeneChip
                    key={g.id}
                    gene={g}
                    shaking={shakingId === g.id}
                    onTryDragV2={handleTryDragV2}
                  />
                ))}
              </div>
            </section>
          </aside>

          <section className="strategy-canvas">
            <div className="canvas-header">
              <p className="canvas-eyebrow">Founding strategies · 2 × 2</p>
              <p className="canvas-hint">
                Drag a trigger gene into the top row, a filter gene into the
                bottom row. Dominant on the left, recessive on the right.
              </p>
            </div>

            <div className="strategy-grid">
              <div className="grid-corner" />
              <div className="col-label dominant">
                <span className="col-label-tag">D</span>
                <span>Dominant Strategy</span>
              </div>
              <div className="col-label recessive">
                <span className="col-label-tag">R</span>
                <span>Recessive Strategy</span>
              </div>

              <div className="row-label">Trigger</div>
              <StrategyCell
                cellKey="dom-trigger"
                state={cells['dom-trigger']}
                onDrop={handleDropOnCell}
                onClear={handleClearCell}
                onParamChange={handleParamChange}
              />
              <StrategyCell
                cellKey="rec-trigger"
                state={cells['rec-trigger']}
                onDrop={handleDropOnCell}
                onClear={handleClearCell}
                onParamChange={handleParamChange}
              />

              <div className="row-label">Filter</div>
              <StrategyCell
                cellKey="dom-filter"
                state={cells['dom-filter']}
                onDrop={handleDropOnCell}
                onClear={handleClearCell}
                onParamChange={handleParamChange}
              />
              <StrategyCell
                cellKey="rec-filter"
                state={cells['rec-filter']}
                onDrop={handleDropOnCell}
                onClear={handleClearCell}
                onParamChange={handleParamChange}
              />
            </div>
          </section>
        </div>
      ) : (
        <div className="alpha-empty">
          <p>Choose a signal layout above to load the gene library and the founding-strategy grid.</p>
        </div>
      )}

      {v2Toast && (
        <div className="v2-toast" role="status">
          <strong>{v2Toast}</strong> — coming in v2
        </div>
      )}
    </div>
  )
}
