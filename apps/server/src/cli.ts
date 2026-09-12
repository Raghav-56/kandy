import { Store } from "./store.js"
import { Bus } from "./bus.js"
import { Runner } from "./runner.js"
import { createHttpServer } from "./http.js"
import { listBoards, projectBoard } from "./projection.js"
import { DB_PATH } from "./paths.js"

const DEFAULT_PORT = 4477
const DEFAULT_SLOTS = 4

/** Parse a `--flag N` positive integer, or exit with a message the user can act on. */
function intFlag(args: string[], flag: string, fallback: number): number {
  const i = args.indexOf(flag)
  if (i === -1) return fallback
  const raw = args[i + 1]
  const n = Number(raw)
  if (raw === undefined || !Number.isInteger(n) || n < 1) {
    console.error(`${flag} expects a positive integer, got: ${raw ?? "(nothing)"}`)
    process.exit(1)
  }
  return n
}

function main(): void {
  const args = process.argv.slice(2)
  const cmd = args[0] ?? "serve"

  if (cmd !== "serve") {
    console.error(`usage: kandy serve [--port N] [--slots N] [--json]\n\nunknown command: ${cmd}`)
    process.exit(1)
  }

  const port = intFlag(args, "--port", DEFAULT_PORT)
  const slots = intFlag(args, "--slots", DEFAULT_SLOTS)
  const json = args.includes("--json")

  const store = new Store()
  const bus = new Bus()
  const runner = new Runner(store, bus, (boardId) => projectBoard(store, boardId), slots)

  // A daemon that died mid-run leaves notes claiming to be running. They
  // aren't. Fail them loudly rather than showing a board that lies.
  for (const b of listBoards(store)) {
    const view = projectBoard(store, b.id)
    if (view) runner.reconcile(view)
  }

  const server = createHttpServer({ store, bus, runner })
  server.listen(port, "127.0.0.1", () => {
    if (json) {
      console.log(JSON.stringify({ port, dbPath: DB_PATH, slots }))
      return
    }
    console.log(`kandy server  http://127.0.0.1:${port}`)
    console.log(`state         ${DB_PATH}`)
    console.log(`slots         ${slots}`)
  })

  const shutdown = () => {
    if (json) console.error("\nshutting down…")
    else console.log("\nshutting down…")
    runner.shutdown()
    server.close()
    store.close()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

main()
