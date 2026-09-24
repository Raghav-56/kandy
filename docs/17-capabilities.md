# Capabilities — skills and MCP servers, for every agent

Step 2 of the v1 plan. Companion to [`16-threads.md`](16-threads.md): a thread is what an agent
*knows* about a note; capabilities are what it can *reach*. Both have to survive changing agent,
machine, and person.

## Two homes, on purpose

**Skills live in the repository.** The `skills` CLI already installs them to `.agents/skills/`,
writes `skills-lock.json`, and links each one into every agent that needs a link. `skills list
--json` on this repository reports each skill reaching Claude Code, Codex, Cursor and OpenCode
from one directory plus a `.claude/skills` symlink. So kandy drives that CLI and does not ship a
second installer with a second lockfile format to drift from.

**MCP servers live on the board.** Each agent keeps them in its own dialect, in the user's home
directory, so a server configured for Claude is invisible to Codex and one configured on your
laptop is invisible to a teammate. A board is where they can live once.

## What kandy adds to skills: the one thing the `skills` CLI cannot see

A note's worktree is checked out from git, so **a skill that is only on disk reaches no agent
kandy runs**. Measured on this repository: fourteen skills installed, two committed, two visible
inside a worktree — twelve deliberately installed skills invisible to every run.

Carrying them into each worktree would fix it here and fail silently everywhere else, because a
teammate's runner checks out from git too. So kandy says so — a hollow mark and one sentence in
`kandy skills` and in Settings — and offers `kandy skills commit`, which commits the skill, its
agent links and the lockfile, and nothing else the user has staged. After that, git carries it to
every worktree, every runner and every handoff.

```
kandy skills                       what's here, and which runs can see it
kandy skills add <owner/repo>      install for every agent
kandy skills commit                commit the ones no worktree can see yet
```

## MCP: one list, four dialects, no secrets

```
kandy mcp add github -- npx -y @modelcontextprotocol/server-github --env 'GITHUB_TOKEN=${GITHUB_TOKEN}'
kandy mcp add linear --url https://mcp.linear.app/mcp --header 'Authorization: Bearer ${LINEAR_TOKEN}'
```

**kandy never expands a secret.** A value names a variable as `${NAME}`, and each agent's own
config dialect fills it from the environment of the machine the agent runs on:

| Agent | How it is given the servers | How `${NAME}` is written |
| --- | --- | --- |
| Claude | inline JSON to `--mcp-config` | `${NAME}` — its own syntax |
| Codex | `-c mcp_servers.<n>={…}` inline tables | the *name*, in `env_vars`, `bearer_token_env_var`, `env_http_headers` |
| Cursor | `.cursor/mcp.json` in the worktree, for the run | `${env:NAME}` |
| opencode | `OPENCODE_CONFIG_CONTENT` | `{env:NAME}` |
| aider | — no MCP client; the transcript says so | — |

So a board can say `Bearer ${LINEAR_TOKEN}`, travel to a hub and to every teammate, and each
person's agent authenticates with their own token. The hub never holds a key. A test renders
every dialect with the secrets set and asserts none of them appears.

Codex has no substitution syntax, only fields that take a variable's name, so it cannot express
everything the others can — renaming a variable, a reference inside an argument, text wrapped
around one. Those servers are **declined for Codex with a reason on the transcript**, never
expanded into argv where `ps` would show them.

Resolved from the board view at every spawn and never cached, so a server added mid-session is in
the very next run with no restart. Additive everywhere: the user's own servers still load.

### Cursor, specifically

Cursor has no flag for MCP. It reads the project's `.cursor/mcp.json` and a home-directory file
resolved from `homedir()` directly, and `CURSOR_CONFIG_DIR` would move its login too. So the
worktree's project files are written for the run and restored after:

- **`mcp.json`** gets the board's servers merged over the project's own.
- **Each board server is approved by name** with `cursor-agent mcp enable`. Not `--approve-mcps`,
  which would also auto-approve any server a cloned repository ships in its own `mcp.json` —
  the file an attacker would put one in.
- **`cli.json`** allows `Mcp(<server>:*)` for board servers only. Approving a server loads it but
  does not let its tools run: the first real run loaded the server, called its tool, and got
  *"User rejected MCP"*. Claude can put that question on the board; Cursor has no channel to ask
  it on, and the board owner already chose the server by adding it.
- **Nothing reaches the reviewed diff.** A tracked file is hidden with `--skip-worktree`. A new one
  can be committed by an agent that commits everything; `undo` then deletes it and the leftover
  commit records the deletion, so the diff that is reviewed and becomes the PR is exactly the
  agent's work. Measured, and tested as the worst case.

## Verified with real agents, not only tests

A note on an isolated board, with `@modelcontextprotocol/server-everything` added once:

- **Claude** called `mcp__everything__echo`. Under repo-only policy the call arrived on the board
  as a question; allowed, it returned `KANDY-MCP-OK`.
- **Cursor** looked the tool up, called it, and returned `KANDY-MCP-OK`. Worktree clean, `.cursor/`
  gone, no commits.
- **Codex**: the generated flags were fed to the real `codex mcp list`, which shows both servers
  with the forwarded `GITHUB_TOKEN` and the bearer `LINEAR_TOKEN`. Not run end-to-end: the Codex
  login on this machine is revoked.
- **opencode**: covered by tests only. It is not installed here.

## A correction to the plan

The plan said MCP injection would also make permission prompts work on every agent, since today
only Claude's reach the board. **That was wrong.** Claude asks because it has
`--permission-prompt-tool`; an MCP server gives an agent tools, not a way to ask. The others need
their own protocols — Codex's app-server approvals, Cursor's ACP `session/request_permission`,
opencode's server permission events — which means moving each adapter off its headless CLI mode.
That is its own piece of work, tracked separately, and the Cursor `cli.json` allow-list above is
the honest interim for board servers.
