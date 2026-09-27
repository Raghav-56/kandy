# CLI reference

The terminal is where the thought occurs, so it's where kandy takes work in.
`kandy -h` prints one screen of this; `kandy <command> -h` prints one command;
`kandy help teams | capabilities | board | flags` goes deeper.

## Everyday

```sh
kandy "fix the login flash"      # write a note in this repo, and an agent runs it
kandy                            # the board, in this terminal (status when piped)
kandy open                       # the board, in a browser
kandy new "refactor the runner"  # write a note without running it
kandy ls [--all]                 # what's open here; --all includes finished work
kandy log [--verbose]            # what's happening, live
kandy stats [--json]             # what this board has done
```

`kandy "…"` runs with the last agent used on this board if it's still signed
in, otherwise the first one that is. `--agent claude|codex|cursor|opencode|aider`
picks one; `--no-run` writes without running.

## Teams

```sh
kandy join <hub-url>             # put this machine on a team
kandy invite <email> [--role member|viewer|owner]
kandy consent [nobody|approved|team]   # who may run notes on this machine
kandy consent revoke <email>
kandy leave                      # back to just this machine
kandy hub --tailscale            # start a team's board on this machine
kandy runner [--hub url]         # this machine's runner, in the foreground
```

See [Join a team](/modes/join) and [Run a hub](/modes/hub).

## What agents can reach

```sh
kandy skills                     # skills in this repo, and which runs can see them
kandy skills add <owner/repo>    # install for every agent
kandy skills commit              # commit the ones no run can see yet
kandy mcp                        # MCP servers every agent on this board gets
kandy mcp add <name> [--env K=V] -- <command…>
kandy mcp add <name> --url <url> [--header "K: V"]
kandy mcp rm <name>
```

See [Skills and MCP servers](/guide/capabilities).

## This machine

```sh
kandy status [--json]            # daemon or team, repos, which agents are signed in
kandy stop [--port N]            # stop kandy here; any command starts it again
kandy setup                      # the first-run question, again
kandy gc [--dry-run] [--force]   # reclaim disk from finished notes
kandy serve [--port N] [--slots N] [--json]   # the daemon, in the foreground
kandy skill                      # let other agents queue work onto a board
```

## How it finds the board

It matches your current directory against the repositories it knows — longest
match wins, so a repository nested inside another picks the inner one. On a team,
where a board was made from someone else's clone, it matches by git remote
instead. If it has never seen the repository, it makes it a board.

Run it from inside the repository the work belongs to.

## Starting and stopping

You don't start it. Every command starts the daemon if it isn't running — or, on
a team, this machine's runner — detached, so the shell that ran the command
isn't what keeps your agents alive.

To stop it, `kandy stop`. Notes that were running show as **interrupted**, and
**Resume** carries on where they stopped — the worktree and the agent's session
are kept. `kandy stop` then any command is how you restart kandy, for instance
after updating it.

## Environment

| Variable | Does |
| --- | --- |
| `KANDY_LOCAL=1` | use this machine's own board even while on a team |
| `NO_COLOR` | no colour, anywhere |
| `KANDY_HOSTS` | extra host names a daemon or hub answers to |
| `KANDY_NO_SETUP=1` | never ask the first-run question |

## `kandy stats`

Reads what's already in the log: notes landed versus discarded, spend and tokens,
lines written, how many landed on the first run with no steering, median and
longest run, the priciest note, the busiest hour, and the most-used tool — plus
an activity map, runs by hour, and the funnel from written to landed.

Figures mixing reported dollars with estimated ones carry a `≈` and say how many
runs were unpriced. An empty board shows blanks rather than zeroes, because a `0`
reads as a fact.
