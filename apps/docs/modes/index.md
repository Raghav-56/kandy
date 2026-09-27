# Which one is you

kandy runs in three modes. They're the same program — `kandy` — doing different
jobs on different machines.

| | Just you | On a team | Running the hub |
| --- | --- | --- | --- |
| **Start with** | `kandy` | `kandy join <hub-url>` | `kandy hub --tailscale` |
| **The board lives** | on your machine | on the hub | here — this *is* the hub |
| **Your notes run on** | your machine | your machine | nobody's; a hub runs nothing |
| **Agents and logins** | yours | yours | none needed |
| **Needs Tailscale** | no | yes | yes |
| **Who else can see it** | nobody | everyone on the team | everyone on the team |

## Just you

The default, and what kandy has always been. One background process on your
laptop keeps the board and runs your agents. Nothing leaves your machine unless
you open a pull request. → [Just you](/modes/solo)

## On a team

A teammate runs a **hub** — a shared board. You run `kandy join` once, and from
then on every `kandy` command on your machine talks to that board. Your notes
still run **on your machine**, with your own Claude, Codex or Cursor, your own
logins, your own git credentials. The hub only keeps the record.
→ [Join a team](/modes/join)

## Running the hub

Someone has to host the shared board. A hub keeps the event log, knows who is on
the team, and relays between people and their machines. It **never runs an
agent, never holds a key, never touches a repository** — so it can live on a
small server, a spare machine, or in Docker. → [Run a hub](/modes/hub)

## The rule behind all three

> Everyone works on their own machine, with their own resources and their own
> agent logins. Nothing in kandy may make one person's laptop another person's
> compute.

It's why a hub runs nothing, why each person has a runner, and why a note
someone else sends to your machine **waits for you to accept it** before anything
starts. → [Who decides what](/modes/permissions)

## Moving between them

- Just you → a team: `kandy join <hub-url>`.
- A team → just you: `kandy leave`. Your notes on the hub stay there.
- On a team but want your own board for a minute: `KANDY_LOCAL=1 kandy …`.
