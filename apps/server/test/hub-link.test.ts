import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import type { AddressInfo } from "node:net"

import { HubLink } from "../dist/hub-link.js"
import { RemoteLog } from "../dist/remote-log.js"

test("a runner whose hub goes quiet reconnects, rather than sitting 'online' forever", async () => {
  // A hub that accepts the stream and then says nothing, ever — what a dead
  // Wi-Fi link or a proxy that lost its upstream looks like from the runner.
  let hellos = 0
  const server = http.createServer((req, res) => {
    if (req.url === "/runner/hello") {
      hellos++
      res.writeHead(200, { "content-type": "application/json" })
      return res.end(JSON.stringify({ ok: true, owner: null }))
    }
    if (req.url?.startsWith("/runner/stream")) {
      res.writeHead(200, { "content-type": "text/event-stream" })
      return res.flushHeaders()
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const { port } = server.address() as AddressInfo

  const link = new HubLink({
    hub: `http://127.0.0.1:${port}`,
    headers: {},
    hello: () => ({ runnerId: "r1", name: "test", os: "test", agents: [], boards: [], version: "0" }) as never,
    handlers: {} as never,
    log: new RemoteLog(async () => {}, async () => [], 1),
    silenceMs: 150,
  })
  void link.start()
  const deadline = Date.now() + 3000
  while (hellos < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
  link.stop()
  server.closeAllConnections()
  server.close()
  assert.ok(hellos >= 2, `said hello ${hellos} time(s)`)
})

test("a connected runner checks in with the hub while it's quiet", async () => {
  let checkIns = 0
  const server = http.createServer((req, res) => {
    if (req.url === "/runner/hello") {
      res.writeHead(200, { "content-type": "application/json" })
      return res.end(JSON.stringify({ ok: true, owner: null }))
    }
    if (req.url?.startsWith("/runner/stream")) {
      res.writeHead(200, { "content-type": "text/event-stream" })
      return res.flushHeaders()
    }
    if (req.url === "/runner/log") {
      checkIns++
      res.writeHead(200, { "content-type": "application/json" })
      return res.end(JSON.stringify({ ok: true }))
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const { port } = server.address() as AddressInfo
  const link = new HubLink({
    hub: `http://127.0.0.1:${port}`,
    headers: {},
    hello: () => ({ runnerId: "r1", name: "test", os: "test", agents: [], boards: [], version: "0" }) as never,
    handlers: {} as never,
    log: new RemoteLog(async () => {}, async () => [], 1),
    checkInMs: 80,
  })
  void link.start()
  const deadline = Date.now() + 3000
  while (checkIns < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 40))
  link.stop()
  server.closeAllConnections()
  server.close()
  assert.ok(checkIns >= 2, `checked in ${checkIns} time(s)`)
})

test("the hub drops a runner it hasn't heard from, even if its connection looks open", async () => {
  // Behind a proxy such as `tailscale serve`, a runner that died can leave
  // its stream apparently open. It must not stay "online" for teammates.
  const { Runners } = await import("../dist/hub.js")
  const { Engine } = await import("../dist/engine.js")
  const { Store } = await import("../dist/store.js")
  const { mkdtempSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const path = await import("node:path")
  const { RUNNER_PROTOCOL } = await import("@kandy/core")
  const runners = new Runners(new Engine(new Store(path.join(mkdtempSync(path.join(tmpdir(), "kandy-sweep-")), "k.db"))))
  runners.hello({ protocol: RUNNER_PROTOCOL, runnerId: "rnr_test1", name: "gone", os: "win32", agents: [], boards: [] } as never, null)

  const server = http.createServer((req, res) => runners.attach("rnr_test1", null, req, res, 0))
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const { port } = server.address() as AddressInfo
  const ctl = new AbortController()
  void fetch(`http://127.0.0.1:${port}/`, { signal: ctl.signal }).then((r) => r.body?.getReader().read()).catch(() => {})
  for (let i = 0; i < 40 && !runners.get("rnr_test1")?.online; i++) await new Promise((r) => setTimeout(r, 25))
  assert.equal(runners.get("rnr_test1")?.online, true)

  runners.sweep(Date.now() + 61_000)
  for (let i = 0; i < 40 && runners.get("rnr_test1")?.online; i++) await new Promise((r) => setTimeout(r, 25))
  assert.equal(runners.get("rnr_test1")?.online, false)
  ctl.abort()
  server.closeAllConnections()
  server.close()
})
