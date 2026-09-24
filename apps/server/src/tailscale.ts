import { execFile } from "node:child_process"
import { promisify } from "node:util"

const run = promisify(execFile)

/**
 * The `tailscale` CLI, for a hub that is reached over a tailnet.
 *
 * Shelled out to rather than embedded, because there is nothing to embed:
 * `tsnet` is Go-only and has no Node binding. t3code reached the same answer
 * and uses exactly two subcommands; so does this.
 *
 * **stderr is never surfaced.** It can contain `tskey-…` auth keys, and every
 * message here goes to a terminal, a log, or a browser. A failure is reported
 * as what it means, not as what the CLI printed.
 */

export type TailnetSelf = {
  /** `laptop.tailnet-name.ts.net`, without the trailing dot Tailscale adds. */
  dnsName: string
  ips: string[]
}

export type TailscaleState =
  | { ok: true; self: TailnetSelf }
  | { ok: false; reason: "not-installed" | "stopped" | "logged-out" | "no-magicdns" | "unreadable" }

/** Whether this machine is on a tailnet, and what it is called there. */
export async function tailscaleStatus(): Promise<TailscaleState> {
  let stdout: string
  try {
    ;({ stdout } = await run("tailscale", ["status", "--json"], { timeout: 10_000 }))
  } catch (err) {
    return { ok: false, reason: (err as NodeJS.ErrnoException).code === "ENOENT" ? "not-installed" : "unreadable" }
  }
  let s: { BackendState?: string; Self?: { DNSName?: string; TailscaleIPs?: string[] | null } }
  try {
    s = JSON.parse(stdout)
  } catch {
    return { ok: false, reason: "unreadable" }
  }
  return parseStatus(s)
}

/** Split out so it can be tested against captured output without a tailnet. */
export function parseStatus(s: {
  BackendState?: string
  Self?: { DNSName?: string; TailscaleIPs?: string[] | null }
}): TailscaleState {
  if (s.BackendState === "NeedsLogin" || s.BackendState === "NoState") return { ok: false, reason: "logged-out" }
  if (s.BackendState !== "Running") return { ok: false, reason: "stopped" }
  const dnsName = (s.Self?.DNSName ?? "").replace(/\.$/, "")
  if (!dnsName) return { ok: false, reason: "no-magicdns" }
  return { ok: true, self: { dnsName, ips: s.Self?.TailscaleIPs ?? [] } }
}

/** What to tell a person for each way it is not ready. */
export function explain(reason: Extract<TailscaleState, { ok: false }>["reason"]): string {
  switch (reason) {
    case "not-installed":
      return "Tailscale is not installed — https://tailscale.com/download"
    case "stopped":
      return "Tailscale is installed but not running — open it, or run `tailscale up`"
    case "logged-out":
      return "Tailscale is not signed in — run `tailscale up`"
    case "no-magicdns":
      return "this tailnet has MagicDNS off, so the hub has no name to be reached by — turn it on in the admin console"
    case "unreadable":
      return "could not read `tailscale status`"
  }
}

/**
 * Put the hub on the tailnet: `tailscale serve --bg --https=<https> http://127.0.0.1:<port>`.
 *
 * Serve and not Funnel, deliberately. Serve is tailnet-only and carries the
 * caller's identity in `Tailscale-User-Login`; Funnel is the public internet
 * and carries nobody's. The hub's whole idea of who someone is comes from
 * that header, so a hub on Funnel would be a hub that trusts everyone.
 *
 * The backend is loopback. That is not incidental: the identity headers are
 * trusted only from a loopback peer (see `identity.ts`), which is only safe
 * because nothing but `tailscaled` can connect from there.
 */
export async function serve(port: number, https = 443): Promise<void> {
  try {
    await run("tailscale", ["serve", "--bg", `--https=${https}`, `http://127.0.0.1:${port}`], { timeout: 30_000 })
  } catch {
    throw new Error(
      `tailscale serve failed on port ${https} — HTTPS certificates may be off for this tailnet, or another service holds the port`,
    )
  }
}

/** Take the hub back off the tailnet. Best effort: a hub shutting down has nowhere to report failure. */
export async function unserve(https = 443): Promise<void> {
  await run("tailscale", ["serve", `--https=${https}`, "off"], { timeout: 10_000 }).catch(() => {})
}
