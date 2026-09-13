# The CLI

The terminal is where the thought occurs, so it is where kandy takes work in.

```sh
kandy                           # status: daemon, repos, agents
kandy "fix the login flash"     # write a note here and run it
kandy new "refactor the runner" # write it, don't run it
kandy ls                        # what's open here
kandy ls --all                  # including finished work
kandy stats                     # what this board has actually done
kandy open                      # the board in a browser
kandy skill                     # install the agent skill globally
kandy serve --port N --slots N  # run the daemon in the foreground
```

Flags: `--agent claude|codex`, `--no-run`, `--port N`, `--all`.

## How it finds the board

It matches your current directory against the repos it knows, **longest match
wins** — so a repository nested inside another picks the inner one. If it has
never seen the repo, it adopts it as a new board.

Run it from inside the repository the work belongs to.

## Starting the daemon

You do not. Every command starts it if it is not running, detached, so the shell
that happened to run `kandy new` is not what keeps your agents alive.

## Colour

Dropped when stdout is not a TTY, or when `NO_COLOR` is set — piping `kandy ls`
somewhere never ships escape codes.

## `kandy stats`

Reads what is already in the log: notes landed versus discarded, spend and
tokens, lines written, how many landed on the first run with no steering, median
and longest run, the priciest note, the busiest hour, and the most-used tool.

It also draws three things a table cannot say:

- **An activity map** — twelve weeks of runs, a column per week. Empty days are
  drawn rather than skipped, because a gap is information.
- **Runs by hour** — a sparkline that tends to say more about you than about the
  agents.
- **A funnel** — written → ran → reviewed → landed, with what fell out at each
  step. This is the one shape only kandy can draw, since it is the only thing
  that knows where a job stopped.

Figures that mix Claude's reported dollars with Codex's computed ones carry a
`≈` and say how many runs were unpriced. An empty board returns blanks rather
than zeroes, because a `0` reads as a fact.
