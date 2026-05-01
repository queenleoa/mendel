import { NextRequest, NextResponse } from 'next/server'
import { listCycles } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ tokenId: string }> },
) {
  const { tokenId } = await ctx.params
  const id = Number(tokenId)
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid tokenId' }, { status: 400 })
  }
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '50')
  const cycles = await listCycles(id, limit)
  return NextResponse.json({ cycles })
}
