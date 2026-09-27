#!/usr/bin/env node
/**
 * The `kandy` command. It checks Node before anything else loads.
 *
 * kandy keeps its board in Node's built-in SQLite, which arrived in Node 22.
 * On an older Node the import fails while modules are still loading — before
 * any of kandy runs — with `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`, which
 * says nothing about what to do. So this file imports nothing, checks first,
 * and only then loads the real entry point.
 */
const major = Number(process.versions.node.split(".")[0])
if (major < 22) {
  process.stderr.write(
    `\n  kandy needs Node 22 or newer — this is Node ${process.versions.node}.\n` +
      `  Install a newer Node (https://nodejs.org), then install kandy again.\n\n`,
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
