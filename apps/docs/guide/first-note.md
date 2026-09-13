# Your first note

A note is a prompt with a lifecycle. It has a **name** — the line you see in the
list — and a **detail**, which is everything else the agent needs. Both are sent
to the agent; the split only decides what shows on the board.

## Write one

From the browser, press <kbd>c</kbd>. From the terminal:

```sh
kandy new "Add a --json flag to kandy serve
Print port, db path and slot count as JSON when --json is passed.
Verify with: pnpm build && node apps/server/dist/cli.js serve --json"
```

The first line names it; the rest is detail.

## What makes a good one

The same things that make a good prompt, plus one that is specific to working
in a fresh worktree:

- **Say how to verify it.** `Verify with: pnpm test` turns a guess into a check
  the agent can run itself. This is the single highest-value line you can add.
- **Name the files** when you know them. The agent starts cold, in a checkout it
  has never seen.
- **One job per note.** Two unrelated changes produce one branch you have to
  split by hand — and two notes would have run at the same time anyway.
- **Say what not to touch.** Agents are literal, and a fresh worktree looks like
  fair game.

![The board, sorted by what needs you](/shots/board.png)

## Run it

Assign an agent and run it, either from the board or in one step:

```sh
kandy "fix the flash when a note is selected" --agent claude
```

The note moves through **queued → running → review**. While it runs, the row
shows what the agent is doing right now — the tool and its target — rather than
a spinner.

## Permissions

Every note runs **repo only** by default: the agent can edit files, but most
shell commands are refused. That is safe, and it also means it cannot run your
tests.

**Full access** lets it run anything. A worktree bounds what it can damage
*inside the repo*; it does nothing about `$HOME` or the network. It is a per-note
choice, and kandy will never make it for you.
