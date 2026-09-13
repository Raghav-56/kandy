import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, statSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { loadToken } from "../dist/auth.js"
import { createHttpServer } from "../dist/http.js"
import { KandyClient } from "@kandy/client"

test("token persists with owner-only permissions", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kandy-auth-"))
  try {
    const file = path.join(dir, "token")
    const token = loadToken(file)
    assert.match(token, /^[a-f0-9]{64}$/)
    assert.equal(loadToken(file), token)
    assert.equal(statSync(file).mode & 0o777, 0o600)
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test("HTTP authentication gates writes and protects browser bootstrap", async () => {
  const token = "a".repeat(64)
  let cancellations = 0
  const server = createHttpServer({
    token,
    engine: { head: () => 0 },
    runner: { cancel: () => { cancellations++; return true } },
    prs: {},
  })
  const base = "http://127.0.0.1:4477"
  // Exercise the actual HTTP request listener without binding a port, so this
  // security regression suite also runs in network-restricted environments.
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    const headers = new Headers(init.headers)
    if (!headers.has("host")) headers.set("host", url.host)
    return new Promise<Response>((resolve) => {
      const responseHeaders = new Headers()
      let status = 200
      const res = {
        setHeader(name: string, value: string) { responseHeaders.set(name, value) },
        writeHead(code: number, values: Record<string, string> = {}) {
          status = code
          for (const [key, value] of Object.entries(values)) responseHeaders.set(key, value)
          return res
        },
        end(body?: string) {
          resolve(new Response(body ?? null, { status, headers: responseHeaders }))
        },
      }
      server.emit("request", {
        url: url.pathname + url.search,
        method: init.method ?? "GET",
        headers: Object.fromEntries(headers),
        socket: { localPort: 4477 },
      }, res)
    })
  }
  try {
    assert.equal((await fetch(base + "/health")).status, 200)
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const prefix of ["", "/api"]) {
        const res = await fetch(base + prefix + "/runs/x/cancel", { method })
        assert.equal(res.status, 401)
      }
    }
    assert.equal((await fetch(base + "/runs/x/cancel", { method: "POST", headers: { authorization: "Bearer wrong" } })).status, 401)
    assert.equal((await fetch(base + `/runs/x/cancel?token=${token}`, { method: "POST" })).status, 401)
    assert.equal((await fetch(base + "/runs/x/cancel", {
      method: "POST", headers: { authorization: `Bearer ${token}`, origin: "https://evil.example" },
    })).status, 403)
    assert.equal(cancellations, 0)
    const api = new KandyClient({ baseUrl: base, token: () => token })
    await api.cancelRun("x")
    assert.equal(cancellations, 1)
    assert.equal((await fetch(base + "/auth/token")).status, 403)
    const headers = { "X-Kandy-Client": "web" }
    const bootstrap = await fetch(base + "/api/auth/token", { headers })
    assert.deepEqual(await bootstrap.json(), { token })
    assert.equal(bootstrap.headers.get("cache-control"), "no-store")
    const dev = await fetch(base + "/auth/token", {
      headers: { ...headers, host: "localhost:5477", origin: "http://localhost:5477", "sec-fetch-site": "same-origin" },
    })
    assert.equal(dev.status, 200)
    for (const origin of ["https://evil.example", "null"]) {
      const res = await fetch(base + "/auth/token", { headers: { ...headers, origin } })
      assert.equal(res.status, 403)
      assert.equal(res.headers.get("access-control-allow-origin"), null)
    }
    assert.equal((await fetch(base + "/auth/token", { headers: { ...headers, host: "evil.example" } })).status, 403)
    assert.equal((await fetch(base + "/auth/token", { headers: { ...headers, "sec-fetch-site": "cross-site" } })).status, 403)
    const preflight = await fetch(base + "/runs/x/cancel", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-headers": "authorization" } })
    assert.equal(preflight.status, 403)
  } finally {
    globalThis.fetch = originalFetch
  }
})
