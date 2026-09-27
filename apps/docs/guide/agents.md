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

**Cursor** — `cursor-agent -p`, sandboxed by the operating system rather than
by an approval mode, because `-p` already grants every tool. kandy always passes
`--trust`: without it Cursor refuses the worktree and exits *zero*, which is a
run that did nothing and reported success. Tokens but no dollar figure.

**opencode** — `opencode run --format json`. Provider-agnostic, so models are
addressed as `provider/model` and a run is priced by opencode itself when it has
a price. Your own `permission` config is what a repo-only note obeys; full access
is what overrides it.

**Aider** — no credential check at all: it configures its own provider, and
installed means available.

Gemini and Grok appear in the data model but have no adapter yet.

::: tip
Cursor and opencode cannot be steered mid-run and cannot be asked for
permission — neither CLI has a channel for it. A follow-up message becomes a
queued run that resumes the same session instead, and a refusal shows up on the
note as blocked rather than as a question.
:::

## Models

A model can be chosen in three places, most specific first:

1. **On the note** — pins that model for this job.
2. **On the board** — the default for each agent in this repo, in Settings.
3. **Neither** — the agent's own default.

The menu comes from the agents themselves wherever they'll say:

- **Codex** is asked over its app-server (`model/list`) — the models *your
  account* can run, and nothing it has hidden.
- **Cursor** is asked with `cursor-agent models`, which depends on your plan.
- **Claude Code** has no way to list its models, so kandy keeps a short list of
  what the CLI accepts — aliases first.
- **Any agent** — add your own model ids and they're offered beside the rest.

Each list is cached for an hour and refreshed in the background, so a menu never
waits on a network call. It is a menu, not a promise: an agent can still refuse
a model your account can't use.

::: tip
Aliases come first for Claude — `opus`, `sonnet`, `haiku` — because an alias
keeps pointing at the current model when a new one ships, and a pinned id does
not.
:::

## Permissions

Two levels, per note:

- **Repo only** — the agent edits files freely. When Claude Code wants to run a
  shell command, the question comes to the board and you answer it: once, for
  the rest of the note, or no — with a note saying what to do instead. Other
  agents can't ask, so their refused commands show the note as **blocked**,
  with a one-click way to continue with full access.
- **Full access** — it can run anything, without asking.

<p class="k-shot"><img class="only-light" src="/shots/site/askpane-light.webp" alt="A note waiting on you: the agent asks to run a shell command, with Allow once and Deny"><img class="only-dark" src="/shots/site/askpane-dark.webp" alt="A note waiting on you: the agent asks to run a shell command, with Allow once and Deny"></p>

A worktree bounds what an agent can damage *inside the repository*. It does
nothing about `$HOME` or the network, which is why full access is a decision
kandy asks you to make rather than one it makes for you.

## Rate limits

Claude Code reports how much of your subscription's five-hour and weekly windows
you've used. kandy shows it beside the agent in the web board, so you can see a
limit coming before a run hits it.
