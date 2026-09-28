import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { mkdtempSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"

import { event } from "@kandy/core"
import { Engine } from "../dist/engine.js"
import { createHttpServer } from "../dist/http.js"
import { Store } from "../dist/store.js"

/*
 * The review route: who may be merged, discarded or sent back, and when.
 *
 * Every case here was reproduced against a real board: a draft that had
 * never run "merged" into done and was counted as landed; a running note was
 * merged while its agent kept writing; a note merged twice. The workshop is a
 * stand-in that records what it was asked, because the question is whether
 * the route asks it at all.
 */

const TOKEN = "e".repeat(64)

async function daemon(review: (verdict: { decision: string }) => unknown = () => ({ checkout: "removed" })) {
  const engine = new Engine(new Store(path.join(mkdtempSync(path.join(tmpdir(), "kandy-review-")), "k.db")))
  const asked: string[] = []
  const workshop = {
    review: async (_repo: string, _note: string, verdict: { decision: string }) => {
      asked.push(verdict.decision)
      return review(verdict)
    },
    // A run asked for by sending a note back, as the runner would record it.
    steer: async (_board: string, noteId: string) => {
      asked.push("steer")
      engine.emit(event("run.requested", { runId: "run_2", noteId, agent: "claude" }))
      engine.emit(event("run.started", { runId: "run_2", noteId, worktree: "/wt", branch: "kandy/n1", baseRef: "abc", pid: 2 }))
      return "queued"
    },
    syncColumn: async () => {},
  }
  const server = createHttpServer({ engine, workshop: workshop as never, prs: {} as never, token: TOKEN } as never)
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const port = (server.address() as AddressInfo).port

  engine.emit(event("board.created", { boardId: "b1", name: "demo", repoPath: "/repo" }))
  engine.emit(event("column.created", { columnId: "c1", boardId: "b1", name: "Todo", pos: "a0" }))
  engine.emit(event("note.created", { noteId: "n1", boardId: "b1", columnId: "c1", title: "t", body: "", pos: "a0" }))

  const decide = (body: Record<string, unknown>) =>
    new Promise<{ status: number; body: any }>((resolve, reject) => {
      const r = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/notes/n1/review",
          method: "POST",
          headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        },
        (res) => {
          let data = ""
          res.setEncoding("utf8")
          res.on("data", (c) => (data += c))
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }))
        },
      )
      r.on("error", reject)
      r.end(JSON.stringify(body))
    })

  const note = () => engine.view("b1")!.notes.find((n) => n.id === "n1")!
  const decided = () => engine.store.since(0).filter((e) => e.type === "review.decided").length
  const toReview = () => {
    engine.emit(event("run.requested", { runId: "run_1", noteId: "n1", agent: "claude" }))
    engine.emit(event("run.started", { runId: "run_1", noteId: "n1", worktree: "/wt", branch: "kandy/n1", baseRef: "abc", pid: 1 }))
    engine.emit(event("run.finished", { runId: "run_1", noteId: "n1", status: "succeeded", exitCode: 0, error: null }))
  }
  return { engine, asked, decide, note, decided, toReview, close: () => server.close() }
}

test("a note that never ran cannot be merged or discarded", async () => {
  const d = await daemon()
  try {
    for (const decision of ["merge", "discard"]) {
      const res = await d.decide({ decision })
      assert.equal(res.status, 409)
      assert.match(res.body.error.message, /not run yet/)
    }
    assert.deepEqual(d.asked, [], "the checkout is never touched")
    assert.equal(d.decided(), 0)
    assert.equal(d.note().status, "draft")
  } finally {
    d.close()
  }
})

test("a running note cannot be merged while its agent is still writing", async () => {
  const d = await daemon()
  try {
    d.engine.emit(event("run.requested", { runId: "run_1", noteId: "n1", agent: "claude" }))
    d.engine.emit(event("run.started", { runId: "run_1", noteId: "n1", worktree: "/wt", branch: "kandy/n1", baseRef: "abc", pid: 1 }))
    const res = await d.decide({ decision: "merge" })
    assert.equal(res.status, 409)
    assert.match(res.body.error.message, /still running/)
    assert.equal(d.note().status, "running")
    assert.deepEqual(d.asked, [])
  } finally {
    d.close()
  }
})

test("a merged note cannot be merged again", async () => {
  const d = await daemon()
  try {
    d.toReview()
    assert.equal((await d.decide({ decision: "merge" })).status, 200)
    assert.equal(d.note().outcome, "merged")
    const again = await d.decide({ decision: "merge" })
    assert.equal(again.status, 409)
    assert.match(again.body.error.message, /already been merged/)
    assert.equal(d.decided(), 1)
  } finally {
    d.close()
  }
})

test("a merge the checkout refused leaves the note in review, with the reason", async () => {
  const reason = "your checkout is on feature, not main — switch it to main, then merge again"
  const d = await daemon(() => ({ checkout: "refused", reason }))
  try {
    d.toReview()
    const res = await d.decide({ decision: "merge" })
    assert.equal(res.status, 409)
    assert.equal(res.body.error.message, reason)
    assert.equal(d.note().status, "review")
    assert.equal(d.decided(), 0)
  } finally {
    d.close()
  }
})

test("sending a note back shows it running, so it cannot be run twice", async () => {
  const d = await daemon()
  try {
    d.toReview()
    const res = await d.decide({ decision: "revise", comment: "smaller, please" })
    assert.equal(res.status, 200)
    // It used to read `draft` here, with `r run` on offer beside a live agent.
    assert.equal(d.note().status, "running")
    assert.equal(d.decided(), 1)
  } finally {
    d.close()
  }
})
