import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { mkdtempSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"

import { RUNNER_PROTOCOL, event, wasInterrupted } from "@kandy/core"
import { KandyClient, SseDecoder } from "@kandy/client"
import { hubUrl, inviteMessage } from "../dist/cli/join.js"
import { tokenHubSteps } from "../dist/cli/roles.js"
import { Engine } from "../dist/engine.js"
import { Runners } from "../dist/hub.js"
import { createHttpServer, parseHosts } from "../dist/http.js"
import { tailscaleIdentity } from "../dist/identity.js"
import { Members } from "../dist/members.js"
import { RemoteWorkshop } from "../dist/remote-workshop.js"
import { Store } from "../dist/store.js"

/*
 * A hub on a tailnet, driven the way `tailscale serve` drives one.
 *
 * Serve connects to the hub from 127.0.0.1, keeps the Host the caller used,
 * and adds Tailscale-User-Login. Every request below does exactly that, so
 * this exercises the real gate rather than a test double of it — the only
 * thing not real is that no tailnet exists.
 */

const TAILNET = "hub.tail1234.ts.net"

async function tailnetHub(opts: { graceMs?: number } = {}) {
  const engine = new Engine(new Store(path.join(mkdtempSync(path.join(tmpdir(), "kandy-team-")), "k.db")))
  const runners = new Runners(engine, opts.graceMs)
  const members = new Members(engine)
  const server = createHttpServer({
    engine,
    workshop: new RemoteWorkshop(engine, runners, null),
    workshopFor: (a: string | null) => new RemoteWorkshop(engine, runners, a),
    prs: { refresh: async () => {} } as never,
    token: "d".repeat(64),
    runners,
    members,
    identity: tailscaleIdentity(),
    hosts: parseHosts(TAILNET),
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const port = (server.address() as AddressInfo).port
  const url = `http://127.0.0.1:${port}`

  /**
   * A request as Serve would forward it, from `who`.
   *
   * Through `node:http`, not `fetch`: fetch silently drops a custom Host
   * header and sends `127.0.0.1` instead — which the gate rightly treats as
   * local — so every request would have been testing the wrong path.
   */
  const as = (who: string | null) => (p: string, init: { method?: string; body?: unknown } = {}) =>
    send(port, p, init.method ?? "GET", {
      host: TAILNET,
      "content-type": "application/json",
      ...(who ? { "tailscale-user-login": who, "tailscale-user-name": who.split("@")[0]! } : {}),
    }, init.body)

  return { engine, runners, members, url, port, as, close: () => server.close() }
}

/** A runner on someone's machine, speaking the protocol through Serve as its owner. */
async function runnerOf(h: Awaited<ReturnType<typeof tailnetHub>>, who: string, runnerId: string, boards: string[], onCommand: (c: { op: string; args: unknown[] }) => unknown) {
  const req = h.as(who)
  const hello = await req("/runner/hello", {
    method: "POST",
    body: { protocol: RUNNER_PROTOCOL, runnerId, name: `${who.split("@")[0]}-laptop`, os: "darwin", agents: [], boards },
  })
  assert.equal(hello.status, 200)
  let ready!: () => void
  const caughtUp = new Promise<void>((r) => (ready = r))
  const dec = new SseDecoder()
  const stream = http.get(
    { host: "127.0.0.1", port: h.port, path: `/runner/stream?runner=${runnerId}&after=0`, headers: { host: TAILNET, "tailscale-user-login": who } },
    (res) => {
      assert.equal(res.statusCode, 200)
      res.setEncoding("utf8")
      res.on("data", async (chunk: string) => {
        for (const m of dec.push(chunk)) {
          if (m.type === "caught-up") ready()
          if (m.type !== "command") continue
          const cmd = JSON.parse(m.data)
          const result = await onCommand(cmd)
          await req("/runner/reply", { method: "POST", body: { runnerId, id: cmd.id, ok: true, result } })
        }
      })
    },
  )
  stream.on("error", () => {})
  await caughtUp
  return () => stream.destroy()
}

test("the first person in owns the hub; the next is told who they are and who to ask", async () => {
  const h = await tailnetHub()
  try {
    const alice = await h.as("alice@example.com")("/me")
    assert.deepEqual(await alice.json(), {
      hub: true,
      email: "alice@example.com",
      role: "owner",
      admitted: true,
      owners: ["alice@example.com"],
      authenticated: true,
      identity: true,
      removed: false,
    })

    const bob = await h.as("bob@example.com")("/boards")
    assert.equal(bob.status, 403)

    // Not admitted, but told so properly: who he is, and whom to ask.
    const who = await h.as("bob@example.com")("/me")
    assert.equal(who.status, 200)
    assert.deepEqual(await who.json(), {
      hub: true,
      email: "bob@example.com",
      name: "bob",
      role: null,
      admitted: false,
      owners: ["alice@example.com"],
      authenticated: true,
      identity: true,
      removed: false,
    })
    assert.match((await bob.json()).error.message, /you are bob@example\.com.*nobody has added you.*ask alice@example\.com/)

    const add = await h.as("alice@example.com")("/members", { method: "POST", body: { email: "bob@example.com", role: "member" } })
    assert.equal(add.status, 200)
    assert.equal((await h.as("bob@example.com")("/boards")).status, 200)

    // And the log says who let him in.
    const added = h.engine.store.since(0).filter((e) => e.type === "member.added").at(-1)!
    assert.equal(added.actor, "alice@example.com")
  } finally {
    h.close()
  }
})

test("a request with no Tailscale identity is refused, not treated as local", async () => {
  // A tagged device: through Serve, on the tailnet Host, and no user header.
  const h = await tailnetHub()
  try {
    const tagged = await h.as(null)("/boards")
    assert.equal(tagged.status, 401)
    assert.match((await tagged.json()).error.message, /Tagged devices/)
  } finally {
    h.close()
  }
})

test("the web app is handed no token on a tailnet, because the identity is the credential", async () => {
  const h = await tailnetHub()
  try {
    const res = await send(h.port, "/auth/token", "GET", {
      host: TAILNET,
      "tailscale-user-login": "alice@example.com",
      "x-kandy-client": "web",
    })
    const body = await res.json()
    assert.equal(res.status, 200)
    assert.equal(body.token, "")
    assert.equal(body.identity.role, "owner")
  } finally {
    h.close()
  }
})

test("a viewer can look and cannot touch", async () => {
  const h = await tailnetHub()
  try {
    await h.as("alice@example.com")("/me")
    await h.as("alice@example.com")("/members", { method: "POST", body: { email: "vic@example.com", role: "viewer" } })
    assert.equal((await h.as("vic@example.com")("/boards")).status, 200)
    const write = await h.as("vic@example.com")("/members", { method: "POST", body: { email: "x@example.com", role: "owner" } })
    assert.equal(write.status, 403)
  } finally {
    h.close()
  }
})

test("everything a person does is theirs in the log", async () => {
  const h = await tailnetHub()
  try {
    await h.as("alice@example.com")("/me")
    h.engine.emit(event("board.created", { boardId: "b1", name: "demo", repoPath: "/repo" }))
    h.engine.emit(event("column.created", { columnId: "c1", boardId: "b1", name: "Todo", pos: "a0" }))
    h.engine.emit(event("note.created", { noteId: "n1", boardId: "b1", columnId: "c1", title: "t", body: "", pos: "a0" }))
    await h.as("alice@example.com")("/notes/n1/edit", { method: "POST", body: { title: "renamed" } })
    const edited = h.engine.store.since(0).find((e) => e.type === "note.edited")
    assert.ok(edited, "the edit must have been recorded at all")
    assert.equal(edited.actor, "alice@example.com")
  } finally {
    h.close()
  }
})

test("a note given to someone else's machine waits for them, and only they can say yes", async () => {
  /*
   * The consent model end to end. Bob asks for a note to run on Alice's
   * machine. Her runner holds it — nothing starts, it says so on the board —
   * and the only person the hub will take an answer from is Alice. An owner
   * of the hub is not enough: it is not their laptop.
   */
  const h = await tailnetHub()
  const stops: (() => void)[] = []
  try {
    await h.as("alice@example.com")("/me")
    await h.as("alice@example.com")("/members", { method: "POST", body: { email: "bob@example.com", role: "owner" } })
    h.engine.emit(event("board.created", { boardId: "b1", name: "demo", repoPath: "/repo" }))
    h.engine.emit(event("column.created", { columnId: "c1", boardId: "b1", name: "Todo", pos: "a0" }))
    h.engine.emit(event("note.created", { noteId: "n1", boardId: "b1", columnId: "c1", title: "t", body: "", pos: "a0" }))

    // Alice's runner applies her consent rule the way the real one does:
    // her own requests run, anyone else's is held until she answers.
    const asked: { op: string; args: unknown[] }[] = []
    stops.push(
      await runnerOf(h, "alice@example.com", "alice-mbp-0001", ["b1"], async (c) => {
        asked.push(c)
        if (c.op === "request") {
          const requestedBy = c.args[3]
          if (requestedBy !== "alice@example.com") {
            await h.as("alice@example.com")("/runner/log", {
              method: "POST",
              body: {
                runnerId: "alice-mbp-0001",
                ops: [{ op: "emit", pending: { type: "note.held", data: { noteId: "n1", runnerId: "alice-mbp-0001", requestedBy, agent: "claude" } } }],
              },
            })
            return ""
          }
          return "run_alice"
        }
        if (c.op === "consent") return c.args[2] ? "run_after_yes" : ""
        return null
      }),
    )

    // Place the note on Alice's machine, as assigning it would.
    h.runners.place("n1", "alice-mbp-0001", "bob@example.com")

    // Bob runs it: accepted, not done.
    const run = await h.as("bob@example.com")("/notes/n1/run", { method: "POST", body: { agent: "claude" } })
    assert.equal(run.status, 202)
    assert.deepEqual(await run.json().then((j) => [j.held, j.runId]), [true, null])
    assert.equal(asked[0]!.args[3], "bob@example.com", "the runner is told who asked")
    const held = h.engine.view("b1")!.notes[0]!.held
    assert.equal(held?.requestedBy, "bob@example.com")

    // Bob owns the hub. He still cannot answer for Alice's machine.
    const bobSays = await h.as("bob@example.com")("/notes/n1/consent", { method: "POST", body: { accept: true } })
    assert.equal(bobSays.status, 403)
    assert.match((await bobSays.json()).error.message, /only the owner of the machine/)

    // Alice can.
    const aliceSays = await h.as("alice@example.com")("/notes/n1/consent", { method: "POST", body: { accept: true, always: true } })
    assert.equal(aliceSays.status, 200)
    assert.equal((await aliceSays.json()).runId, "run_after_yes")
    const consent = asked.find((c) => c.op === "consent")!
    assert.deepEqual(consent.args.slice(2, 5), [true, true, "bob@example.com"])
  } finally {
    for (const s of stops) s()
    h.close()
  }
})

test("a runner cannot be taken over by someone presenting its id", async () => {
  const h = await tailnetHub()
  try {
    await h.as("alice@example.com")("/me")
    await h.as("alice@example.com")("/members", { method: "POST", body: { email: "mallory@example.com", role: "member" } })
    const hello = (who: string) =>
      h.as(who)("/runner/hello", {
        method: "POST",
        body: { protocol: RUNNER_PROTOCOL, runnerId: "alice-mbp-0001", name: "x", os: "darwin", agents: [], boards: [] },
      })
    assert.equal((await hello("alice@example.com")).status, 200)
    const taken = await hello("mallory@example.com")
    assert.equal(taken.status, 403)
  } finally {
    h.close()
  }
})

test("my notes go to my machine, never quietly to someone else's", async () => {
  const h = await tailnetHub()
  const stops: (() => void)[] = []
  try {
    await h.as("alice@example.com")("/me")
    await h.as("alice@example.com")("/members", { method: "POST", body: { email: "bob@example.com", role: "member" } })
    h.engine.emit(event("board.created", { boardId: "b1", name: "demo", repoPath: "/repo" }))
    h.engine.emit(event("column.created", { columnId: "c1", boardId: "b1", name: "Todo", pos: "a0" }))
    h.engine.emit(event("note.created", { noteId: "n1", boardId: "b1", columnId: "c1", title: "t", body: "", pos: "a0" }))
    // Only Alice's machine is connected.
    stops.push(await runnerOf(h, "alice@example.com", "alice-mbp-0001", ["b1"], () => "run_x"))

    // Bob runs a note with no place: it must not land on Alice's laptop.
    const res = await h.as("bob@example.com")("/notes/n1/run", { method: "POST", body: { agent: "claude" } })
    assert.equal(res.status, 503)
    assert.match((await res.json()).error.message, /none of your machines/)
    assert.equal(h.runners.placement("n1"), null)
  } finally {
    for (const s of stops) s()
    h.close()
  }
})

/** A minimal fetch-shaped request over node:http, so a Host header survives. */
function send(port: number, p: string, method: string, headers: Record<string, string>, body?: unknown) {
  return new Promise<{ status: number; json: () => Promise<any> }>((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, path: p, method, headers }, (res) => {
      let data = ""
      res.setEncoding("utf8")
      res.on("data", (c) => (data += c))
      res.on("end", () => resolve({ status: res.statusCode ?? 0, json: async () => JSON.parse(data) }))
    })
    r.on("error", reject)
    if (body !== undefined) r.write(JSON.stringify(body))
    r.end()
  })
}

test("on a hub, setting a note's agent sets its agent — it is not a handoff", async () => {
  // The handoff route once shared this path, and on a hub it answered first:
  // "use claude" read as "give it to a machine", and every note run from
  // the CLI on a hub failed with "that machine is not connected".
  const h = await tailnetHub()
  try {
    await h.as("alice@example.com")("/me")
    h.engine.emit(event("board.created", { boardId: "b1", name: "demo", repoPath: "/repo" }))
    h.engine.emit(event("column.created", { columnId: "c1", boardId: "b1", name: "Todo", pos: "a0" }))
    h.engine.emit(event("note.created", { noteId: "n1", boardId: "b1", columnId: "c1", title: "t", body: "", pos: "a0" }))
    const res = await h.as("alice@example.com")("/notes/n1/assign", { method: "POST", body: { agent: "claude" } })
    assert.equal(res.status, 200)
    assert.equal(h.engine.view("b1")!.notes[0]!.agent, "claude")
  } finally {
    h.close()
  }
})

test("the page loads over https, as tailscale serve delivers it", async () => {
  // The browser sends Origin: https://… for the app's own module script and
  // stylesheet. The first real deployment refused them — the check compared
  // against http:// only — and the hub was a blank page.
  const h = await tailnetHub()
  try {
    await h.as("alice@example.com")("/me")
    const res = await send(h.port, "/api/me", "GET", {
      host: TAILNET,
      origin: `https://${TAILNET}`,
      "tailscale-user-login": "alice@example.com",
    })
    assert.equal(res.status, 200)
    // A different host is still refused, whatever the scheme.
    const evil = await send(h.port, "/api/me", "GET", {
      host: TAILNET,
      origin: "https://evil.example",
      "tailscale-user-login": "alice@example.com",
    })
    assert.equal(evil.status, 403)
  } finally {
    h.close()
  }
})

// ── machines that go away ─────────────────────────────────────────────────

/** Poll until `ok`, for the moments a socket closing takes a tick to be heard. */
async function until(ok: () => boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out waiting")
    await new Promise((r) => setTimeout(r, 20))
  }
}

