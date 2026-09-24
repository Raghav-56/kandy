import test from "node:test"
import assert from "node:assert/strict"
import type { IncomingMessage } from "node:http"

import { tailscaleIdentity } from "../dist/identity.js"

/*
 * Identity from a header is identity from something anyone can type, so
 * almost every test here is about when the header is *not* believed.
 */

function req(headers: Record<string, string | string[]>, remoteAddress = "127.0.0.1") {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage
}

const alice = {
  "tailscale-user-login": "alice@example.com",
  "tailscale-user-name": "Alice",
  "tailscale-user-profile-pic": "https://example.com/a.png",
}

const id = tailscaleIdentity()

test("a tailnet user behind Serve is identified", () => {
  assert.deepEqual(id.identify(req(alice)), {
    id: "alice@example.com",
    email: "alice@example.com",
    name: "Alice",
    avatar: "https://example.com/a.png",
  })
})

test("a login alone is enough; the rest is decoration", () => {
  assert.deepEqual(id.identify(req({ "tailscale-user-login": "bob@example.com" })), {
    id: "bob@example.com",
    email: "bob@example.com",
    name: "bob@example.com",
  })
})

test("a tagged device, which sends no header, is nobody", () => {
  /*
   * The important one. Tailscale populates identity headers for users and not
   * for tagged devices, so a CI box or a shared server on the tailnet arrives
   * with no header — indistinguishable, from in here, from localhost.
   * Answering "trusted" to that is the bug reported against other projects
   * that trust Serve, and the same shape as the proxy hole fixed in http.ts.
   */
  assert.equal(id.identify(req({})), null)
})

test("a header from a peer that is not the local proxy is not believed", () => {
  // tailscaled proxies to its backend from the backend's own machine, so a
  // request that really came through Serve always arrives on loopback. One
  // that did not, never does — and this is what stops anyone who can open a
  // socket from simply claiming to be the owner.
  assert.equal(id.identify(req(alice, "203.0.113.9")), null)
})

test("a peer whose address cannot be read is not the local proxy either", () => {
  // Built by hand rather than by passing `undefined` to `req`, which would
  // take the default parameter and quietly test loopback again.
  const unknown = { headers: alice, socket: {} } as unknown as IncomingMessage
  assert.equal(id.identify(unknown), null)
})

test("an IPv4 peer on a dual-stack listener is still the local proxy", () => {
  assert.equal(id.identify(req(alice, "::ffff:127.0.0.1"))?.email, "alice@example.com")
})

test("a repeated identity header is refused, not reconciled", () => {
  // Node hands back an array when a header arrives twice. Taking the first
  // would let someone sit a header of their own beside the real one.
  assert.equal(id.identify(req({ "tailscale-user-login": ["alice@example.com", "eve@evil"] })), null)
})

test("an empty header is not a name", () => {
  assert.equal(id.identify(req({ "tailscale-user-login": "   " })), null)
})
