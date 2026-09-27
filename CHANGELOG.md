# Changelog

## 0.2.0-alpha.1 — teams, capabilities, the terminal

September 2026. **Extremely experimental** — see [Status](https://github.com/hiteshbandhu/kandy/tree/main/apps/docs/status.md).

**Installable.** One command, from the GitHub release — no clone:

```sh
npm i -g https://github.com/hiteshbandhu/kandy/releases/latest/download/kandy.tgz
```

### Teams

- **Three modes.** Just you, as before; **join a team** with
  `kandy join <hub-url>`; or **run a hub** with `kandy hub --tailscale` or
  `deploy/try-hub.sh`. → [The three modes](https://github.com/hiteshbandhu/kandy/tree/main/apps/docs/modes/index.md)
- **Your notes run on your machine**, with your agents and logins, even on a
  shared board. A hub keeps the log and runs nothing — no agents, no keys, no
  repositories.
- **Identity from Tailscale.** No accounts or passwords: the tailnet says who you
  are. Requests with no identity (tagged devices) are refused, not trusted.
- **Owners, members, viewers**, with `kandy invite` and a Team page — people,
  machines, and who did what. The first person to open a hub owns it.
- **Consent at the edge.** A note someone sends to your machine waits for you:
  run it, always allow them, or decline. Only a machine's owner can answer for
  it, and only they can answer its agent's permission prompts.
- **Hand work to a teammate.** Give to… pushes your branch; their machine
  continues it, with a briefing for whichever agent they use. → [Handoff](https://github.com/hiteshbandhu/kandy/tree/main/apps/docs/modes/handoff.md)
- **Onboarding in one command.** `kandy join` checks reachability, identity,
  admission, agents and clones, says what to fix, and starts the runner.
- **A hub image**: Docker, with a Tailscale sidecar; no agents or git inside.
- **A published runner protocol**, with a conformance test.

### Agents reach more

- **MCP servers on the board**, given to Claude Code, Codex, Cursor and opencode
  in each one's own format, every run. Secrets are `${NAME}` and never leave the
  machine. → [Skills and MCP](https://github.com/hiteshbandhu/kandy/tree/main/apps/docs/guide/capabilities.md)
- **Skills**, installed with the `skills` CLI, with uncommitted ones flagged —
  a note runs in a checkout of git, so they'd reach no agent.
- **Change agent mid-note.** The next agent gets a [briefing](https://github.com/hiteshbandhu/kandy/tree/main/apps/docs/concepts/briefings.md),
  not a transcript.
- **Claude asks before running commands** under repo-only access, on the board.
- **Model menus from the agents themselves** — Codex and Cursor are asked which
  models your account can run.
- **Rate limits** for your Claude subscription, beside the agent.

### The terminal

- **`kandy` opens the board in your terminal** — run, steer, diff, merge, answer
  prompts and consent requests from the keyboard. → [The terminal board](https://github.com/hiteshbandhu/kandy/tree/main/apps/docs/guide/terminal.md)
- **First run asks one question** — just me, join a team, or start a hub — and
  never in a script. `kandy setup` asks again.
- **`kandy -h` is one screen**, with `kandy help <topic>` and
  `kandy <command> -h` for depth.
- **The real logo**, drawn in the terminal.

### Fixed

- `kandy "…"` now runs the note; without `--agent` it used to write a draft and
  stop.
- The daemon refuses reads from anywhere but this machine unless they bring a
  credential; before, anything that could reach the port could read every board.
- `kandy gc` reclaims `node_modules` and caches from notes in review, not only
  finished ones.
- A finished note's checkout is tidied away after its branch is pushed.

## 0.1.0-alpha.1

First tagged version. Alpha in the honest sense: it runs real work every day on
its own repository, and the parts that are unfinished are named below rather
than discovered.

Not published. Install it from a clone — `pnpm build`, then `pnpm link
--global` from `apps/server`.

### What works

- **Boards** point at a git repository. Notes are units of work with a
  lifecycle: draft → queued → running → review → done.
- **Isolation.** Every note runs in its own `git worktree` on its own branch, so
  several agents work the same repo at once without seeing each other's writes.
  Your working tree is never touched.
- **Workspaces are ready.** Gitignored paths are carried in by reference
  (`clonefile` on APFS, `--reflink` on Linux) and a setup command guessed from
  the repo's lockfiles runs before the agent arrives. Measured on this repo:
  worktree 0.07s, `pnpm install` 0.85s.
- **Agents.** Claude Code and Codex, written against their real captured output.
  Credentials are never read — the spawned CLI inherits your existing login.
- **Steering.** Send a message to a running agent, or queue a follow-up that
  resumes its session in the same worktree. Files can be attached.
- **Review.** A diff per file, then merge locally, open a PR, or discard. Each
  asks first, and says what will happen to that branch.
- **Cost.** Claude reports dollars; Codex reports tokens and is priced from the
  LiteLLM table. Which is which is tracked, so a mixed total says how much of it
  is estimated.
- **A CLI** — `kandy "do the thing"` from any repo — and a skill so other agents
  can queue work onto a board.

### Known gaps

- **`blocked` can be seen but not answered.** Refusals surface; you cannot
  approve one in flight. That needs the agent running in-process.
- **Only two agents.** Cursor, opencode, Gemini and Grok are named in the model
  but have no adapter.
- **No auth on the HTTP port.** It binds `127.0.0.1`, so nothing is exposed, but
  `--port` has no token yet.
- **No worktree GC.** Abandoned worktrees accumulate until a note is reviewed.
- **Codex cost is an estimate.** Codex reports no dollar figure, and a price
  table goes stale.
