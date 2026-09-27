#!/usr/bin/env node
/**
 * Refresh the numbers the home page quotes.
 *
 * The hero claims kandy built kandy, and backs it with four figures. Typing
 * those by hand means the page is honest exactly once and stale forever after,
 * so they come from `kandy stats --json`, run against this repository's own
 * board.
 *
 * The result is committed rather than fetched at build time: the docs must
 * build on a machine with no daemon, and a build that silently falls back to
 * zeroes would be worse than one that uses last week's real numbers. Run this
 * when the numbers deserve refreshing; the page says when they were taken.
 */
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, "../../..")
const cli = path.join(repo, "apps/server/dist/cli.js")
const out = path.join(here, "../data/stats.json")

// KANDY_LOCAL: this repository's own board, on this machine — never a team
// hub the machine happens to have joined.
const raw = execFileSync("node", [cli, "stats", "--json"], {
  cwd: repo,
  encoding: "utf8",
  env: { ...process.env, KANDY_LOCAL: "1" },
})
const s = JSON.parse(raw)
if (!s.board) {
  console.error("No board for this repo — start the daemon and run a note first.")
  process.exit(1)
}

const round = (n) => Math.round(n * 100) / 100
writeFileSync(
  out,
  JSON.stringify(
    {
      landed: s.notes.landed,
      runs: s.runs.total,
      insertions: s.code.insertions,
      usd: round(s.spend.usd),
      estimated: s.spend.estimated,
      takenAt: s.generatedAt,
    },
    null,
    2,
  ) + "\n",
)
console.log(`wrote ${path.relative(repo, out)}`)
