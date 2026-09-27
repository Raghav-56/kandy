# Hub and runners

On your own, kandy is one process: it keeps the board *and* runs the agents. On a
team those two jobs come apart, because the second one has to happen on each
person's own machine.

```
          ┌──────────── hub — a VPS, a spare box, a container ────────────┐
          │  event log · board · who is who · relay      runs nothing     │
          └──────▲───────────────────────▲───────────────────────▲────────┘
                 │ dials out             │ dials out             │ opens the board
          alice's laptop           bob's laptop               any browser
          runner                   runner
          her Claude Code          his Codex + Cursor
```

## The hub

Keeps the **event log** — every note, run, transcript line and decision, each
stamped with who made it — plus the member list, and serves the board. It is the
single writer, so there's one order of events and no two machines ever disagree
about the state of a note.

It never spawns an agent, never holds a key, never clones a repository. Anything
that needs a checkout — a diff, a merge, a PR, a handoff — is a **command** it
sends to the runner that has the checkout.

## A runner

Runs on one person's machine, with their agents, their logins and their clones.
It:

- **dials out** to the hub — nothing on a laptop listens on a port, so there's no
  firewall to open;
- tells the hub who it is, which agents are signed in, and which boards it has a
  clone of;
- keeps its own copy of the board, folded from the hub's stream of events;
- runs the notes **placed** on it, and streams everything they do back;
- answers the hub's commands — "show this diff", "merge this", "hand this over".

`kandy join` starts one in the background, and any `kandy` command restarts it if
it has stopped.

## Where a note runs

Each note is **placed** on one runner, and that placement is in the log. A note
you run with no placement goes to *your* machine — never quietly to someone
else's if yours is offline. A handed-over note is placed on the receiver's.

## Why it's built this way

If a company installed a single all-in-one daemon on a server, that server would
run everyone's agents under whatever credentials it had — one machine spending
everyone's tokens with pooled logins. Splitting the hub from runners is what
keeps work on the machine of the person it belongs to.

## The runner protocol

The conversation between a runner and a hub is a small, published protocol —
four HTTP routes and a stream of events. It's written up in the repository at
[`docs/18-runner-protocol.md`](https://github.com/hiteshbandhu/kandy/blob/main/docs/18-runner-protocol.md),
and a conformance test drives a hub with a runner written only against that
document. It's the part meant for others to build on: a runner on a CI box, in a
sandbox, or for an agent kandy doesn't support.
