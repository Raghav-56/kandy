import { DatabaseSync } from "node:sqlite"
import type { KandyEvent, PendingEvent, TranscriptFrame, TranscriptRole } from "@kandy/core"
import { DB_PATH } from "./paths.js"

/**
 * Append-only event log. Single writer (this process), so a monotonic integer
 * sequence is sufficient ordering — no vector clocks, no conflict resolution.
 *
 * Agent output is deliberately in its own table. It is orders of magnitude
 * higher volume than domain events, and mixing them would make board replay
 * proportional to how chatty the agents were. See docs/02-data-model.md.
 */
export class Store {
  private db: DatabaseSync

  constructor(file: string = DB_PATH) {
    this.db = new DatabaseSync(file)
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA foreign_keys = ON")
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        seq   INTEGER PRIMARY KEY AUTOINCREMENT,
        ts    INTEGER NOT NULL,
        type  TEXT    NOT NULL,
        data  TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_type ON events(type);

      CREATE TABLE IF NOT EXISTS transcript (
        run_id TEXT    NOT NULL,
        seq    INTEGER NOT NULL,
        ts     INTEGER NOT NULL,
        role   TEXT    NOT NULL,
        text   TEXT    NOT NULL,
        meta   TEXT,
        PRIMARY KEY (run_id, seq)
      );

      CREATE TABLE IF NOT EXISTS diffs (
        note_id TEXT    PRIMARY KEY,
        run_id  TEXT    NOT NULL,
        ts      INTEGER NOT NULL,
        branch  TEXT    NOT NULL,
        stat    TEXT    NOT NULL,
        diff    TEXT    NOT NULL
      );

      CREATE TABLE IF NOT EXISTS output (
        run_id  TEXT    NOT NULL,
        seq     INTEGER NOT NULL,
        ts      INTEGER NOT NULL,
        channel TEXT    NOT NULL,
        text    TEXT    NOT NULL,
        PRIMARY KEY (run_id, seq)
      );
    `)
  }

  append(pending: PendingEvent): KandyEvent {
    const ts = Date.now()
    const row = this.db
      .prepare("INSERT INTO events (ts, type, data) VALUES (?, ?, ?) RETURNING seq")
      .get(ts, pending.type, JSON.stringify(pending.data)) as { seq: number }
    return { ...pending, seq: row.seq, ts } as KandyEvent
  }

  /** Events strictly after `seq`. The basis of both projection and SSE replay. */
  since(seq: number, limit = 10_000): KandyEvent[] {
    const rows = this.db
      .prepare("SELECT seq, ts, type, data FROM events WHERE seq > ? ORDER BY seq LIMIT ?")
      .all(seq, limit) as { seq: number; ts: number; type: string; data: string }[]
    return rows.map((r) => ({
      seq: r.seq,
      ts: r.ts,
      type: r.type,
      data: JSON.parse(r.data),
    })) as KandyEvent[]
  }

  head(): number {
    const row = this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM events").get() as {
      seq: number
    }
    return row.seq
  }

  /**
   * Append a transcript frame. Sequence is per-run and dense, so a client can
   * ask for "everything after 42" for one note without scanning the log.
   */
  appendTranscript(
    runId: string,
    role: TranscriptRole,
    text: string,
    meta?: string,
  ): TranscriptFrame {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM transcript WHERE run_id = ?")
      .get(runId) as { next: number }
    const ts = Date.now()
    this.db
      .prepare("INSERT INTO transcript (run_id, seq, ts, role, text, meta) VALUES (?, ?, ?, ?, ?, ?)")
      .run(runId, row.next, ts, role, text, meta ?? null)
    return {
      kind: "transcript",
      runId,
      seq: row.next,
      ts,
      role,
      text,
      ...(meta ? { meta } : {}),
    }
  }

  transcriptSince(runId: string, after = 0, limit = 1000): TranscriptFrame[] {
    const rows = this.db
      .prepare(
        "SELECT seq, ts, role, text, meta FROM transcript WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?",
      )
      .all(runId, after, limit) as {
      seq: number
      ts: number
      role: TranscriptRole
      text: string
      meta: string | null
    }[]
    return rows.map((r) => ({
      kind: "transcript" as const,
      runId,
      seq: r.seq,
      ts: r.ts,
      role: r.role,
      text: r.text,
      ...(r.meta ? { meta: r.meta } : {}),
    }))
  }

  /**
   * Snapshot the review diff for a note.
   *
   * The worktree is deleted the moment a review is decided, and a branch can
   * be deleted too — so the only moment the diff is guaranteed to exist is
   * when review opens. It lives in its own table for the same reason output
   * does: a full unified diff is far too big to replay through the event log.
   *
   * One row per note; a follow-up run that reopens review replaces it.
   */
  saveDiff(
    noteId: string,
    snapshot: { runId: string; branch: string; stat: string; diff: string },
  ): void {
    this.db
      .prepare(
        `INSERT INTO diffs (note_id, run_id, ts, branch, stat, diff) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(note_id) DO UPDATE SET
           run_id = excluded.run_id,
           ts     = excluded.ts,
           branch = excluded.branch,
           stat   = excluded.stat,
           diff   = excluded.diff`,
      )
      .run(noteId, snapshot.runId, Date.now(), snapshot.branch, snapshot.stat, snapshot.diff)
  }

  savedDiff(noteId: string) {
    return (
      (this.db
        .prepare("SELECT run_id, ts, branch, stat, diff FROM diffs WHERE note_id = ?")
        .get(noteId) as
        | { run_id: string; ts: number; branch: string; stat: string; diff: string }
        | undefined) ?? null
    )
  }

  appendOutput(runId: string, channel: "stdout" | "stderr", text: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM output WHERE run_id = ?")
      .get(runId) as { next: number }
    this.db
      .prepare("INSERT INTO output (run_id, seq, ts, channel, text) VALUES (?, ?, ?, ?, ?)")
      .run(runId, row.next, Date.now(), channel, text)
    return row.next
  }

  outputSince(runId: string, after = 0, limit = 500) {
    return this.db
      .prepare(
        "SELECT seq, ts, channel, text FROM output WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?",
      )
      .all(runId, after, limit) as {
      seq: number
      ts: number
      channel: "stdout" | "stderr"
      text: string
    }[]
  }

  /**
   * How often each tool was called across a set of runs.
   *
   * Grouped in SQL: the transcript is the high-volume table, and pulling every
   * frame into memory to count them would make a stats command cost more than
   * the work it describes.
   */
  toolCounts(runIds: string[], limit = 8): { tool: string; calls: number }[] {
    if (runIds.length === 0) return []
    const marks = runIds.map(() => "?").join(",")
    const rows = this.db
      .prepare(
        `SELECT meta AS tool, COUNT(*) AS calls FROM transcript
         WHERE role = 'tool' AND meta IS NOT NULL AND run_id IN (${marks})
         GROUP BY meta ORDER BY calls DESC LIMIT ?`,
      )
      .all(...runIds, limit) as { tool: string; calls: number }[]
    // node:sqlite hands back null-prototype rows, which surprise anything that
    // compares or spreads them. Callers get plain objects.
    return rows.map((r) => ({ tool: r.tool, calls: r.calls }))
  }

  close(): void {
    this.db.close()
  }
}
