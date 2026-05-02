import {
  applyTradeToAgent,
  getAgent,
  getNextCycleNo,
  insertCycle,
} from './db'
import { fetchMarketSnapshot } from './market'
import { evaluateStrategy } from './strategy'
import { llmGatekeeper } from './llm'
import type { Cycle, MarketSnapshot } from './types'

// =====================================================================
//                          Trade execution (stub)
// =====================================================================
//
//  Phase 2 will route this through Uniswap V3 on Base Sepolia. For now
//  we paper-trade against the Binance spot mid: opening a long stores
//  position_open_price, closing realizes PnL in basis points.

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
}

function stubTrade(
  signal: 'buy' | 'sell' | 'hold',
  decision: 'accept' | 'reject',
  market: MarketSnapshot,
  current: { position: 'flat' | 'long'; positionQty: number; positionOpenPrice: number | null },
): TradeResult {
  // Default = no-op
  const noop: TradeResult = {
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
  if (decision !== 'accept') return noop
  if (signal === 'hold') return noop

  if (signal === 'buy' && current.position === 'flat') {
    // Paper open long for 1.0 ETH.
    const qty = 1
    return {
      action: 'open_long',
      price: market.spot,
      qty,
      txHash: null,
      realizedPnlBpsDelta: 0,
      cumulativeTradesDelta: 1,
      newPosition: 'long',
      newPositionQty: qty,
      newPositionOpenPrice: market.spot,
    }
  }
  if (signal === 'sell' && current.position === 'long' && current.positionOpenPrice) {
    const pnlBps = Math.round(
      ((market.spot - current.positionOpenPrice) / current.positionOpenPrice) * 10_000,
    )
    return {
      action: 'close_long',
      price: market.spot,
      qty: current.positionQty,
      txHash: null,
      realizedPnlBpsDelta: pnlBps,
      cumulativeTradesDelta: 1,
      newPosition: 'flat',
      newPositionQty: 0,
      newPositionOpenPrice: null,
    }
  }
  return noop
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
  const trade = stubTrade(alpha.signal, gate.decision, market, {
    position: agent.position,
    positionQty: agent.positionQty,
    positionOpenPrice: agent.positionOpenPrice,
  })

  // Persist the cycle.
  const cumulativePnlAfter =
    agent.realizedPnlBps + trade.realizedPnlBpsDelta

  const cycle = await insertCycle({
    tokenId,
    cycleNo,
    marketSnapshot: market,
    alphaSignal: alpha.signal,
    alphaReason: alpha.reason,
    llmDecision: gate.decision,
    llmReason: gate.reason,
    llmProvider: gate.provider,
    llmChatId: gate.chatId,
    tradeAction: trade.action,
    tradePrice: trade.price,
    tradeQty: trade.qty,
    tradeTxHash: trade.txHash,
    pnlBpsCumulative: cumulativePnlAfter,
    decisionLogRootHash: null, // Phase 2: 0G Storage upload
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
