# Steering

A note is not fire-and-forget. You can talk to it while it works.

## Two deliveries

A message sent to a note either:

**Reaches the live agent**, if its CLI accepts further turns on stdin. Claude
Code does, over `--input-format stream-json`. It lands in the agent's queue for
its next turn — it does not interrupt the tool loop it is currently in.

**Queues a follow-up run** that resumes the agent's session in the *same*
worktree, so it keeps both its context and its working state.

kandy tells you which happened, because from your side the difference between
"it heard me" and "it will hear me next turn" is the entire feel of the thing.

## One run is one turn

Claude's stdin stays open so steering can reach it — but left open after a turn
completes, it waits for more input forever, and the note never reaches review.
So the `result` event closes stdin: the process exits, the run finishes, the
note lands in review.

Steering after that point becomes a follow-up run. Same intent, one turn later.

<p class="k-shot"><img class="only-light" src="/shots/site/streampane-light.webp" alt="A finished run: the agent's own summary, what it cost, and a box to say what to change"><img class="only-dark" src="/shots/site/streampane-dark.webp" alt="A finished run: the agent's own summary, what it cost, and a box to say what to change"></p>

## Attachments

Files can be sent with a message — dropped, pasted or picked. They are written
into the note's **own worktree**, so the path handed to the agent is one it can
open with the tools it already has, and they are discarded with the worktree at
review. No upload service, no new capability, nothing to clean up.

A note being *composed* has no worktree — worktrees are made at run time — so a
screenshot pasted into the composer is held under kandy's state directory, keyed
by note id, and moved into the worktree the moment the run starts. The prompt
then names it by a relative path the agent can open. Nothing is written into
your repository for a note you have not run.

That staging area is on disk, so attachments survive a page reload, and a daemon
restart, between writing a note and running it. The one thing that does not
survive is a reload with the composer still open: an unsaved note is unsaved,
files and all.

Images and text are accepted, up to 8MB each and ten per note, decided from the
file's bytes rather than its name. Anything else is refused **with a reason** —
an attachment that silently fails to arrive is indistinguishable from an agent
ignoring it.

## Blocked

In headless mode, an agent that cannot ask for permission does not hang — it
**denies** and reports what it was refused. kandy surfaces those, which is what
makes `blocked` a real status rather than theatre.

What it cannot do yet is let you *answer* one. By the time a note goes blocked
the agent has moved on. Answering in flight needs the agent running in-process
rather than as a subprocess, which is a real fork in the architecture.
