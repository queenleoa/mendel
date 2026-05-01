import { NextRequest, NextResponse } from 'next/server'
import { upsertAgent } from '@/lib/runtime/db'
import type { Genome, LineageParams } from '@/lib/runtime/types'

export const dynamic = 'force-dynamic'

type ActivateBody = {
  tokenId: number
  ownerAddress: string
  genome: Genome
  lineage: LineageParams
}

function isValid(body: unknown): body is ActivateBody {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return (
    typeof b.tokenId === 'number' &&
    typeof b.ownerAddress === 'string' &&
    !!b.genome &&
    typeof b.genome === 'object' &&
    !!b.lineage &&
    typeof b.lineage === 'object'
  )
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!isValid(body)) {
      return NextResponse.json(
        { error: 'invalid body — required: tokenId, ownerAddress, genome, lineage' },
        { status: 400 },
      )
    }
    const agent = await upsertAgent(body)
    return NextResponse.json({ agent })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
