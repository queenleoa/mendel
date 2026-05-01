// Thin client for the agent-runtime API.
//
// Co-hosted with the frontend (App Router routes under /app/api/*), so all
// fetches are same-origin and `BASE` is empty. We still export
// `RUNTIME_BASE_URL` for the Trade tab's status display.

import type { Genome } from './genome'

const BASE = ''

export type RuntimeLineage = {
  asset: string
  venue: string
  barInterval: string
  hasGrid: boolean
  loci: string[]
}

export type RuntimeAgent = {
  tokenId: number
  ownerAddress: string
  status: 'active' | 'paused' | 'killed'
  position: 'flat' | 'long'
  positionQty: number
  positionOpenPrice: number | null
  realizedPnlBps: number
  cumulativeTrades: number
  activatedAt: string
  lastCycleAt: string | null
}

export type RuntimeCycle = {
  id: number
  tokenId: number
  cycleNo: number
  ts: string
  marketSnapshot: {
    asset: string
    spot: number
    spot24hChangeBps: number
    fearGreed: number
    fearGreedClassification: string
    fundingRateBps?: number
    volatility24hBps: number
    fetchedAt: string
  }
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

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      `agent-runtime ${res.status}: ${detail.slice(0, 200) || res.statusText}`,
    )
  }
  return (await res.json()) as T
}

export async function checkRuntimeHealth(): Promise<{ ok: boolean; time: string }> {
  return asJson(await fetch(`${BASE}/api/health`))
}

export async function listAgents(): Promise<{ agents: RuntimeAgent[] }> {
  return asJson(await fetch(`${BASE}/api/agents`))
}

export async function activateAgent(input: {
  tokenId: number
  ownerAddress: string
  genome: Genome
  lineage: RuntimeLineage
}): Promise<{ agent: RuntimeAgent }> {
  return asJson(
    await fetch(`${BASE}/api/agents/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
}

export async function tickAgent(tokenId: number): Promise<{ cycle: RuntimeCycle }> {
  return asJson(
    await fetch(`${BASE}/api/agents/${tokenId}/tick`, {
      method: 'POST',
    }),
  )
}

export async function listCycles(
  tokenId: number,
  limit = 50,
): Promise<{ cycles: RuntimeCycle[] }> {
  return asJson(
    await fetch(`${BASE}/api/agents/${tokenId}/cycles?limit=${limit}`),
  )
}

// Display value for the Trade tab. Empty `BASE` means same-origin, so we
// surface that explicitly rather than rendering a blank string.
export const RUNTIME_BASE_URL = '/api (same origin)'
