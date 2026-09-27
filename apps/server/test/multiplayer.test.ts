import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { can, scopesOf } from "@kandy/core"
import { ConsentStore } from "../dist/consent.js"
import { Engine } from "../dist/engine.js"
import { Members } from "../dist/members.js"
import { RemoteLog } from "../dist/remote-log.js"
import { Store } from "../dist/store.js"
import { explain, parseStatus } from "../dist/tailscale.js"

const tmp = () => mkdtempSync(path.join(tmpdir(), "kandy-mp-"))
const engine = () => new Engine(new Store(path.join(tmp(), "k.db")))
const alice = { id: "alice@example.com", email: "alice@example.com", name: "Alice" }
const bob = { id: "bob@example.com", email: "bob@example.com", name: "Bob" }

// ── consent: who may run code on this machine ─────────────────────────────

test("a runner's owner is always accepted — it is their machine", () => {
  const c = new ConsentStore(path.join(tmp(), "consent.json"))
  c.setAccept("nobody")
  assert.equal(c.decide("alice@example.com", "Alice@Example.com"), "run")
})

test("by default someone else's note waits for the owner", () => {
  // The default that cannot surprise anyone: the first note from a new
  // person arrives as a request with their name on it.
  const c = new ConsentStore(path.join(tmp(), "consent.json"))
  assert.equal(c.get().accept, "approved")
  assert.equal(c.decide("bob@example.com", "alice@example.com"), "hold")
})

test("approving someone once answers it for good, and survives a restart", () => {
  const file = path.join(tmp(), "consent.json")
  new ConsentStore(file).approve("Bob@Example.com")
  const again = new ConsentStore(file)
  assert.equal(again.decide("bob@example.com", "alice@example.com"), "run")
  again.revoke("bob@example.com")
  assert.equal(new ConsentStore(file).decide("bob@example.com", "alice@example.com"), "hold")
})

test("nobody means nobody; team means anyone the hub admitted", () => {
  const c = new ConsentStore(path.join(tmp(), "consent.json"))
  c.approve("bob@example.com")
  c.setAccept("nobody")
  assert.equal(c.decide("bob@example.com", "alice@example.com"), "hold")
  c.setAccept("team")
  assert.equal(c.decide("carol@example.com", "alice@example.com"), "run")
})

test("a single-player daemon has nobody to ask, so everything runs", () => {
  const c = new ConsentStore(path.join(tmp(), "consent.json"))
  c.setAccept("nobody")
  assert.equal(c.decide(null, null), "run")
})

// ── members ───────────────────────────────────────────────────────────────

test("the first person in owns the hub, and it is in the log as theirs", () => {
  const e = engine()
  const m = new Members(e)
  assert.equal(m.arrive(alice), "owner")
  const added = e.store.since(0).find((x) => x.type === "member.added")!
  assert.equal(added.actor, "alice@example.com")
})

test("after that, arriving is not joining", () => {
  const e = engine()
  const m = new Members(e)
  m.arrive(alice)
  assert.equal(m.arrive(bob), null, "on the tailnet is not on the team")
  m.set("alice@example.com", "bob@example.com", "member")
  assert.equal(m.arrive(bob), "member")
})

test("only an owner admits, and a hub is never left without one", () => {
  const e = engine()
  const m = new Members(e)
  m.arrive(alice)
  m.set("alice@example.com", "bob@example.com", "member")
  assert.throws(() => m.set("bob@example.com", "carol@example.com", "member"), /only an owner/)
  assert.throws(() => m.set("alice@example.com", "alice@example.com", "member"), /at least one owner/)
  m.set("alice@example.com", "bob@example.com", "owner")
  m.set("bob@example.com", "alice@example.com", null)
  assert.equal(m.roleOf("alice@example.com"), null)
})

test("membership is folded from the log, so a restarted hub remembers it", () => {
  const file = path.join(tmp(), "k.db")
  const first = new Members(new Engine(new Store(file)))
  first.arrive(alice)
  first.set("alice@example.com", "bob@example.com", "viewer")
  const again = new Members(new Engine(new Store(file)))
  assert.equal(again.roleOf("BOB@example.com"), "viewer")
})

test("roles are names for sets of scopes, and enforcement asks about scopes", () => {
  assert.equal(can("viewer", "board:read"), true)
  assert.equal(can("viewer", "board:write"), false)
  assert.equal(can("member", "run:assign"), true)
  assert.equal(can("member", "member:admin"), false)
  assert.deepEqual([...scopesOf("owner")].sort(), ["board:read", "board:write", "member:admin", "run:assign"])
  assert.equal(can(null, "board:read"), false)
})

