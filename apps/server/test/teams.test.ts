import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { mkdtempSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"

import { RUNNER_PROTOCOL, event } from "@kandy/core"
import { SseDecoder } from "@kandy/client"
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

async function tailnetHub() {
  const engine = new Engine(new Store(path.join(mkdtempSync(path.join(tmpdir(), "kandy-team-")), "k.db")))
  const runners = new Runners(engine)
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
    assert.deepEqual(await alice.json(), { hub: true, email: "alice@example.com", role: "owner" })

    const bob = await h.as("bob@example.com")("/boards")
    assert.equal(bob.status, 403)
    assert.match((await bob.json()).error.message, /you are bob@example\.com.*ask one of its owners/)

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
