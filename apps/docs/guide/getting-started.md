---
outline: [2, 2]
---

# Get started

From nothing installed to your first agent-written change merged — about ten
minutes, most of it the agent working. Every screen and every line of output
below is from a real run, made while this page was written: Claude Code working
on a small timer app called `pomodoro`.

::: warning Extremely experimental
kandy changes daily. Expect to update often, and point it at a repository where
an agent getting something wrong costs you nothing. [What that means →](/status)
:::

## 1. Check the basics

You need three things kandy doesn't install for you.

| | Check | Why |
| --- | --- | --- |
| **macOS or Linux** | — | Windows installs and runs, but has barely been tried ([Status](/status)). |
| **Node 22 or newer** | `node --version` | kandy stores its board with Node's built-in SQLite, which arrived in 22. |
| **git** | `git --version` | Every note runs in its own git worktree, on its own branch. |

And **at least one coding agent, installed and signed in**. kandy has no login
of its own and never reads yours — it starts the agent's CLI, and the CLI uses
the login it already has.

| Agent | Install | Sign in | Guide |
| --- | --- | --- | --- |
| Claude Code | `npm i -g @anthropic-ai/claude-code` | `claude`, then `/login` | [Claude Code](/agents/claude-code) |
| Codex | `npm i -g @openai/codex` | `codex login` | [Codex](/agents/codex) |
| Cursor | `curl https://cursor.com/install -fsS \| bash` | `cursor-agent login` | [Cursor](/agents/cursor) |
| opencode | `npm i -g opencode-ai` | none for its free models; `opencode auth login` for your own | [opencode](/agents/opencode) |
| aider | `python -m pip install aider-install && aider-install` | its own provider keys | [aider](/agents/aider) |

