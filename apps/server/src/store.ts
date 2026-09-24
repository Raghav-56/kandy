import { DatabaseSync } from "node:sqlite"
import type { ActorId, KandyEvent, PendingEvent, TranscriptFrame, TranscriptRole } from "@kandy/core"
import { DB_PATH } from "./paths.js"

type Row = { seq: number; ts: number; type: string; data: string; actor: string | null }

/**
 * A row back into an event.
 *
 * Shared by both readers because they had drifted into two copies of the same
 * five lines, and a column added to one of them is a column missing from the
 * other.
 */
function hydrate(r: Row): KandyEvent {
  return { seq: r.seq, ts: r.ts, type: r.type, data: JSON.parse(r.data), actor: r.actor } as KandyEvent
}

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
        data  TEXT    NOT NULL,
        actor TEXT
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

      -- SPIKE (docs/12-spike-git-share.md). Provenance for events that came
      -- from another device. The local seq stays local and single-writer; this
      -- records which foreign (origin, oseq) it was, which is what makes a
      -- second fold of the same file a no-op instead of a duplicate board.
      CREATE TABLE IF NOT EXISTS shared (
        origin TEXT    NOT NULL,
        oseq   INTEGER NOT NULL,
        seq    INTEGER NOT NULL,
        PRIMARY KEY (origin, oseq)
      );
      CREATE INDEX IF NOT EXISTS shared_seq ON shared(seq);
    `)

    // `CREATE TABLE IF NOT EXISTS` does nothing to a table that already
    // exists, so a column added after someone has been using kandy has to be
    // asked for separately. Every event already in the log stays unattributed,
    // which is honest: nobody recorded who, and inventing an answer now would
    // be worse than the null.
    this.addColumn("events", "actor", "TEXT")
  }

  /** Add a column unless it is already there. Idempotent, like the DDL above. */
  private addColumn(table: string, column: string, type: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    if (cols.some((c) => c.name === column)) return
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }

  append(pending: PendingEvent, ts: number = Date.now(), actor: ActorId | null = null): KandyEvent {
    const row = this.db
      .prepare("INSERT INTO events (ts, type, data, actor) VALUES (?, ?, ?, ?) RETURNING seq")
      .get(ts, pending.type, JSON.stringify(pending.data), actor) as { seq: number }
    return { ...pending, seq: row.seq, ts, actor } as KandyEvent
  }

  /**
   * Append an event that originated on another device, preserving its origin
   * timestamp so the board shows when the teammate did the thing, not when we
   * happened to pull it.
   *
   * Returns null if this (origin, oseq) was already folded in — pulling twice,
   * or pulling a file that overlaps what we already have, must be free.
   */
  appendShared(
    pending: PendingEvent,
    origin: string,
    oseq: number,
    ts: number,
    actor: ActorId | null = null,
  ): KandyEvent | null {
    if (this.isShared(origin, oseq)) return null
    // The teammate who did the thing, not whoever pulled it — the same reason
    // the origin timestamp is preserved a few lines above.
    const e = this.append(pending, ts, actor)
    this.db.prepare("INSERT INTO shared (origin, oseq, seq) VALUES (?, ?, ?)").run(origin, oseq, e.seq)
    return e
  }

  isShared(origin: string, oseq: number): boolean {
    return (
      this.db.prepare("SELECT 1 FROM shared WHERE origin = ? AND oseq = ?").get(origin, oseq) !==
      undefined
    )
  }

  /**
   * Events this device authored, in order.
   *
   * Anything in `shared` is excluded: it reached us from its author's own file
   * on the branch, and re-publishing it under our device id would give it a
   * second identity and defeat the dedupe for whoever pulls from both of us.
   */
  locallyAuthored(after = 0, limit = 100_000): KandyEvent[] {
    const rows = this.db
      .prepare(
        `SELECT e.seq, e.ts, e.type, e.data, e.actor FROM events e
         LEFT JOIN shared s ON s.seq = e.seq
         WHERE e.seq > ? AND s.seq IS NULL ORDER BY e.seq LIMIT ?`,
      )
      .all(after, limit) as Row[]
    return rows.map(hydrate)
  }

  /** Events strictly after `seq`. The basis of both projection and SSE replay. */
  since(seq: number, limit = 10_000): KandyEvent[] {
    const rows = this.db
      .prepare("SELECT seq, ts, type, data, actor FROM events WHERE seq > ? ORDER BY seq LIMIT ?")
      .all(seq, limit) as Row[]
    return rows.map(hydrate)
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

  /**
   * What the agent said last, for a PR body.
   *
   * The closing message of a run is the agent's own account of what it did —
   * written for a person, because the last turn always is. It is the one piece
   * of context a reviewer wants and the only place kandy had it was a
   * transcript nobody reads after the fact.
   */
  lastSaid(runId: string): string | null {
    const row = this.db
      .prepare(
        "SELECT text FROM transcript WHERE run_id = ? AND role = 'assistant' ORDER BY seq DESC LIMIT 1",
      )
      .get(runId) as { text?: string } | undefined
    const text = row?.text?.trim()
    return text ? text : null
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
