# Notes and runs

## A note

One unit of work. It has a name, a detail, an agent, a model, a permission
level, and a status:

| Status | Meaning |
| --- | --- |
| `draft` | Written, not started. |
| `queued` | Accepted, waiting for a slot. |
| `running` | An agent process is live. |
| `blocked` | Something was refused. |
| `review` | Finished; a branch and a diff await a verdict. |
| `done` | Merged or discarded — the outcome is recorded separately. |
| `failed` | The run errored out. |

`blocked` is the only status that legitimately demands attention, and the
interface treats it that way everywhere.

Status is **machine state**. A note arrives in `running` because a process
started, not because anyone dragged it — which is why the board is a list sorted
by what needs you, rather than columns you push cards between.

## Writing one

The name and the detail are two fields, and the agent is given both — the split
decides what shows in the list, not what gets sent.

So a paste is split the same way round. Drop three paragraphs into the name and
the first line names the note while the rest lands in the detail, rather than
the browser keeping line one and discarding the remainder without saying so.
`kandy "…"` from a shell splits an argument by the same rule.

Paste a screenshot into either field and it is attached — see
[attachments](/concepts/steering#attachments).

## A run

One execution of a note by an agent. A note may have several over its life:
a retry, or a follow-up after you steered it.

Crucially, **a note has one workspace, not one per attempt**. A retry continues
in the existing worktree rather than creating a second one — otherwise the first
attempt's work would be stranded on an orphan branch.

A run records the agent's own session id, which is what makes resuming possible,
plus what it cost: tokens, turns, dollars where the agent reports them.

## Ordering

Notes are ordered by a **fractional index** rather than an integer. Moving one
between two others is a single write computing a key between its neighbours — no
renumbering, no write amplification, and two clients dragging at once produce
different keys instead of clobbering each other.

It is also the representation a list CRDT would need, so choosing it now keeps
the door to multiplayer open at no cost.
