# Who decides what

Most permission systems exist to stop people spending money and touching
production. kandy has neither problem: every run is paid for by whoever's
machine runs it, and git already governs merges. What's left are two questions
only a tool like this raises — who can read the work, and who can make code run
on your laptop.

| Question | Decided by |
| --- | --- |
| Who can open the board | the tailnet, then the hub's member list |
| Who can read, write, invite | their role on the hub |
| **Who may run code on my laptop** | **me** — my runner's consent setting |
| **My agent's permission prompts** | **me only** — not even a hub owner |
| Who may push, merge, open a PR | git and your forge, as always |
| Whose subscription pays | whoever's machine runs the note |

## Who you are

On a hub, identity comes from **Tailscale**. `tailscale serve` tells the hub the
login of whoever is asking, and that is the whole of it: no passwords, no
sessions, no kandy account. Two things are refused outright:

- **A request with no identity.** Tagged devices — CI boxes, shared servers —
  carry nobody's login, and the hub will not guess. They're refused, never
  treated as trusted.
- **A hub reachable any other way.** Identity is only believed from Tailscale's
  own proxy, so a hub with identity turned on refuses to listen anywhere but
  loopback.

## Roles

**Owner**, **member** and **viewer** — see [Run a hub](/modes/hub#inviting-people).
Every change to who is on the hub is an event in the log, with who made it.

## Running on someone's machine

If Bob could make a note run on Alice's laptop, Bob could make an agent act
under Alice's logins, with her keys. So that answer isn't a hub setting an admin
can change — it lives **on Alice's runner**, in a file only she controls.

Each runner has one setting, changed with `kandy consent`:

```sh
kandy consent                  # what it is now, and who you've approved
kandy consent team             # nobody | approved | team
kandy consent revoke bob@company.com
```

| Setting | Means |
| --- | --- |
| `approved` *(default)* | my own notes, and people I've approved. Anyone else's waits for me |
| `team` | anyone on the hub |
| `nobody` | only my own notes |

A note that's held shows on the board as a request, with who asked. Nothing is
checked out and nothing runs until Alice answers:

- **Run it** — this once.
- **Always allow Bob** — and from then on, Bob's notes run without asking.
- **Decline.**

Only the owner of that machine can answer. A hub owner who isn't Alice gets
*"only the owner of the machine it would run on can answer this."*

## An agent's permission prompts

Under **repo only**, when Claude Code wants to run a shell command the question
comes to the board. It can only be answered by the person whose machine the
agent is running on — the hub relays the question and the answer, and decides
neither.

<p class="k-shot"><img class="only-light" src="/shots/site/askpane-light.webp" alt="A note waiting on you: the agent asks to run a shell command, with Allow once and Deny"><img class="only-dark" src="/shots/site/askpane-dark.webp" alt="A note waiting on you: the agent asks to run a shell command, with Allow once and Deny"></p>

## Secrets

- **Agent logins** never leave the machine. kandy starts the CLI; it never reads
  a token.
- **MCP server secrets** are written as `${NAME}` on the board and filled in
  from each machine's own environment — the board, and the hub, never hold them.
  See [Skills and MCP servers](/guide/capabilities).
- **The daemon's own token** (for a machine on its own) lives in a file only you
  can read, and is never printed.

## What a hub never does

| Never | Because |
| --- | --- |
| Run an agent | it would pool everyone's credentials on one machine |
| Hold a provider key or forge token | kandy never has |
| Touch a repository | code travels through git, which already has permissions |
| Answer a permission prompt | that decision belongs to the machine that will run the command |
