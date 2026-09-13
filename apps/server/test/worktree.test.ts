import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, existsSync, readFileSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { carryInto, checkRepo, commitLeftovers, createWorktree, diffNumbers, isDirty, mergeBranch, removeWorktree } from "../dist/worktree.js"
import { commitTrailers } from "../dist/attribution.js"

/** A real repository, because the thing under test is git behaviour. */
function repo(): string {
  // realpath, because macOS symlinks /var to /private/var and git reports the
  // resolved path — comparing against the unresolved one fails for no reason.
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "kandy-git-")))
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } })
  git("init", "-q", "-b", "main")
  git("config", "user.email", "t@t")
  git("config", "user.name", "t")
  writeFileSync(path.join(dir, "README.md"), "# demo\n")
  git("add", "-A")
  git("commit", "-qm", "init")
  return dir
}

test("checkRepo tells apart a repo, a plain directory and a missing path", async () => {
  const dir = repo()
  const ok = await checkRepo(dir)
  assert.equal(ok.isRepo, true)
  assert.equal(ok.branch, "main")
  assert.equal(ok.dirty, false)

  const plain = realpathSync(mkdtempSync(path.join(tmpdir(), "kandy-plain-")))
  assert.equal((await checkRepo(plain)).isRepo, false)
  assert.equal((await checkRepo("/nope/nowhere")).exists, false)
  // A relative path cannot be resolved on the daemon's behalf.
  assert.ok((await checkRepo("relative/path")).error)
})

test("checkRepo resolves a path inside the repo to the repo root", async () => {
  const dir = repo()
  execFileSync("mkdir", ["-p", path.join(dir, "src", "deep")])
  const found = await checkRepo(path.join(dir, "src", "deep"))
  assert.equal(found.isRepo, true)
  assert.equal(found.path, dir)
})

test("two notes edit the same file without seeing each other", async () => {
  // The load-bearing claim: concurrent agents on one repo.
  const dir = repo()
  const a = await createWorktree(dir, "note_a", "Fix the login bug")
  const b = await createWorktree(dir, "note_b", "Add dark mode")

  assert.notEqual(a.path, b.path)
  assert.match(a.branch, /^kandy\/note_a-fix-the-login-bug$/)
  assert.equal(a.baseBranch, "main")

  writeFileSync(path.join(a.path, "README.md"), "# demo\nfrom A\n")
  writeFileSync(path.join(b.path, "README.md"), "# demo\nfrom B\n")

  assert.equal(readFileSync(path.join(a.path, "README.md"), "utf8").includes("from A"), true)
  assert.equal(readFileSync(path.join(b.path, "README.md"), "utf8").includes("from B"), true)
  // The user's own working tree is never touched.
  assert.equal(readFileSync(path.join(dir, "README.md"), "utf8"), "# demo\n")

  await removeWorktree(dir, a.path, true)
  await removeWorktree(dir, b.path, true)
})

test("creating a worktree does not leave the repo dirty", async () => {
  // .kandy/ lives inside the repo so git can share the object store; without
  // excluding it, every run after the first saw a dirty tree.
  const dir = repo()
  const wt = await createWorktree(dir, "note_c", "thing")
  assert.equal(await isDirty(dir), false)
  await removeWorktree(dir, wt.path, true)
})

test("diffNumbers counts only what the note changed", async () => {
  const dir = repo()
  const wt = await createWorktree(dir, "note_d", "add a file")
  writeFileSync(path.join(wt.path, "NEW.md"), "one\ntwo\n")
  execFileSync("git", ["add", "-A"], { cwd: wt.path })
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"], { cwd: wt.path })

  const stat = await diffNumbers(wt)
  assert.equal(stat.files, 1)
  assert.equal(stat.insertions, 2)
  assert.equal(stat.deletions, 0)
  await removeWorktree(dir, wt.path, true)
})

test("carryInto copies gitignored paths and refuses to escape the repo", async () => {
  const dir = repo()
  writeFileSync(path.join(dir, ".env"), "SECRET=1\n")
  const wt = await createWorktree(dir, "note_e", "thing")

  const carried = await carryInto(dir, wt.path, [".env", "../outside", "missing"])
  assert.deepEqual(carried, [".env"])
  assert.equal(readFileSync(path.join(wt.path, ".env"), "utf8"), "SECRET=1\n")
  assert.equal(existsSync(path.join(wt.path, "outside")), false)
  await removeWorktree(dir, wt.path, true)
})

