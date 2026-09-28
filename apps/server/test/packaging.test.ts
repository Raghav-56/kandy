import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { literalSecrets } from "../dist/cli/capabilities.js"

const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url))
const PATHS = fileURLToPath(new URL("../dist/paths.js", import.meta.url))

function kandy(args: string[]): string {
  return execFileSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", KANDY_NO_SETUP: "1", XDG_STATE_HOME: mkdtempSync(path.join(tmpdir(), "kandy-help-")) },
  })
}

test("an empty XDG variable is unset, not the current directory", () => {
  const home = mkdtempSync(path.join(tmpdir(), "kandy-home-"))
  const cwd = mkdtempSync(path.join(tmpdir(), "kandy-cwd-"))
  const printed = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", `const p = await import(${JSON.stringify(PATHS)}); console.log(JSON.stringify([p.STATE_DIR, p.DATA_DIR, p.CONFIG_DIR]))`],
    { cwd, encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home, XDG_STATE_HOME: "", XDG_DATA_HOME: "relative/dir", XDG_CONFIG_HOME: "" } },
  )
  const [state, data, config] = JSON.parse(printed) as string[]
  assert.equal(state, path.join(home, ".local/state", "kandy"))
  assert.equal(data, path.join(home, ".local/share", "kandy"))
  assert.equal(config, path.join(home, ".config", "kandy"))
})

test("a literal secret in --env is flagged the way a header is", () => {
  assert.deepEqual(literalSecrets([], ["GITHUB_TOKEN=ghp_abc123"]), ["GITHUB_TOKEN"])
  assert.deepEqual(literalSecrets(["Authorization: Bearer abc"], []), ["Authorization"])
  assert.deepEqual(literalSecrets(["X-Custom: Bearer abc"], []), ["X-Custom"])
  // Written as ${NAME}, it's read on each machine and never stored.
  assert.deepEqual(literalSecrets(["Authorization: Bearer ${API_KEY}"], ["GITHUB_TOKEN=${GITHUB_TOKEN}"]), [])
  // Not secrets.
  assert.deepEqual(literalSecrets(["Accept: application/json"], ["LOG_LEVEL=debug"]), [])
})

test("skill, list, board and tui have their own help, and kandy -h lists skill", () => {
  assert.match(kandy(["skill", "--help"]), /kandy skill\n[\s\S]*~\/\.claude\/skills\/kandy/)
  assert.match(kandy(["list", "--help"]), /kandy list \[--all\]/)
  assert.match(kandy(["board", "--help"]), /kandy board/)
  assert.match(kandy(["tui", "-h"]), /kandy tui/)
  assert.match(kandy(["-h"]), /kandy skill\s/)
})

test("kandy help flags lists every flag the CLI accepts", () => {
  const flags = kandy(["help", "flags"])
  for (const f of ["--hub", "--repo", "--token", "--bind", "--https-port", "--tailscale", "--role", "--url", "--header", "--env", "--skill", "--check", "--force", "--slots", "--port", "--json"]) {
    assert.ok(flags.includes(f), `${f} missing from kandy help flags`)
  }
})
