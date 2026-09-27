import test from "node:test"
import assert from "node:assert/strict"

import { compareVersions, versionFromTagUrl } from "../dist/cli/update.js"

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