test("a conflicting merge is reported and leaves the repo clean", async () => {
  const dir = repo()
  const wt = await createWorktree(dir, "note_f", "conflict")

  writeFileSync(path.join(wt.path, "README.md"), "# demo\nbranch side\n")
  execFileSync("git", ["add", "-A"], { cwd: wt.path })
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "branch"], { cwd: wt.path })

  writeFileSync(path.join(dir, "README.md"), "# demo\nmain side\n")
  execFileSync("git", ["add", "-A"], { cwd: dir })
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "main"], { cwd: dir })

  const result = await mergeBranch(dir, wt.branch)
  assert.equal(result.merged, false)
  assert.ok(result.conflict)
  // A half-merge the user has to discover on their own is worse than a refusal.
  assert.equal(await isDirty(dir), false)
  await removeWorktree(dir, wt.path, true)
})

test("a clean merge lands on the base branch", async () => {
  const dir = repo()
  const wt = await createWorktree(dir, "note_g", "clean")
  writeFileSync(path.join(wt.path, "ADDED.md"), "hi\n")
  execFileSync("git", ["add", "-A"], { cwd: wt.path })
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "add"], { cwd: wt.path })

  const result = await mergeBranch(dir, wt.branch)
  assert.equal(result.merged, true)
  assert.equal(existsSync(path.join(dir, "ADDED.md")), true)
  await removeWorktree(dir, wt.path, true)
})

/** The full commit message of HEAD, exactly as git stored it. */
function message(cwd: string): string {
  return execFileSync("git", ["log", "-1", "--format=%B"], { cwd }).toString()
}

test("with attribution off, a commit is byte-for-byte what it always was", async () => {
  // The default has to be genuinely inert: the same git command, the same
  // stored message, no empty trailers, no extra newline.
  const dir = repo()
  const wt = await createWorktree(dir, "note_h", "quiet")
  writeFileSync(path.join(wt.path, "LEFT.md"), "left behind\n")

  assert.equal(await commitLeftovers(wt, "Guard the daemon port with a token"), true)
  assert.equal(message(wt.path), "Guard the daemon port with a token\n")
  // Not "no Kandy-Note value" — no trailer block at all.
  assert.equal(
    execFileSync("git", ["log", "-1", "--format=%(trailers)"], { cwd: wt.path }).toString().trim(),
    "",
  )
  await removeWorktree(dir, wt.path, true)
})

test("the commit message is the note's title, not its id", async () => {
  const dir = repo()
  const wt = await createWorktree(dir, "note_i", "titled")
  writeFileSync(path.join(wt.path, "LEFT.md"), "x\n")
  await commitLeftovers(wt, "Rebuild the hero around the thing itself")
  // git log --oneline has to be readable by the person who wrote the note.
  assert.match(
    execFileSync("git", ["log", "-1", "--format=%s"], { cwd: wt.path }).toString(),
    /^Rebuild the hero around the thing itself$/m,
  )
  await removeWorktree(dir, wt.path, true)
})

test("with attribution on, trailers are real trailers git can read back", async () => {
  const dir = repo()
  const wt = await createWorktree(dir, "note_j", "signed")
  writeFileSync(path.join(wt.path, "LEFT.md"), "x\n")

  await commitLeftovers(
    wt,
    "Add commit trailers",
    commitTrailers({ noteId: "note_j", runId: "run_k", agent: "claude", model: "opus" }),
  )

  const read = (key: string) =>
    execFileSync("git", ["log", "-1", `--format=%(trailers:key=${key},valueonly)`], {
      cwd: wt.path,
    })
      .toString()
      .trim()

  assert.equal(read("Kandy-Note"), "note_j")
  assert.equal(read("Kandy-Run"), "run_k")
  assert.equal(read("Kandy-Agent"), "claude (opus)")
  assert.equal(read("Co-Authored-By"), "Claude <noreply@anthropic.com>")
  // Subject is untouched; the trailers sit in their own block below it.
  assert.match(message(wt.path), /^Add commit trailers\n\nKandy-Note: note_j\n/)
  await removeWorktree(dir, wt.path, true)
})

test("a merge commit is unsigned by default and signed on request", async () => {
  const dir = repo()

  const plain = await createWorktree(dir, "note_k", "plain")
  writeFileSync(path.join(plain.path, "ONE.md"), "1\n")
  await commitLeftovers(plain, "one")
  assert.equal((await mergeBranch(dir, plain.branch)).merged, true)
  assert.equal(message(dir), `kandy: merge ${plain.branch}\n`)
  await removeWorktree(dir, plain.path, true)

  const signed = await createWorktree(dir, "note_l", "signed")
  writeFileSync(path.join(signed.path, "TWO.md"), "2\n")
  await commitLeftovers(signed, "two")
  const trailers = commitTrailers({ noteId: "note_l", runId: "run_m", agent: "codex" })
  assert.equal((await mergeBranch(dir, signed.branch, trailers)).merged, true)
  assert.equal(
    execFileSync("git", ["log", "-1", "--format=%(trailers:key=Kandy-Note,valueonly)"], { cwd: dir })
      .toString()
      .trim(),
    "note_l",
  )
  await removeWorktree(dir, signed.path, true)
})
