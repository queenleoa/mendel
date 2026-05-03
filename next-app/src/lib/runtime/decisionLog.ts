// Periodic batch upload of cycle decision logs to 0G Storage.
//
// Each `runCycle` writes a row to the `cycles` Postgres table with the
// market snapshot, alpha signal/reason, LLM decision/reason/provider/chatId,
// and trade outcome. Those rows are the agent's auditable decision trail.
// This module bundles every still-unposted row into a single JSON document,
// pushes it to 0G Storage, and writes the resulting root hash back into
// each row's `decision_log_root_hash` column so anyone can later fetch
// `0g://<hash>` and replay the agents' reasoning.
//
// Triggered every 10 minutes by the Vercel cron at
// /api/cron/upload-decision-logs (see vercel.json). Also callable by
// hand for testing — just curl the endpoint locally.

import 'server-only'

import { JsonRpcProvider, Wallet } from 'ethers'
import { Indexer, MemData } from '@0gfoundation/0g-storage-ts-sdk'
import { sql } from './db'
import type { Cycle } from './types'

const STORAGE_INDEXER_URL = 'https://indexer-storage-testnet-turbo.0g.ai'
const ZERO_G_RPC =
  process.env.ZERO_G_RPC ?? 'https://evmrpc-testnet.0g.ai'

// Cap each batch — Postgres + storage upload latency scales with this.
// 250 cycles ≈ 200KB of JSON, well within a single 0G Storage segment.
const MAX_BATCH = 250

// Same DB row shape used by db.ts. Duplicated locally rather than
// exported to keep the runtime/db boundary clean.
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

const rowToCycle = (r: CycleRow): Cycle => ({
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

export type UploadDecisionLogsResult = {
  uploaded: number
  rootHash: string | null
  txHash: string | null
  batchTs: string
}

/**
 * Pull every cycle whose `decision_log_root_hash` is still NULL (i.e.
 * never been included in an upload), bundle them into one JSON blob,
 * push to 0G Storage, and stamp every row in the batch with the
 * resulting root hash. Idempotent — running twice in a row with no new
 * cycles in between is a no-op.
 */
export async function uploadPendingDecisionLogs(): Promise<UploadDecisionLogsResult> {
  const batchTs = new Date().toISOString()

  // 1. Fetch the oldest pending cycles.
  const rows = (await sql`
    SELECT * FROM cycles
    WHERE decision_log_root_hash IS NULL
    ORDER BY id ASC
    LIMIT ${MAX_BATCH};
  `) as CycleRow[]

  if (rows.length === 0) {
    return { uploaded: 0, rootHash: null, txHash: null, batchTs }
  }

  // 2. Build the public, append-only decision-log document.
  const cycles = rows.map(rowToCycle)
  const payload = {
    schema: 'mendel.decisionLog/v1',
    batchTs,
    count: cycles.length,
    minCycleId: cycles[0].id,
    maxCycleId: cycles[cycles.length - 1].id,
    cycles,
  }
  const bytes = new TextEncoder().encode(JSON.stringify(payload))

  // 3. Upload to 0G Storage with the agent's hot wallet.
  const pk = process.env.AGENT_PRIVATE_KEY
  if (!pk) throw new Error('AGENT_PRIVATE_KEY not set')
  const provider = new JsonRpcProvider(ZERO_G_RPC)
  const wallet = new Wallet(pk, provider)

  const memData = new MemData(bytes)
  const [tree, treeErr] = await memData.merkleTree()
  if (treeErr || !tree) {
    throw new Error(`merkleTree: ${treeErr?.message ?? 'unknown error'}`)
  }
  const rootHash = tree.rootHash()
  if (!rootHash) throw new Error('merkleTree: empty root hash')

  const indexer = new Indexer(STORAGE_INDEXER_URL)
  let txHash = ''
  const [tx, uploadErr] = await indexer.upload(
    memData,
    ZERO_G_RPC,
    wallet as never,
  )
  if (uploadErr) {
    // Same root hash + same blob = "already uploaded" is functionally a
    // success, just means a previous run got us here. Mark the rows.
    if (!/already.*upload/i.test(uploadErr.message)) {
      throw new Error(`upload: ${uploadErr.message}`)
    }
    if (tx && 'txHash' in tx) txHash = tx.txHash
  } else {
    txHash = 'txHash' in tx ? tx.txHash : tx.txHashes[0]
  }

  // 4. Stamp every cycle in the batch with the root hash so we never
  //    re-upload them. Use a single UPDATE with ANY() so it's atomic.
  const ids = rows.map((r) => Number(r.id))
  await sql`
    UPDATE cycles SET decision_log_root_hash = ${rootHash}
    WHERE id = ANY(${ids}::bigint[]);
  `

  return { uploaded: cycles.length, rootHash, txHash, batchTs }
}
