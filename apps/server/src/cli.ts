import { Engine } from "./engine.js"
import { Runner } from "./runner.js"
import { createHttpServer } from "./http.js"
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
    console.error(`usage: kandy serve [--port N] [--slots N]\n\nunknown command: ${cmd}`)
    process.exit(1)
  }

  const port = intFlag(args, "--port", DEFAULT_PORT)
  const slots = intFlag(args, "--slots", DEFAULT_SLOTS)

  const engine = new Engine()
  const runner = new Runner(engine, slots)

  // A daemon that died mid-run leaves notes claiming to be running. They
  // aren't. Fail them loudly rather than showing a board that lies.
  for (const b of engine.projections.boards()) {
    const view = engine.view(b.id)
    if (view) runner.reconcile(view)
  }

  const server = createHttpServer({ engine, runner })
  server.listen(port, "127.0.0.1", () => {
    console.log(`kandy server  http://127.0.0.1:${port}`)
    console.log(`state         ${DB_PATH}`)
    console.log(`slots         ${slots}`)
  })

  const shutdown = () => {
    console.log("\nshutting down…")
    runner.shutdown()
    server.close()
    engine.close()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

main()
