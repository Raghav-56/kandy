#!/usr/bin/env node
/**
 * The `kandy` command. It checks Node before anything else loads.
 *
 * kandy keeps its board in Node's built-in SQLite, which works without a flag
 * from Node 22.13. On an older Node — 20, or 22.0 to 22.12 — the import fails
 * while modules are still loading, before any of kandy runs, with
 * `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`, which says nothing about what to
 * do. So this file imports nothing, checks first, and only then loads the
 * real entry point.
 */
const [major = 0, minor = 0] = process.versions.node.split(".").map(Number)
if (major < 22 || (major === 22 && minor < 13)) {
  process.stderr.write(
    `\n  kandy needs Node 22.13 or newer — this is Node ${process.versions.node}.\n` +
      `  Update Node (https://nodejs.org, or nvm install 22), then install kandy again with it.\n` +
      `  https://hiteshbandhu.github.io/kandy/guide/troubleshooting\n\n`,
  )
  process.exit(1)
}
/*
 * Node 22 prints "ExperimentalWarning: SQLite is an experimental feature" on
 * every run — above every command's output, for most people's Node. kandy has
 * chosen node:sqlite knowingly; that one warning is dropped and every other
 * warning still shows.
 */
const emitWarning = process.emitWarning.bind(process)
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === "string" ? warning : warning.message
  if (/SQLite is an experimental feature/.test(text)) return
  return (emitWarning as (...a: unknown[]) => void)(warning, ...rest)
}) as typeof process.emitWarning

await import("./cli.js")
