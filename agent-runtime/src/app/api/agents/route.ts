import { NextResponse } from 'next/server'
import { listActiveAgents } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const agents = await listActiveAgents()
  return NextResponse.json({ agents })
}
