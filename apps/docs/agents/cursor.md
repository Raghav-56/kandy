# Cursor

Cursor's command-line agent, `cursor-agent`. It runs on your Cursor plan and its
models.

## Install

```sh
curl https://cursor.com/install -fsS | bash
```

See [Cursor's CLI docs](https://cursor.com/cli). kandy needs the `cursor-agent`
command on your `PATH`.

## Sign in

```sh
cursor-agent login
```

## Check it's ready

```sh
kandy status
```
```
  agents
    cursor     ready 2026.09.25-5d5651d
```

"Ready" means kandy found a signed-in user in `~/.cursor/cli-config.json`.
Cursor keeps that after a login expires — and `cursor-agent status` still says
*Login successful* — so a note can fail at once with:

```
Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.
```

Run `cursor-agent login` again. To test Cursor on its own:
`cursor-agent -p "reply ok"`.

## Run a note with it

```sh
kandy "Extract the price formatting into a helper
Use it in both the cart and the invoice. Verify with: npm test" --agent cursor
```

## What the access levels mean

| | What kandy passes | What the agent can do |
| --- | --- | --- |
| **Repo only** | `--sandbox enabled` | Cursor's `-p` mode already allows every tool, so the operating-system sandbox is the boundary: writes stay in the worktree. Refused commands can't be asked about, so the note shows as **blocked**. |
| **Full access** | `--force --sandbox disabled` | Anything, without asking. |

kandy always passes `--trust`. Without it, Cursor refuses an unfamiliar folder,
prints a warning and exits as if it had succeeded — a run that did nothing. A
worktree is a folder you already asked an agent to work in.

## What works

- **Follow-ups** resume the same Cursor session (`--resume`). A message sent
  mid-run arrives when the current turn ends.
- **MCP servers** from the board. Cursor has no flag for them, so kandy writes
  the worktree's `.cursor/mcp.json` for the run, approves the board's servers by
  name, and restores the file afterwards — it never shows up in your diff.
- **Skills** in `.agents/skills`.
- **Models** — your plan's list, from `cursor-agent models`.
- **Cost** — Cursor reports tokens, not dollars (it bills your plan), so kandy
  prices them from a public table and marks the result `≈`.

## When it doesn't work

- **"Authentication required" though kandy says ready** — `cursor-agent login`.
- **Blocked on a test run** — expected under repo only. Grant full access for
  that note, or use Claude Code for notes that need commands.

More in [Troubleshooting](/guide/troubleshooting).
