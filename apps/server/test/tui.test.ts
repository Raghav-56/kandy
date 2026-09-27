import test from "node:test"
import assert from "node:assert/strict"

import {
  boardRows,
  defaultAgent,
  formatDuration,
  giveTargets,
  glyph,
  heldForMe,
  inboxColumn,
  moveSelection,
  needsYou,
  readyAgents,
  reconcileSelection,
  scrollOffset,
  selectFirst,
  selectLast,
} from "../dist/tui/board.js"
import { editKey, emptyEditor } from "../dist/tui/editor.js"
import { fitHints, hints, keyAction, splitBurst, stageOf } from "../dist/tui/keys.js"
import { batcher, LiveBoard } from "../dist/tui/live.js"
import { FOLLOWING, mergeFrames, scroll, toBottom, toTop, transcriptRows, viewStart } from "../dist/tui/transcript.js"
import { jumpFile, parseDiff } from "../dist/tui/diff.js"
import { palette, toneProps } from "../dist/tui/theme.js"
import { textWidth, truncate, truncateStart, wrap, tildify } from "../dist/tui/text.js"

// --- fixtures ----------------------------------------------------------------

const NOW = 1_700_000_000_000

function note(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    boardId: "b",
    columnId: "c0",
    title: `note ${id}`,
    body: "",
    status: "draft",
    pos: id,
    agent: null,
    model: null,
    policy: "repo",
    rules: [],
    runId: null,
    branch: null,
    worktree: null,
    stat: null,
    pr: null,
    outcome: null,
    runner: null,
    held: null,
    handoff: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

function run(id: string, noteId: string, over: Record<string, unknown> = {}) {
  return {
    id,
    noteId,
    agent: "claude",
    agentSessionId: null,
    status: "running",
    baseRef: null,
    startedAt: NOW - 65_000,
    endedAt: null,
    exitCode: null,
    error: null,
    costUsd: null,
    tokens: null,
    turns: null,
    model: null,
    costSource: "unpriced",
    ...over,
  }
}

function view(notes: unknown[], extra: Record<string, unknown> = {}) {
  const lanes = ["inbox", "running", "review", "done"]
  return {
    board: { id: "b", name: "demo", repoPath: "/r", models: {}, defaultPolicy: "repo" },
    // Deliberately out of order: rows follow `pos`, not array order.
    columns: lanes.map((lane, i) => ({ id: `c${i}`, boardId: "b", name: lane, pos: `a${i}`, lane })).reverse(),
    notes,
    runs: [],
    prompts: [],
    seq: 5,
    ...extra,
  } as never
}

function frame(seq: number, role = "assistant", text = `f${seq}`, meta?: string) {
  return { kind: "transcript", runId: "r1", seq, ts: NOW, role, text, ...(meta ? { meta } : {}) }
}

const ctx = (over: Record<string, unknown> = {}) =>
  ({ screen: "board", hub: false, filtering: false, prompt: false, heldMine: false, note: true, stage: "idle", ...over }) as never

// --- board -------------------------------------------------------------------

test("boardRows: lanes in board order, notes under their lane, empty lanes left out", () => {
  const v = view([note("n1"), note("n2", { columnId: "c2", status: "review" }), note("n3")])
  const rows = boardRows(v)
  assert.deepEqual(
    rows.map((r: { kind: string; key: string; count?: number }) => (r.kind === "lane" ? `[${r.key}:${r.count}]` : r.key)),
    // As the web board does: a terminal has too few rows for "QUEUED 0".
    ["[lane:c0:2]", "n1", "n3", "[lane:c2:1]", "n2"],
  )
})

test("boardRows: a filter matches title/body/agent and hides empty lanes", () => {
  const v = view([
    note("n1", { title: "Fix the README" }),
    note("n2", { body: "readme again" }),
    note("n3", { columnId: "c2", agent: "codex" }),
  ])
  assert.deepEqual(
    boardRows(v, "readme").map((r: { key: string }) => r.key),
    ["lane:c0", "n1", "n2"],
  )
  assert.deepEqual(
    boardRows(v, "CODEX").map((r: { key: string }) => r.key),
    ["lane:c2", "n3"],
  )
})

test("selection skips lane headers, clamps, and survives a vanished note", () => {
  const v = view([note("n1"), note("n2", { columnId: "c2" }), note("n3", { columnId: "c2" })])
  const rows = boardRows(v)
  assert.equal(selectFirst(rows), "n1")
  assert.equal(selectLast(rows), "n3")
  assert.equal(moveSelection(rows, "n1", 1), "n2") // across two headers
  assert.equal(moveSelection(rows, "n3", 5), "n3")
  assert.equal(moveSelection(rows, "n2", -9), "n1")
  assert.equal(moveSelection(rows, null, 1), "n1")
  // n2 deleted: stay near where it was rather than jumping to the top.
  const after = boardRows(view([note("n1"), note("n3", { columnId: "c2" })]))
  const idx = rows.findIndex((r: { key: string }) => r.key === "n2")
  assert.equal(reconcileSelection(after, "n2", idx), "n3")
  assert.equal(reconcileSelection(after, "n1", 0), "n1")
  assert.equal(reconcileSelection([], "n1", 0), null)
})

test("scrollOffset keeps the selection (and its lane header) on screen", () => {
  assert.equal(scrollOffset(0, 3, 5, 20), 0)
  assert.equal(scrollOffset(0, 7, 5, 20), 3)
  assert.equal(scrollOffset(10, 11, 5, 20), 10) // header above is row 10
  assert.equal(scrollOffset(10, 10, 5, 20), 9)
  assert.equal(scrollOffset(18, 19, 5, 20), 15) // clamped to the last page
  assert.equal(scrollOffset(3, 0, 10, 4), 0)
})

test("glyphs: prompts and held outrank status; running spins", () => {
  const n = note("n1", { status: "running", runId: "r1" })
  const v = view([n], { prompts: [{ noteId: "n1" }] })
  assert.deepEqual(glyph(v, n), { char: "?", tone: "lemon" })
  const quiet = view([n])
  assert.notEqual(glyph(quiet, n, 0).char, glyph(quiet, n, 1).char)
  assert.equal(glyph(quiet, n).tone, "mint")
  assert.deepEqual(glyph(quiet, note("h", { held: { runnerId: "x" } })), { char: "!", tone: "lemon" })
  assert.deepEqual(glyph(quiet, note("f", { status: "failed" })), { char: "✗", tone: "berry" })
  assert.equal(glyph(quiet, note("d", { status: "done" })).char, "✓")
  assert.equal(glyph(quiet, note("r", { status: "review" })).char, "●")
})

test("needsYou counts each waiting note once", () => {
  const v = view(
    [
      note("a", { status: "review" }),
      note("b", { status: "blocked" }),
      note("c", { held: { runnerId: "x" } }),
      note("d", { status: "running" }),
      note("e"),
    ],
    { prompts: [{ noteId: "d" }, { noteId: "d" }, { noteId: "a" }] },
  )
  assert.equal(needsYou(v), 4)
})

test("formatDuration", () => {
  assert.equal(formatDuration(4_000), "4s")
  assert.equal(formatDuration(125_000), "2m")
  assert.equal(formatDuration(3 * 3600_000), "3h")
  assert.equal(formatDuration(3 * 86400_000), "3d")
  assert.equal(formatDuration(-5), "0s")
})

test("agents: ready ones only, last-used first, inbox column for new notes", () => {
  const infos = [
    { id: "claude", installed: true, authed: true },
    { id: "codex", installed: true, authed: false },
    { id: "cursor", installed: true, authed: true },
  ] as never
  assert.deepEqual(readyAgents(infos), ["claude", "cursor"])
  assert.ok(readyAgents(null).includes("codex"))
  const v = view([], {
    runs: [run("r1", "x", { agent: "claude", startedAt: 1 }), run("r2", "y", { agent: "cursor", startedAt: 2 })],
  })
  assert.equal(defaultAgent(v, ["claude", "cursor"]), "cursor")
  assert.equal(defaultAgent(v, ["claude"]), "claude")
  assert.equal(defaultAgent(view([]), []), null)
  assert.equal(inboxColumn(view([])), "c0")
})

test("hub: held-for-me by owner email, give targets exclude the current machine", () => {
  const runners = [
    { runnerId: "m1", name: "mine", owner: "Me@Example.com", online: true, boards: ["b"] },
    { runnerId: "m2", name: "bob", owner: "bob@x", online: true, boards: ["b"] },
    { runnerId: "m3", name: "off", owner: "bob@x", online: false, boards: ["b"] },
    { runnerId: "m4", name: "elsewhere", owner: "bob@x", online: true, boards: ["other"] },
  ] as never
  const held = note("n", { held: { runnerId: "m1" }, runner: "m2" })
  assert.equal(heldForMe(held as never, runners, "me@example.com"), true)
  assert.equal(heldForMe(held as never, runners, "bob@x"), false)
  assert.equal(heldForMe(note("n") as never, runners, "me@example.com"), false)
  assert.deepEqual(
    giveTargets(runners, "b", held as never).map((r: { runnerId: string }) => r.runnerId),
    ["m1"],
  )
})

// --- keys --------------------------------------------------------------------

test("keyAction: board keys", () => {
  assert.deepEqual(keyAction(ctx(), "j", {}), { type: "move", by: 1 })
  assert.deepEqual(keyAction(ctx(), "", { upArrow: true }), { type: "move", by: -1 })
  assert.deepEqual(keyAction(ctx(), "", { return: true }), { type: "open" })
  assert.deepEqual(keyAction(ctx(), "n", {}), { type: "new", run: true })
  assert.deepEqual(keyAction(ctx(), "N", { shift: true }), { type: "new", run: false })
  assert.deepEqual(keyAction(ctx(), "r", {}), { type: "run" })
  assert.deepEqual(keyAction(ctx(), "/", {}), { type: "filter" })
  assert.deepEqual(keyAction(ctx(), "q", {}), { type: "quit" })
  assert.deepEqual(keyAction(ctx(), "c", { ctrl: true }), { type: "quit" })
  // esc clears a filter before it quits
  assert.deepEqual(keyAction(ctx({ filtering: true }), "", { escape: true }), { type: "clearFilter" })
  assert.deepEqual(keyAction(ctx(), "", { escape: true }), { type: "quit" })
  // no note selected: open/run mean nothing
  assert.equal(keyAction(ctx({ note: false }), "", { return: true }), null)
  // prompt keys only when there is a prompt
  assert.equal(keyAction(ctx(), "a", {}), null)
  assert.deepEqual(keyAction(ctx({ prompt: true }), "A", {}), { type: "allow", scope: "note" })
})

test("keyAction: note keys, consent only when held on my machine, give only on a hub", () => {
  const note = (o: Record<string, unknown> = {}) => ctx({ screen: "note", stage: "review", ...o })
  assert.deepEqual(keyAction(note(), "q", {}), { type: "back" })
  assert.deepEqual(keyAction(note(), "", { escape: true }), { type: "back" })
  assert.deepEqual(keyAction(note(), "M", {}), { type: "merge" })
  assert.deepEqual(keyAction(note(), "X", {}), { type: "discard" })
  assert.deepEqual(keyAction(note(), "R", {}), { type: "revise" })
  assert.deepEqual(keyAction(note(), "m", {}), { type: "message" })
  assert.deepEqual(keyAction(note(), "d", {}), { type: "diff" })
  assert.equal(keyAction(note(), "g", {}), null)
  assert.deepEqual(keyAction(note({ hub: true }), "g", {}), { type: "give" })
  assert.equal(keyAction(note(), "y", {}), null)
  assert.deepEqual(keyAction(note({ heldMine: true }), "Y", {}), { type: "consent", accept: true, always: true })
  assert.deepEqual(keyAction(note({ heldMine: true }), "n", {}), { type: "consent", accept: false, always: false })
  assert.deepEqual(keyAction(note({ prompt: true }), "D", {}), { type: "deny" })
  assert.deepEqual(keyAction(note(), "G", {}), { type: "bottom" })
})

test("keyAction: diff and help", () => {
  const d = ctx({ screen: "diff" })
  assert.deepEqual(keyAction(d, "]", {}), { type: "file", dir: 1 })
  assert.deepEqual(keyAction(d, "[", {}), { type: "file", dir: -1 })
  assert.deepEqual(keyAction(d, " ", {}), { type: "page", by: 1 })
  assert.deepEqual(keyAction(ctx({ screen: "help" }), "?", {}), { type: "back" })
})

test("a burst of one key repeats it; a mixed burst is its first key", () => {
  assert.deepEqual(splitBurst("jjj"), { input: "j", count: 3 })
  assert.deepEqual(splitBurst("jk"), { input: "j", count: 1 })
  assert.deepEqual(keyAction(ctx(), "jjj", {}), { type: "move", by: 3 })
  assert.deepEqual(keyAction(ctx(), "Mq", {}), null) // M means nothing on the board
})

test("hints: contextual, urgent first, '?' survives narrow widths", () => {
  const board = hints(ctx({ stage: "live" })).map((h: { key: string }) => h.key)
  assert.ok(board.includes("x"))
  assert.ok(!board.includes("r"))
  const idle = hints(ctx({ stage: "idle" })).map((h: { key: string }) => h.key)
  assert.ok(idle.includes("r") && !idle.includes("x"))
  const asked = hints(ctx({ screen: "note", prompt: true, stage: "live" })).map((h: { key: string }) => h.key)
  assert.deepEqual(asked.slice(0, 3), ["a", "A", "D"])
  const review = hints(ctx({ screen: "note", stage: "review" })).map((h: { key: string }) => h.key)
  assert.ok(review.includes("M") && review.includes("X") && review.includes("R"))
  const fitted = fitHints(hints(ctx()), 30)
  assert.equal(fitted[fitted.length - 1].key, "?")
  assert.ok(1 + fitted.reduce((n: number, h: { key: string; label: string }) => n + h.key.length + h.label.length + 3, 0) <= 30)
  assert.equal(stageOf("blocked"), "live")
  assert.equal(stageOf("failed"), "review")
})

// --- editor ------------------------------------------------------------------

test("editor: typing, cursor, deletion, submit and cancel", () => {
  let ed = emptyEditor()
  for (const c of "helo") ed = editKey(ed, c, {}).editor
  ed = editKey(ed, "", { leftArrow: true }).editor
  ed = editKey(ed, "l", {}).editor
  assert.deepEqual(ed, { text: "hello", cursor: 4 })
  ed = editKey(ed, "", { backspace: true }).editor
  assert.equal(ed.text, "helo")
  ed = editKey(ed, "a", { ctrl: true }).editor
  assert.equal(ed.cursor, 0)
  ed = editKey(ed, "", { delete: true }).editor
  assert.equal(ed.text, "elo")
  assert.equal(editKey(ed, "", { return: true }).done, "submit")
  assert.equal(editKey(ed, "", { escape: true }).done, "cancel")
  ed = editKey(emptyEditor("fix the thing"), "w", { ctrl: true }).editor
  assert.equal(ed.text, "fix the ")
  ed = editKey(emptyEditor("abc"), "u", { ctrl: true }).editor
  assert.deepEqual(ed, { text: "", cursor: 0 })
})

test("editor: newlines only where allowed; pastes are inserted whole", () => {
  const ml = { multiline: true }
  let ed = editKey(emptyEditor("title"), "\n", {}, ml).editor // ctrl+j
  ed = editKey(ed, "", { return: true, meta: true }, ml).editor // alt+enter
  ed = editKey(ed, "body", {}, ml).editor
  assert.equal(ed.text, "title\n\nbody")
  assert.equal(editKey(emptyEditor("x"), "\n", {}).editor.text, "x")
  assert.equal(editKey(emptyEditor(), "a\r\nb", {}).editor.text, "a b")
  assert.equal(editKey(emptyEditor(), "a\r\nb", {}, ml).editor.text, "a\nb")
  assert.equal(editKey(emptyEditor("x"), "", { upArrow: true }).editor.text, "x")
})

// --- transcript --------------------------------------------------------------

test("mergeFrames: dedupes, orders, caps", () => {
  const a = [frame(1), frame(2)]
  assert.equal(mergeFrames(a, []), a)
  assert.equal(mergeFrames(a, [frame(2)]), a)
  assert.deepEqual(
    mergeFrames([frame(3), frame(5)], [frame(4), frame(1), frame(4)]).map((f: { seq: number }) => f.seq),
    [1, 3, 4, 5],
  )
  assert.deepEqual(
    mergeFrames([frame(1)], [frame(2), frame(3), frame(4)], 2).map((f: { seq: number }) => f.seq),
    [3, 4],
  )
})

test("transcriptRows: roles styled, tools folded, runs separated", () => {
  const long = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n")
  const rows = transcriptRows(
    [
      {
        run: run("r1", "n", { status: "succeeded", endedAt: NOW }),
        frames: [frame(1, "user", "do it"), frame(2, "tool", long, "Bash"), frame(3, "tool", "x", "Read"), frame(4, "error", "boom")],
      },
      { run: run("r2", "n", { agent: "codex" }), frames: [frame(5, "system", "compacted")] },
    ],
    40,
    NOW,
  )
  const text = rows.map((r: { text: string }[]) => r.map((s) => s.text).join(""))
  assert.match(text[0], /run 1 · Claude Code · succeeded/)
  assert.equal(text[1], "› do it")
  assert.equal(rows[1][1].bold, true)
  assert.ok(text.includes("Bash line 0"))
  assert.ok(text.some((t: string) => /… 14 more lines/.test(t)))
  // consecutive tool frames are not separated by a blank row
  const readAt = text.indexOf("Read x")
  assert.notEqual(text[readAt - 1], "")
  assert.ok(text.includes("✗ boom"))
  assert.ok(text.some((t: string) => /run 2 · Codex/.test(t)))
  assert.equal(rows[rows.length - 1][0].italic, true)
  for (const t of text) assert.ok(textWidth(t) <= 40, t)
})

test("follow: tails until scrolled up, re-pins at the bottom", () => {
  let f = FOLLOWING
  assert.equal(viewStart(f, 100, 10), 90)
  assert.equal(viewStart(f, 120, 10), 110) // new rows: still tailing
  f = scroll(f, -5, 120, 10)
  assert.deepEqual(f, { offset: 105, follow: false })
  assert.equal(viewStart(f, 150, 10), 105) // new rows: stays put
  f = scroll(f, 1000, 150, 10)
  assert.equal(f.follow, true)
  assert.equal(viewStart(toTop(), 150, 10), 0)
  assert.equal(toBottom().follow, true)
  assert.equal(viewStart(FOLLOWING, 3, 10), 0)
})

// --- diff --------------------------------------------------------------------

test("parseDiff: file headers, hunks, adds and removes; jump between files", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 1..2 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,2 +1,2 @@",
    " keep",
    "-old",
    "+new",
    "diff --git a/b.md b/c.md",
    "rename from b.md",
    "@@ -1 +1 @@",
    "-x",
    "+y",
    "",
  ].join("\n")
  const { rows, files } = parseDiff(diff)
  assert.deepEqual(
    rows.map((r: { text: string; tone: string; bold: boolean }) => [r.text, r.tone, r.bold]),
    [
      ["src/a.ts", "plain", true],
      ["@@ -1,2 +1,2 @@", "cyan", false],
      [" keep", "plain", false],
      ["-old", "berry", false],
      ["+new", "mint", false],
      ["", "plain", false],
      ["b.md → c.md", "plain", true],
      ["rename from b.md", "dim", false],
      ["@@ -1 +1 @@", "cyan", false],
      ["-x", "berry", false],
      ["+y", "mint", false],
    ],
  )
  assert.deepEqual(files, [0, 6])
  assert.equal(jumpFile(files, 0, 1), 6)
  assert.equal(jumpFile(files, 6, 1), 6)
  assert.equal(jumpFile(files, 8, -1), 6)
  assert.equal(jumpFile(files, 6, -1), 0)
  assert.equal(jumpFile([], 3, 1), 3)
})