No subscription? **opencode** runs free models with no sign-in.
If you're not sure which to pick, start with **Claude Code**: it's the one kandy
is built and tested against every day, and the only one that can stop and ask
you before running a command ([why that matters](#_7-answer-its-question)).

## 2. Install kandy

::: code-group

```sh [macOS / Linux]
curl -fsSL https://hiteshbandhu.github.io/kandy/install.sh | sh
```

```powershell [Windows]
irm https://hiteshbandhu.github.io/kandy/install.ps1 | iex
```

:::

The script checks you have Node 22 or newer, installs the newest release from
GitHub, and then asks two questions: how you'll use kandy (just you, joining a
team, or starting a hub), and what agents may do — **full access** (the
default) or **repo only**. It asks only once; running it again just updates.
You can read it first: [install.sh](https://hiteshbandhu.github.io/kandy/install.sh) · [install.ps1](https://hiteshbandhu.github.io/kandy/install.ps1).

Rather not pipe a script into a shell? The same thing by hand:

```sh
npm i -g https://github.com/hiteshbandhu/kandy/releases/latest/download/kandy.tgz
kandy setup
```

Check it:

```sh
kandy --version
```
```
0.2.0-alpha.5
```

To **update**, `kandy update` — or run the install command again. Either
stops a running kandy first, so the next command starts the new version. To **remove** it,
`npm rm -g kandy` — your boards stay in `~/.local/state/kandy` until you delete
that too.

::: details Why not `npm i -g kandy`?
The name `kandy` on npm belongs to an unrelated package, so that command would
install a stranger's code. kandy installs from its GitHub releases until it has
an npm name of its own.
:::

::: details Install from source, to follow `main`
```sh
git clone https://github.com/hiteshbandhu/kandy.git
cd kandy && pnpm install && pnpm build
cd apps/server && pnpm link --global
```
Update with `git pull && pnpm install && pnpm build` in the clone. You'll need
[pnpm](https://pnpm.io/installation) for this route.
:::

## 3. Run it in a repository

Go into any git repository — one of your own, or a scratch one — and run
`kandy`:

```sh
cd ~/Developer/pomodoro     # any git repository
kandy
```

The first time, and only the first time, kandy says hello, shows which agents it
found signed in, and asks one question:

<p class="k-shot"><img src="/shots/start/terminal-firstrun.webp" alt="kandy's first run: the logo, the agents found on this machine, and the question — just me, join my team's hub, or start a hub for my team"></p>

- **1 — Just me** <kbd>Enter</kbd>. Everything on this machine. Pick this unless
  someone has sent you a hub address. → [Just you](/modes/solo)
- **2 — Join my team's hub.** It asks for the address and runs
  [`kandy join`](/modes/join), which checks everything and connects this
  machine.
- **3 — Start a hub for my team.** It checks Tailscale, explains where a hub
  should live, and offers to start one. → [Run a hub](/modes/hub)

Choosing **just me** turns this repository into a board and opens it, right in
the terminal — a kanban, one column per stage, with more columns off to the right
(`2›`) when the terminal is narrow:

```
 ▮▮▮  pomodoro   +                                              0 need you · ● live
────────────────────────────────────────────────────────────────────────────────────
INBOX 0 ──────────────────── QUEUED 0 ────────────────── RUNNING 0 ────────────── 2›
 n writes a note              —                           nothing running
```

It never asks in a script, a pipe or CI, and never asks someone who already has
a board. To answer again, run `kandy setup`. Press <kbd>q</kbd> to leave the
board — kandy keeps running in the background, so notes carry on without it.

## 4. Check what can run

```sh
kandy status
```
```
  repos
    pomodoro ~/Developer/pomodoro

  agents
    claude     ready 2.1.283 (Claude Code)
    codex      ready codex-cli 0.154.0
    aider      not installed
    cursor     ready 2026.09.25-5d5651d
    opencode   not installed

  board  http://127.0.0.1:4477
```

Each agent is **ready**, **signed out** or **not installed**. A signed-out agent
needs its own login command from [step 1](#_1-check-the-basics).

::: tip "ready" means signed in as far as kandy can tell
kandy asks each agent whether it's logged in, and some answer yes for a login
that has quietly expired. If a note fails at once with *Authentication
required* or *refresh token was revoked*, sign in to that agent again —
[Troubleshooting](/guide/troubleshooting#an-agent-says-ready-but-every-run-fails).
:::

## 5. Write your first note

A note is one job. Its **first line is the title**; anything after it is detail.
The agent gets both.

```sh
kandy "Reset the timer with the R key
R resets to a fresh focus session, like the Reset button. Ignore it while typing in an input." --agent claude
```
```
  ✓ Reset the timer with the R key  running with claude
    http://127.0.0.1:4477
```

That wrote the note and started Claude Code on it, in a fresh worktree on its
own branch. Your checkout wasn't touched — keep working in it.

The same thing, two other ways:

- **In the terminal board:** press <kbd>n</kbd>, type, and press <kbd>Enter</kbd>.
  <kbd>Ctrl</kbd>+<kbd>J</kbd> starts the detail on a new line.
- **In the browser:** `kandy open`, then write in the box at the bottom.

<p class="k-shot"><img class="only-light" src="/shots/site/composer-light.webp" alt="The note composer in the browser, with Claude Code chosen"><img class="only-dark" src="/shots/site/composer-dark.webp" alt="The note composer in the browser, with Claude Code chosen"></p>

Without `--agent`, kandy uses the last agent run on this board, or the first one
signed in. To write a note without starting it, use `kandy new "…"`.

::: tip The line that makes notes work
Say how to check the work: *"Verify with: npm test"*. The agent starts in a
checkout it has never seen, and a way to check itself is the difference between
a guess and a change you can trust. More in [Your first note](/guide/first-note).
:::

## 6. Watch it run

Open the board with `kandy` — or `kandy ls` for a quick list:

```
 ▮▮▮  pomodoro   +                                  1 running · 0 need you · ● live
────────────────────────────────────────────────────────────────────────────────────
INBOX 0 ──────────────────── QUEUED 0 ────────────────── RUNNING 1 ────────────── 2›
 n writes a note              —                          ╭─────────────────────────╮
                                                         │ Reset the timer with    │
                                                         │ the R key               │
                                                         │ ⠇ running     claude 3s │
                                                         ╰─────────────────────────╯
```

Each note is a card, coloured by what it's waiting for — blue while it runs.
Move with the arrow keys or click; press <kbd>Enter</kbd> or double-click to
follow it live: every file it reads, every edit, every command. <kbd>m</kbd>
sends it a message mid-run; <kbd>x</kbd> cancels it. You don't have to watch —
that's the point — but you can. [Every key, and the mouse →](/guide/terminal)

In the browser (`kandy open`) it's the same board:

<p class="k-shot"><img class="only-light" src="/shots/site/board-light.webp" alt="The board in the browser: notes waiting on you, ready to review, in the backlog, and done"><img class="only-dark" src="/shots/site/board-dark.webp" alt="The board in the browser: notes waiting on you, ready to review, in the backlog, and done"></p>

Run several notes at once — each has its own worktree, so they never step on
each other. Four run at a time by default.

## 7. Answer its question

A few seconds in, the note stopped: **needs you**. Every note
starts **repo only** — the agent edits files freely, but a shell command is put
to you first. Here it wanted to run the tests:

<p class="k-shot"><img src="/shots/start/terminal-ask.webp" alt="A note in the terminal waiting on you: Claude Code wants to run npm test, with a to allow once and D to deny"></p>

- <kbd>a</kbd> — **allow once**.
- <kbd>A</kbd> — **allow for this note**, so it isn't asked again for commands
  like it. Not offered for chained commands (`&&`, `;`, `|`): a rule made from
  one would cover more than you just read.
- <kbd>D</kbd> — **deny**, with a message saying what to do instead.

In the browser, the question is pinned at the top of the board and on the note:

<p class="k-shot"><img class="only-light" src="/shots/site/askpane-light.webp" alt="A note waiting on you in the browser, with Allow once and Deny"><img class="only-dark" src="/shots/site/askpane-dark.webp" alt="A note waiting on you in the browser, with Allow once and Deny"></p>

Only Claude Code can ask. Codex, Cursor and opencode have no way to, so under
repo only their refused commands are refused outright and the note shows as
**blocked**, with one click to continue with full access.
[More on access](/modes/permissions).

## 8. Read what it did

When it finishes, the note moves to **review**. Open it for the agent's own
account of the work — what changed, what it checked, and what it didn't:

<p class="k-shot"><img src="/shots/start/terminal-summary.webp" alt="The finished note in the terminal: the agent's summary in plain English, what it cost, and the keys to diff, merge, revise or discard"></p>

The last line is what the run cost: 7 turns, 131,855 tokens, **$0.17**.

Then the diff — <kbd>d</kbd> in the terminal, **Diff** in the browser. File by
file; <kbd>]</kbd> and <kbd>[</kbd> move between files:

```diff
 src/app.js
 @@ -21,7 +21,23 @@ const timer = new Timer(
  document.getElementById("start").onclick = () => timer.start()
-document.getElementById("reset").onclick = () => {
+function reset() {
   timer.reset()
+  phase.textContent = "Focus"
   document.title = plainTitle
 }
+
+document.getElementById("reset").onclick = reset
```

::: tip "Nothing is committed," says the agent
It's describing its own work. When a run ends, kandy commits whatever it left
on the note's branch, with the note's title as the message — so a review is
always a real branch, and nothing is lost if you walk away.
:::

## 9. Land it

Three ways to finish a note:

| | Terminal | Browser | What happens |
| --- | --- | --- | --- |
| **Merge** | <kbd>M</kbd> | **Merge into main** | The branch is merged into your current branch, on this machine. Nothing is pushed. |
| **Open a PR** | — | **Open a PR** | Pushes the branch and opens a pull request. Shown instead of Merge when the repo is on GitHub and the [`gh` CLI](https://cli.github.com) is signed in. |
| **Send it back** | <kbd>R</kbd> | the box under the note | Say what to change. The same agent carries on, in the same worktree and the same session. |
| **Discard** | <kbd>X</kbd> | **Discard** | Deletes the branch and its worktree. The note stays, so you can run it again. |

Each asks first and says exactly what it will do:

<p class="k-shot"><img src="/shots/start/terminal-merge.webp" alt="The terminal asking: Merge “Reset the timer with the R key” into main? y / n"></p>

Press <kbd>y</kbd>, and it's done:

<p class="k-shot"><img src="/shots/start/terminal-board.webp" alt="The terminal board: one note in review, and the merged note under Done with its line counts"></p>

```sh
git log --oneline -2
```
```
43840c9 Reset the timer with the R key
329935f Reset the timer with the R key
```

The first is the merge, the second the note's commit. Your checkout was never
touched while the agent worked. Now that the work has landed, the note's
worktree is removed; its branch is kept, because in a repo with no remote it's
the only copy.

## 10. Where next

<div class="k-cards">
  <a href="./first-note"><strong>Write better notes</strong><span>What to put in one so the agent gets it right the first time.</span></a>
  <a href="./terminal"><strong>The terminal board</strong><span>Every key, and how to work from the keyboard all day.</span></a>
  <a href="../agents/"><strong>Agents</strong><span>Set up Claude Code, Codex, Cursor, opencode or aider — and what each can do.</span></a>
  <a href="../modes/"><strong>Work as a team</strong><span>Share a board; everyone's notes still run on their own machine.</span></a>
  <a href="./settings"><strong>Board settings</strong><span>Setup commands, access, models, skills and MCP servers.</span></a>
  <a href="./troubleshooting"><strong>Troubleshooting</strong><span>When something doesn't work, and what to do about it.</span></a>
</div>
