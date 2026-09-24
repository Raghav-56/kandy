# Running a hub for your team

A hub is the board your team shares. It keeps the log, serves the board, and relays between
people and their machines. **It never runs an agent, never holds a provider key, and never touches
a repository.** Each person's notes run on their own laptop, with their own agents and their own
logins, through `kandy runner`.

```
          ┌──────────── hub (a VPS, a spare box, a container) ────────────┐
          │  log · board · who is who · relay        runs nothing         │
          └──────▲───────────────────────▲───────────────────────▲────────┘
                 │ dials out             │ dials out             │ opens the board
          alice's laptop           bob's laptop               anyone's browser
          kandy runner             kandy runner
          her Claude Code          his Codex + Cursor
          her git creds            his git creds
```

## On a tailnet (recommended)

Tailscale is the network *and* the identity. Nothing is exposed to the internet, runners need no
tokens, and "who is this" is answered by the tailnet — the hub only keeps its own list of who is on
the team and what they may do.

### With Docker

```sh
# 1. An auth key: https://login.tailscale.com/admin/settings/keys
# 2. Start it
TS_AUTHKEY=tskey-auth-… \
KANDY_TAILNET_HOST=kandy-hub.<your-tailnet>.ts.net \
docker compose up -d
```

`compose.yaml` runs the hub beside a Tailscale sidecar sharing its network. The hub listens on
`127.0.0.1` inside that network and nothing else can reach it there — which is what makes Tailscale's
identity headers safe to believe.

### Without Docker

On any machine that is on your tailnet with MagicDNS and HTTPS certificates on:

```sh
kandy hub --tailscale
```

It runs `tailscale serve` for itself and takes it down on exit.

### Then — onboarding, start to finish

**The owner** (whoever opens the hub first):

1. Opens the hub's URL. They are its owner, and a **Set up your hub** checklist ticks itself off as
   they go: connect your machine, add a board, invite your team.
2. Connects their own laptop: `kandy join https://kandy-hub.<tailnet>.ts.net`.
3. Adds people — on the Team page, or from any joined machine:

   ```sh
   kandy invite bob@corp.com            # --role member (default) | viewer | owner
   ```

   Either way they get a message to paste to Bob:

   ```
   You're on the kandy hub at https://kandy-hub.<tailnet>.ts.net
   1. Make sure you're on our Tailscale network.
   2. Install kandy:  <install command>
   3. Connect your machine:  kandy join https://kandy-hub.<tailnet>.ts.net
   Your notes run on your own machine, with your own agents.
   ```

**The new person** runs one command:

```sh
kandy join https://kandy-hub.<tailnet>.ts.net
```

It checks, in order, and says plainly what is wrong at whichever step fails:

| Check | If it fails |
| --- | --- |
| Can this machine reach the hub? | "cannot reach it", plus whether Tailscale is up here |
| Does the hub know who this is? | not on the tailnet, or a tagged device — which carries nobody's identity |
| Has an owner added them? | "Nobody has added you yet — ask alice@…: `kandy invite bob@…`". The machine is saved and connects the moment they do |
| Which agents are signed in here? | lists the signed-out ones and how to sign in |
| Which team repositories are cloned here? | ✓ per board, found by git remote, not path |

Then it starts this machine's runner in the background and waits until the hub sees it. From then
on **every `kandy` command on that machine talks to the hub**: `kandy "fix the flash"` inside a
repository makes a note on the team's board and runs it here; `kandy` shows the team, and whether
this machine's runner is connected. Nothing to remember, no runner to start by hand — any command
restarts it if it has stopped. `kandy leave` puts the machine back to single-player.

Someone who opens the hub in a browser before being added sees who they are signed in as, which
owners can add them, and the exact command to give them — never an error page. A member whose own
machine is not connected sees a banner with the `kandy join` command until it is.

`KANDY_LOCAL=1 kandy …` uses this machine's own board even while on a team.

> **Install command.** Every onboarding message reads it from one constant,
> `packages/core/src/install.ts`. It is a placeholder: the name `kandy` on npm belongs to someone
> else, so it must be changed once the package's npm name is chosen.

## What people control, and what the hub does not

| | Decided by |
| --- | --- |
| Who can open the board | the tailnet, then the hub's member list |
| Who can read, write, admit | role on the hub |
| **Who may run code on my laptop** | **me** — `accept` on my runner: *nobody*, *people I approve* (default), *team* |
| Answering my agent's permission prompts | me, and only me — not even a hub owner |
| Who may push, merge, open a PR | git and your forge, as always |
| Whose subscription pays | whoever's machine runs it — nobody spends anyone else's tokens |

A note someone asks to run on your machine arrives as a request with their name on it. Nothing
starts until you say yes; "always" answers it for that person from then on.

## Handing work to someone

Give a note to a teammate from the board. The machine that has it commits what is there and pushes
the branch — with its owner's credentials — and the receiver's runner continues that same branch,
briefing its agent on what came before. It works across agents: Claude on one laptop, Cursor on the
next.

The repository needs a remote both machines can reach. That is the only requirement, and git has
already decided who may clone it.

## Without Tailscale

A hub can run on a single token instead: `kandy hub`, then `kandy runner --hub <url> --token
<token>` (the token is in the hub's state directory). There is no identity, so there are no people —
whoever holds the token is the one person. Useful for one person with two machines; not for a team.

To reach it from other machines, put it behind a proxy you trust and name the host:

```sh
KANDY_HOSTS=kandy.example.com kandy hub --bind 0.0.0.0
```

`--bind` anything other than loopback is refused when identity is on: it would let anyone who can
reach the port claim to be anyone.

## PRs

A PR opens from the runner that holds the branch, pushed with its owner's `gh`. Each runner also
watches the PRs of its own notes — CI going green, a review, a merge on GitHub landing the note —
because watching needs `gh` and the repository, and the hub has neither.

## Known gaps in this version

- **Permission prompts reach the board from Claude only.** Codex, Cursor and opencode need their own
  structured protocols to ask; see [`17-capabilities.md`](17-capabilities.md).