// --- text & theme ------------------------------------------------------------

test("text: width-aware truncation and wrapping", () => {
  assert.equal(truncate("hello world", 8), "hello w…")
  assert.equal(truncate("hi", 8), "hi")
  assert.equal(textWidth("日本"), 4)
  assert.equal(truncate("日本語です", 5), "日本…")
  assert.equal(truncateStart("/a/very/long/path", 8), "…ng/path")
  assert.equal(tildify("/home/me/x", "/home/me"), "~/x")
  assert.deepEqual(wrap("the quick brown fox", 9), ["the quick", "brown fox"])
  assert.deepEqual(wrap("abcdefghij", 4), ["abcd", "efgh", "ij"])
  assert.deepEqual(wrap("a\n\nb\tc", 10), ["a", "", "b  c"])
  assert.deepEqual(wrap("\x1b[31mred\x1b[0m", 10), ["red"])
})

test("theme: NO_COLOR drops hue but keeps dimness", () => {
  const on = palette({})
  const off = palette({ NO_COLOR: "1" })
  assert.ok(on.color("mint"))
  assert.equal(off.color("mint"), undefined)
  assert.deepEqual(toneProps(off, "berry"), {})
  assert.deepEqual(toneProps(off, "dim"), { dimColor: true })
  assert.ok(palette({ NO_COLOR: "" }).color("lemon"))
})

