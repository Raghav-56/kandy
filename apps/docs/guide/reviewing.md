# Reviewing work

An agent that "did stuff in your repo" is a toy. The point of a note is that it
comes back as a **branch and a diff**, and you decide.

## The diff

Open a note and switch to **Diff** — or, in the terminal board, press
<kbd>d</kbd>. It is split per file rather than presented as one scroll, because
reviewing agent output means asking *what did it touch* before *what did it
write*. In the terminal, <kbd>]</kbd> and <kbd>[</kbd> jump between files.

Full screen puts the stream and the diff side by side — reading what the agent
said it did next to what it actually did is the real review motion.

<p class="k-shot"><img class="only-light" src="/shots/site/review-light.webp" alt="A finished note open beside the board: its diff, what it cost, and Merge into main or Discard"><img class="only-dark" src="/shots/site/review-dark.webp" alt="A finished note open beside the board: its diff, what it cost, and Merge into main or Discard"></p>

## Three ways to finish

There are exactly two destinations and a bin, so "merge" never means two
different things:

**Merge** (<kbd>M</kbd> in the terminal, **Merge into main** in the browser)
merges the branch into the branch the note started from, in your checkout, on
this machine. Nothing is pushed. Your checkout has to be on that branch, and not
partway through a merge, rebase or cherry-pick — otherwise kandy says what's in
the way and merges nothing. Once it lands, the note's checkout and its branch
are tidied away — unless something in the checkout is uncommitted, in which case
it is kept, because it may be the only copy. In the browser, Merge is offered
when there's nowhere to open a pull request; in a GitHub repo, work leaves
through a PR.

**Open a PR** pushes the branch and opens a pull request. This is the first
thing kandy does that leaves your machine. It needs the
[`gh` CLI](https://cli.github.com), signed in. The note lands here
automatically once the PR is merged on GitHub.

**Discard** (<kbd>X</kbd>) removes the note's worktree. Its branch stays on this
machine, unpushed, so the work can be recovered — the note says which branch,
and `git branch -D kandy/note_…` deletes it for good. The note stays, so you can
run it again.

Merge and discard are for a note that has stopped — in **review**, or
**failed** — and has a branch with commits on it. While a note runs they aren't
offered; send it a message, or cancel it first.

Each asks first, and the question states what will happen to *that* branch —
which branch, how many files, where it lands. A confirmation that carries no
information is a speed bump, and people learn to click through those.

## Conflicts

A conflicting merge is reported, never guessed at. The merge is aborted, the
repository is left clean, and the branch is intact — you have a worktree and an
editor, and resolving it on your behalf is how trust dies. kandy names the
files that conflicted.

A merge can also be stopped before it starts by your own uncommitted changes to
files the branch touches. kandy tells the two apart: a conflict names the
conflicting files; uncommitted changes in the way say *would be overwritten*,
and committing or stashing them is all it takes.

## Sending it back

If the work is close but wrong, say so in the box at the bottom — or press
<kbd>R</kbd> in the terminal — instead of discarding. That queues a follow-up
run which **resumes the agent's session in the same worktree**, so it keeps its
context rather than starting cold.

You can also send it back to a *different* agent. Pick another one and run it:
that agent can't resume the first one's session, so it gets a
[briefing](/concepts/briefings) instead — what was asked, what was decided,
what failed, and where the code stands.

## Handing it to someone

On a team, **Give to…** on a note hands it to a teammate's machine: yours pushes
the branch, theirs continues it. See [Hand work to someone](/modes/handoff).
