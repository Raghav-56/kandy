# Claude Code

Anthropic's coding agent, and the one kandy is built and tested against every
day. **If you're choosing an agent, choose this one**: it's the only one that
can stop and ask you before running a command, and the only one you can message
mid-turn.

## Install

```sh
npm i -g @anthropic-ai/claude-code
```

Or any way [Anthropic's guide](https://docs.claude.com/en/docs/claude-code/setup)
offers. kandy needs the `claude` command on your `PATH`.

## Sign in

```sh
claude
```

and type `/login` if it doesn't ask. A Claude subscription (Pro, Max, Team) or
an Anthropic API key both work — kandy runs whatever login `claude` has.

## Check it's ready

```sh
kandy status
```
```
  agents
    claude     ready 2.1.283 (Claude Code)
```

kandy asks `claude auth status` rather than reading your credentials, so
"ready" here reflects what Claude Code itself says.

## Run a note with it

```sh
kandy "Add a dark mode toggle
Follow the system setting by default. Verify with: npm test" --agent claude
```

Or pick **Claude Code** in the agent picker. With no `--agent`, kandy uses the
last agent that ran on the board.

## What the access levels mean

| | What kandy passes | What the agent can do |
| --- | --- | --- |
| **Repo only** | `--permission-mode acceptEdits`, plus kandy as its permission prompt | Edit files in its worktree. Every other command is **put to you as a question** on the board. |
| **Full access** | `--permission-mode bypassPermissions` | Anything, without asking. |

Under repo only, a question looks like this in the terminal — <kbd>a</kbd> allow
once, <kbd>A</kbd> allow for the rest of this note, <kbd>D</kbd> deny with a
reason:

<p class="k-shot"><img src="/shots/start/terminal-ask.webp" alt="Claude Code asking to run npm test, in the terminal board"></p>

A question nobody answers in 10 minutes is refused, and the agent carries on
without it.

## What works

- **Messages mid-run.** Send one while it works and it arrives in the same
  turn — the prompt travels over stdin as a stream, so the channel stays open.
- **Follow-ups** resume the same session in the same worktree.
- **Skills and MCP servers** from the board, every run (`--mcp-config`, added to
  your own servers, never replacing them). See [Skills and MCP](/guide/capabilities).
- **Cost in dollars**, as Claude Code reports it — not estimated.
- **Plan limits.** Claude Code reports how much of your five-hour and weekly
  windows you've used; kandy shows it beside the agent in the browser.
- **Models.** A short list of what the CLI accepts, aliases first — `fable`,
  `opus`, `sonnet`, `haiku` — then pinned ids. Add your own in the model menu.

## When it doesn't work

- **`signed out` in `kandy status`** — run `claude` and `/login`.
- **Notes stop partway, near a limit** — your plan's window is used up. The
  limit is shown next to Claude Code in the browser's sidebar.
- **It keeps asking about the same command** — answer with <kbd>A</kbd> (allow
  for this note). It isn't offered for chained commands (`&&`, `;`, `|`), because
  a rule made from one would cover more than you read — allow those once, or give
  the note full access.

More in [Troubleshooting](/guide/troubleshooting).
