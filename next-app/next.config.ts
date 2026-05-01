import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // Don't 308-redirect URLs with trailing slashes — breaks the 0G storage
  // SDK's path shape when it goes through `/api/proxy/zg/[...path]`.
  skipTrailingSlashRedirect: true,
  // Some 0G/web3 packages ship as ESM and reach into Node built-ins; let
  // Next transpile them so webpack can apply the browser polyfill fallbacks
  // declared below.
  transpilePackages: [
    '@0gfoundation/0g-storage-ts-sdk',
    '@0glabs/0g-serving-broker',
  ],
  webpack: (cfg, { isServer, webpack }) => {
    if (!isServer) {
      // Browser polyfills for Node built-ins reached by ethers / 0G SDKs.
      // Mirrors what `vite-plugin-node-polyfills` provided in the Vite build.
      cfg.resolve.fallback = {
        ...(cfg.resolve.fallback ?? {}),
        crypto: require.resolve('crypto-browserify'),
        stream: require.resolve('stream-browserify'),
        util: require.resolve('util'),
        buffer: require.resolve('buffer'),
        process: require.resolve('process/browser'),
        events: require.resolve('events'),
        // Common upstream noise from web3 deps — not used in browser:
        fs: false,
        net: false,
        tls: false,
        path: false,
        child_process: false,
        worker_threads: false,
        os: false,
        http: false,
        https: false,
        zlib: false,
        querystring: false,
        url: false,
        assert: false,
        constants: false,
      }
      cfg.plugins = cfg.plugins ?? []
      cfg.plugins.push(
        new webpack.ProvidePlugin({
          Buffer: ['buffer', 'Buffer'],
          process: 'process/browser',
        }),
      )
    }
    return cfg
  },
}

export default config
