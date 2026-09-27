# Briefings

When a note moves to an agent that can't resume the last one's session — a
different agent, or the same agent on a teammate's machine — it doesn't get the
previous transcript. It gets a **briefing**.

## What's in one

In the order that stops the next agent re-deriving what's already known:

1. **What was wanted** — the note itself.
2. **Where the code stands** — the branch and its diffstat. Named, never
   described: git carries the code better than prose can.
3. **What people asked for** along the way — every steer and answer, verbatim.
4. **What already failed** — so it isn't tried again.
5. **Where it stopped** — or, if the work was finished, *"what they finished"*
   with an instruction to check it rather than repeat it.

Tool calls, file reads and the agent's own thinking aloud are left out. They're
most of a transcript and none of what's known.

It also tells the new agent plainly that it didn't write the code on the branch —
so it reads before it rewrites.

## When one is sent

| The next run is… | It gets |
| --- | --- |
| the same agent, same machine, same checkout | its own session, resumed — better than any summary |
| a different agent | a briefing |
| the same agent on another machine (a handoff) | a briefing — the session is on someone else's laptop |

The transcript says when it happened: *"briefed on 2 earlier runs by Claude
Code"* — useful for agents like Cursor and Codex that don't echo their prompt.

## Does it work

Measured on this repository, handing a finished job to Cursor: briefed, it took
**5 tool calls and 31 seconds** to check the work and confirm it. Cold, with only
the note, it took **108 tool calls and 272 seconds** rediscovering the same
ground.
