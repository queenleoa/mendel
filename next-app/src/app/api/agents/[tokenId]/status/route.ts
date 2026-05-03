import { NextRequest, NextResponse } from 'next/server'
import { setAgentStatus } from '@/lib/runtime/db'

export const dynamic = 'force-dynamic'

const VALID = new Set(['active', 'paused', 'killed'])

type Body = { status?: string }

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ tokenId: string }> },
) {
  const { tokenId } = await ctx.params
  const id = Number(tokenId)
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid tokenId' }, { status: 400 })
  }
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (!body.status || !VALID.has(body.status)) {
    return NextResponse.json(
      { error: `invalid status — expected one of ${[...VALID].join(' / ')}` },
      { status: 400 },
    )
  }
  try {
    await setAgentStatus(id, body.status as 'active' | 'paused' | 'killed')
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
