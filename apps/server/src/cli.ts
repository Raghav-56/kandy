import { Store } from "./store.js"
import { Bus } from "./bus.js"
import { Runner } from "./runner.js"
import { createHttpServer } from "./http.js"
import { listBoards, projectBoard } from "./projection.js"
import { DB_PATH } from "./paths.js"

const DEFAULT_PORT = 4477

function main(): void {
  const args = process.argv.slice(2)
  const cmd = args[0] ?? "serve"

  if (cmd !== "serve") {
    console.error(`usage: kandy serve [--port N]\n\nunknown command: ${cmd}`)
    process.exit(1)
  }

  const portArg = args.indexOf("--port")
  const port = portArg === -1 ? DEFAULT_PORT : Number(args[portArg + 1])

  const store = new Store()
  const bus = new Bus()
  const runner = new Runner(store, bus, (boardId) => projectBoard(store, boardId))

  // A daemon that died mid-run leaves notes claiming to be running. They
  // aren't. Fail them loudly rather than showing a board that lies.
  for (const b of listBoards(store)) {
    const view = projectBoard(store, b.id)
    if (view) runner.reconcile(view)
  }

  const server = createHttpServer({ store, bus, runner })
  server.listen(port, "127.0.0.1", () => {
    console.log(`kandy server  http://127.0.0.1:${port}`)
    console.log(`state         ${DB_PATH}`)
  })

  const shutdown = () => {
    console.log("\nshutting down…")
    runner.shutdown()
    server.close()
    store.close()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

main()