// ── tailscale ─────────────────────────────────────────────────────────────

test("tailscale status is read for what it means", () => {
  // Shaped like this machine's own output when the tailnet is stopped.
  assert.deepEqual(parseStatus({ BackendState: "Stopped", Self: { DNSName: "" } }), { ok: false, reason: "stopped" })
  assert.deepEqual(parseStatus({ BackendState: "NeedsLogin" }), { ok: false, reason: "logged-out" })
  assert.deepEqual(parseStatus({ BackendState: "Running", Self: { DNSName: "" } }), {
    ok: false,
    reason: "no-magicdns",
  })
  assert.deepEqual(
    parseStatus({ BackendState: "Running", Self: { DNSName: "laptop.tail1234.ts.net.", TailscaleIPs: ["100.64.0.1"] } }),
    { ok: true, self: { dnsName: "laptop.tail1234.ts.net", ips: ["100.64.0.1"] } },
  )
  assert.match(explain("stopped"), /tailscale up/)
})

// ── the remote log ────────────────────────────────────────────────────────

const board = { type: "board.created", data: { boardId: "b1", name: "b", repoPath: "/r" } } as never
const note = {
  type: "note.created",
  data: { noteId: "n1", boardId: "b1", columnId: "c1", title: "t", body: "", pos: "a0" },
} as never

test("a runner sees its own write at once, and its echo is not applied twice", () => {
  const sent: unknown[][] = []
  const log = new RemoteLog(async (ops) => void sent.push(ops), async () => [], 1)
  log.receive({ ...(board as object), seq: 1, ts: 1, actor: null } as never)

  log.emit(note)
  // Read-your-own-writes: the runner's next line looks the note up.
  assert.equal(log.view("b1")!.notes.length, 1)

  // The hub streams it back, stamped. Folding it again would be a second note.
  log.receive({ ...(note as object), seq: 2, ts: 2, actor: "alice@example.com" } as never)
  assert.equal(log.view("b1")!.notes.length, 1)
  assert.equal(log.head, 2)
})

test("someone else's event is folded even while ours are in flight", () => {
  const log = new RemoteLog(async () => {}, async () => [], 1)
  log.receive({ ...(board as object), seq: 1, ts: 1, actor: null } as never)
  log.emit(note)
  const theirs = {
    type: "note.edited",
    data: { noteId: "n1", title: "renamed by Bob" },
    seq: 2,
    ts: 2,
    actor: "bob@example.com",
  }
  log.receive(theirs as never)
  assert.equal(log.view("b1")!.notes[0]!.title, "renamed by Bob")
  // And our echo, arriving after theirs, is still recognised as ours.
  log.receive({ ...(note as object), seq: 3, ts: 3, actor: null } as never)
  assert.equal(log.view("b1")!.notes.length, 1)
})

test("writes arrive in the order they were made, batched", async () => {
  const sent: string[][] = []
  const log = new RemoteLog(async (ops) => void sent.push(ops.map((o) => o.op)), async () => [], 5)
  log.say("r1", "assistant", "one")
  log.activity("r1", "bash", "ls")
  log.output("r1", "stderr", "two")
  await log.drain()
  assert.deepEqual(sent, [["say", "activity", "output"]])
})

test("a hub that is down loses nothing and reorders nothing", async () => {
  let fail = 2
  const got: string[] = []
  const log = new RemoteLog(
    async (ops) => {
      if (fail-- > 0) throw new Error("hub restarting")
      for (const o of ops) got.push((o as { text: string }).text)
    },
    async () => [],
    1,
  )
  log.say("r1", "assistant", "a")
  log.say("r1", "assistant", "b")
  await log.drain()
  log.say("r1", "assistant", "c")
  await log.drain()
  assert.deepEqual(got, ["a", "b", "c"])
})

test("a consent change made elsewhere applies to a running runner at once", () => {
  // `kandy consent team` runs in another process and edits the file; the
  // runner's store was loaded before that and must not keep the old answer.
  const file = path.join(tmp(), "consent.json")
  const running = new ConsentStore(file)
  assert.equal(running.decide("bob@example.com", "alice@example.com"), "hold")
  new ConsentStore(file).setAccept("team")
  assert.equal(running.decide("bob@example.com", "alice@example.com"), "run")
})
