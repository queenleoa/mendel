import type { NextConfig } from 'next'

const allowedOrigin = process.env.ALLOWED_ORIGIN || '*'

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
