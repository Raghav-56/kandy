/**
 * Terminal client — status and attach, not a second full editor.
 *
 * Deliberately a placeholder. The TUI is a *secondary* client: it renders the
 * same projection from the same reducer over the same API as the web app, so
 * building it is a rendering problem, not an architecture problem. Doing it
 * now would halve iteration speed on the board, which is where the product is.
 *
 * Plan (see docs/08-roadmap.md, M3):
 *   - opentui + its React reconciler: `createRoot(renderer).render(<Board/>)`.
 *   - Columns as flex boxes, notes as bordered boxes, `useKeyboard()` for nav.
 *   - Ink is the boring fallback if opentui's pre-1.0 API fights us; nothing
 *     structural depends on the choice.
 *
 * Today it prints board state so the server can be smoke-tested without a
 * browser.
 */
import { KandyClient } from "@kandy/client"
import { notesIn } from "@kandy/core"

const BASE = process.env["KANDY_URL"] ?? "http://127.0.0.1:4477"

async function main(): Promise<void> {
  const client = new KandyClient({ baseUrl: BASE })

  const { boards } = await client.boards()
  if (boards.length === 0) {
    console.log("no boards yet")
    return
  }

  const board = boards[0]!
  const view = await client.view(board.id)

  console.log(`\n  ${board.name}  ${board.repoPath}\n`)
  for (const col of view.columns) {
    const notes = notesIn(view, col.id)
    if (notes.length === 0) continue
    console.log(`  ${col.name}`)
    for (const n of notes) {
      const agent = n.agent ? ` @${n.agent}` : ""
      console.log(`    [${n.status.padEnd(7)}] ${n.title}${agent}`)
    }
    console.log()
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
