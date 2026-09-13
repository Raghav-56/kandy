# What's unfinished

kandy is alpha. It runs real work every day on its own repository, and these are
the parts that do not work yet — named here rather than left to be discovered.

## `blocked` can be seen but not answered

Refusals surface correctly: a headless agent denies what it cannot ask about and
reports it, and kandy shows that. But by the time a note goes blocked the agent
has already moved on, so there is nothing to approve.

Answering in flight needs the `canUseTool` callback, which means running the
agent in-process rather than as a subprocess. That is an architectural fork, not
a patch.

## Only two agents

Claude Code and Codex have adapters. Cursor, opencode, Gemini and Grok appear in
the data model and the UI but do nothing.

## No auth on the HTTP port

The daemon binds `127.0.0.1`, so nothing is exposed today. But `kandy serve
--port` has no token, and a bound port is reachable by every process on the
machine.

## No worktree collection

Worktrees are kept until a note is reviewed, which is right — review needs the
diff. But an abandoned note keeps its worktree forever, and ten `node_modules`
is real disk.

## Codex cost is an estimate

Codex reports tokens and no dollar figure. kandy prices those against a table
that will go stale. Everywhere such a number appears it is marked `≈`, and any
total says how many runs were unpriced — but for anything that matters, check
your provider's billing.

## Notes cannot be reordered meaningfully

Fractional indexing is implemented and works, but the triage list sorts by
urgency, so manual ordering has nowhere to show. It matters if a board view
comes back.

## No sync

One daemon owns the state. Clients are views. That is correct for the local
case and wrong for anything else — offline editing, two people on one board, or
a board that exists without a daemon running would all need real sync.

The intended answer is Yjs, and the decision that matters is already made: the
local daemon is authoritative and the cloud would be a relay, never a copy.
