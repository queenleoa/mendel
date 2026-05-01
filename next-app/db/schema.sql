-- Agents table: one row per activated iNFT.
CREATE TABLE IF NOT EXISTS agents (
  token_id BIGINT PRIMARY KEY,
  owner_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',           -- 'active' | 'paused' | 'killed'
  genome JSONB NOT NULL,                            -- decrypted genome JSON
  lineage JSONB NOT NULL,                           -- {asset, venue, barInterval, ...}
  position TEXT NOT NULL DEFAULT 'flat',            -- 'flat' | 'long'
  position_qty NUMERIC NOT NULL DEFAULT 0,
  position_open_price NUMERIC,
  realized_pnl_bps INTEGER NOT NULL DEFAULT 0,
  cumulative_trades INTEGER NOT NULL DEFAULT 0,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_cycle_at TIMESTAMPTZ
);

-- One row per cycle ever attempted. Replay-friendly history.
CREATE TABLE IF NOT EXISTS cycles (
  id BIGSERIAL PRIMARY KEY,
  token_id BIGINT NOT NULL REFERENCES agents(token_id) ON DELETE CASCADE,
  cycle_no INTEGER NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Market snapshot (raw inputs the strategy and LLM saw)
  market_snapshot JSONB NOT NULL,

  -- Strategy output
  alpha_signal TEXT NOT NULL,                       -- 'buy' | 'sell' | 'hold'
  alpha_reason TEXT,

  -- LLM gatekeeper output
  llm_decision TEXT,                                -- 'accept' | 'reject' | 'skip'
  llm_reason TEXT,
  llm_provider TEXT,
  llm_chat_id TEXT,

  -- Trade execution
  trade_action TEXT,                                -- 'open_long' | 'close_long' | 'skip'
  trade_price NUMERIC,
  trade_qty NUMERIC,
  trade_tx_hash TEXT,
  pnl_bps_cumulative INTEGER,

  -- 0G Storage decision log (Phase 2)
  decision_log_root_hash TEXT
);

CREATE INDEX IF NOT EXISTS cycles_token_id_idx ON cycles (token_id, cycle_no DESC);