// --- live board --------------------------------------------------------------

function fakeClient(snapshot: unknown) {
  const handlers: Record<string, (x: unknown) => void> = {}
  let closed = 0
  const client = {
    view: async () => snapshot,
    events: (after: number, h: Record<string, (x: unknown) => void>) => {
      client.after = after
      Object.assign(handlers, h)
      return () => void closed++
    },
    transcript: async (_runId: string, after: number) =>
      after === 0 ? { frames: [frame(1), frame(2)], nextAfter: 2 } : { frames: [frame(3)], nextAfter: null },
    after: -1,
  }
  return { client, handlers, closed: () => closed }
}

function manualTimers() {
  const pending: (() => void)[] = []
  return {
    timers: { set: (fn: () => void) => (pending.push(fn), pending.length), clear: () => void pending.splice(0) },
    fire: () => pending.splice(0).forEach((fn) => fn()),
    get count() {
      return pending.length
    },
  }
}

test("batcher coalesces until it fires", () => {
  const t = manualTimers()
  let flushed = 0
  const b = batcher(() => flushed++, 33, t.timers)
  b.schedule()
  b.schedule()
  b.schedule()
  assert.equal(t.count, 1)
  t.fire()
  assert.equal(flushed, 1)
  b.schedule()
  b.flushNow()
  assert.equal(flushed, 2)
  assert.equal(b.pending, false)
})

