# Your first note

A note is a prompt with a lifecycle. Its first line is its **title** — what you
see in the list. Everything after is **detail**. The agent gets both; the split
only decides what the board shows.

## Write one

Three ways, same result:

```sh
kandy "Add a --json flag to kandy serve
Print port, db path and slot count as JSON when --json is passed.
Verify with: pnpm build && node apps/server/dist/cli.js serve --json"
```

- **In the terminal board** (`kandy`): press <kbd>n</kbd>, type, <kbd>Enter</kbd>.
  <kbd>Ctrl</kbd>+<kbd>J</kbd> adds a line for the detail.
- **In the browser** (`kandy open`): press <kbd>c</kbd>.

`kandy "…"` writes the note and runs it straight away with the last agent used
on this board — or the first one signed in. Pick one with `--agent codex`, or
write without running using `kandy new "…"`.

## What makes a good one

The same things that make a good prompt, plus a few that matter because the
agent starts in a fresh checkout it has never seen:

- **Say how to verify it.** `Verify with: pnpm test` turns a guess into a check
  the agent can run itself. The single most valuable line you can add.
- **Name the files** when you know them.
- **One job per note.** Two unrelated changes make one branch you'll have to
  split by hand — and two notes would have run at the same time anyway.
- **Say what not to touch.** Agents are literal, and a fresh worktree looks like
  fair game.

<p class="k-shot"><img class="only-light" src="/shots/site/board-light.webp" alt="The board: notes waiting on you, ready to review, in the backlog, and done"><img class="only-dark" src="/shots/site/board-dark.webp" alt="The board: notes waiting on you, ready to review, in the backlog, and done"></p>

## What happens

The note moves through **queued → running → review**. While it runs, its row
shows what the agent is doing right now — the tool and its target — and opening
it shows the transcript live. When the agent finishes, whatever it changed is
committed on the note's branch, and the note waits in **Review** for you.

Want to change course mid-run? Send it a message — see
[Steering](/concepts/steering).

## Permissions

Every note starts **repo only**: the agent edits files freely, and when it
wants to run a shell command, Claude Code puts the question to you on the board
— allow it once, allow that kind of thing for this note, or deny it with a note
saying what to do instead. Other agents can't ask yet, so a refused command
shows as **blocked**, with a one-click way to continue with more access.

**Full access** lets it run anything without asking. A worktree bounds what it
can damage *inside the repository* — it does nothing about your home directory
or the network. It's a per-note choice, and kandy never makes it for you.
