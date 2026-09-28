/**
 * Who already has the port, if anyone.
 *
 * Asked before anything is constructed, because starting a second daemon is
 * not merely noisy — the daemon's `reconcile` marks every run it finds in flight as
 * interrupted, and the two daemons share one database. The crash was the
 * harmless half of what used to happen.
 */
export async function portOwner(
  port: number,
): Promise<{ kandy: true; pid: number } | { kandy: false } | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1500),
    })
    // Something answered. A body that isn't JSON — another dev server's 404
    // page — is still somebody, and not kandy.
    const body = (await res.json().catch(() => ({}))) as { pid?: number }
    return typeof body.pid === "number" ? { kandy: true, pid: body.pid } : { kandy: false }
  } catch (err) {
    // Refused means nobody is listening. Anything else — a socket that accepts
    // and says something we cannot read — is somebody else's server.
    const cause = (err as { cause?: { code?: string } }).cause
    if (cause?.code === "ECONNREFUSED") return null
    if (err instanceof DOMException && err.name === "TimeoutError") return { kandy: false }
    return cause?.code ? { kandy: false } : null
  }
}
