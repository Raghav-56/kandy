import { createReadStream, existsSync, readFileSync, statSync } from "node:fs"
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

/**
 * Where the board is, installed or in the repo.
 *
 * Two places, and the order matters. `dist/web` is inside the published
 * package, put there at build time; `../../web/dist` is the sibling workspace,
 * which only exists in this repository.
 *
 * Only the second used to be checked, so the packed tarball carried 153 files
 * and not one of them was the board. `kandy serve` would have started, printed
 * its banner, and served nothing at all to the first person who installed it —
 * a failure invisible here, because in the repo that path happens to resolve.
 */
const STAGED = path.resolve(HERE, "web")
const SIBLING = path.resolve(HERE, "../../web/dist")

/*
 * In this repository the sibling is the truth and goes first.
 *
 * The staged copy is a snapshot taken at the last *server* build. Rebuilding
 * only the web app left the daemon serving that snapshot — a stale board that
 * looked exactly like a fix not working, which is how this was found.
 *
 * But the sibling is only trusted when it is really @kandy/web. Installed, the
 * same relative path lands in `node_modules/web/dist`, and a stranger's package
 * called `web` is not our board.
 */
function isOurWeb(): boolean {
  try {
    const pkg = JSON.parse(readFileSync(path.resolve(SIBLING, "../package.json"), "utf8")) as { name?: string }
    return pkg.name === "@kandy/web"
  } catch {
    return false
  }
}

export const WEB_ROOTS = isOurWeb() ? [SIBLING, STAGED] : [STAGED]

/**
 * Looked up each time rather than frozen at import.
 *
 * In the repo the board is often built *after* the daemon starts, and a
 * constant resolved at module load would keep saying "board not built" until
 * someone restarted a daemon that was working fine.
 */
export function webRoot(): string {
  return WEB_ROOTS.find((dir) => existsSync(path.join(dir, "index.html"))) ?? WEB_ROOTS[0]!
}

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
  return existsSync(path.join(webRoot(), "index.html"))
}

/**
 * Whether this path is a real file in the build, rather than the fallback.
 *
 * The gate in `http.ts` needs to answer "may an unauthenticated stranger have
 * this?" before any routing happens, and the answer for the bundle is yes —
 * it is a public build artifact, and the UI it loads is what then
 * authenticates. `serveStatic` cannot be asked, because it answers yes to
 * everything by design: its index.html fallback exists so client-side routes
 * work, and using it here would reopen every API path it has never heard of.
 *
 * So: the entry point, and files that actually exist. A deep link into a
 * client-side route is deliberately not included — it would have to be
 * indistinguishable from `/boards`, which is the thing being protected.
 */
export function isBundleAsset(pathname: string): boolean {
  if (!hasWebBuild()) return false
  if (pathname === "/" || pathname === "/index.html") return true

  const root = webRoot()
  const file = path.join(root, pathname.replace(/^\/+/, ""))
  if (!file.startsWith(root + path.sep)) return false
  return existsSync(file) && statSync(file).isFile()
}

/**
 * Serve `pathname` from the build, falling back to index.html so client-side
 * routes work. Returns false when there is no build to serve at all.
 */
export function serveStatic(pathname: string, res: ServerResponse): boolean {
  if (!hasWebBuild()) return false

  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "")
  const root = webRoot()
  let file = path.join(root, rel)

  // Never let a crafted path escape the build directory.
  if (!file.startsWith(root + path.sep) && file !== path.join(root, "index.html")) {
    file = path.join(root, "index.html")
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    file = path.join(root, "index.html")
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
