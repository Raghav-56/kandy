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

### Then

1. **Open the hub's URL.** The first person in owns it.
2. **Add people** on the Team page, by the email Tailscale knows them by. Roles: *owner* (admits
   people), *member* (writes and runs), *viewer* (looks).
3. **Everyone runs a runner** on their own laptop, inside the repositories they work on:

   ```sh
   kandy runner --hub https://kandy-hub.<your-tailnet>.ts.net --repo ~/code/app
   ```

   `--repo` is optional; without it a runner finds its clones by git remote in the usual places.

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
