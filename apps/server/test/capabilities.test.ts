import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { checkMcpServers, envRefs } from "@kandy/core"
import {
  claudeMcpConfig,
  codexMcpArgs,
  cursorMcpConfig,
  opencodeMcpConfig,
} from "../dist/capabilities/mcp.js"
import { placeCursorMcp } from "../dist/capabilities/cursor-file.js"
import { commitSkills, frontmatter, listSkills } from "../dist/capabilities/skills.js"
import { commitLeftovers } from "../dist/worktree.js"
import { claude } from "../dist/agents/claude.js"
import { codex } from "../dist/agents/codex.js"
import { opencode } from "../dist/agents/opencode.js"
import { aider } from "../dist/agents/aider.js"

const linear = {
  name: "linear",
  type: "http" as const,
  url: "https://mcp.linear.app/mcp",
  headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
}
const github = {
  name: "github",
  type: "stdio" as const,
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  env: { GITHUB_TOKEN: "${GITHUB_TOKEN}", LOG_LEVEL: "warn" },
}

// ── the rule every translation keeps ──────────────────────────────────────

test("no translation ever contains a secret's value", () => {
  /*
   * The property that lets a board's config travel to a hub and to teammates:
   * whatever the environment holds, it never lands in what kandy produces.
   * Every dialect is rendered with the secrets set, and none may contain them.
   */
  process.env["LINEAR_TOKEN"] = "lin_SECRET_value"
  process.env["GITHUB_TOKEN"] = "ghp_SECRET_value"
  try {
    const all = JSON.stringify([
      claudeMcpConfig([linear, github]),
      cursorMcpConfig([linear, github]),
      opencodeMcpConfig([linear, github]),
      codexMcpArgs([linear, github]),
    ])
    assert.equal(all.includes("SECRET"), false)
  } finally {
    delete process.env["LINEAR_TOKEN"]
    delete process.env["GITHUB_TOKEN"]
  }
})

// ── each dialect ──────────────────────────────────────────────────────────

test("Claude gets the references exactly as written, because it expands them itself", () => {
  assert.deepEqual(claudeMcpConfig([linear, github]), {
    mcpServers: {
      linear: { type: "http", url: linear.url, headers: { Authorization: "Bearer ${LINEAR_TOKEN}" } },
      github: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "${GITHUB_TOKEN}", LOG_LEVEL: "warn" },
      },
    },
  })
})

test("Cursor gets ${env:NAME}, and keeps the project's own servers", () => {
  const out = cursorMcpConfig([linear], {
    mcpServers: { theirs: { command: "their-server" } },
  }) as { mcpServers: Record<string, any> }
  assert.deepEqual(out.mcpServers["theirs"], { command: "their-server" })
  assert.equal(out.mcpServers["linear"].headers.Authorization, "Bearer ${env:LINEAR_TOKEN}")
})

test("opencode gets {env:NAME}, its command as one array, and `environment`", () => {
  const out = opencodeMcpConfig([github]) as { mcp: Record<string, any> }
  assert.deepEqual(out.mcp["github"], {
    type: "local",
    command: ["npx", "-y", "@modelcontextprotocol/server-github"],
    environment: { GITHUB_TOKEN: "{env:GITHUB_TOKEN}", LOG_LEVEL: "warn" },
    enabled: true,
  })
})

test("Codex gets the variable's name in the fields that take one", () => {
  const { args, declined } = codexMcpArgs([linear, github])
  assert.deepEqual(declined, [])
  assert.deepEqual(args, [
    "-c",
    'mcp_servers.linear={url="https://mcp.linear.app/mcp", bearer_token_env_var="LINEAR_TOKEN"}',
    "-c",
    'mcp_servers.github={command="npx", args=["-y","@modelcontextprotocol/server-github"], env={"LOG_LEVEL"="warn"}, env_vars=["GITHUB_TOKEN"]}',
  ])
})