test("LiveBoard: snapshot then stream, skipping what the snapshot already holds, one notify per batch", async () => {
  const snap = view([note("n1")], { seq: 10 })
  const { client, handlers, closed } = fakeClient(snap)
  const t = manualTimers()
  const live = new LiveBoard(client as never, { timers: t.timers })
  let notified = 0
  live.subscribe(() => notified++)
  await live.open("b")
  assert.equal(client.after, 10)
  assert.equal(live.getSnapshot().view, snap)
  assert.equal(live.getSnapshot().connected, true)

  const before = notified
  const created = (seq: number, id: string) => ({
    seq,
    ts: NOW,
    actor: null,
    type: "note.created",
    data: { noteId: id, boardId: "b", columnId: "c0", title: id, body: "", pos: `z${seq}` },
  })
  handlers.onEvent(created(9, "old")) // already in the snapshot
  handlers.onEvent(created(11, "n2"))
  handlers.onEvent(created(11, "dup")) // replayed after a reconnect
  handlers.onEvent(created(12, "n3"))
  handlers.onTranscript(frame(7))
  handlers.onTranscript(frame(6))
  handlers.onActivity({ kind: "activity", runId: "r1", ts: NOW, tool: "Edit", detail: "x" })
  assert.equal(notified, before, "nothing drawn until the batch fires")
  t.fire()
  assert.equal(notified, before + 1)
  const s = live.getSnapshot()
  assert.deepEqual(
    s.view.notes.map((n: { id: string }) => n.id),
    ["n1", "n2", "n3"],
  )
  assert.equal(s.view.seq, 12)
  assert.deepEqual(
    s.transcripts.r1.map((f: { seq: number }) => f.seq),
    [6, 7],
  )
  assert.equal(s.activity.r1.tool, "Edit")

  // Backfill pages through and merges with what streamed in.
  await live.loadTranscript("r1")
  assert.deepEqual(
    live.getSnapshot().transcripts.r1.map((f: { seq: number }) => f.seq),
    [1, 2, 3, 6, 7],
  )

  handlers.onError({})
  t.fire()
  assert.equal(live.getSnapshot().connected, false)

  live.dispose()
  assert.equal(closed(), 1)
})

