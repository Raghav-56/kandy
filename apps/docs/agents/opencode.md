# opencode

An open-source coding agent that works with many model providers — including
local models. kandy's support is written against opencode's real output format,
but hasn't yet been driven end to end as much as Claude Code, Codex and Cursor.
Tell us how it goes.

## Install

```sh
npm i -g opencode-ai
```

Or `brew install sst/tap/opencode`, or see [opencode.ai](https://opencode.ai).
kandy needs the `opencode` command on your `PATH`.

## Sign in

```sh
opencode auth login
```

and pick a provider. kandy checks opencode's own auth file
(`~/.local/share/opencode/auth.json`) for which providers you've signed in to,
and nothing more.

## Check it's ready

```sh
kandy status
```

It should show `opencode   ready`.

## Run a note with it

```sh
kandy "Add input validation to the signup form" --agent opencode
```

Models are named `provider/model`, for example `anthropic/claude-sonnet-4-5` —
choose one in the model menu or in **Settings → Models**.

## What the access levels mean

| | What kandy passes | What the agent can do |
| --- | --- | --- |
| **Repo only** | nothing extra | **Your own opencode permission rules** stand. Anything they mark `ask` is refused (opencode can't ask through kandy), and the note shows as **blocked**. |
| **Full access** | `--auto` | Approves what your rules would have asked about. Your explicit `deny` rules still hold. |

## What works

- **Follow-ups** resume the same opencode session (`-s`). A message sent mid-run
  arrives when the current turn ends.
- **MCP servers** from the board, passed as inline config merged over your own.
  Secrets written as `${NAME}` are expanded by opencode from your environment.
- **Skills** in `.agents/skills`.
- **Cost** — opencode prices runs itself, which kandy uses. A run on a
  subscription or a local model reports $0, which kandy treats as *unpriced*
  rather than free.
- **Models** — add the `provider/model` ids you use to the model menu.

## When it doesn't work

- **`signed out`** — `opencode auth login`.
- **Blocked** — something your permission config marks `ask`. Grant full access
  for the note, or change your opencode rules.

More in [Troubleshooting](/guide/troubleshooting).
