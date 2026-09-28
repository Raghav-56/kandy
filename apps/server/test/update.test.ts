import test from "node:test"
import assert from "node:assert/strict"

import { compareVersions, npmCommand, UPDATE_AVAILABLE, versionFromTagUrl } from "../dist/cli/update.js"

test("prereleases order by number, not by text", () => {
  assert.ok(compareVersions("0.2.0-alpha.10", "0.2.0-alpha.9") > 0)
  assert.ok(compareVersions("0.2.0-alpha.5", "0.2.0-alpha.7") < 0)
  assert.equal(compareVersions("0.2.0-alpha.5", "v0.2.0-alpha.5"), 0)
})

test("a release comes after its prereleases, and versions compare part by part", () => {
  assert.ok(compareVersions("0.2.0", "0.2.0-alpha.9") > 0)
  assert.ok(compareVersions("0.2.0-alpha.1", "0.2.0") < 0)
  assert.ok(compareVersions("0.10.0", "0.9.9") > 0)
  assert.ok(compareVersions("1.0.0-beta.1", "1.0.0-alpha.3") > 0)
})

test("the version is read from where releases/latest redirects", () => {
  assert.equal(versionFromTagUrl("https://github.com/hiteshbandhu/kandy/releases/tag/v0.2.0-alpha.7"), "0.2.0-alpha.7")
  assert.equal(versionFromTagUrl("https://github.com/hiteshbandhu/kandy/releases"), null)
  assert.equal(versionFromTagUrl(""), null)
})

test("update uses the npm beside the Node that runs it, not whichever is first on PATH", () => {
  const has = (want: string) => (p: string) => p === want
  const node = "/home/me/.nvm/versions/node/v22.13.0/bin/node"
  const cli = "/home/me/.nvm/versions/node/v22.13.0/lib/node_modules/npm/bin/npm-cli.js"
  assert.deepEqual(npmCommand(node, "linux", has(cli), {}), { cmd: node, args: [cli], shell: false })

  const winCli = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js"
  const win = npmCommand("C:\\Program Files\\nodejs\\node.exe", "win32", has(winCli), {})
  assert.deepEqual(win.args, [winCli])
  assert.equal(win.shell, false)
})

test("without an npm beside Node, or under Volta, it's PATH's npm", () => {
  assert.deepEqual(npmCommand("/usr/bin/node", "linux", () => false, {}), { cmd: "npm", args: [], shell: false })
  assert.deepEqual(npmCommand("C:\\node\\node.exe", "win32", () => false, {}), { cmd: "npm", args: [], shell: true })
  const volta = npmCommand("/home/me/.volta/tools/image/node/22.13.0/bin/node", "linux", () => true, {
    VOLTA_HOME: "/home/me/.volta",
  })
  assert.equal(volta.cmd, "npm")
})

test("update --check has its own exit code for a newer release", () => {
  assert.equal(UPDATE_AVAILABLE, 10)
})
