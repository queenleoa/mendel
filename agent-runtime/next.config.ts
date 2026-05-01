import type { NextConfig } from 'next'

// Normalize ALLOWED_ORIGIN: browsers compare `Access-Control-Allow-Origin`
// character-for-character against the request's `Origin` header, which is
// never sent with a trailing slash. We strip any trailing slashes from the
// env value so responses match regardless of how the operator wrote it.
function normalizeOrigin(raw: string | undefined): string {
  if (!raw || raw === '*') return '*'
  return (
    raw
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean)
      .join(',') || '*'
  )
}

const allowedOrigin = normalizeOrigin(process.env.ALLOWED_ORIGIN)

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Don't 308-redirect URLs with trailing slashes — breaks cross-origin
  // proxy traffic from the SDK. The catch-all `[...path]` route handles
  // both shapes.
  skipTrailingSlashRedirect: true,
  // Default CORS headers on /api/* — per-route handlers (e.g. the
  // /api/proxy/zg/* route) override with a per-request origin when an
  // ALLOWED_ORIGIN whitelist matches.
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: allowedOrigin },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
    ]
  },
}

export default nextConfig
