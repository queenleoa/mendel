'use client'

import '../../styles/UniverseParameters.css'

export type UniverseParams = {
  familyName: string
  venue: string
  pair: string
  timeframe: string
}

export const defaultUniverseParams: UniverseParams = {
  familyName: '',
  venue: 'uniswap',
  pair: 'eth/usdc',
  timeframe: '',
}

export const isUniverseComplete = (p: UniverseParams): boolean =>
  p.familyName.trim().length > 0 &&
  p.venue.length > 0 &&
  p.pair.length > 0 &&
  p.timeframe.length > 0

type Props = {
  value: UniverseParams
  onChange: (next: UniverseParams) => void
  onContinue: () => void
}

const VENUES = [
  { value: 'uniswap', label: 'Uniswap', disabled: false },
  { value: 'gmx', label: 'GMX', disabled: true },
  { value: 'hyperliquid', label: 'Hyperliquid', disabled: true },
  { value: 'binance', label: 'Binance', disabled: true },
]

const PAIRS = [
  { value: 'eth/usdc', label: 'ETH / USDC', disabled: false },
  { value: 'eth/btc', label: 'ETH / BTC', disabled: true },
  { value: 'btc/usdc', label: 'BTC / USDC', disabled: true },
]

const TIMEFRAMES = [
  { value: '1m', label: '1 minute' },
  { value: '5m', label: '5 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '1d', label: '1 day' },
]

export default function UniverseParameters({ value, onChange, onContinue }: Props) {
  const update = <K extends keyof UniverseParams>(key: K, v: UniverseParams[K]) =>
    onChange({ ...value, [key]: v })

  const complete = isUniverseComplete(value)

  return (
    <div className="universe-container">
      <article className="universe-card">
        <header className="card-header">
          <p className="eyebrow">Step 2 · Universe</p>
          <h1 className="title">Universe Parameters</h1>
          <p className="subtitle">
            These parameters define the specialisation of your quant bot. The
            details will also be used to group your strategy iNFT. Strategies
            with different universe parameters are therefore not equivalent,
            but strategies with similar universe parameters can be cross-bred.
          </p>
        </header>

        <form
          className="universe-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (complete) onContinue()
          }}
        >
          <div className="field">
            <label htmlFor="family-name">Family Name</label>
            <input
              id="family-name"
              type="text"
              placeholder="e.g. Mendelian Momentum"
              value={value.familyName}
              onChange={(e) => update('familyName', e.target.value)}
              autoComplete="off"
            />
            <p className="field-hint">
              A human-readable label for the strategy family.
            </p>
          </div>

          <div className="field">
            <label htmlFor="venue">Venue</label>
            <select
              id="venue"
              value={value.venue}
              onChange={(e) => update('venue', e.target.value)}
            >
              {VENUES.map((v) => (
                <option key={v.value} value={v.value} disabled={v.disabled}>
                  {v.label}
                  {v.disabled ? ' — v2' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="pair">Trading Pair</label>
            <select
              id="pair"
              value={value.pair}
              onChange={(e) => update('pair', e.target.value)}
            >
              {PAIRS.map((p) => (
                <option key={p.value} value={p.value} disabled={p.disabled}>
                  {p.label}
                  {p.disabled ? ' — v2' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="timeframe">Timeframe</label>
            <select
              id="timeframe"
              value={value.timeframe}
              onChange={(e) => update('timeframe', e.target.value)}
            >
              <option value="" disabled>
                Select a timeframe
              </option>
              {TIMEFRAMES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-footer">
            <button
              className="btn btn-primary"
              type="submit"
              disabled={!complete}
              title={complete ? undefined : 'Fill all fields to continue'}
            >
              Continue
            </button>
            {!complete && (
              <p className="form-hint">
                Complete all fields to unlock the next steps.
              </p>
            )}
          </div>
        </form>
      </article>
    </div>
  )
}
