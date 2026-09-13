# Open questions

Honest list. These are unresolved, and some of them are load-bearing.

## Product

**What is a note's output, exactly?** "A branch and a diff" is the current answer. But most
agent work is not one clean commit — it's a branch with five messy commits and a conversation
that explains them. Does review show the diff, the transcript, or a generated summary? Getting
this wrong makes review feel like homework, and review is the whole back half of the product.

**Does a board map to a repo, or can it span repos?** One repo is simpler and matches worktree
isolation cleanly. But real work spans a frontend and a backend, and forcing two boards for one
task is exactly the friction we claim to remove.

**~~Free-position canvas or columns?~~** *Settled: columns.* We built the spatial version — a
3D board with cards in space — and it was worse at the only two questions a board needs to
answer. Free positioning is expressive; a lifecycle is not a thing you want to arrange by hand.
See [`10-interface.md`](10-interface.md).

**Where do rough thoughts live?** A note is a job: it has a lifecycle and it runs. There is
no home for the other kind of artifact — a strategy memo, a half-formed idea, a spec you want
three future notes to be given as context. `11-going-multiplayer.md` is the proof of the gap:
a conversation that had to be flattened into a repo file to survive, where the next agent has
to be *told* the file exists. Open whether that is a note type, a board-level drawer, or a
first-class context library that notes reference. Steering-chat attachments already do a narrow
version of it.

**Who is this for?** Someone running six agents at once is already sophisticated and probably
already has tmux and a script. The person who *needs* a board may not yet run enough agents to
need one. This gap is real and unresolved.

## Technical

**~~How does a blocked run actually surface?~~** *Partly answered.* Claude Code in headless
mode does not hang and does not silently auto-approve: it auto-**denies** what it cannot ask
about, emits the refusal as a `tool_result` with `is_error: true`, and reports every one in
`result.permission_denials` with the tool name and its arguments. So `blocked` is real, and the
adapter surfaces it.

What is still open is the other half: **we can see the denial but we cannot answer it.** The
agent has already moved on by the time the note goes blocked, so today "blocked" means "it was
refused something" rather than "it is waiting for you." Answering in-flight needs the
`canUseTool` callback from `@anthropic-ai/claude-agent-sdk`, which means running the agent
in-process rather than as a subprocess — a real architectural fork, not a tweak. Codex and the
others each express refusal differently and will need their own answer.

There is now a pragmatic version of the answer, which is not the same thing. The note's detail
pane shows what was actually refused — the exact commands, read out of the `permission` frames
the adapters already write — and offers one action: grant *this note* full access and continue.
That sets the note's policy and resumes the agent in the same worktree, one turn later, down the
same path steering uses. It is a decision made once, after the fact, about a whole note; it is
not an answer to a single prompt in flight, and the escalation says so plainly before you take
it. A board also carries a `defaultPolicy`, so a repo whose blast radius you're comfortable with
can start its notes unblocked and never reach this screen.

**Can we reliably capture agent session ids?** Resume — which steering depends on — needs them.
Claude emits `session_id` on every event and can even be handed one up front, so it is solved
there. Codex won't let us pre-assign one; Gemini doesn't reliably emit one at all. Steering will
therefore be excellent on some agents and degraded on others, which is a bad inconsistency to
put in front of a user without explaining it.

And even where we capture one, **it is machine-local** — a Claude session on my laptop is not
resumable on yours, and Codex's thread lives in my `~/.codex`. That caps what sharing can
honestly promise: a teammate gets a fresh run seeded with the replayed transcript, not a
resumed session. "Hand off the thread", not "resume the session". See
[`11-going-multiplayer.md`](11-going-multiplayer.md).

**How much output is too much?** An agent can emit megabytes. Storage, replay, and rendering
all need a cap or a rollup, and we haven't designed one.

**Does the in-process-worker trick survive our shape?** It's clean for opencode where the TUI
is the primary client. Our primary client is a browser, which *needs* a real HTTP server. So
the zero-port mode may only ever apply to the TUI — which means it may be complexity for a
secondary client. Worth deciding before implementing.

**What happens when the daemon dies mid-run?** Orphaned child processes, half-written
worktrees, notes stuck in `running` forever. Needs a reconciliation pass on startup: scan for
live PIDs, mark the rest failed, and say so honestly rather than leaving a lying board.

## Business / policy

**Does wrapping Claude Code's subscription auth violate Anthropic's terms?** Reported yes as of
~Feb 2026; unverified against primary source. This needs a real answer before the "use your
existing subscription" pitch appears anywhere public. See `05-agent-auth.md`.

**What stops t3code — or herdr — from adding columns?** Honestly: nothing, if the board is all
we have. The defensibility has to be in the execution model — parallel isolated worktrees with a
real review flow — which is genuinely harder to retrofit onto a chat-shaped architecture. That's
the bet, and it's a bet, not a certainty.

Sharpened since herdr: the one thing neither can retrofit cheaply is **handing a note to
another person's machine**, because a terminal pane is one machine, one user, and forgets when
it closes. Our append-only log is the substrate for that. Still a bet — and untested until a
note actually moves between two laptops.

**Is there a business here at all, if we don't sell inference?** We have no margin on tokens by
design. That leaves a paid tier for remote access, teams, or hosted relays — all of which are
M4+ features. Worth being clear-eyed that the free local product has no revenue path attached.

The sketch, such as it is, lives in [`11-going-multiplayer.md`](11-going-multiplayer.md). One
property worth protecting deliberately: because agents run on the user's machine with the user's
logins, a hosted tier stores and relays events but never runs inference, never pays for compute,
and never holds a provider key. Per-seat revenue against near-zero marginal cost. It would be
easy to trade that away later for a "run it in our cloud" feature that sounds convenient.

Open and unanswered: what enterprise actually pays for if the log rides on a private git repo,
since repo permissions then answer most of RBAC for free.
