import type { IncomingMessage } from "node:http"
import { isLoopback } from "./http.js"

/**
 * Who someone is, as far as the hub is concerned.
 *
 * `id` is the stable handle written into an event's `actor`. For Tailscale it
 * is the login, because that is what the tailnet guarantees is unique and
 * what an admin would recognise in an audit line.
 */
export type Person = {
  id: string
  email: string
  name: string
  avatar?: string
}

/**
 * How the hub learns who is calling.
 *
 * One interface, one implementation, deliberately. The expensive part of
 * pluggable identity was never the interface — it is writing a second
 * provider — and an interface with a single implementation costs an afternoon
 * where retrofitting one through every call site later costs a refactor.
 *
 * **`null` means refuse, never "assume it is fine".** That is the whole
 * contract, and it is the opposite of the natural reading. See below.
 */
export interface Identity {
  /** A name for diagnostics and for saying, in an error, what was expected. */
  readonly kind: string
  identify(req: IncomingMessage): Person | null
}

/**
 * Identity from Tailscale Serve's headers.
 *
 * Serve injects `Tailscale-User-Login`, `-Name` and `-Profile-Pic` describing
 * the tailnet user behind a request, which is why this needs no login screen,
 * no session table and no password reset: the tailnet already did it, and
 * node sharing extends it to people outside the tailnet who accepted a share.
 *
 * ## Two ways this goes wrong, both handled here
 *
 * **A header anyone can set.** These are ordinary HTTP headers. Anything that
 * can open a socket to the hub can claim to be anyone, so they are trusted
 * only from a loopback peer — `tailscaled` proxies to its backend from the
 * backend's own machine, so a request that really came through Serve always
 * arrives that way, and one that did not, never does. This holds only while
 * the hub binds loopback, which is the deployment Serve implies and which
 * `kandy hub --tailscale` sets up. A hub bound to a public interface must not
 * use this provider, and says so rather than quietly trusting a header.
 *
 * **A device with no user behind it.** Tailscale populates these headers for
 * users and *not for tagged devices*, so a CI box or a shared server on the
 * tailnet arrives with no header at all — looking, from here, exactly like
 * localhost. Returning "trusted" for that is the bug that has been reported
 * against other projects doing this, and it is the same shape as the proxy
 * hole fixed in `http.ts`. So: no header, no person, and the caller refuses.
 *
 * That second rule also happens to be the product's rule. A tagged node is a
 * machine with no owner, and kandy's whole position is that work runs on a
 * person's own machine under their own logins.
 */
export function tailscaleIdentity(): Identity {
  return {
    kind: "tailscale",
    identify(req) {
      if (!isLoopback(req.socket.remoteAddress)) return null

      const login = header(req, "tailscale-user-login")
      if (!login) return null

      return {
        id: login,
        email: login,
        name: header(req, "tailscale-user-name") ?? login,
        ...(header(req, "tailscale-user-profile-pic")
          ? { avatar: header(req, "tailscale-user-profile-pic")! }
          : {}),
      }
    },
  }
}

/**
 * A single header value, or nothing.
 *
 * Node hands back an array when a header arrives more than once. A repeated
 * identity header is not a request to reconcile — it is someone trying to sit
 * beside a real one — so it is rejected rather than resolved to the first.
 */
function header(req: IncomingMessage, name: string): string | null {
  const v = req.headers[name]
  if (typeof v !== "string") return null
  const trimmed = v.trim()
  return trimmed === "" ? null : trimmed
}
