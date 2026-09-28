import { readFileSync, statSync } from "node:fs"
import path from "node:path"

/**
 * How to start an agent's CLI on this machine.
 *
 * Everywhere but Windows that is the name and its arguments, as they are.
 *
 * On Windows, a CLI installed with npm is not an executable but a `.cmd` shim
 * — `codex.cmd`, `opencode.cmd` — and `spawn` without a shell looks only for
 * `codex.exe`. So every npm-installed agent read "not installed" there, while
 * it ran fine from the same person's terminal. A shell would find it, but a
 * prompt is an argument, and cmd.exe cannot carry a newline in one: the note's
 * body would be cut at its first line. So the shim is read instead, and the
 * script it points at is run with this Node, exactly as the shim would. Only a
 * shim that cannot be read that way goes through cmd.exe, quoted for it.
 */
export type Command = {
  command: string
  args: string[]
  /** cmd.exe gets its command line exactly as quoted here. */
  windowsVerbatimArguments?: boolean
}

type Env = Record<string, string | undefined>

export function resolveCommand(
  bin: string,
  args: readonly string[],
  opts: { platform?: NodeJS.Platform; env?: Env } = {},
): Command {
  const platform = opts.platform ?? process.platform
  if (platform !== "win32") return { command: bin, args: [...args] }
  const env = opts.env ?? process.env

  const found = findOnPath(bin, env)
  // Not there at all: let spawn say ENOENT, which the runner turns into
  // "isn't installed on this machine".
  if (!found) return { command: bin, args: [...args] }
  if (!/\.(cmd|bat)$/i.test(found)) return { command: found, args: [...args] }

  const script = shimTarget(found)
  if (script) return { command: process.execPath, args: [script, ...args] }

  return {
    command: env["ComSpec"] ?? env["COMSPEC"] ?? "cmd.exe",
    args: ["/d", "/s", "/c", `"${[quoteCmd(found), ...args.map((a) => quoteCmdArg(a))].join(" ")}"`],
    windowsVerbatimArguments: true,
  }
}

/** Where `bin` is on PATH, trying each PATHEXT extension the way cmd.exe does. */
export function findOnPath(bin: string, env: Env): string | null {
  const exts = (env["PATHEXT"] ?? env["Pathext"] ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
  // Already has one of them, or is a path: try it as given first.
  // Windows matches names without case; the lower-case spelling is tried too so
  // the lookup means the same on a filesystem that doesn't (Linux CI, WSL).
  const names = exts.some((e) => bin.toLowerCase().endsWith(e.toLowerCase()))
    ? [bin]
    : [...new Set(exts.flatMap((e) => [bin + e.toLowerCase(), bin + e]))]
  const dirs = /[\\/]/.test(bin) ? [""] : (env["PATH"] ?? env["Path"] ?? "").split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    for (const name of names) {
      const full = dir ? path.join(dir, name) : name
      try {
        if (statSync(full).isFile()) return full
      } catch {
        // Not here; next.
      }
    }
  }
  return null
}

/**
 * The script an npm or pnpm `.cmd` shim runs, or null if it isn't one.
 *
 * Both end in a line like
 *   "%_prog%"  "%dp0%\node_modules\@openai\codex\bin\codex.js" %*
 * where %dp0% (or %~dp0) is the shim's own directory.
 */
export function shimTarget(shim: string): string | null {
  let text: string
  try {
    text = readFileSync(shim, "utf8")
  } catch {
    return null
  }
  const m = /"%~?dp0%?\\?([^"]+?\.[cm]?js)"\s+%\*/i.exec(text)
  if (!m) return null
  return path.join(path.dirname(shim), ...m[1]!.split(/[\\/]/).filter(Boolean))
}

// cmd.exe's own metacharacters, escaped with ^ — the rules cross-spawn uses.
const META = /([()\][%!^"`<>&|;, *?])/g

function quoteCmd(s: string): string {
  return s.replace(META, "^$1")
}

function quoteCmdArg(arg: string): string {
  // Backslashes before a quote are doubled, the quote escaped, and the whole
  // thing wrapped — then every metacharacter is escaped for cmd itself.
  const q = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`
  return q.replace(META, "^$1")
}
