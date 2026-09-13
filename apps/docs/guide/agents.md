# Agents and models

kandy spawns the agent CLI you already installed and logged into. It never
reads, stores or forwards a credential — the child process inherits your login,
the same way a Makefile would.

## Supported today

**Claude Code** — the reference adapter. The prompt travels over stdin rather
than argv, because `--input-format stream-json` is what makes steering possible:
the same channel carries further turns. It is the only agent that accepts a
message mid-run.

**Codex** — speaks a thread/turn/item vocabulary rather than messages. It
reports tokens but no dollar figure, so cost is computed (see [Cost](/guide/cost)).
Its stdin is closed immediately after spawn; left open, it waits on
`Reading additional input from stdin…` forever.

Cursor, opencode, Gemini and Grok appear in the data model but have no adapter
yet.

## Models

A model can be chosen in three places, most specific first:

1. **On the note** — pins that model for this job.
2. **On the board** — the default for each agent in this repo, in Settings.
3. **Neither** — the agent's own default.

The menu is built from the price table kandy already fetches, filtered to what
each agent can actually run. It is a menu, not a promise: the agent still
refuses one you have no access to.

::: tip
Aliases come first for Claude — `opus`, `sonnet`, `haiku` — because an alias
keeps pointing at the current model when a new one ships, and a pinned id does
not.
:::

## Permissions

Two levels, per note:

- **Repo only** — the agent edits files freely. Most shell commands are refused,
  including the tests it just wrote.
- **Full access** — it can run anything.

A worktree bounds what an agent can damage *inside the repository*. It does
nothing about `$HOME` or the network, which is why full access is a decision
kandy asks you to make rather than one it makes for you.
