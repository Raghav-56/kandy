# How kandy works

kandy is a board. Each **note** on it is one job for a coding agent. You write
the note, kandy runs an agent on it somewhere safe, and the job comes back as a
**diff you decide about**.

That loop is the whole product. Everything else — teams, handoffs, the terminal
board — is that loop, made to work in more places.

## The loop

```
  write a note  →  an agent works in its own worktree  →  a diff comes back  →  you decide
       ↑                                                                            │
       └──────────────────────── send it back with a comment ──────────────────────┘
```

**1. You write a note.** A title and, optionally, detail — constraints, files to
look at, how to verify. From the terminal (`kandy "fix the login flash"`), the
terminal board (`n`), or the browser (`c`).

**2. kandy makes it a safe place to work.** A fresh `git worktree` of your repo,
on a new branch, so the agent can change anything without touching your
checkout — and so ten agents can work the same repo at once without seeing each
other. Gitignored files you need, like `.env`, are carried in; a setup command
like `pnpm install` runs before the agent arrives.

**3. An agent does the job.** Whichever you choose: Claude Code, Codex, Cursor,
opencode or aider. kandy starts the CLI you already installed and signed into —
it never sees your credentials. You watch it live, or you don't.

**4. It comes back as a diff.** When the agent stops, whatever it changed is
committed on the note's branch and the note moves to **Review**.

**5. You decide.** Merge it into your branch. Open a pull request. Send it back
with a comment and the same agent picks up where it left off. Or discard it.

## Where things live

| Thing | Where |
| --- | --- |
| Your notes, runs, transcripts, costs | an event log in `~/.local/state/kandy/` |
| Each note's work in progress | `<your repo>/.kandy/worktrees/<note>/`, on branch `kandy/<note>-…` |
| Your agent logins | wherever each CLI keeps them — kandy never touches them |
| A team's shared board | on the hub, if you're on a team; see [Hub and runners](/concepts/hub-and-runners) |

## The pieces

**The daemon** keeps the board and runs agents. On your own it is one
background process — every `kandy` command starts it if it isn't running.

**The web board** (`kandy open`) and **the terminal board** (`kandy`) are two
views of the same thing. Change one, and the other updates live.

**On a team**, the daemon comes apart into two halves: a **hub** that keeps the
shared board and runs nothing, and a **runner** on each person's laptop that runs
that person's notes. [The three modes](/modes/) explains when you'd want which.

## What kandy never does

- **Read or store your agent credentials.** It starts the CLI; the CLI logs in.
- **Touch your working tree.** Agents only ever work in their own worktree.
- **Push, merge or open a PR without you asking.** Every one of those is a
  button you press after reading the diff.
- **Run someone's work on your machine without your say-so.** On a team, a note
  someone else sends your way waits for you to accept it.
