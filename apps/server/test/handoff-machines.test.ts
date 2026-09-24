import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { reduce } from "@kandy/core"
import { continueBranch, normalizeRemote, pushBranch } from "../dist/worktree.js"

/*
 * Handing a note from one machine to another, at the git level.
 *
 * Two clones of one bare origin stand in for two laptops: the same
 * repository at two paths, sharing nothing but the remote — which is all two
 * real laptops share.
 */

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd }).toString().trim()

function twoLaptops() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "kandy-2m-")))
  git(root, "init", "-q", "--bare", "origin.git")
  git(root, "clone", "-q", "origin.git", "alice")
  git(root, "clone", "-q", "origin.git", "bob")
  for (const who of ["alice", "bob"]) {
    const dir = path.join(root, who)
    git(dir, "config", "user.email", `${who}@example.com`)
    git(dir, "config", "user.name", who)
  }
  const alice = path.join(root, "alice")
  writeFileSync(path.join(alice, "README.md"), "# shared\n")
  git(alice, "add", ".")
  git(alice, "commit", "-qm", "init")
  git(alice, "push", "-q", "origin", "HEAD:main")
  git(path.join(root, "bob"), "pull", "-q", "origin", "main")
  return { root, alice, bob: path.join(root, "bob") }
}

test("one repository, cloned three ways by three people, is one repository", () => {
  const same = [
    "git@github.com:acme/app.git",
    "https://github.com/acme/app",
    "https://github.com/acme/app.git",
    "ssh://git@github.com/acme/app.git",
    "https://someone@GitHub.com/acme/app/",
  ].map(normalizeRemote)
  assert.equal(new Set(same).size, 1)
  assert.equal(same[0], "github.com/acme/app")
  assert.notEqual(normalizeRemote("git@github.com:acme/other.git"), same[0])
  assert.equal(normalizeRemote(""), null)
})

test("a remote on disk is named by where it really is, through any symlink", () => {
  const { root } = twoLaptops()
  assert.equal(normalizeRemote(path.join(root, "origin.git")), `file:${path.join(root, "origin")}`)
  assert.equal(normalizeRemote(`file://${path.join(root, "origin.git")}`), `file:${path.join(root, "origin")}`)
})

test("Bob's machine continues Alice's branch: her commits, then his, on one branch", async () => {
  const { alice, bob } = twoLaptops()
  const base = git(alice, "rev-parse", "HEAD")

  // Alice's note did some work on its branch.
  git(alice, "checkout", "-q", "-b", "kandy/note_1-math")
  writeFileSync(path.join(alice, "math.js"), "export const add = (a, b) => a + b\n")
  git(alice, "add", ".")
  git(alice, "commit", "-qm", "add")
  git(alice, "checkout", "-q", "main")
  await pushBranch(alice, "kandy/note_1-math")

  // Bob's runner picks it up, in his own clone.
  const wt = await continueBranch(bob, "note_1", "kandy/note_1-math", base)
  assert.ok(wt)
  assert.equal(wt.branch, "kandy/note_1-math")
  assert.ok(wt.path.startsWith(bob), "in Bob's clone, not Alice's")
  assert.equal(readFileSync(path.join(wt.path, "math.js"), "utf8"), "export const add = (a, b) => a + b\n")
  // The base is where the note began, so Bob's review shows the whole note.
  assert.equal(wt.baseRef, base)
  // And it tracks the remote, so Bob's push goes back to the same branch.
  assert.equal(git(wt.path, "rev-parse", "--abbrev-ref", "@{upstream}"), "origin/kandy/note_1-math")
})

test("a branch nowhere to be found starts fresh rather than failing the run", async () => {
  const { bob } = twoLaptops()
  assert.equal(await continueBranch(bob, "note_9", "kandy/note_9-gone", null), null)
})

test("a repository with no remote says it cannot hand work to anyone", async () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "kandy-lonely-")))
  git(dir, "init", "-q", "-b", "main")
  git(dir, "config", "user.email", "x@x")
  git(dir, "config", "user.name", "x")
  git(dir, "commit", "-q", "--allow-empty", "-m", "init")
  await assert.rejects(pushBranch(dir, "main"), /no remote, so there is nowhere to send the branch/)
})

test("a handed note moves to its new machine, loses its old checkout, and remembers the branch", () => {
  const base = {
    board: { id: "b1" } as never,
    columns: [],
    notes: [
      {
        id: "n1",
        boardId: "b1",
        runner: "alice-mbp",
        worktree: "/alice/.kandy/worktrees/n1",
        branch: "kandy/n1",
        handoff: null,
      } as never,
    ],
    runs: [],
    prompts: [],
    seq: 0,
  } as never
  const handed = reduce(base, {
    type: "note.handed",
    data: { noteId: "n1", from: "alice-mbp", to: "bob-linux", branch: "kandy/n1" },
    seq: 1,
    ts: 5,
    actor: "alice@example.com",
  } as never)
  const n = handed.notes[0]!
  assert.equal(n.runner, "bob-linux")
  assert.equal(n.worktree, null, "Alice's checkout path means nothing on Bob's machine")
  assert.deepEqual(n.handoff, { branch: "kandy/n1", from: "alice-mbp", by: "alice@example.com", at: 5 })
})
