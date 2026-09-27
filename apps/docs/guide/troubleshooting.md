# Troubleshooting

Each entry starts with what you see — usually kandy's exact words, so searching
this page for an error finds it. If yours isn't here,
[ask for help](#getting-help) and it will be.

::: tip The first thing to try
`kandy stop`, then run your command again. kandy runs a small background process
(the daemon) that every command starts for you; stopping it clears most
wedged states, and notes that were running can be resumed.
:::

## Installing and starting

### `kandy needs Node 22 or newer — this is Node 20…`

kandy keeps its board in Node's built-in SQLite, which arrived in Node 22.
Install a newer Node from [nodejs.org](https://nodejs.org) (or with `nvm install
22`, `fnm install 22`, `brew install node`), then run the install command again.

Older versions of kandy printed
`Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite`
instead. It means the same thing.

### `npm i -g` fails with `EACCES: permission denied`

npm is trying to write to a system directory. Don't use `sudo`; point npm at
one you own:

```sh
mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc   # or ~/.bashrc
```

Open a new terminal and install again. Node installed with `nvm`, `fnm` or
Homebrew doesn't have this problem.

### `kandy: command not found` right after installing

npm's global folder isn't on your `PATH`. Find it and add its `bin`:

```sh
npm prefix -g        # e.g. /Users/you/.npm-global
export PATH="$(npm prefix -g)/bin:$PATH"
```

Put the `export` line in `~/.zshrc` or `~/.bashrc` to keep it.

### `could not reach the kandy daemon`

The background process didn't start. Run it in the foreground to see why:

```sh
kandy serve
```

Whatever stops it is printed there. Press <kbd>Ctrl</kbd>+<kbd>C</kbd> when
you're done — the next command starts it in the background again.

### `port 4477 is taken by something that is not kandy`

Another program is using kandy's port. Either stop that program, or run kandy
on another port — and then pass the same `--port` to every command:

```sh
kandy serve --port 4478
kandy --port 4478
kandy --port 4478 "fix the flash"
```

### `kandy is already running`

Not an error: `kandy serve` found kandy already there, and printed its address
and process id. `kandy open` opens it; `kandy stop` stops it.

### `not a git repository`

kandy works on git repositories: every note becomes a branch. `cd` into one,
or make one:

```sh
git init && git add -A && git commit -m "Start"
```

A repository needs at least one commit — a note's branch starts from it.

### `no board here — run kandy in this repo once to create one`

`kandy ls` and friends work on the board for the repository you're in, and this
one hasn't got one yet. Run `kandy` here, or write a note with `kandy "…"`,
and it's created.

### The first-run question never appeared — or I picked the wrong answer

It's asked once, only in an interactive terminal, and never to someone who
already has a board. Run `kandy setup` to be asked again. It's also skipped
when `CI` or `KANDY_NO_SETUP` is set.

## Agents

### An agent says `ready`, but every run fails

The note fails within seconds, and the stream or its output says something like:

```
Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.
```
```
Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.
```

The agent's login has expired. kandy judges "ready" from the login each agent
leaves on disk, and some keep that file after the login itself has stopped
working. Sign in again with the agent's own command:

| Agent | Sign in again |
| --- | --- |
| Claude Code | `claude`, then `/login` |
| Codex | `codex login` |
| Cursor | `cursor-agent login` |
| opencode | `opencode auth login` |

Then run the note again. To check an agent directly, outside kandy:
`cursor-agent -p "reply ok"` or `codex exec "reply ok"`.

### `no agent is signed in here`

kandy found no agent it can run. `kandy status` lists each as `ready`,
`signed out` or `not installed`. Install and sign in to one —
[Agents](/agents/) has each one's commands.

### `signed out` next to an agent I use every day

kandy looks for the agent's login where the agent keeps it. If you sign in some
other way — an API key in an environment variable, say — kandy can't see it,
but the agent can: pick it anyway with `kandy "…" --agent codex`, and the run
will work if the agent does.

### A note sits in *queued* and never starts

Four notes run at once by default; the rest wait their turn. Check with
`kandy ls`. To allow more, restart kandy with more slots:

```sh
kandy stop && kandy serve --slots 8
```

On a team, a queued note may be waiting for the machine it was given to —
see [Hand work to someone](/modes/handoff).

### A note is stuck on *needs you*

It's asking you something. Open it (<kbd>Enter</kbd> in the terminal board, or
click it in the browser) and answer. A question left unanswered for **10
minutes** is refused, and the agent carries on without it — the stream says so.

### A note shows *blocked* with a list of refused commands

The agent is on **repo only** and tried something outside the repository — most
often running the tests or a build. Claude Code asks first; Codex, Cursor and
opencode can't ask, so they're refused outright. Either:

- click **Grant full access and continue** (browser), which resumes the same
  session with full access, or
- run the note with Claude Code, which asks instead of failing.

[Who decides what](/modes/permissions) explains the two levels.

### `setup failed after 12s (exit 1): npm install --no-package-lock`

Before an agent starts, kandy runs the board's setup command in the new
worktree — usually installing dependencies. It failed, so the agent never
started. Run the same command in your own checkout to see why, then fix it — or
change it in **Settings → Workspace** ([board settings](/guide/settings#workspace)).

### A note says *interrupted*

kandy was stopped or restarted while it ran. Nothing is lost: the worktree is
untouched and the agent's session was saved. Open it and press **Resume**.

### The agent's run ended but it didn't do what I asked

Send it back: in review, press <kbd>R</kbd> (or use the box under the note) and
say what's wrong. The same agent carries on in the same session. If it went
off in a direction you can't steer back, **Discard** and write a better note —
[Your first note](/guide/first-note) has what helps.

### Claude Code: a limit warning next to the agent

Claude Code reports how much of your plan's five-hour and weekly limits you've
used, and kandy shows it. When it's high, notes may stop partway until the
window resets. It's your plan's limit, not kandy's.

## Reviewing and landing

### Merge says there's a conflict

Your branch moved on while the agent worked, and both changed the same lines.
kandy leaves everything as it was — the note, its branch and its worktree — and
tells you. Either send it back with <kbd>R</kbd> ("rebase on main and resolve
the conflict") or resolve it yourself:

```sh
git merge kandy/note_…     # the branch name is on the note
```

### There's no *Open a PR* button

Pull requests are opened with the [GitHub CLI](https://cli.github.com), so it
must be installed and signed in (`gh auth login`), and the repository must be
on GitHub. Without it, the browser offers **Merge into main** instead.

### The diff shows a file I didn't expect

Every change the agent left is in the diff, including ones you didn't ask for —
that's what review is for. Send it back with <kbd>R</kbd> ("don't touch
package-lock.json"), or merge and fix it up.

### kandy is using a lot of disk

Each note gets its own worktree, and some — `node_modules` included — are big.
Reclaim them:

```sh
kandy gc --dry-run    # what it would remove
kandy gc
```

Finished notes lose their worktrees; notes in review keep theirs but lose
`node_modules` and caches. Running notes and branches are never touched.

## Teams

### `cannot reach https://kandy-hub.….ts.net — is Tailscale up?`

This machine is on a team and can't reach the hub. Check Tailscale:

```sh
tailscale status
```

If it's stopped, start it. If Tailscale is fine, the hub itself may be down —
ask its owner. To use your own board meanwhile, see the next entry.

### My commands go to the team's hub, but I want my own board

After `kandy join`, every command goes to the hub. For one command, use your own:

```sh
KANDY_LOCAL=1 kandy
```

To leave the team for good: `kandy leave`.

### `Nobody has added you to this hub yet.`

You're on the tailnet but not on the team. The message names the hub's owners;
ask one to run `kandy invite you@example.com` (or add you on the Team page).
Your machine is already set up and connects the moment they do.

### `the hub cannot tell who this machine belongs to.`

The hub knows people by their Tailscale login, and this machine arrived without
one. Either it isn't on the tailnet — check `tailscale status` — or it's a
*tagged* device, which Tailscale gives no person's identity. A hub won't run
anyone's work on a tagged machine; join from one signed in as you.

### `this hub wants a token.`

This hub isn't using Tailscale logins, so it asks for a shared token instead.
Its owner has it: `kandy join <url> --token <token>`.

### The hub's page won't load, or says it needs HTTPS

A hub on Tailscale is served over HTTPS, which each tailnet has to turn on once:
in the Tailscale admin console, **DNS → HTTPS Certificates → Enable**. The
[hub guide](/modes/hub) walks through it.

### A teammate's note is waiting on my machine

That's by design: nobody's notes run on your machine until you say so. Open it
and choose to run it, always allow that person, or decline. To change the
default:

```sh
kandy consent             # show the current setting
kandy consent team        # anyone on the team
kandy consent approved    # people you've approved (the default)
kandy consent nobody      # only you
```

### Where are the runner's logs?

On a team, your machine's runner logs to `~/.local/state/kandy/runner.log`.

## Starting over

If an update leaves a board unreadable — this is an alpha, and it can happen —
start fresh. **Your code is safe**: it's in your repository, and every note's
work is on its own git branch. What's lost is the board: its notes and history.

```sh
kandy stop
kandy leave                  # only if this machine joined a team
rm -rf ~/.local/state/kandy  # boards, notes, history, the daemon's token
rm -rf ~/.config/kandy       # the first-run answer and team membership
```

Then, in each repository kandy used, tidy its worktrees:

```sh
rm -rf .kandy/worktrees && git worktree prune
```

The `kandy/…` branches are still there for anything you didn't merge
(`git branch --list 'kandy/*'`).

## Getting help

[Open an issue](https://github.com/hiteshbandhu/kandy/issues/new) with:

- what you ran, and everything it printed;
- `kandy --version`, `node --version`, and your OS;
- the output of `kandy status`;
- on a team, the end of `~/.local/state/kandy/runner.log`.

Never paste the contents of `~/.local/state/kandy/token` — it's the key to your
board.