test("a header that is wholly a variable goes to env_http_headers; a literal stays literal", () => {
  const { args } = codexMcpArgs([
    {
      name: "api",
      type: "http",
      url: "https://x.example/mcp",
      headers: { "X-Api-Key": "${API_KEY}", "X-Client": "kandy" },
    },
  ])
  assert.equal(
    args[1],
    'mcp_servers.api={url="https://x.example/mcp", http_headers={"X-Client"="kandy"}, env_http_headers={"X-Api-Key"="API_KEY"}}',
  )
})

test("what Codex cannot say without expanding a secret, it declines — and says why", () => {
  /*
   * Codex has no substitution syntax, only fields that take a variable's
   * name. Renaming a variable, or building text around one, cannot be
   * expressed without kandy putting the value into argv where `ps` shows it.
   * Declining is the honest answer; a silent drop is not.
   */
  const { args, declined } = codexMcpArgs([
    { name: "renamed", type: "stdio", command: "srv", env: { API_KEY: "${LINEAR_KEY}" } },
    { name: "inarg", type: "stdio", command: "srv", args: ["--token", "${T}"] },
    { name: "wrapped", type: "http", url: "https://x.example", headers: { "X-Auth": "token=${T}" } },
    { name: "fine", type: "stdio", command: "srv" },
  ])
  assert.deepEqual(
    declined.map((d) => d.name),
    ["renamed", "inarg", "wrapped"],
  )
  assert.match(declined[0]!.reason, /write it as \$\{API_KEY\}/)
  assert.deepEqual(args, ["-c", 'mcp_servers.fine={command="srv"}'])
})

test("TOML quoting survives quotes and backslashes in a value", () => {
  const { args } = codexMcpArgs([
    { name: "q", type: "stdio", command: 'C:\\tools\\srv "x"' },
  ])
  assert.equal(args[1], 'mcp_servers.q={command="C:\\\\tools\\\\srv \\"x\\""}')
})

// ── adapters use them ─────────────────────────────────────────────────────

const opts = { cwd: "/wt", prompt: "go", policy: "repo" as const }

test("Claude's board config rides the same --mcp-config as the ask channel", () => {
  const spec = claude.spawn({
    ...opts,
    ask: { configPath: "/state/ask.json", toolName: "mcp__kandy__permission_prompt" },
    mcp: [linear],
  })
  const i = spec.args.indexOf("--mcp-config")
  assert.equal(spec.args.filter((a) => a === "--mcp-config").length, 1)
  assert.equal(spec.args[i + 1], "/state/ask.json")
  assert.deepEqual(JSON.parse(spec.args[i + 2]!), claudeMcpConfig([linear]))
  // Additive: the user's own servers must still load.
  assert.equal(spec.args.includes("--strict-mcp-config"), false)
})

test("no board servers means Claude's arguments are what they always were", () => {
  const spec = claude.spawn({ ...opts })
  assert.equal(spec.args.includes("--mcp-config"), false)
})

test("Codex carries its -c flags on both exec and exec resume", () => {
  const fresh = codex.spawn({ ...opts, mcp: [linear] })
  const resumed = codex.spawn({ ...opts, resume: "sess", mcp: [linear] })
  for (const spec of [fresh, resumed]) {
    assert.ok(spec.args.some((a) => a.startsWith("mcp_servers.linear=")))
    // The prompt is still the last argument.
    assert.equal(spec.args.at(-1), "go")
  }
})

test("Codex reports what it declined, so the runner can say it on the transcript", () => {
  const spec = codex.spawn({
    ...opts,
    mcp: [{ name: "renamed", type: "stdio", command: "srv", env: { A: "${B}" } }],
  })
  assert.equal(spec.declined?.[0]?.name, "renamed")
})

test("opencode gets its servers through inline config, not the user's files", () => {
  const spec = opencode.spawn({ ...opts, mcp: [github] })
  assert.deepEqual(JSON.parse(spec.env!["OPENCODE_CONFIG_CONTENT"]!), opencodeMcpConfig([github]))
})

