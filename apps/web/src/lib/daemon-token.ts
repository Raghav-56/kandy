/** Kept in memory; never stored in URLs or browser storage. */
export async function daemonToken(): Promise<string> {
  const res = await fetch("/api/auth/token", {
    headers: { "X-Kandy-Client": "web" },
    cache: "no-store",
  })
  if (!res.ok) throw new Error("Could not authenticate with the daemon")
  return ((await res.json()) as { token: string }).token
}