test("LiveBoard: a failed snapshot is an error state, not a throw", async () => {
  const live = new LiveBoard({
    view: async () => {
      throw new Error("no such board")
    },
    events: () => () => {},
    transcript: async () => ({ frames: [], nextAfter: null }),
  } as never)
  await live.open("nope")
  assert.equal(live.getSnapshot().error, "no such board")
  assert.equal(live.getSnapshot().view, null)
})

test("needsYou reads a note from an older daemon, which has no held field, as needing nothing", () => {
  const v = view([{ ...note("n1", { status: "done" }), held: undefined } as never])
  assert.equal(needsYou(v), 0)
})

test("an agent's markdown reads as formatting, not asterisks", async () => {
  const { markdownRows } = await import("../dist/tui/markdown.js")
  const reply = [
    "I added the chime.",
    "",
    "- **Volume:** peaks at 0.06, set in `src/chime.js`, quiet enough not to startle anyone nearby",
    "1. first",
    "```",
    "const x = **not bold**",
    "```",
    "a lone ** stays",
  ].join("\n")
  const rows = markdownRows(reply, 40)
  const text = rows.map((r: { text: string }[]) => r.map((s) => s.text).join(""))
  assert.ok(!text.some((t: string) => t.includes("**Volume") || t.includes("`src")))
  const bullet = rows[2]
  assert.equal(text[2].startsWith("• Volume:"), true)
  assert.ok(bullet.some((s: { text: string; bold?: boolean }) => s.text === "Volume:" && s.bold))
  assert.ok(rows.flat().some((s: { text: string; tone: string }) => s.text === "src/chime.js" && s.tone === "cyan"))
  // The bullet's continuation hangs under its text, not under the dot.
  assert.ok(text[3].startsWith("  ") && !text[3].startsWith("   "))
  assert.ok(text.includes("1. first"))
  // Inside a fence nothing is interpreted.
  assert.ok(text.includes("  const x = **not bold**"))
  assert.ok(text.includes("a lone ** stays"))
  for (const t of text.filter((t: string) => !t.startsWith("  const"))) assert.ok(textWidth(t) <= 40, t)
})
