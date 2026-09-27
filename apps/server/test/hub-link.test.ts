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
