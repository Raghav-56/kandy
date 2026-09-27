---
layout: home
---

## In thirty seconds

```sh
cd ~/your-repo
kandy "fix the flash when a note is selected"
```

That writes a note, makes the repository a board if kandy has never seen it,
and hands the job to an agent in a fresh git worktree — your own checkout is
never touched. Then:

```sh
kandy          # the board, right here in the terminal
kandy open     # the same board in a browser
```

The first time you run `kandy`, it asks one question — how you'll use it — and
sets up the rest. [Install it →](/guide/getting-started)

## Three ways to use it

| | You run | Your notes run on | For |
| --- | --- | --- | --- |
| [**Just you**](/modes/solo) | `kandy` | your machine | one person, one laptop — the default |
| [**Join a team**](/modes/join) | `kandy join <hub-url>` | your machine, with your agents | being on someone's shared board |
| [**Run a hub**](/modes/hub) | `kandy hub --tailscale` | nobody's — a hub runs nothing | starting a board a team shares |

Whatever the mode, the rule is the same: **work runs on the machine of the
person it belongs to, with their own agents and their own logins.** A shared
board never becomes someone else's compute. [How that works →](/modes/)

## What it does

- **One note is one job.** Each runs in its own git worktree on its own branch,
  so many agents work the same repository at once without colliding.
- **It comes back as a diff.** Review it file by file, then merge, open a PR,
  send it back with a comment, or throw it away.
- **Any agent.** Claude Code, Codex, Cursor, opencode, aider — the CLIs you
  already installed and signed into. kandy never reads a credential.
- **Change agent mid-job.** Start with Claude, continue with Cursor: the next
  agent gets a [briefing](/concepts/briefings) of what was done and decided, not
  a transcript to wade through.
- **Hand work to a teammate.** Their machine continues your branch, with their
  agent — and nothing runs on their laptop until they say yes.
- **Skills and MCP servers, set once.** Every agent on a board gets them, in its
  own format. Secrets stay on each machine.
- **A terminal that is a place to work.** `kandy` opens the board right in your
  terminal: run, steer, diff, merge, answer an agent — all from the keyboard.

## What it is not

Not a better chat with an agent. Chat wins at one task you are watching, and
always will. kandy is for the other case: several jobs, none of which you want
to sit through, and a pile of diffs to triage when you get back.

::: warning Extremely experimental
kandy is changing every day. It builds itself — the numbers above are its own
board — but expect breaking changes, rough edges, and the occasional board you
have to wipe. [Read what that means](/status) before you rely on it.
:::
