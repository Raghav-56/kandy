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

**Merge here** (<kbd>M</kbd> in the terminal) merges the branch into the base
branch on this machine. Your own working tree is not touched. The note's
checkout is then tidied away — unless something in it is uncommitted, in which
case it is kept, because it may be the only copy.

**Open a PR** pushes the branch and opens a pull request. This is the first
thing kandy does that leaves your machine. The note lands here automatically
once the PR is merged on the forge.

**Discard** (<kbd>X</kbd>) deletes the branch and its worktree. The note stays,
so you can run it again.

Each asks first, and the question states what will happen to *that* branch —
which branch, how many files, where it lands. A confirmation that carries no
information is a speed bump, and people learn to click through those.

## Conflicts

A conflicting merge is reported, never guessed at. The merge is aborted, the
repository is left clean, and the branch is intact — you have a worktree and an
editor, and resolving it on your behalf is how trust dies.

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
