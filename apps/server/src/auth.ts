import { randomBytes, timingSafeEqual } from "node:crypto"
import { chmodSync, readFileSync, writeFileSync } from "node:fs"

/** Exclusive creation preserves the same credential across daemon starts. */
export function loadToken(file: string): string {
  try {
    writeFileSync(file, randomBytes(32).toString("hex") + "\n", { flag: "wx", mode: 0o600 })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
  }
  chmodSync(file, 0o600)
  return readToken(file)
}

export function readToken(file: string): string {
  const token = readFileSync(file, "utf8").trim()
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid daemon token file")
  return token
}

export function authorized(header: string | undefined, token: string): boolean {
  const supplied = Buffer.from(header ?? "")
  const expected = Buffer.from(`Bearer ${token}`)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}
