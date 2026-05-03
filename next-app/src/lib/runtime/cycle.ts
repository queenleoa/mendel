import {
  applyTradeToAgent,
  getAgent,
  getNextCycleNo,
  insertCycle,
} from './db'
import { fetchMarketSnapshot } from './market'
import { evaluateStrategy } from './strategy'
import { llmGatekeeper } from './llm'
import { tryCloseLong, tryOpenLong, type TradeAttempt } from './uniswap'
import type { Cycle, MarketSnapshot } from './types'

// =====================================================================
//                          Trade execution
// =====================================================================
//
//  Routes through Uniswap V3 on Base Sepolia for the actual swap, but
//  *PnL math always uses the Binance reference price* — testnet pool
//  prices are wildly off mainnet (~$162/ETH today) and we don't want
//  thin-pool liquidity to corrupt the strategy's accounting. The on-
//  chain swap is proof-of-execution; the books are kept against
//  Binance.
//
//  Any swap failure (no liquidity, balance shortfall, RPC blip, slippage
//  breach) falls back to a paper trade — `tradeTxHash` is left null and
//  the cycle still records open_long / close_long against the Binance
//  ref price so the position state machine keeps marching.

type TradeResult = {
  action: 'open_long' | 'close_long' | 'skip'
  price: number | null
  qty: number | null
  txHash: string | null
  realizedPnlBpsDelta: number
  cumulativeTradesDelta: number
  newPosition: 'flat' | 'long'
  newPositionQty: number
  newPositionOpenPrice: number | null
  // Optional human-readable note for the cycle log when the on-chain
  // fill diverges materially from Binance, or when we paper-traded.
  note?: string
}

function noopTrade(current: {
  position: 'flat' | 'long'
  positionQty: number
  positionOpenPrice: number | null
}): TradeResult {
  return {
    action: 'skip',
    price: null,
    qty: null,
    txHash: null,
    realizedPnlBpsDelta: 0,
    cumulativeTradesDelta: 0,
    newPosition: current.position,
    newPositionQty: current.positionQty,
    newPositionOpenPrice: current.positionOpenPrice,
  }
}

function describeSwap(attempt: TradeAttempt): string | undefined {
  if (attempt.isPaper) {
    return `paper-trade (${attempt.paperReason ?? 'pool unavailable'})`
  }
  if (attempt.uniswapPrice === null) return undefined
  const divergencePct =
    ((attempt.uniswapPrice - attempt.binancePrice) / attempt.binancePrice) *
    100
  if (Math.abs(divergencePct) < 5) return undefined
  return `swap fill ~$${attempt.uniswapPrice.toFixed(2)} (testnet pool, ${divergencePct >= 0 ? '+' : ''}${divergencePct.toFixed(1)}% vs Binance ref)`
}

async function executeTrade(
  signal: 'buy' | 'sell' | 'hold',
  decision: 'accept' | 'reject' | 'skip',
  market: MarketSnapshot,
  current: {
    position: 'flat' | 'long'
    positionQty: number
    positionOpenPrice: number | null
  },
): Promise<TradeResult> {
  if (decision !== 'accept') return noopTrade(current)
  if (signal === 'hold') return noopTrade(current)

  if (signal === 'buy' && current.position === 'flat') {
    const attempt = await tryOpenLong(market.spot)
    return {
      action: 'open_long',
      price: market.spot, // Binance ref — used for PnL math
      qty: attempt.ethSize,
      txHash: attempt.txHash,
      realizedPnlBpsDelta: 0,
      cumulativeTradesDelta: 1,
      newPosition: 'long',
      newPositionQty: attempt.ethSize,
      newPositionOpenPrice: market.spot,
      note: describeSwap(attempt),
    }
  }
  if (
    signal === 'sell' &&
    current.position === 'long' &&
    current.positionOpenPrice
  ) {
    const attempt = await tryCloseLong(market.spot, current.positionQty)
    const pnlBps = Math.round(
      ((market.spot - current.positionOpenPrice) /
        current.positionOpenPrice) *
        10_000,
    )
    return {
      action: 'close_long',
      price: market.spot,
      qty: current.positionQty,
      txHash: attempt.txHash,
      realizedPnlBpsDelta: pnlBps,
      cumulativeTradesDelta: 1,
      newPosition: 'flat',
      newPositionQty: 0,
      newPositionOpenPrice: null,
      note: describeSwap(attempt),
    }
  }
  return noopTrade(current)
}

// =====================================================================
//                          Cycle orchestrator
// =====================================================================

export async function runCycle(tokenId: number): Promise<Cycle> {
  const agent = await getAgent(tokenId)
  if (!agent) throw new Error(`Agent ${tokenId} not found`)
  if (agent.status !== 'active') {
    throw new Error(`Agent ${tokenId} is ${agent.status}`)
  }

  const cycleNo = await getNextCycleNo(tokenId)
  const market = await fetchMarketSnapshot(agent.lineage.asset)
  const alpha = evaluateStrategy(agent.genome, market, agent.position)
  const gate = await llmGatekeeper(
    alpha.signal,
    alpha.reason,
    agent.genome,
    market,
  )
  const trade = await executeTrade(alpha.signal, gate.decision, market, {
    position: agent.position,
    positionQty: agent.positionQty,
    positionOpenPrice: agent.positionOpenPrice,
  })

  // Persist the cycle. When the on-chain swap diverged from Binance ref
  // or fell back to paper, append the trade note to the alpha reason so
  // it shows up in the cycle log without needing a schema change.
  const alphaReasonWithNote = trade.note
    ? `${alpha.reason} · ${trade.note}`
    : alpha.reason

  const cumulativePnlAfter =
    agent.realizedPnlBps + trade.realizedPnlBpsDelta

  const cycle = await insertCycle({
    tokenId,
    cycleNo,
    marketSnapshot: market,
    alphaSignal: alpha.signal,
    alphaReason: alphaReasonWithNote,
    llmDecision: gate.decision,
    llmReason: gate.reason,
    llmProvider: gate.provider,
    llmChatId: gate.chatId,
    tradeAction: trade.action,
    tradePrice: trade.price,
    tradeQty: trade.qty,
    tradeTxHash: trade.txHash,
    pnlBpsCumulative: cumulativePnlAfter,
    decisionLogRootHash: null, // Stamped in by the cron upload job.
  })

  // Roll the agent's position state forward.
  await applyTradeToAgent(tokenId, {
    position: trade.newPosition,
    positionQty: trade.newPositionQty,
    positionOpenPrice: trade.newPositionOpenPrice,
    realizedPnlBpsDelta: trade.realizedPnlBpsDelta,
    cumulativeTradesDelta: trade.cumulativeTradesDelta,
  })

  return cycle
}
