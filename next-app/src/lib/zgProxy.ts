// HTTPS proxy shim for 0G Storage nodes.
//
// The 0G storage indexer returns trusted-node URLs as plain HTTP (e.g.
// `http://34.83.53.209:5678`). When this app is served over HTTPS in
// production, browsers refuse to fetch those URLs (mixed-content). To
// fix that without monkey-patching the SDK, we install a global fetch
// shim here: any HTTP request to an IP:port endpoint gets rewritten to
// `<prefix>/api/proxy/zg/<ip>:<port>/...`.
//
// Frontend + agent-runtime ship in the same Next deploy, so the proxy
// is same-origin by default — `prefix` is empty and the proxied URL is
// a relative `/api/proxy/zg/...`, which the browser resolves against
// the current page (HTTPS in prod, HTTP on localhost — both work).
//
// `NEXT_PUBLIC_AGENT_RUNTIME_URL` is only needed when the frontend and
// runtime are deployed to *different* origins; setting it pins all
// rewrites to that absolute URL.

const runtimePrefix = (
  process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL ?? ''
).replace(/\/$/, '')

// Match http://<ipv4>:<port>... — covers 0G storage nodes specifically.
const HTTP_NODE = /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+/

let installed = false

export function installZgProxyFetch(): void {
  if (installed) return
  if (typeof window === 'undefined') return
  installed = true
  console.info(
    runtimePrefix
      ? `[mendel/zgProxy] proxy installed → ${runtimePrefix}/api/proxy/zg/…`
      : '[mendel/zgProxy] proxy installed → /api/proxy/zg/… (same-origin)',
  )

  const original = window.fetch.bind(window)

  window.fetch = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    let url: string
    if (typeof input === 'string') url = input
    else if (input instanceof URL) url = input.href
    else url = input.url

    if (HTTP_NODE.test(url)) {
      // Split into <ip:port/path> + <?query>, strip any trailing slash from
      // the path part. Next.js 308-redirects URLs with trailing slashes by
      // default, which breaks cross-origin POST + preflight.
      const tail = url.slice('http://'.length)
      const qIdx = tail.indexOf('?')
      const pathPart = (qIdx >= 0 ? tail.slice(0, qIdx) : tail).replace(
        /\/+$/,
        '',
      )
      const queryPart = qIdx >= 0 ? tail.slice(qIdx) : ''
      const proxied = `${runtimePrefix}/api/proxy/zg/${pathPart}${queryPart}`
      // Re-build the request: if `input` was a Request object, copy its
      // body/method/headers; otherwise just forward `init`.
      if (typeof input === 'string' || input instanceof URL) {
        return original(proxied, init)
      }
      return original(proxied, {
        method: input.method,
        headers: input.headers,
        body: input.body,
        // Only pass a few of the safe init fields back through.
        signal: init?.signal ?? input.signal,
      } as RequestInit)
    }
    return original(input, init)
  }
}
