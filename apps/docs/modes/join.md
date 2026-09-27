# Join a team

Someone on your team runs a [hub](/modes/hub). Joining it takes one command, and
from then on your notes appear on the shared board — while still running on
**your** machine, with **your** agents.

## Before you start

- **Tailscale is running** on your machine and you're signed in to your team's
  tailnet. The hub is only reachable from inside it.
- **kandy is installed** ([install](/guide/getting-started#install)).
- **An owner has added you** by your Tailscale login email. If they haven't yet,
  `kandy join` tells you who to ask — so you can run it first and find out.

## Join

The hub's owner gives you its address. It looks like
`https://kandy-hub.your-tailnet.ts.net`.

```sh
kandy join https://kandy-hub.your-tailnet.ts.net
```

It checks, in order, and stops at the first thing that needs fixing — saying
exactly what to do about it:

| It checks | If not |
| --- | --- |
| Can this machine reach the hub? | "cannot reach it", plus whether Tailscale is up here |
| Does the hub know who you are? | this machine isn't on the tailnet, or is a *tagged* device, which carries nobody's identity |
| Has an owner added you? | "Nobody has added you yet — ask alice@…", with the command to give them. This machine is saved and connects the moment they do |
| Which agents are signed in here? | lists the signed-out ones |
| Which of the team's repositories are cloned here? | a ✓ per board — found by git remote, so your clone can be anywhere on your disk |

Then it starts this machine's **runner** in the background and waits until the
hub can see it.

```
  hub     https://kandy-hub.your-tailnet.ts.net
  you     bob@company.com · member
  agents  claude codex cursor
  repos
    ✓ web-app  ~/code/web-app
  runner  connected

  You're in. Your notes run on this machine, with your agents and logins.
```

![Opening the hub before an owner has added you: who you are, which owners can add you, and the command to give them](/shots/not-added.png)

## After joining

Every `kandy` command on this machine now talks to the hub:

```sh
cd ~/code/web-app
kandy "fix the login flash"     # a note on the team's board, run on your machine
kandy                           # the team's board, in your terminal
kandy status                    # which team, your role, is your runner connected
```

Open the hub's address in a browser to see the same board — with every note
tagged by the machine it's on, and a **Team** page listing people, machines and
recent activity.

You never have to start the runner. Any `kandy` command starts it again if it
has stopped — after a restart, say.

## Notes someone sends you

When a teammate [hands you a note](/modes/handoff), or asks for one to run on
your machine, it arrives as a **request**: nothing is checked out, nothing runs,
no tokens are spent. You see *"Alice wants to run this on your machine with
Claude Code"* and choose **Run it**, **Always allow Alice**, or **Decline** — in
the browser, or with <kbd>y</kbd> / <kbd>Y</kbd> / <kbd>n</kbd> in the terminal
board. [More on who decides what →](/modes/permissions)

## Leaving

```sh
kandy leave
```

Stops the runner and forgets the hub. Notes you started stay on the board, and
their branches are wherever you pushed them. For a quick look at your own local
board without leaving: `KANDY_LOCAL=1 kandy`.
