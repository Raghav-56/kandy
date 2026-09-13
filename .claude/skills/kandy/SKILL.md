---
name: kandy
description: Queue, run and review coding work through kandy — a board where each note is one job an agent picks up in its own git worktree. Use when the user wants work done in parallel, wants to hand off a task and come back to it, says "queue this", "put that on the board", "run these in parallel", or asks what agent work is in flight, blocked, or waiting for review. Also use to check spend on agent runs.
---

# kandy

kandy runs coding jobs as **notes**. Each note gets its own git worktree and
branch, so several agents can work the same repository at once without seeing
each other's writes. The user's working tree is never touched.

Reach for this instead of doing the work yourself when the user wants something
**parallel** ("do all three"), **asynchronous** ("start it, I'll check later"),
or **isolated** ("try it without touching my branch").

## Check it is there

```sh
kandy status
```

Prints the daemon, the repos it knows, and which agents are installed and signed
in. If `kandy` is not on PATH, kandy is not installed — say so rather than
guessing at a path. Every other command starts the daemon itself if needed.

## Queue work

```sh
kandy "fix the flash when a note is selected"        # write it here and run it
kandy new "refactor the runner"                      # write it, don't run it
kandy new "add tests" --agent codex                  # choose the agent
kandy "short task" --no-run                          # same as `new`
```

The first line is the note's name; anything after it is detail. Both are given
to the agent, so put constraints and how-to-verify in the detail:

```sh
kandy "Add a --json flag to kandy serve
Print port, db path and slot count as JSON when --json is passed.
Verify with: pnpm build && node apps/server/dist/cli.js serve --json"
```

It finds the board by matching the current directory against known repos
(longest match wins, so a nested repo picks the inner one) and adopts the repo
as a new board if it has never seen it. Run it from inside the repository the
work belongs to.

## See what is happening

```sh
kandy ls          # what is open here
kandy ls --all    # including finished work
kandy open        # the board in a browser
```

`ls` orders by what needs a human first: needs-you, review, running, queued,
draft. Each note shows its agent, diff size, tokens and PR number where there is
one.

## Writing a good note

A note is a prompt, and the same things make it good:

- **Say how to verify it.** "Verify with `pnpm test`" turns a guess into a
  check the agent can run itself.
- **Name the files** when you know them. The agent is starting cold in a fresh
  worktree.
- **One job per note.** Two unrelated changes in one note produce one branch you
  have to split by hand. Two notes run at the same time anyway.
- **Say what not to touch.** Agents are literal, and a fresh worktree looks like
  fair game.

## What to tell the user afterwards

Report the note's name and that it is running — not a guess at the outcome. The
work happens in a separate process; you will not see it finish. Point them at
`kandy ls` or the board.

## What this does not do

- It does not merge or open pull requests. Those are decisions a person makes on
  the board, after reading the diff.
- It cannot answer whether a run succeeded, from here. Check `kandy ls`.
- Notes run with repo-only permissions unless the user chose full access on the
  board. An agent that cannot run your test command is expected, not broken.
