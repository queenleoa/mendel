// HTTPS proxy shim for 0G Storage nodes.
//
// The 0G storage indexer returns trusted-node URLs as plain HTTP (e.g.
// `http://34.83.53.209:5678`). When this app is served over HTTPS in
// production, browsers refuse to fetch those URLs (mixed-content).
//
// We rewrite any such URL to `<prefix>/api/proxy/zg/<ip>:<port>/...`
// at two layers:
//   1. window.fetch  — covers callers that use the modern fetch API.
//   2. XMLHttpRequest.prototype.open — the 0G storage SDK uses axios,
//      which goes through XHR in the browser; a fetch-only shim
//      doesn't see those uploads at all (this was the actual cause of
//      the "Network Error" the SDK was logging).
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

function rewriteHttpNodeUrl(url: string): string {
  if (!HTTP_NODE.test(url)) return url
  // Split into <ip:port/path> + <?query>, strip any trailing slash from
  // the path part. Next.js 308-redirects URLs with trailing slashes by
  // default, which breaks cross-origin POST + preflight.
  const tail = url.slice('http://'.length)
  const qIdx = tail.indexOf('?')
  const pathPart = (qIdx >= 0 ? tail.slice(0, qIdx) : tail).replace(/\/+$/, '')
  const queryPart = qIdx >= 0 ? tail.slice(qIdx) : ''
  return `${runtimePrefix}/api/proxy/zg/${pathPart}${queryPart}`
}

let installed = false

export function installZgProxyFetch(): void {
  if (installed) return
  if (typeof window === 'undefined') return
  installed = true
  console.info(
    runtimePrefix
      ? `[mendel/zgProxy] proxy installed → ${runtimePrefix}/api/proxy/zg/… (fetch + XHR)`
      : '[mendel/zgProxy] proxy installed → /api/proxy/zg/… (same-origin, fetch + XHR)',
  )

  // ----- window.fetch -----
  const originalFetch = window.fetch.bind(window)
  window.fetch = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    let url: string
    if (typeof input === 'string') url = input
    else if (input instanceof URL) url = input.href
    else url = input.url

    const proxied = rewriteHttpNodeUrl(url)
    if (proxied === url) return originalFetch(input, init)

    if (typeof input === 'string' || input instanceof URL) {
      return originalFetch(proxied, init)
    }
    return originalFetch(proxied, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      signal: init?.signal ?? input.signal,
    } as RequestInit)
  }

  // ----- XMLHttpRequest (axios uses this in the browser) -----
  if (typeof XMLHttpRequest !== 'undefined') {
    const originalOpen = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function patchedOpen(
      this: XMLHttpRequest,
      ...args: unknown[]
    ) {
      // Signature: open(method, url, async?, user?, password?)
      if (args.length >= 2 && (typeof args[1] === 'string' || args[1] instanceof URL)) {
        const urlStr = typeof args[1] === 'string' ? args[1] : (args[1] as URL).href
        const proxied = rewriteHttpNodeUrl(urlStr)
        if (proxied !== urlStr) args[1] = proxied
      }
      return (originalOpen as (...a: unknown[]) => void).apply(this, args)
    } as typeof XMLHttpRequest.prototype.open
  }
}
