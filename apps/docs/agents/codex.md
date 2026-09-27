# Codex

OpenAI's coding agent. It works well with kandy for notes that don't need to run
commands outside the repository — tests and builds included, under full access.

## Install

```sh
npm i -g @openai/codex
```

Or `brew install codex`. kandy needs the `codex` command on your `PATH`.

## Sign in

```sh
codex login
```

A ChatGPT plan or an OpenAI API key both work.

## Check it's ready

```sh
kandy status
```
```
  agents
    codex      ready codex-cli 0.154.0
```

"Ready" means kandy found `~/.codex/auth.json`. Codex keeps that file even after
a login has expired, so a note can still fail at once with:

```
Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.
```

Run `codex login` again when you see it.

## Run a note with it

```sh
kandy "Add a --json flag to the export command
Print the result as JSON. Verify with: npm test" --agent codex
```

## What the access levels mean

| | What kandy passes | What the agent can do |
| --- | --- | --- |
| **Repo only** | `-s workspace-write` | Write inside its worktree. Commands Codex's sandbox refuses are **refused outright** — Codex can't ask — and the note shows as **blocked**. |
| **Full access** | `--dangerously-bypass-approvals-and-sandbox` | Anything, without asking. |

When a note is blocked, **Grant full access and continue** resumes the same
session with full access — nothing is redone.

## What works

- **Follow-ups** resume the same Codex session (`codex exec resume`). A message
  sent mid-run arrives when the current turn ends.
- **MCP servers** from the board, added with `-c mcp_servers.…` on top of your
  own config. Codex can only take a secret as a variable under its own name or
  as `Bearer ${TOKEN}`; a server that needs anything else is skipped for Codex,
  and the transcript says why.
- **Skills** in `.agents/skills`, where Codex looks.
- **Models** — the list your account can use, asked of Codex itself
  (`model/list`).
- **Cost** — Codex reports tokens, not dollars, so kandy prices them from a
  public table and marks the result `≈`. Your OpenAI billing is the truth.

## When it doesn't work

- **The note fails in seconds, "refresh token was revoked"** — `codex login`.
- **Blocked on a test run** — expected under repo only. Grant full access for
  that note, or run notes that need tests with Claude Code, which asks instead.
- **A board MCP server doesn't appear** — see the secret rule above; the
  transcript names the server and the reason.

More in [Troubleshooting](/guide/troubleshooting).
