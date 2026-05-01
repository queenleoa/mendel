import { NextRequest, NextResponse } from 'next/server'
import { listActiveAgents } from '@/lib/db'
import { runCycle } from '@/lib/cycle'

export const dynamic = 'force-dynamic'
// Hobby tier caps at 10s; Pro at 60s. Iterate small fleets only.
export const maxDuration = 60

/**
 * Vercel Cron entry point. Hourly on the free tier (`vercel.json`).
 * For each active agent, run one cycle and collect the outcome.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (expected) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const agents = await listActiveAgents()
  const results: Array<{
    tokenId: number
    ok: boolean
    cycleNo?: number
    error?: string
  }> = []

  for (const agent of agents) {
    try {
      const cycle = await runCycle(agent.tokenId)
      results.push({ tokenId: agent.tokenId, ok: true, cycleNo: cycle.cycleNo })
    } catch (e) {
      results.push({
        tokenId: agent.tokenId,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }
  return NextResponse.json({ ranAt: new Date().toISOString(), results })
}
