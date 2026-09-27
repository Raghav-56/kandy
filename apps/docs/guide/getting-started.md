# Install and first run

::: warning Extremely experimental
kandy changes daily and is not published to npm yet. Install it from a clone,
expect to `git pull` often, and don't point it at anything you can't afford to
have an agent get wrong. [Status →](/status)
:::

## What you need

- **macOS or Linux**, **Node 22 or newer**, **pnpm**, and **git**.
- **At least one agent CLI, installed and signed in** — any of:
  [Claude Code](https://claude.com/claude-code) (`claude`),
  [Codex](https://developers.openai.com/codex/cli) (`codex login`),
  [Cursor](https://cursor.com/cli) (`cursor-agent login`),
  [opencode](https://opencode.ai), or [aider](https://aider.chat).
  kandy has no login of its own and never reads yours — it starts the CLI, and
  the CLI uses the login you already have.
- **For teams only:** [Tailscale](https://tailscale.com/download) on each
  machine. Not needed to use kandy on your own.

## Install

```sh
git clone https://github.com/hiteshbandhu/kandy.git
cd kandy
pnpm install
pnpm build
cd apps/server && pnpm link --global
```

That puts `kandy` on your PATH, pointing at your clone. To update:

```sh
cd kandy && git pull && pnpm install && pnpm build
```

## First run

Go into any git repository and run `kandy`:

```sh
cd ~/code/your-app
kandy
```

The first time — and only the first time — it shows which agents are signed in
on this machine and asks one question:

```
  How will you use it?
    1  Just me, on this machine          (enter)
    2  Join my team's hub
    3  Start a hub for my team
```

- **1 — Just me.** This repository becomes a board and the terminal board opens
  on it. Press <kbd>n</kbd> to write your first note. → [Just you](/modes/solo)
- **2 — Join my team's hub.** It asks for the hub's address and runs
  [`kandy join`](/modes/join) — which checks everything and connects this
  machine.
- **3 — Start a hub.** It checks Tailscale, explains where a hub should live,
  and offers to start one. → [Run a hub](/modes/hub)

It never asks in a script, a pipe or CI, and never asks someone who already has
a board. To answer again: `kandy setup`.

## Check it's working

```sh
kandy status
```

You should see the daemon (or your team), the repositories kandy knows, and each
agent as `ready`, `signed out` or `not installed`. A `signed out` agent needs its
own login command — `claude`, `codex login`, `cursor-agent login`.

## Next

- [Your first note](/guide/first-note) — what to write, and what happens.
- [The terminal board](/guide/terminal) — every key.
- `kandy -h` — one screen of commands; `kandy help <topic>` for more.
