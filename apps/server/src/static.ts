import { createReadStream, existsSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { ServerResponse } from "node:http"

/**
 * Serves the built web client.
 *
 * `kandy serve` should give you the board, not a daemon plus instructions for
 * starting a second process. A dev server also costs orders of magnitude more
 * memory than handing over a 300kB bundle — enough that the OS reclaimed ours
 * twice under pressure while the daemon itself sat at 21MB.
 *
 * `pnpm --filter @kandy/web dev` still exists for working *on* the UI; this is
 * for using it.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url))

/** dist/ of @kandy/web, resolved from the server's own build output. */
export const WEB_ROOT = path.resolve(HERE, "../../web/dist")

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
}

export function hasWebBuild(): boolean {
  return existsSync(path.join(WEB_ROOT, "index.html"))
}

/**
 * Serve `pathname` from the build, falling back to index.html so client-side
 * routes work. Returns false when there is no build to serve at all.
 */
export function serveStatic(pathname: string, res: ServerResponse): boolean {
  if (!hasWebBuild()) return false

  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "")
  let file = path.join(WEB_ROOT, rel)

  // Never let a crafted path escape the build directory.
  if (!file.startsWith(WEB_ROOT + path.sep) && file !== path.join(WEB_ROOT, "index.html")) {
    file = path.join(WEB_ROOT, "index.html")
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    file = path.join(WEB_ROOT, "index.html")
  }

  const ext = path.extname(file)
  res.writeHead(200, {
    "content-type": TYPES[ext] ?? "application/octet-stream",
    // Vite fingerprints asset filenames, so they are safe to cache hard.
    // index.html must not be, or a redeploy is invisible.
    "cache-control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  })
  createReadStream(file).pipe(res)
  return true
}
