import { DatabaseSync } from "node:sqlite"
import type { KandyEvent, PendingEvent } from "@kandy/core"
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

  close(): void {
    this.db.close()
  }
}
