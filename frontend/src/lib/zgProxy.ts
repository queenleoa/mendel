// HTTPS proxy shim for 0G Storage nodes.
//
// The 0G storage indexer returns trusted-node URLs as plain HTTP (e.g.
// `http://34.83.53.209:5678`). When this app is served over HTTPS in
// production, browsers refuse to fetch those URLs (mixed-content). To
// fix that without monkey-patching the SDK, we install a global fetch
// shim here: any HTTP request to an IP:port endpoint gets rewritten to
// `<agent-runtime>/api/proxy/zg/<ip>:<port>/...`.
//
// In dev (Vite on http://localhost:5173) the page itself is HTTP, so
// mixed-content doesn't apply and this shim is a no-op — we still
// rewrite for consistency, but local Vite running against a deployed
// agent-runtime will route through HTTPS too.

const runtimeUrl = (
  (import.meta.env.VITE_AGENT_RUNTIME_URL as string | undefined) ?? ''
).replace(/\/$/, '')

// Match http://<ipv4>:<port>... — covers 0G storage nodes specifically.
const HTTP_NODE = /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+/

let installed = false

export function installZgProxyFetch(): void {
  if (installed) return
  if (!runtimeUrl) return
  installed = true

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
      const tail = url.slice('http://'.length) // ip:port/path/?query
      const proxied = `${runtimeUrl}/api/proxy/zg/${tail}`
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
