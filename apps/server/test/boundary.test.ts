import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

import { LocalWorkshop } from "../dist/local-workshop.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const dist = (f: string) => readFileSync(path.join(HERE, "..", "dist", f), "utf8")

/** Every module specifier a compiled file imports, static or dynamic. */
function imports(src: string): string[] {
  const found: string[] = []
  for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)) found.push(m[1]!)
  return found
}

/*
 * The other seam.
 *
 * `Log` keeps the runner from reaching into the hub; `Workshop` keeps the hub
 * from reaching into the runner. The API must be able to run on a machine
 * with no checkouts, no agent CLIs and nobody's credentials, so everything it
 * wants from those goes through the interface. These tests hold that line
 * structurally, the way `log.test.ts` holds the other one.
 */

test("the API reaches the repository machine through the workshop and nothing else", () => {
  // If this fails, a route is doing git, disk or process work inline again,
  // and a hub would either have to hold the repo or quietly break that route.
  // Each of these is a module whose whole job is the local machine.
  const forbidden = [
    "runner.js",
    "worktree.js",
    "attach.js",
    "gc.js",
    "browse.js",
    "forge.js",
    "pricing.js",
    "limits.js",
    "local-workshop.js",
    "capabilities/skills.js",
    "agents/",
    "node:child_process",
    "node:fs",
    "node:os",
  ]
  const specs = imports(dist("http.js"))
  assert.ok(specs.length > 0, "found no imports at all — the pattern is broken, not the file clean")
  for (const spec of specs) {
    for (const f of forbidden) {
      assert.equal(spec.includes(f), false, `http.js must not import ${spec}`)
    }
  }
})

test("the local workshop is the runner's calls, answered as plain data", async () => {
  // A remote workshop can only hand back JSON, so the local one must not
  // hand back anything richer — a `Worktree`, a live object — that the
  // routes could come to depend on without anyone noticing.
  const runner = {
    worktreeOf: () => undefined,
    cancel: (runId: string) => runId === "run_live",
  }
  const workshop = new LocalWorkshop(runner as never)

  assert.equal(await workshop.cancel("run_live"), true)
  assert.equal(await workshop.cancel("run_gone"), false)
  // No checkout means no live diff; the route falls back to the snapshot.
  assert.equal(await workshop.diff("note_1"), null)
  assert.deepEqual(
    await workshop.review("/nowhere", "note_1", { decision: "discard" }),
    { checkout: "none" },
  )
})
