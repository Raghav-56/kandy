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

**Free-position canvas or columns?** Sticky notes imply free positioning, which is expressive
in a browser and meaningless in a terminal. Columns are honest in both. Current assumption:
columns are the model, canvas is a browser-only *view* — but this has not been tested with a
real user and it is the core of the "sticky note" pitch.

**Who is this for?** Someone running six agents at once is already sophisticated and probably
already has tmux and a script. The person who *needs* a board may not yet run enough agents to
need one. This gap is real and unresolved.

## Technical

**How does a blocked run actually surface?** A permission prompt from an agent's stdout has to
become a structured request we can answer from a browser. Each CLI expresses this differently
and some don't express it at all — they just hang, or auto-approve because we passed a bypass
flag. If we always pass bypass flags, `blocked` never happens and our safest-looking status is
theatre.

**Can we reliably capture agent session ids?** Resume — which `revise` depends on — needs them.
Codex won't let us pre-assign one. Gemini doesn't reliably emit one. This may make `revise`
work well for some agents and not others, which is a bad user-facing inconsistency.

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

**What stops t3code from adding columns?** Honestly: nothing, if the board is all we have. The
defensibility has to be in the execution model — parallel isolated worktrees with a real review
flow — which is genuinely harder to retrofit onto a chat-shaped architecture. That's the bet,
and it's a bet, not a certainty.

**Is there a business here at all, if we don't sell inference?** We have no margin on tokens by
design. That leaves a paid tier for remote access, teams, or hosted relays — all of which are
M4+ features. Worth being clear-eyed that the free local product has no revenue path attached.
