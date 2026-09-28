export type FileDiff = {
  path: string
  lines: string[]
  added: number
  removed: number
}

/**
 * `git diff` output, one entry per file.
 *
 * Headers only count as headers before a file's first `@@`. After it every
 * line is content, and content can look like anything: a markdown file that
 * gains the line `++ note` shows as `+++ note`, and dropping it as a header
 * both hid the line and undercounted the change.
 *
 * The path comes from the `+++`/`---` lines, which name one file each, rather
 * than from `diff --git a/x b/x`, where a path containing ` b/` is ambiguous —
 * `docs/a b/file.txt` split on ` b/` came out as `file.txt`.
 */
export function splitFiles(diff: string): FileDiff[] {
  const files: FileDiff[] = []
  let current: (FileDiff & { inHunks: boolean; from: string | null; to: string | null }) | null =
    null

  const finish = () => {
    if (!current) return
    const { inHunks: _h, from, to, ...file } = current
    file.path = to ?? from ?? file.path
    files.push(file)
  }

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      finish()
      current = {
        path: gitLinePath(line.slice("diff --git ".length)),
        lines: [],
        added: 0,
        removed: 0,
        inHunks: false,
        from: null,
        to: null,
      }
      continue
    }
    if (!current) continue

    if (!current.inHunks) {
      if (line.startsWith("@@")) {
        current.inHunks = true
      } else {
        // Headers are noise once the filename is its own row — but they are
        // where the filename is.
        if (line.startsWith("+++ ")) current.to = sidePath(line.slice(4), "b/")
        else if (line.startsWith("--- ")) current.from = sidePath(line.slice(4), "a/")
        else if (line.startsWith("rename to ")) current.to = unquote(line.slice(10))
        else if (line.startsWith("rename from ")) current.from ??= unquote(line.slice(12))
        continue
      }
    }

    current.lines.push(line)
    if (line.startsWith("+")) current.added++
    else if (line.startsWith("-")) current.removed++
  }
  finish()
  return files
}

/** `a/x` or `b/x` from a `---`/`+++` line; null for `/dev/null`. */
function sidePath(raw: string, prefix: string): string | null {
  // Git ends the name with a tab when it contains a space, for GNU patch.
  const name = unquote(raw.replace(/\t$/, ""))
  if (name === "/dev/null") return null
  return name.startsWith(prefix) ? name.slice(prefix.length) : name
}

/**
 * The b-side of `a/x b/x`, for a file with no `---`/`+++` (a mode change, an
 * empty file, a binary). Unrenamed, both halves are the same path, which is
 * the only way to split one that contains ` b/` itself.
 */
function gitLinePath(rest: string): string {
  if (rest.startsWith('"')) {
    const parts = rest.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? []
    const b = parts[1] ?? parts[0] ?? rest
    return strip(unquote(b), "b/")
  }
  const n = (rest.length - 5) / 2
  if (Number.isInteger(n) && n > 0 && rest.startsWith("a/")) {
    const a = rest.slice(2, 2 + n)
    if (rest.slice(2 + n) === ` b/${a}`) return a
  }
  const at = rest.lastIndexOf(" b/")
  return at === -1 ? rest : unquote(rest.slice(at + 3))
}

function strip(s: string, prefix: string): string {
  return s.startsWith(prefix) ? s.slice(prefix.length) : s
}

/**
 * Git's C-style quoting, undone: `"caf\303\251.txt"` is `café.txt`.
 * A name is quoted when it has a quote, a backslash, a control character or —
 * with the default `core.quotePath` — anything outside ASCII.
 */
export function unquote(s: string): string {
  if (!(s.length >= 2 && s.startsWith('"') && s.endsWith('"'))) return s
  const simple: Record<string, number> = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11 }
  const bytes: number[] = []
  const enc = new TextEncoder()
  for (const [, esc, text] of s.slice(1, -1).matchAll(/\\([0-7]{3}|[\s\S])|([^\\]+)/g)) {
    if (text !== undefined) bytes.push(...enc.encode(text))
    else if (/^[0-7]{3}$/.test(esc!)) bytes.push(parseInt(esc!, 8))
    else bytes.push(simple[esc!] ?? esc!.charCodeAt(0))
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}
