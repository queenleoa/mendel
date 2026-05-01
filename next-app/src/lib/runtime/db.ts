// Server-only — guards against accidental client-bundle imports of
// @neondatabase/serverless + DATABASE_URL leakage.
import 'server-only'

import { neon } from '@neondatabase/serverless'
import type { Agent, AgentStatus, Cycle, Genome, LineageParams } from './types'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL not set')
}

export const sql = neon(process.env.DATABASE_URL)

// =====================================================================
//                                Agents
// =====================================================================

type AgentRow = {
  token_id: string
  owner_address: string
  status: AgentStatus
  genome: Genome
  lineage: LineageParams
  position: 'flat' | 'long'
  position_qty: string
  position_open_price: string | null
  realized_pnl_bps: number
  cumulative_trades: number
  activated_at: string
  last_cycle_at: string | null
}

const agentFromRow = (r: AgentRow): Agent => ({
  tokenId: Number(r.token_id),
  ownerAddress: r.owner_address,
  status: r.status,
  genome: r.genome,
  lineage: r.lineage,
  position: r.position,
  positionQty: Number(r.position_qty),
  positionOpenPrice: r.position_open_price ? Number(r.position_open_price) : null,
  realizedPnlBps: r.realized_pnl_bps,
  cumulativeTrades: r.cumulative_trades,
  activatedAt: r.activated_at,
  lastCycleAt: r.last_cycle_at,
})

export async function upsertAgent(input: {
  tokenId: number
  ownerAddress: string
  genome: Genome
  lineage: LineageParams
}): Promise<Agent> {
  const rows = (await sql`
    INSERT INTO agents
      (token_id, owner_address, genome, lineage, status)
    VALUES
      (${input.tokenId}, ${input.ownerAddress},
       ${JSON.stringify(input.genome)}::jsonb,
       ${JSON.stringify(input.lineage)}::jsonb,
       'active')
    ON CONFLICT (token_id) DO UPDATE SET
      owner_address = EXCLUDED.owner_address,
      genome = EXCLUDED.genome,
      lineage = EXCLUDED.lineage,
      status = 'active'
    RETURNING *;
  `) as AgentRow[]
  return agentFromRow(rows[0])
}

export async function getAgent(tokenId: number): Promise<Agent | null> {
  const rows = (await sql`
    SELECT * FROM agents WHERE token_id = ${tokenId} LIMIT 1;
  `) as AgentRow[]
  return rows[0] ? agentFromRow(rows[0]) : null
}

export async function listActiveAgents(): Promise<Agent[]> {
  const rows = (await sql`
    SELECT * FROM agents WHERE status = 'active' ORDER BY token_id ASC;
  `) as AgentRow[]
  return rows.map(agentFromRow)
}

export async function setAgentStatus(
  tokenId: number,
  status: AgentStatus,
): Promise<void> {
  await sql`
    UPDATE agents SET status = ${status} WHERE token_id = ${tokenId};
  `
}

// =====================================================================
//                                Cycles
// =====================================================================

type CycleRow = {
  id: string
  token_id: string
  cycle_no: number
  ts: string
  market_snapshot: Cycle['marketSnapshot']
  alpha_signal: Cycle['alphaSignal']
  alpha_reason: string | null
  llm_decision: Cycle['llmDecision']
  llm_reason: string | null
  llm_provider: string | null
  llm_chat_id: string | null
  trade_action: Cycle['tradeAction']
  trade_price: string | null
  trade_qty: string | null
  trade_tx_hash: string | null
  pnl_bps_cumulative: number | null
  decision_log_root_hash: string | null
}

const cycleFromRow = (r: CycleRow): Cycle => ({
  id: Number(r.id),
  tokenId: Number(r.token_id),
  cycleNo: r.cycle_no,
  ts: r.ts,
  marketSnapshot: r.market_snapshot,
  alphaSignal: r.alpha_signal,
  alphaReason: r.alpha_reason,
  llmDecision: r.llm_decision,
  llmReason: r.llm_reason,
  llmProvider: r.llm_provider,
  llmChatId: r.llm_chat_id,
  tradeAction: r.trade_action,
  tradePrice: r.trade_price ? Number(r.trade_price) : null,
  tradeQty: r.trade_qty ? Number(r.trade_qty) : null,
  tradeTxHash: r.trade_tx_hash,
  pnlBpsCumulative: r.pnl_bps_cumulative,
  decisionLogRootHash: r.decision_log_root_hash,
})

export async function getNextCycleNo(tokenId: number): Promise<number> {
  const rows = (await sql`
    SELECT COALESCE(MAX(cycle_no), 0) AS n
    FROM cycles WHERE token_id = ${tokenId};
  `) as { n: number }[]
  return Number(rows[0].n) + 1
}

export async function insertCycle(input: Omit<Cycle, 'id' | 'ts'>): Promise<Cycle> {
  const rows = (await sql`
    INSERT INTO cycles (
      token_id, cycle_no, market_snapshot,
      alpha_signal, alpha_reason,
      llm_decision, llm_reason, llm_provider, llm_chat_id,
      trade_action, trade_price, trade_qty, trade_tx_hash,
      pnl_bps_cumulative, decision_log_root_hash
    ) VALUES (
      ${input.tokenId}, ${input.cycleNo},
      ${JSON.stringify(input.marketSnapshot)}::jsonb,
      ${input.alphaSignal}, ${input.alphaReason},
      ${input.llmDecision}, ${input.llmReason},
      ${input.llmProvider}, ${input.llmChatId},
      ${input.tradeAction}, ${input.tradePrice}, ${input.tradeQty},
      ${input.tradeTxHash}, ${input.pnlBpsCumulative}, ${input.decisionLogRootHash}
    )
    RETURNING *;
  `) as CycleRow[]
  return cycleFromRow(rows[0])
}

export async function listCycles(
  tokenId: number,
  limit = 50,
): Promise<Cycle[]> {
  const rows = (await sql`
    SELECT * FROM cycles
    WHERE token_id = ${tokenId}
    ORDER BY cycle_no DESC
    LIMIT ${limit};
  `) as CycleRow[]
  return rows.map(cycleFromRow)
}

// =====================================================================
//                          Position updates
// =====================================================================

export async function applyTradeToAgent(
  tokenId: number,
  patch: {
    position: 'flat' | 'long'
    positionQty: number
    positionOpenPrice: number | null
    realizedPnlBpsDelta: number
    cumulativeTradesDelta: number
  },
): Promise<void> {
  await sql`
    UPDATE agents SET
      position = ${patch.position},
      position_qty = ${patch.positionQty},
      position_open_price = ${patch.positionOpenPrice},
      realized_pnl_bps = realized_pnl_bps + ${patch.realizedPnlBpsDelta},
      cumulative_trades = cumulative_trades + ${patch.cumulativeTradesDelta},
      last_cycle_at = NOW()
    WHERE token_id = ${tokenId};
  `
}
