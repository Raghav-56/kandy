# Reviewing work

An agent that "did stuff in your repo" is a toy. The point of a note is that it
comes back as a **branch and a diff**, and you decide.

## The diff

Open a note and switch to **Diff**. It is split per file rather than presented
as one scroll, because reviewing agent output means asking *what did it touch*
before *what did it write*.

Full screen puts the stream and the diff side by side — reading what the agent
said it did next to what it actually did is the real review motion.

![A finished note: its diff, what it cost, and merge, open a PR, or discard](/shots/review.png)

## Three ways to finish

There are exactly two destinations and a bin, so "merge" never means two
different things:

**Merge here** merges the branch into the base branch on this machine. Nothing
is pushed. The branch and worktree are removed; your own working tree is not
touched.

**Open a PR** pushes the branch and opens a pull request. This is the first
thing kandy does that leaves your machine. The note lands here automatically
once the PR is merged on the forge.

**Discard** deletes the branch and its worktree. The note stays, so you can run
it again.

Each asks first, and the question states what will happen to *that* branch —
which branch, how many files, where it lands. A confirmation that carries no
information is a speed bump, and people learn to click through those.

## Conflicts

A conflicting merge is reported, never guessed at. The merge is aborted, the
repository is left clean, and the branch is intact — you have a worktree and an
editor, and resolving it on your behalf is how trust dies.

## Sending it back

If the work is close but wrong, say so in the box at the bottom instead of
discarding. That queues a follow-up run which **resumes the agent's session in
the same worktree**, so it keeps its context rather than starting cold.
