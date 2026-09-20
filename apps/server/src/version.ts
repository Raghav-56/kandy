import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * The version of the package that is actually running.
 *
 * Was a hardcoded "0.0.0" in the health endpoint — the one number whose entire
 * job is telling you which build someone is on. Read from package.json so it
 * cannot drift from what npm installed, and cached because it never changes
 * while the process lives.
 *
 * Unreadable stays "0.0.0" rather than throwing: nothing here is worth failing
 * a health check or a `--version` over.
 */
let cached: string | null = null

export function kandyVersion(): string {
  if (cached !== null) return cached
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(path.resolve(here, "../package.json"), "utf8")) as {
      version?: string
    }
    cached = pkg.version ?? "0.0.0"
  } catch {
    cached = "0.0.0"
  }
  return cached
}
