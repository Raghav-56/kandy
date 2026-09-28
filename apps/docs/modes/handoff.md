# Hand work to someone

On a team, a note can move from your machine to a teammate's — mid-job, with its
branch, and with a briefing for whichever agent they use.

## How

Open the note and choose **Give to…** — or press <kbd>g</kbd> in the terminal
board. The list shows connected machines that have this repository, named by
whose they are.

![Give to…: the other machine that has this repository, and the note's combined diff behind it](/shots/give-to.png)

A note can't be handed over while it's running — stop it first, or wait.

## What happens

1. **Your machine lets go.** It commits anything the agent left uncommitted and
   pushes the note's branch to your git remote — with *your* git credentials.
   The hub never holds a forge token.
2. **The hub records it** — who handed what to whom, and which branch — in the
   log, where the Team page's activity shows it.
3. **Their machine picks it up.** It finds its own clone of the repository by git
   remote (not by path — their clone can be anywhere), fetches the branch, and
   continues **on top of your commits**, so the review shows the whole note.
4. **Their agent is briefed.** Even if it's the same agent: your agent's session
   lives on your laptop, so theirs starts fresh — with a
   [briefing](/concepts/briefings) of what was asked, decided, tried and
   finished. The transcript says so: *"briefed on 2 earlier runs by Claude
   Code"*.

Handing a note over **doesn't run it**. Your teammate runs it — or someone asks
them to, and their machine's [consent setting](/modes/permissions#running-on-someone-s-machine)
answers.

## Across agents

It doesn't matter what either of you uses. Claude on your laptop, Cursor on
theirs, is the normal case — tested end to end: Claude wrote half a module on one
machine, and Cursor on another was briefed and finished it on the same branch.

## What you need

- **A remote you can both reach.** The branch travels through git. A repository
  with no remote can't hand work to anyone, and kandy says so.
- **Their machine connected**, with a clone of the repository.

## What if it goes wrong

- **Their machine is offline:** the handoff is refused — "bob@…'s machine is
  offline — give it once it reconnects" — and the note stays with you. A machine
  that drops out mid-run shows offline within seconds; if it's gone for 90
  seconds its run is marked interrupted, and can be resumed.
- **The push fails** (no rights, a protected branch): nothing moves, and the
  error says why.
- **The branch isn't on the remote when they pick it up:** their runner says so
  in the transcript and starts fresh rather than failing.
