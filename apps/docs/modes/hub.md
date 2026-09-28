# Run a hub

A hub is the board your team shares. It keeps the log of everything that
happens, knows who is on the team, and passes work between people and their
machines.

It **runs no agents, holds no keys, and never touches a repository.** Every note
runs on the machine of the person it belongs to. That's what lets a hub live
somewhere small and boring — and why it can't spend anyone's tokens.

::: warning Extremely experimental
Teams are the newest part of kandy. It has been run end to end on a real
tailnet — a hub in Docker, a Mac joined to it, a real note run through it — but
by very few people. Expect to hit things. [Status →](/status)
:::

## What you need

- **A machine that stays on** — a small VPS, a spare box, a home server, or
  Docker. Not a laptop that sleeps: when the hub is off, nobody's board is.
- **Tailscale**, with two settings on in the
  [admin console](https://login.tailscale.com/admin/dns):
  - **MagicDNS** — gives the hub a name.
  - **HTTPS certificates** — gives that name an `https://` address. Tailscale
    will warn that the machine's name is published in public certificate logs:
    only the name (`kandy-hub.tail1234.ts.net`) is, not access to it, and your
    tailnet's name is already a random one.

## Option A — Docker (recommended)

From a clone of kandy:

```sh
deploy/try-hub.sh
```

It checks Tailscale, MagicDNS and HTTPS, builds the hub, and starts it beside a
Tailscale container. With no auth key, it prints a **one-time link**: open it,
signed in as you, to approve the hub onto your tailnet — nothing to revoke
later. (Or pass one: `TS_AUTHKEY=tskey-auth-… deploy/try-hub.sh`.) When it's
up:

```
  The hub is up.

  1  open https://kandy-hub.tail1234.ts.net  — the first person to open it owns it
  2  connect this machine:  kandy join https://kandy-hub.tail1234.ts.net
  3  add people on the Team page, or: kandy invite <email>
```

Stop it with `docker compose down`; wipe it — board and all — with
`docker compose down -v`, then remove the `kandy-hub` machine in the Tailscale
admin console.

The image holds Node and kandy and nothing else: no agent CLIs, no git, and it
runs as a non-root user.

## Option B — on a machine with Tailscale

```sh
kandy hub --tailscale
```

It serves itself on your tailnet with `tailscale serve` and takes that down again
when it stops. A new hub prints its next three steps.

## Owning it

**Whoever opens the hub first becomes its owner** — by opening the board, or
with `kandy join`. A health check, a script or a runner doesn't claim it, and the
hub prints who became owner. On a tailnet, "whoever can
reach it" is already someone your company let onto its network. The owner sees a
checklist that ticks itself off:

![A new hub's setup checklist: connect your machine, add a board, invite your team](/shots/hub-setup.png)

1. **Connect your machine** — `kandy join <hub-url>` on your own laptop, like
   everyone else.
2. **Add a board** — `kandy` inside a repository on your laptop, or from the
   web.
3. **Invite your team.**

## Inviting people

On the **Team** page, add someone by the email Tailscale knows them by — or from
any joined machine:

```sh
kandy invite bob@company.com                # member, by default
kandy invite carol@company.com --role viewer
```

Either way you get a message to paste to them:

![After adding someone: a message to send them, with the install and join commands](/shots/invite.png)

| Role | Can |
| --- | --- |
| **owner** | everything, plus add, remove and change people. A hub always keeps at least one |
| **member** | write and run notes, review, hand work to people |
| **viewer** | look |

Someone on your tailnet whom nobody has added sees who they're signed in as and
which owners can add them — never an error page.

::: tip Not on your tailnet?
Share the hub's machine with them from the Tailscale admin console. People who
accept a share are still identified by their own login.
:::

## Without Tailscale

`kandy hub` with no flag runs with a single token instead of identities. There
are no people — whoever holds the token is the one person — so it suits one
person with two machines, not a team. Join it with
`kandy join <url> --token <token>`; the token is in the hub's state directory,
and the hub's banner prints both commands. A wrong token is refused at join,
with "that token was refused".

It listens on `127.0.0.1` only. To reach it from your other machine, start it
with the name that machine will use and an address it can reach:
`KANDY_HOSTS=my-box.local kandy hub --bind 0.0.0.0`.

## What the hub stores

The event log (every note, run, transcript and decision, with who made it), the
member list, and the diffs snapshotted at review. **Not** code, not credentials,
not agent logins. Code travels through your git remote, which already decides who
may clone what.
