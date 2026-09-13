# Getting started

## What you need

- **Node 22 or newer**, and **pnpm**.
- **At least one agent CLI**, installed and signed in: [Claude
  Code](https://claude.com/claude-code) or [Codex](https://developers.openai.com/codex/cli).
  kandy never reads your credentials — it spawns the CLI you already
  authenticated, and the child inherits your login.
- **Git**, and a repository to point it at.

## Install

kandy is not published, so install it from a clone:

```sh
git clone https://github.com/hiteshbandhu/kandy.git
cd kandy
pnpm install
pnpm build

cd apps/server && pnpm link --global
```

That puts `kandy` on your PATH. Check it:

```sh
kandy status
```

You should see the daemon, any repos it knows, and which agents are installed
and signed in. If an agent shows `signed out`, run its own login command — kandy
has no login of its own.

::: tip
The global link points at `apps/server/dist`, so after changing CLI code you
need `pnpm build` before `kandy` reflects it.
:::

## Point it at a repository

From inside any git repository:

```sh
cd ~/your-repo
kandy new "try something small"
```

kandy adopts the repo as a board the first time it sees one, picks a default
model for each installed agent, and guesses how to make a fresh worktree ready —
`pnpm install`, `npm ci`, `uv sync`, whatever your lockfiles imply.

Open the board:

```sh
kandy open
```

## One process, one URL

`kandy serve` runs the daemon and serves the board from the same port. There is
no separate front-end to start:

```sh
kandy serve --port 4477 --slots 4
```

`--slots` is how many agents may run at once. Every other command starts the
daemon itself if it is not already up, so you rarely run this by hand.
