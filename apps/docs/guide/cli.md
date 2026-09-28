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
kandy consent approve|revoke <email>
kandy leave                      # back to just this machine
kandy hub --tailscale [--https-port N] [--bind addr] [--json]
                                 # start a team's board on this machine
kandy runner [--hub url] [--token t] [--repo path] [--slots N] [--json]
                                 # this machine's runner, in the foreground
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
kandy update [--check] [--force] # the newest release, in place
kandy setup                      # the first-run questions, again
kandy gc [--dry-run] [--force]   # reclaim disk from finished notes
kandy serve [--port N] [--slots N] [--json]   # the daemon, in the foreground
kandy skill                      # teach your own agent to queue work on kandy
```

`kandy skill` copies the kandy skill to `~/.claude/skills/kandy`, so an agent you
talk to in any repository can queue notes and check on them for you. Run it
again after an update for the newest version. It's not `kandy skills`, which is
about the skills in this repository.

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
are kept. `kandy stop` then any command is how you restart kandy.

`kandy update` asks GitHub for the newest release and, if it's newer, stops
the running kandy (and your team runner) and installs it — then says what
changed from what: *0.2.0-alpha.5 → 0.2.0-alpha.7*. Stopping kandy interrupts
the notes it's running, so when there are any it lists them and asks first; from
a script, with no terminal to ask in, it stops there unless you pass `--force`.
Interrupted notes can be resumed. After installing it starts your team runner
again, and checks that the `kandy` on your `PATH` is the new one — if another
install comes first, it says where.

It installs with the npm that belongs to the Node running kandy, so a second
Node on your machine (nvm, fnm, Homebrew) doesn't get it instead. Run from a
source checkout, it tells you to `git pull` there instead of installing over
it. It arrived in 0.2.0-alpha.7: on anything older, `kandy
update` isn't a command yet — update with the install script instead.

`kandy update --check` only says whether there is a newer release, and its exit
code says it to a script:

| Exit | Means |
| --- | --- |
| `0` | up to date |
| `10` | a newer release is out |
| `1` | couldn't tell — GitHub didn't answer |

## Environment

| Variable | Does |
| --- | --- |
| `KANDY_LOCAL=1` | use this machine's own board even while on a team |
| `KANDY_NO_SETUP=1` | never ask the first-run questions (also skipped when `CI` is set) |
| `NO_COLOR` | no colour, anywhere |
| `KANDY_NO_MOUSE=1` · `KANDY_MOUSE=1` | the terminal board's mouse off · on where it's off by default ([more](/guide/terminal)) |
| `KANDY_QUIET_MS` · `KANDY_STALL_MS` · `KANDY_STALL_TOOL_MS` | when a quiet agent is warned about and stopped ([more](/guide/troubleshooting)) |
| `XDG_STATE_HOME` · `XDG_DATA_HOME` · `XDG_CONFIG_HOME` | where kandy keeps its board, data and settings — a `kandy` folder in each; `~/.local/state`, `~/.local/share` and `~/.config` when unset or empty |

For a team's hub and runners:

| Variable | Does |
| --- | --- |
| `KANDY_HUB` | the hub `kandy runner` runs notes for, when there's no `--hub` — before the one you joined |
| `KANDY_HUB_TOKEN` | the hub's token for `kandy runner`, when there's no `--token` — for a hub without Tailscale |
| `KANDY_BIND` | the address `kandy hub` listens on, when there's no `--bind` (default `127.0.0.1`) |
| `KANDY_HOSTS` | extra host names a daemon or hub answers to, comma-separated — for a proxy in front of it |
| `KANDY_IDENTITY=tailscale` | trust Tailscale's identity headers from a sidecar — a hub in a container, as in `compose.yaml` |
| `KANDY_TAILNET_HOST` | the name that sidecar serves the hub under, e.g. `hub.your-tailnet.ts.net`; needed with `KANDY_IDENTITY` |

For the install script:

| Variable | Does |
| --- | --- |
| `KANDY_TGZ` | install this tarball instead of the newest release |
| `KANDY_ALLOW_ROOT=1` | let `install.sh` run as root — for a container where root is the only user |

## `kandy stats`

Reads what's already in the log: notes landed versus discarded, spend and tokens,
lines written, how many landed on the first run with no steering, median and
longest run, the priciest note, the busiest hour, and the most-used tool — plus
an activity map, runs by hour, and the funnel from written to landed.

Figures mixing reported dollars with estimated ones carry a `≈` and say how many
runs were unpriced. An empty board shows blanks rather than zeroes, because a `0`
reads as a fact.
