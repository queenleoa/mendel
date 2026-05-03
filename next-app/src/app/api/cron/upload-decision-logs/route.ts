import { NextRequest, NextResponse } from 'next/server'
import { uploadPendingDecisionLogs } from '@/lib/runtime/decisionLog'

export const dynamic = 'force-dynamic'
// Storage upload involves a Merkle tree, an on-chain submit, and segment
// transfers — give it the full Pro-tier budget. Hobby tier (10s) will
// truncate large batches; that's OK for a hackathon demo.
export const maxDuration = 60

/**
 * Vercel Cron entry point — bundles pending cycle decision logs into a
 * single JSON blob and pushes it to 0G Storage. See vercel.json for the
 * 10-minute schedule.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (expected) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }
  try {
    const result = await uploadPendingDecisionLogs()
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }
}
