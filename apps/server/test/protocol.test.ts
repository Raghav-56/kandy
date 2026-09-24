import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { RUNNER_PROTOCOL, event } from "@kandy/core"
import { SseDecoder } from "@kandy/client"
import { Engine } from "../dist/engine.js"
import { Runners } from "../dist/hub.js"
import { createHttpServer } from "../dist/http.js"
import { RemoteWorkshop } from "../dist/remote-workshop.js"
import { Store } from "../dist/store.js"

/*
 * Conformance for docs/18-runner-protocol.md.
 *
 * The runner below is written against the wire format and nothing else:
 * plain fetch, a hand-read event stream, no kandy runner code. If it can hold
 * a conversation with a hub, the protocol is a protocol and not just the
 * shape our own client happens to have.
 */

const TOKEN = "c".repeat(64)

async function hub() {
  const engine = new Engine(new Store(path.join(mkdtempSync(path.join(tmpdir(), "kandy-proto-")), "k.db")))
  const runners = new Runners(engine)
  const server = createHttpServer({
    engine,
    workshop: new RemoteWorkshop(engine, runners, null),
    workshopFor: (a: string | null) => new RemoteWorkshop(engine, runners, a),
    prs: { refresh: async () => {} } as never,
    token: TOKEN,
    runners,
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const port = (server.address() as AddressInfo).port
  return { engine, runners, url: `http://127.0.0.1:${port}`, close: () => server.close() }
}

const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }

/** A runner, by the book. */
function thirdParty(url: string, runnerId: string, boards: string[]) {
  const events: { type: string; data: string }[] = []
  const controller = new AbortController()
  let caughtUp!: () => void
  const ready = new Promise<void>((r) => (caughtUp = r))
  const post = (p: string, body: unknown) => fetch(url + p, { method: "POST", headers: auth, body: JSON.stringify(body) })

  return {
    events,
    ready,
    post,
    hello: (protocol = RUNNER_PROTOCOL) =>
      post("/runner/hello", { protocol, runnerId, name: "ci-box", os: "linux", agents: [], boards }),
    async open(onCommand: (c: { id: string; op: string; args: unknown[] }) => unknown) {
      const res = await fetch(`${url}/runner/stream?runner=${runnerId}&after=0`, {
        headers: { authorization: auth.authorization },
        signal: controller.signal,
      })
      assert.equal(res.status, 200)
      const dec = new SseDecoder()
      const text = new TextDecoder()
      void (async () => {
        try {
          for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
            for (const m of dec.push(text.decode(chunk, { stream: true }))) {
              if (m.type === "caught-up") caughtUp()
              else if (m.type === "command") {
                const cmd = JSON.parse(m.data)
                const result = await onCommand(cmd)
                await post("/runner/reply", { runnerId, id: cmd.id, ok: true, result })
              } else events.push({ type: m.type, data: m.data })
            }
          }
        } catch {
          // Aborted at the end of the test.
        }
      })()
    },
    close: () => controller.abort(),
  }
}

test("a runner written only against the protocol can hold a conversation with a hub", async () => {
  const h = await hub()
  try {
    h.engine.emit(event("board.created", { boardId: "b1", name: "demo", repoPath: "/repo" }))
    h.engine.emit(event("column.created", { columnId: "c1", boardId: "b1", name: "Todo", pos: "a0" }))
    h.engine.emit(event("note.created", { noteId: "n1", boardId: "b1", columnId: "c1", title: "t", body: "", pos: "a0" }))

    const r = thirdParty(h.url, "ci-runner-1", ["b1"])
    const hello = await r.hello()
    assert.equal(hello.status, 200)
    assert.deepEqual(await hello.json(), { ok: true, protocol: RUNNER_PROTOCOL, owner: null })

    let asked: { op: string; args: unknown[] } | null = null
    await r.open((cmd) => {
      asked = cmd
      return "run_from_ci"
    })
    await r.ready
    // It was replayed the whole board before being told it had caught up.
    assert.deepEqual(r.events.map((e) => e.type), ["board.created", "column.created", "note.created"])

    // A person asks the hub to run the note; the hub places it and commands the runner.
    const res = await fetch(`${h.url}/notes/n1/run`, { method: "POST", headers: auth, body: JSON.stringify({ agent: "claude" }) })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).runId, "run_from_ci")
    assert.equal(asked!.op, "request")
    assert.deepEqual(asked!.args.slice(0, 3), ["b1", "n1", "claude"])
    assert.equal(h.runners.placement("n1"), "ci-runner-1")

    // The runner reports what its run did; the hub stamps and keeps it.
    const log = await r.post("/runner/log", {
      runnerId: "ci-runner-1",
      ops: [{ op: "emit", pending: { type: "note.edited", data: { noteId: "n1", title: "done by CI" } } }],
    })
    assert.equal(log.status, 200)
    assert.equal(h.engine.view("b1")!.notes[0]!.title, "done by CI")
    r.close()
  } finally {
    h.close()
  }
})

