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

![The agent's reasoning, eighteen tool calls folded away behind one line, and a box to answer back](/shots/stream.png)

## Attachments

Files can be sent with a message — dropped, pasted or picked. They are written
into the note's **own worktree**, so the path handed to the agent is one it can
open with the tools it already has, and they are discarded with the worktree at
review. No upload service, no new capability, nothing to clean up.

## Blocked

In headless mode, an agent that cannot ask for permission does not hang — it
**denies** and reports what it was refused. kandy surfaces those, which is what
makes `blocked` a real status rather than theatre.

What it cannot do yet is let you *answer* one. By the time a note goes blocked
the agent has moved on. Answering in flight needs the agent running in-process
rather than as a subprocess, which is a real fork in the architecture.
