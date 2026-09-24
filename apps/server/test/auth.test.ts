import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, statSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { loadToken } from "../dist/auth.js"
import { createHttpServer, parseHosts } from "../dist/http.js"
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
    engine: { head: () => 0, projections: { boards: () => [] } },
    workshop: { cancel: async () => { cancellations++; return true } },
    prs: {},
    // What `KANDY_HOSTS=laptop.tailnet.ts.net` configures on a real daemon.
    hosts: parseHosts("laptop.tailnet.ts.net"),
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
      // Which interface the request arrived on is now part of the policy, so
      // the harness has to be able to lie about it. Loopback unless a test
      // says otherwise, which is what every real single-player request is.
      const remoteAddress = headers.get("x-test-remote") ?? "127.0.0.1"
      headers.delete("x-test-remote")
      server.emit("request", {
        url: url.pathname + url.search,
        method: init.method ?? "GET",
        headers: Object.fromEntries(headers),
        socket: { localPort: 4477, remoteAddress },
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

    /*
     * Off-machine, reads are reads no longer.
     *
     * `GET /boards`, `GET /events` and `GET /repo/browse` each used to answer
     * an anonymous caller in full — every board, the live transcript stream,
     * and the name of every repository on the disk — because the gate asked
     * only about the method. The Host allowlist was doing the actual work,
     * and `KANDY_HOSTS` exists to open it.
     */
    const remote = { "x-test-remote": "203.0.113.9" }
    for (const route of ["/boards", "/events", "/repo/browse", "/agents"]) {
      const res = await fetch(base + route, { headers: remote })
      assert.equal(res.status, 401, `${route} must not answer an anonymous stranger`)
      assert.equal(res.headers.get("www-authenticate"), "Bearer")
    }
    // The credential itself never leaves the machine, however well-formed the
    // request looks — this is the one route a token cannot buy.
    assert.equal((await fetch(base + "/auth/token", {
      headers: { ...headers, ...remote, "sec-fetch-site": "same-origin" },
    })).status, 403)
    // The bundle still bootstraps: it is a public build artifact, and the UI
    // it loads is what then authenticates.
    assert.equal((await fetch(base + "/health", { headers: remote })).status, 200)
    // An IPv4 peer on a dual-stack listener is still this machine, so the
    // single-player daemon is untouched by any of the above.
    assert.equal((await fetch(base + "/boards", {
      headers: { "x-test-remote": "::ffff:127.0.0.1" },
    })).status, 200)
    assert.equal((await fetch(base + "/boards")).status, 200)

    /*
     * A reverse proxy in front is the case the socket cannot answer.
     *
     * `tailscale serve` dials the backend from the backend's own machine, so
     * every request on the tailnet arrives from 127.0.0.1. Trusting the peer
     * address alone would hand the whole tailnet every transcript — the exact
     * hole this gate exists to close. Tailscale's identity headers are no
     * help: they are populated for users and not for tagged devices, so a
     * tagged node looks like localhost by header too.
     *
     * The name the caller asked for does survive the proxy, so both must
     * agree before a request counts as local.
     */
    const served = {
      host: "laptop.tailnet.ts.net",
      "tailscale-user-login": "someone@example.com",
    }
    assert.equal((await fetch(base + "/boards", { headers: served })).status, 401)
    assert.equal((await fetch(base + "/auth/token", {
      headers: { ...headers, ...served, "sec-fetch-site": "same-origin" },
    })).status, 403)
    // With the token it is a perfectly good request — the point is that it
    // has to bring one.
    assert.equal((await fetch(base + "/boards", {
      headers: { ...served, authorization: `Bearer ${token}` },
    })).status, 200)
  } finally {
    globalThis.fetch = originalFetch
  }
})
