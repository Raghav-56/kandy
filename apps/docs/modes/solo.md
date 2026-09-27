# Just you

One person, one machine. This is what you get by default, and it needs nothing
but kandy and a signed-in agent.

## Starting

```sh
cd ~/code/your-app
kandy
```

The repository becomes a board the first time you run kandy in it, and the
[terminal board](/guide/terminal) opens. Or write a note straight away:

```sh
kandy "fix the login flash"
```

## What's running

A single background process — the **daemon** — on port `4477`. It keeps your
board, runs agents, and serves the web board. You never have to start it: every
`kandy` command does, and it keeps running after the command exits, so closing
your terminal doesn't kill your agents.

To run it in the foreground instead (to watch its output):

```sh
kandy serve --port 4477 --slots 4
```

`--slots` is how many agents may run at once. Four is the default.

## Where things are

| | |
| --- | --- |
| The board | `kandy` (terminal) or `kandy open` (browser, `http://127.0.0.1:4477`) |
| Its data | `~/.local/state/kandy/` — the event log, transcripts, diffs |
| Each note's work | `<repo>/.kandy/worktrees/<note>/`, excluded from git |
| Disk used by old notes | `kandy gc` reclaims it (`--dry-run` to see first) |

## Who can reach it

Only this machine. The daemon listens on `127.0.0.1`. Anything that changes the
board needs a token kept in a file only you can read, and the web board fetches
it for you. Reads from anywhere but this machine are refused.

## Several repositories

Each repository is its own board. Run `kandy` inside any of them; switch boards
in the terminal with <kbd>b</kbd> or in the browser from the menu at the top
left. `kandy status` lists them all.