test("a runner may not write about a note that is not placed on it", async () => {
  const h = await hub()
  try {
    h.engine.emit(event("board.created", { boardId: "b1", name: "demo", repoPath: "/repo" }))
    h.engine.emit(event("column.created", { columnId: "c1", boardId: "b1", name: "Todo", pos: "a0" }))
    h.engine.emit(event("note.created", { noteId: "n1", boardId: "b1", columnId: "c1", title: "t", body: "", pos: "a0" }))
    const r = thirdParty(h.url, "rogue-runner", ["b1"])
    await r.hello()

    const edit = await r.post("/runner/log", {
      runnerId: "rogue-runner",
      ops: [{ op: "emit", pending: { type: "note.edited", data: { noteId: "n1", title: "hijacked" } } }],
    })
    assert.equal(edit.status, 403)
    assert.equal(h.engine.view("b1")!.notes[0]!.title, "t")

    // Nor about no note at all: boards and columns are changed by people.
    const board = await r.post("/runner/log", {
      runnerId: "rogue-runner",
      ops: [{ op: "emit", pending: { type: "board.removed", data: { boardId: "b1" } } }],
    })
    assert.equal(board.status, 403)

    // Nor place a note on itself.
    h.runners.place("n1", "rogue-runner", null)
    const place = await r.post("/runner/log", {
      runnerId: "rogue-runner",
      ops: [{ op: "emit", pending: { type: "note.placed", data: { noteId: "n1", runnerId: "rogue-runner" } } }],
    })
    assert.equal(place.status, 403)

    // A batch with one bad write is refused whole: half a batch is a hole.
    const mixed = await r.post("/runner/log", {
      runnerId: "rogue-runner",
      ops: [
        { op: "emit", pending: { type: "note.edited", data: { noteId: "n1", title: "fine" } } },
        { op: "emit", pending: { type: "board.removed", data: { boardId: "b1" } } },
      ],
    })
    assert.equal(mixed.status, 403)
    assert.equal(h.engine.view("b1")!.notes[0]!.title, "t")
  } finally {
    h.close()
  }
})

test("a runner on another protocol version is told to upgrade, not left to misread", async () => {
  const h = await hub()
  try {
    const res = await thirdParty(h.url, "old-runner", []).hello(RUNNER_PROTOCOL + 1)
    assert.equal(res.status, 426)
    assert.match((await res.json()).error.message, /upgrade kandy/)
  } finally {
    h.close()
  }
})

test("a command to a runner that goes away fails at once, not two minutes later", async () => {
  const h = await hub()
  try {
    h.engine.emit(event("board.created", { boardId: "b1", name: "demo", repoPath: "/repo" }))
    const r = thirdParty(h.url, "flaky-runner", ["b1"])
    await r.hello()
    await r.open(() => new Promise(() => {})) // never answers
    await r.ready
    const started = Date.now()
    const pending = h.runners.call("flaky-runner", "diff", ["n1"])
    r.close()
    await assert.rejects(pending, (e: { status?: number }) => e.status === 503)
    assert.ok(Date.now() - started < 5000)
  } finally {
    h.close()
  }
})

test("the hub's own modules cannot reach an agent, a runner or a repository", () => {
  /*
   * The rule the whole split rests on, as an import check. A hub that can
   * import the runner is a hub that will, one day, run something.
   * `tailscale.js` may start a process — it is `tailscale`, not an agent —
   * and is not in this list for that reason.
   */
  const HERE = path.dirname(fileURLToPath(import.meta.url))
  const FORBIDDEN = [/runner\.js/, /local-workshop\.js/, /worktree\.js/, /agents\//, /capabilities\//, /node:child_process/]
  for (const file of ["hub.js", "remote-workshop.js", "members.js", "identity.js"]) {
    const src = readFileSync(path.join(HERE, "..", "dist", file), "utf8")
    const specs = [...src.matchAll(/^import[^"']*["']([^"']+)["']/gm)].map((m) => m[1]!)
    for (const s of specs) {
      assert.equal(FORBIDDEN.some((f) => f.test(s)), false, `${file} imports ${s}`)
    }
  }
  // roles.js holds both halves: the runner's pieces may only arrive by
  // dynamic import, so loading the hub never loads an agent adapter.
  const roles = readFileSync(path.join(HERE, "..", "dist", "cli", "roles.js"), "utf8")
  const statics = [...roles.matchAll(/^import[^"']*["']([^"']+)["']/gm)].map((m) => m[1]!)
  for (const s of statics) assert.equal(FORBIDDEN.some((f) => f.test(s)), false, `roles.js statically imports ${s}`)
})
