import test from "node:test"
import assert from "node:assert/strict"

import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

import { installEventSource, NodeEventSource, SseDecoder } from "../dist/sse.js"

test("named events come out with their data and id", () => {
  const d = new SseDecoder()
  const out = d.push('id: 7\nevent: note.status\ndata: {"seq":7}\n\n')

  assert.deepEqual(out, [{ type: "note.status", data: '{"seq":7}', lastEventId: "7" }])
})

test("a frame split across two chunks is not lost", () => {
  // The case that breaks naive parsers: a chunk boundary can fall anywhere,
  // including mid-field. Nothing is emitted until the blank line arrives, and
  // then the whole frame is emitted exactly once.
  const d = new SseDecoder()

  assert.deepEqual(d.push("id: 4\nevent: run.st"), [])
  assert.deepEqual(d.push('arted\ndata: {"ru'), [])
  assert.deepEqual(d.push('nId":"r1"}\n\n'), [
    { type: "run.started", data: '{"runId":"r1"}', lastEventId: "4" },
  ])
})

test("several frames in one chunk come out in order", () => {
  const d = new SseDecoder()
  const out = d.push("id: 1\nevent: a\ndata: one\n\nid: 2\nevent: b\ndata: two\n\n")

  assert.deepEqual(
    out.map((m) => [m.type, m.data, m.lastEventId]),
    [
      ["a", "one", "1"],
      ["b", "two", "2"],
    ],
  )
})

test("heartbeats are swallowed", () => {
  // The server writes ":\n\n" every 15s to hold the connection open. It is not
  // an event, and a listener must never see it.
  const d = new SseDecoder()
  assert.deepEqual(d.push(":\n\n"), [])
  assert.deepEqual(d.push(": keep-alive\n\n"), [])
})

test("an idless frame carries the last id forward, and does not move it", () => {
  // Transcript frames deliberately carry no `id:`, so a reconnect resumes the
  // domain log where it left off instead of replaying agent chatter.
  const d = new SseDecoder()
  d.push("id: 9\nevent: note.status\ndata: x\n\n")
  const out = d.push('event: transcript\ndata: {"kind":"transcript"}\n\n')

  assert.equal(out[0]?.lastEventId, "9")
  assert.equal(d.resumeFrom, "9")
})

test("multi-line data is joined with newlines, and one leading space is eaten", () => {
  const d = new SseDecoder()
  const out = d.push("event: m\ndata: line one\ndata:line two\n\n")

  assert.equal(out[0]?.data, "line one\nline two")
})

test("a frame with only an id is not an event", () => {
  const d = new SseDecoder()
  assert.deepEqual(d.push("id: 12\n\n"), [])
  // …but it still moves the resume point.
  assert.equal(d.resumeFrom, "12")
})

test("a value keeps its inner colons", () => {
  const d = new SseDecoder()
  assert.equal(d.push("data: 12:30:01\n\n")[0]?.data, "12:30:01")
})

// --- the transport ----------------------------------------------------------
//
// The decoder tests above cover the parsing. These cover the part that only
// shows up against a socket: that chunk boundaries chosen by the network, not
// by a test, still produce whole events.

/** An SSE server that writes exactly the chunks it is given, then holds open. */
function sseServer(chunks: string[]): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server: Server = createServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      })
      // One write per chunk, so the boundaries are the ones the test chose.
      for (const c of chunks) res.write(c)
    })
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo
      resolve({ url: `http://127.0.0.1:${port}/events`, close: () => server.close() })
    })
  })
}

test("NodeEventSource delivers named events across a chunk boundary", async () => {
  const { url, close } = await sseServer([
    'event: note.created\ndata: {"title":"a no',
    'te"}\n\n: heartbeat\n\nevent: note.created\ndata: {"title":"another"}\n\n',
  ])
  const es = new NodeEventSource(url)
  const seen: string[] = []
  await new Promise<void>((resolve) => {
    es.addEventListener("note.created", (ev) => {
      seen.push(ev.data)
      if (seen.length === 2) resolve()
    })
  })
  es.close()
  close()

  assert.deepEqual(seen, ['{"title":"a note"}', '{"title":"another"}'])
})

test("a connection that cannot be made is reported, not thrown", async () => {
  // Nothing listens on port 1, and an unhandled rejection here would take the
  // whole CLI down rather than showing "reconnecting…".
  const es = new NodeEventSource("http://127.0.0.1:1/events")
  const err = await new Promise<unknown>((resolve) => {
    es.onerror = resolve
  })
  es.close()

  assert.ok(err, "onerror should receive the failure")
})

test("installEventSource leaves a real EventSource alone", () => {
  const g = globalThis as { EventSource?: unknown }
  const real = function RealEventSource() {}
  const had = g.EventSource
  g.EventSource = real
  installEventSource()
  assert.equal(g.EventSource, real, "a browser's own EventSource must win")
  g.EventSource = had
})

test("installEventSource fills in the gap when there is none", () => {
  const g = globalThis as { EventSource?: unknown }
  const had = g.EventSource
  delete g.EventSource
  installEventSource()
  assert.equal(g.EventSource, NodeEventSource)
  g.EventSource = had
})