/** A board with one note, and Alice and Bob on the hub. */
async function team(h: Awaited<ReturnType<typeof tailnetHub>>) {
  await h.as("alice@example.com")("/me")
  await h.as("alice@example.com")("/members", { method: "POST", body: { email: "bob@example.com", role: "member" } })
  h.engine.emit(event("board.created", { boardId: "b1", name: "demo", repoPath: "/repo" }))
  h.engine.emit(event("column.created", { columnId: "c1", boardId: "b1", name: "Todo", pos: "a0" }))
  h.engine.emit(event("note.created", { noteId: "n1", boardId: "b1", columnId: "c1", title: "t", body: "", pos: "a0" }))
}

test("a runner that says hello again still goes offline when it leaves", async () => {
  /*
   * The runner re-announces right after attaching and every minute after.
   * That used to swap its entry for a new one, and the stream's close
   * handler then marked the discarded copy offline — so every machine was
   * "online" for good, and work given to a closed laptop waited two minutes
   * to be told "bad request".
   */
  const h = await tailnetHub()
  try {
    await team(h)
    const stop = await runnerOf(h, "bob@example.com", "bob-mbp-00001", ["b1"], () => null)
    const again = await h.as("bob@example.com")("/runner/hello", {
      method: "POST",
      body: { protocol: RUNNER_PROTOCOL, runnerId: "bob-mbp-00001", name: "bob-laptop", os: "darwin", agents: [], boards: ["b1"] },
    })
    assert.equal(again.status, 200)
    assert.equal(h.runners.get("bob-mbp-00001")?.online, true, "a hello does not disconnect anyone")

    stop()
    await until(() => h.runners.get("bob-mbp-00001")?.online === false)

    const give = await h.as("alice@example.com")("/notes/n1/give", { method: "POST", body: { to: "bob@example.com" } })
    assert.equal(give.status, 409)
    assert.match((await give.json()).error.message, /bob@example\.com's machine is offline/)

    // A note already placed there is refused at once, and not as the caller's mistake.
    h.runners.place("n1", "bob-mbp-00001", "bob@example.com")
    const started = Date.now()
    const run = await h.as("bob@example.com")("/notes/n1/run", { method: "POST", body: { agent: "claude" } })
    assert.equal(run.status, 503)
    const err = (await run.json()).error
    assert.equal(err.code, "unavailable")
    assert.match(err.message, /bob@example\.com's machine is offline/)
    assert.ok(Date.now() - started < 1000, "no two-minute wait for a machine known to be gone")
  } finally {
    h.close()
  }
})

test("a run on a machine that does not come back is interrupted, not running forever", async () => {
  const h = await tailnetHub({ graceMs: 50 })
  try {
    await team(h)
    const stop = await runnerOf(h, "bob@example.com", "bob-mbp-00001", ["b1"], () => null)
    h.runners.place("n1", "bob-mbp-00001", "bob@example.com")
    h.engine.emit(event("run.requested", { runId: "r1", noteId: "n1", agent: "claude" }))
    h.engine.emit(event("run.started", { runId: "r1", noteId: "n1", worktree: "/w", branch: "kandy/n1", baseRef: "abc", pid: 1 }))
    assert.equal(h.engine.view("b1")!.notes[0]!.status, "running")

    stop()
    await until(() => h.engine.view("b1")!.notes[0]!.status !== "running")
    const run = h.engine.view("b1")!.runs.find((r) => r.id === "r1")!
    assert.equal(run.status, "failed")
    assert.equal(wasInterrupted(run), true, "offered as Resume, not as the agent's failure")
  } finally {
    h.close()
  }
})

test("a machine back within the grace period keeps its runs", async () => {
  const h = await tailnetHub({ graceMs: 300 })
  try {
    await team(h)
    const stop = await runnerOf(h, "bob@example.com", "bob-mbp-00001", ["b1"], () => null)
    h.runners.place("n1", "bob-mbp-00001", "bob@example.com")
    h.engine.emit(event("run.requested", { runId: "r1", noteId: "n1", agent: "claude" }))
    h.engine.emit(event("run.started", { runId: "r1", noteId: "n1", worktree: "/w", branch: "kandy/n1", baseRef: "abc", pid: 1 }))
    stop()
    await until(() => h.runners.get("bob-mbp-00001")?.online === false)
    const back = await runnerOf(h, "bob@example.com", "bob-mbp-00001", ["b1"], () => null)
    await new Promise((r) => setTimeout(r, 450))
    assert.equal(h.engine.view("b1")!.notes[0]!.status, "running")
    back()
  } finally {
    h.close()
  }
})

// ── who owns a new hub ────────────────────────────────────────────────────

test("a health check reaches a hub before anyone is let in, and claims nothing", async () => {
  const h = await tailnetHub()
  try {
    // A probe from a tagged device, and one from a person: both answered.
    assert.equal((await h.as(null)("/health")).status, 200)
    assert.equal((await h.as("mallory@example.com")("/health")).status, 200)
    // Nor does a script reading the board take the hub.
    const poke = await h.as("mallory@example.com")("/boards")
    assert.equal(poke.status, 403)
    assert.match((await poke.json()).error.message, /nobody owns this hub yet/)
    assert.deepEqual(h.members.list(), [])

    // Opening the board — which asks who it is — does.
    assert.equal((await (await h.as("alice@example.com")("/me")).json()).role, "owner")
    // And /health tells an outsider nothing about the boards.
    const health = await (await h.as("bob@example.com")("/health")).json()
    assert.deepEqual(Object.keys(health).sort(), ["pid", "uptime", "version"])
  } finally {
    h.close()
  }
})

test("someone taken off the hub is told so, not asked to be added", async () => {
  const h = await tailnetHub()
  try {
    await team(h)
    await h.as("alice@example.com")("/members", { method: "POST", body: { email: "bob@example.com", role: null } })
    const me = await (await h.as("bob@example.com")("/me")).json()
    assert.equal(me.admitted, false)
    assert.equal(me.removed, true)
    const boards = await h.as("bob@example.com")("/boards")
    assert.match((await boards.json()).error.message, /you were removed from this hub — ask alice@example\.com/)
  } finally {
    h.close()
  }
})

// ── a hub with a token and no people ──────────────────────────────────────

async function tokenHub() {
  const engine = new Engine(new Store(path.join(mkdtempSync(path.join(tmpdir(), "kandy-token-")), "k.db")))
  const runners = new Runners(engine)
  const token = "e".repeat(64)
  const server = createHttpServer({
    engine,
    workshop: new RemoteWorkshop(engine, runners, null),
    workshopFor: (a: string | null) => new RemoteWorkshop(engine, runners, a),
    prs: { refresh: async () => {} } as never,
    token,
    runners,
    hosts: parseHosts("hub.example.com"),
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const port = (server.address() as AddressInfo).port
  /** From another machine: arrived under a name that is not loopback. */
  const remote = (p: string, bearer?: string) =>
    send(port, p, "GET", { host: "hub.example.com", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) })
  return { token, port, url: `http://127.0.0.1:${port}`, remote, close: () => server.close() }
}

test("a token hub can be read from another machine with its token", async () => {
  const h = await tokenHub()
  try {
    assert.equal((await h.remote("/boards", h.token)).status, 200)
    assert.equal((await h.remote("/me", h.token)).status, 200)
    assert.equal((await h.remote("/health")).status, 200)
    const none = await h.remote("/boards")
    assert.equal(none.status, 401)
    const wrong = await h.remote("/boards", "f".repeat(64))
    assert.equal(wrong.status, 401)
    assert.match((await wrong.json()).error.message, /that token was refused/)
  } finally {
    h.close()
  }
})

test("the client sends its token on reads, and a wrong one is refused even on the hub's machine", async () => {
  /*
   * On the hub's own machine a read needs no token, so `kandy join` with a
   * wrong one used to say "You're in" and leave a runner refused on every
   * write, with nothing in its log to say why.
   */
  const h = await tokenHub()
  try {
    const right = await new KandyClient({ baseUrl: h.url, token: () => h.token }).me()
    assert.equal(right.authenticated, true, "the token went with the GET")

    await assert.rejects(new KandyClient({ baseUrl: h.url, token: () => "f".repeat(64) }).me(), /that token was refused/)

    const none = await new KandyClient({ baseUrl: h.url, token: () => "" }).me()
    assert.equal(none.authenticated, false, "read, but not proven — join must ask for a token")
    assert.equal(none.identity, false)
  } finally {
    h.close()
  }
})

// ── the words people are given ────────────────────────────────────────────

test("a hub url typed without a scheme gets the one it serves", () => {
  assert.equal(hubUrl("127.0.0.1:4530"), "http://127.0.0.1:4530")
  assert.equal(hubUrl("localhost:4530/"), "http://localhost:4530")
  assert.equal(hubUrl("192.168.1.20:4530"), "http://192.168.1.20:4530")
  assert.equal(hubUrl("kandy-hub.tail1234.ts.net"), "https://kandy-hub.tail1234.ts.net")
  assert.equal(hubUrl("http://kandy.example.com"), "http://kandy.example.com")
})

test("an invite says the role, and to clone from the same remote", () => {
  const member = inviteMessage("https://hub.tail1.ts.net", { role: "member", remotes: ["git@github.com:acme/web.git"], tailnet: true })
  assert.match(member[0]!, /as a member/)
  assert.ok(member.some((l: string) => l.includes("git clone git@github.com:acme/web.git")))
  const viewer = inviteMessage("https://hub.tail1.ts.net", { role: "viewer", remotes: ["git@github.com:acme/web.git"] })
  assert.match(viewer[0]!, /as a viewer/)
  assert.equal(viewer.some((l: string) => l.includes("git clone")), false, "nothing runs for a viewer, so nothing to clone")
})

test("a token hub's banner says how to join from here and from elsewhere, consistently", () => {
  const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "")
  const loop = tokenHubSteps({ port: 4530, bind: "127.0.0.1", hosts: new Set(), fresh: true }).map(plain).join("\n")
  assert.match(loop, /on this machine: +kandy join http:\/\/127\.0\.0\.1:4530 --token "\$\(cat /)
  assert.match(loop, /answers only on this machine/)
  assert.match(loop, /KANDY_HOSTS=.* kandy hub --bind 0\.0\.0\.0/)
  assert.doesNotMatch(loop, /has one person/)

  const open = tokenHubSteps({ port: 4530, bind: "0.0.0.0", hosts: new Set(["box.lan"]), fresh: true }).map(plain).join("\n")
  assert.match(open, /on another machine: +kandy join http:\/\/box\.lan:4530 --token <the token in /)
  assert.doesNotMatch(open, /answers only on this machine/)
})
