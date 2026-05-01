import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * HTTPS pass-through proxy for 0G Storage nodes.
 *
 * The indexer returns storage-node URLs over plain HTTP (e.g.
 * `http://34.83.53.209:5678`), which browsers refuse to fetch from an
 * HTTPS page (mixed-content blocking). The frontend rewrites those URLs
 * to `<this runtime>/api/proxy/zg/<ip>:<port>/<path>` so they go over
 * HTTPS to us, and we forward to the original HTTP target server-side.
 *
 * The path after `/api/proxy/zg/` is treated literally as the HTTP
 * target's authority + path, e.g.
 *   /api/proxy/zg/34.83.53.209:5678/file/get      → http://34.83.53.209:5678/file/get
 */

type Ctx = { params: Promise<{ path: string[] }> }

function corsOrigin(req: NextRequest): string {
  const allowed = process.env.ALLOWED_ORIGIN
  if (!allowed || allowed === '*') return '*'
  const origin = req.headers.get('origin') ?? ''
  // Comma-separated whitelist support: ALLOWED_ORIGIN="https://a.com,https://b.com".
  // Trailing slashes are stripped — browsers send `Origin` without one,
  // so the response header must match without one too.
  const list = allowed
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
  if (list.includes(origin)) return origin
  return list[0] ?? '*'
}

async function proxy(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params
  if (!path || path.length === 0) {
    return NextResponse.json({ error: 'missing target' }, { status: 400 })
  }
  const search = new URL(req.url).search
  const target = `http://${path.join('/')}${search}`

  const headers = new Headers()
  // Forward content-type and accept; everything else dropped to keep it lean.
  const ct = req.headers.get('content-type')
  if (ct) headers.set('content-type', ct)
  const accept = req.headers.get('accept')
  if (accept) headers.set('accept', accept)

  const init: RequestInit = { method: req.method, headers }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.arrayBuffer()
  }

  let upstream: Response
  try {
    upstream = await fetch(target, init)
  } catch (e) {
    return NextResponse.json(
      {
        error: 'upstream fetch failed',
        target,
        detail: e instanceof Error ? e.message : String(e),
      },
      {
        status: 502,
        headers: { 'access-control-allow-origin': corsOrigin(req) },
      },
    )
  }

  const body = await upstream.arrayBuffer()
  const responseHeaders = new Headers()
  const upstreamCt = upstream.headers.get('content-type')
  if (upstreamCt) responseHeaders.set('content-type', upstreamCt)
  responseHeaders.set('access-control-allow-origin', corsOrigin(req))

  return new Response(body, {
    status: upstream.status,
    headers: responseHeaders,
  })
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx)
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx)
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx)
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx)
}
export async function OPTIONS(req: NextRequest) {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': corsOrigin(req),
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization',
      'access-control-max-age': '86400',
    },
  })
}
