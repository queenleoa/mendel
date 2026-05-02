// Shared types between the runtime API and the frontend.

export type AgentStatus = 'active' | 'paused' | 'killed'

export type Allele =
  | { type: 'momentum'; lookback: number; threshold: number }
  | { type: 'reversion'; window: number; zThreshold: number }
  | { type: 'volatility-narrow'; min: number; max: number }
  | { type: 'volatility-wide'; min: number; max: number }

export type Genome = {
  trigger: { locusId: string; alleles: Allele[]; dominance: string }
  filter: { locusId: string; alleles: Allele[]; dominance: string }
  parents: number[]
  generation: number
  createdAt: string
}

export type LineageParams = {
  asset: string
  venue: string
  barInterval: string
  hasGrid: boolean
  loci: string[]
}

export type MarketSnapshot = {
  asset: string
  spot: number                          // ETH/USDC mid in USD
  spot24hChangeBps: number              // 24h change in basis points
  fearGreed: number                     // 0-100
  fearGreedClassification: string       // 'Fear', 'Greed', etc.
  fundingRateBps?: number               // perp funding (basis points / 8h)
  volatility24hBps: number              // realized 24h vol in basis points
  recentCloses?: number[]               // last 12 × 5-min closes (oldest → newest), trend context for the LLM
  fetchedAt: string                     // ISO timestamp
}

export type Agent = {
  tokenId: number
  ownerAddress: string
  status: AgentStatus
  genome: Genome
  lineage: LineageParams
  position: 'flat' | 'long'
  positionQty: number
  positionOpenPrice: number | null
  realizedPnlBps: number
  cumulativeTrades: number
  activatedAt: string
  lastCycleAt: string | null
}

export type Cycle = {
  id: number
  tokenId: number
  cycleNo: number
  ts: string
  marketSnapshot: MarketSnapshot
  alphaSignal: 'buy' | 'sell' | 'hold'
  alphaReason: string | null
  llmDecision: 'accept' | 'reject' | 'skip' | null
  llmReason: string | null
  llmProvider: string | null
  llmChatId: string | null
  tradeAction: 'open_long' | 'close_long' | 'skip' | null
  tradePrice: number | null
  tradeQty: number | null
  tradeTxHash: string | null
  pnlBpsCumulative: number | null
  decisionLogRootHash: string | null
}
