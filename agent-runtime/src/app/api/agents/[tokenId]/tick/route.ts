import { NextRequest, NextResponse } from 'next/server'
import { runCycle } from '@/lib/cycle'

export const dynamic = 'force-dynamic'
// 60s on Vercel Pro; on Hobby this is capped at 10s.
export const maxDuration = 60

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ tokenId: string }> },
) {
  const { tokenId } = await ctx.params
  const id = Number(tokenId)
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid tokenId' }, { status: 400 })
  }
  try {
    const cycle = await runCycle(id)
    return NextResponse.json({ cycle })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