test("aider says it cannot, rather than pretending", () => {
  assert.equal(aider.mcp, false)
  assert.equal(claude.mcp, true)
})

// ── Cursor's file ─────────────────────────────────────────────────────────

// The real approval runs `cursor-agent` and writes to ~/.cursor. Not in a test.
const noApprove = async () => {}

function repo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "kandy-cap-"))
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir })
  writeFileSync(path.join(dir, "README.md"), "hi\n")
  execFileSync("git", ["add", "."], { cwd: dir })
  execFileSync("git", ["commit", "-qm", "init"], { cwd: dir })
  return dir
}
const status = (dir: string) => execFileSync("git", ["status", "--porcelain"], { cwd: dir }).toString()

test("Cursor's file is invisible to git while the run is on, and gone after", async () => {
  const dir = repo()
  const placed = await placeCursorMcp(dir, [linear], noApprove)
  const file = path.join(dir, ".cursor", "mcp.json")
  assert.ok(existsSync(file))
  // Untracked, so git does see it — and the runner keeps it out of its own
  // commit by removing it first. Asserted here as the reason undo runs first.
  assert.match(status(dir), /\.cursor/)
  await placed.undo()
  assert.equal(existsSync(path.join(dir, ".cursor")), false, "an empty .cursor/ it made is removed too")
  assert.equal(status(dir), "")
})

test("a tracked Cursor file is merged, hidden from the index, and restored byte for byte", async () => {
  const dir = repo()
  mkdirSync(path.join(dir, ".cursor"))
  const original = '{\n  "mcpServers": { "theirs": { "command": "their-server" } }\n}\n'
  writeFileSync(path.join(dir, ".cursor", "mcp.json"), original)
  execFileSync("git", ["add", "."], { cwd: dir })
  execFileSync("git", ["commit", "-qm", "cursor"], { cwd: dir })

  const placed = await placeCursorMcp(dir, [linear], noApprove)
  const during = JSON.parse(readFileSync(path.join(dir, ".cursor", "mcp.json"), "utf8"))
  assert.ok(during.mcpServers.theirs, "the project's own server is kept")
  assert.ok(during.mcpServers.linear)
  // The point of --skip-worktree: the tracked file's change is invisible.
  assert.doesNotMatch(status(dir), /mcp\.json/)

  await placed.undo()
  assert.equal(readFileSync(path.join(dir, ".cursor", "mcp.json"), "utf8"), original)
  assert.equal(status(dir), "")
})

test("even an agent that commits everything leaves nothing in the reviewed diff", async () => {
  /*
   * The worst case, measured rather than assumed. A tracked mcp.json is
   * protected outright by --skip-worktree. cli.json is new, so it is
   * untracked and an agent's own `git add -A` can take it — and one that
   * does has committed an allow-list line and nothing secret. `undo` then
   * deletes it and the runner's leftover commit records the deletion, so the
   * diff that is reviewed and becomes the PR is exactly the agent's work.
   */
  const dir = repo()
  mkdirSync(path.join(dir, ".cursor"))
  writeFileSync(path.join(dir, ".cursor", "mcp.json"), '{"mcpServers":{}}\n')
  execFileSync("git", ["add", "."], { cwd: dir })
  execFileSync("git", ["commit", "-qm", "base"], { cwd: dir })
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim()

  const placed = await placeCursorMcp(dir, [linear], noApprove)
  execFileSync("git", ["add", "-A"], { cwd: dir })
  execFileSync("git", ["commit", "-qm", "agent: git add -A"], { cwd: dir })
  const grabbed = execFileSync("git", ["show", "--name-only", "--format=", "HEAD"], { cwd: dir }).toString()
  assert.doesNotMatch(grabbed, /mcp\.json/, "the tracked file was never takeable")
  assert.equal(grabbed.includes("SECRET"), false)

  await placed.undo()
  await commitLeftovers({ path: dir } as never, "leftovers")
  assert.equal(execFileSync("git", ["diff", "--name-only", base, "HEAD"], { cwd: dir }).toString(), "")
})

test("nothing to place means nothing is touched", async () => {
  const dir = repo()
  const placed = await placeCursorMcp(dir, [], noApprove)
  assert.deepEqual(placed.paths, [])
  assert.equal(existsSync(path.join(dir, ".cursor")), false)
})

// ── validation ────────────────────────────────────────────────────────────

test("a server list is refused whole, with the first reason", () => {
  assert.equal(checkMcpServers([linear, github]).ok, true)
  const bad = [
    [{ ...linear, name: "has space" }, /letters, digits/],
    [[linear, linear], /two servers are called linear/],
    [{ name: "x", type: "stdio" }, /needs a command/],
    [{ name: "x", type: "http", url: "ftp://x" }, /http\(s\) url/],
    [{ name: "x", type: "sse", url: "https://x" }, /type must be/],
    [{ ...github, env: { A: 1 } }, /env must map/],
  ] as const
  for (const [input, why] of bad) {
    const r = checkMcpServers(Array.isArray(input) ? input : [input])
    assert.equal(r.ok, false)
    assert.match((r as { error: string }).error, why)
  }
})

test("a runner can say which variables a server needs", () => {
  assert.deepEqual(envRefs(github), ["GITHUB_TOKEN"])
  assert.deepEqual(envRefs(linear), ["LINEAR_TOKEN"])
})

// ── skills ────────────────────────────────────────────────────────────────

function skill(dir: string, name: string, description: string) {
  mkdirSync(path.join(dir, ".agents", "skills", name), { recursive: true })
  writeFileSync(
    path.join(dir, ".agents", "skills", name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  )
  mkdirSync(path.join(dir, ".claude", "skills"), { recursive: true })
  symlinkSync(path.join("..", "..", ".agents", "skills", name), path.join(dir, ".claude", "skills", name))
}

test("a skill git does not know about is reported as not reaching any run", async () => {
  const dir = repo()
  skill(dir, "animate", "Motion that means something")
  const [s] = await listSkills(dir)
  assert.equal(s!.name, "animate")
  assert.equal(s!.description, "Motion that means something")
  assert.equal(s!.committed, false)
})

test("a skill and its link are one skill, listed once", async () => {
  const dir = repo()
  skill(dir, "animate", "x")
  skill(dir, "polish", "y")
  assert.deepEqual(
    (await listSkills(dir)).map((s) => s.name),
    ["animate", "polish"],
  )
})

test("committing skills takes the skill, its links and the lockfile — and nothing else staged", async () => {
  const dir = repo()
  skill(dir, "animate", "x")
  writeFileSync(path.join(dir, "skills-lock.json"), '{"version":1,"skills":{}}\n')
  // Something the user staged for their own reasons.
  writeFileSync(path.join(dir, "mine.txt"), "wip\n")
  execFileSync("git", ["add", "mine.txt"], { cwd: dir })

  assert.deepEqual(await commitSkills(dir), ["animate"])

  const files = execFileSync("git", ["show", "--name-only", "--format=", "HEAD"], { cwd: dir })
    .toString()
    .trim()
    .split("\n")
    .sort()
  assert.deepEqual(files, [
    ".agents/skills/animate/SKILL.md",
    ".claude/skills/animate",
    "skills-lock.json",
  ])
  // Still staged, still theirs, not in our commit.
  assert.match(status(dir), /^A  mine\.txt/m)
  assert.equal((await listSkills(dir))[0]!.committed, true)
})

test("frontmatter handles plain, quoted and folded descriptions", () => {
  assert.equal(frontmatter("---\nname: a\ndescription: plain words\n---").description, "plain words")
  assert.equal(frontmatter('---\nname: a\ndescription: "quoted: yes"\n---').description, "quoted: yes")
  assert.equal(
    frontmatter("---\nname: a\ndescription: >\n  folded over\n  two lines\n---").description,
    "folded over two lines",
  )
  assert.deepEqual(frontmatter("no frontmatter"), { name: null, description: null })
})
