# Spike: sharing a board over a git orphan branch

What [`11-going-multiplayer.md`](11-going-multiplayer.md) asked for at the end: *"one share, two
laptops, over a git remote."* This is that, minus the two laptops — two stores, two clones, one
bare remote, in `apps/server/test/share.test.ts`. The code is `apps/server/src/share.ts` and is
deliberately not wired into the daemon or the CLI. There is no `kandy share` command. The
experiment runs through tests and nothing else can reach it.

Verdict: **the transport holds and is boring, which is the good outcome. The product around it
does not hold yet, and the gap is bigger than the transport was.**

## The shape

An orphan branch `kandy-log`, flat, one file per device:

```
<deviceId>.jsonl    append-only; only its owning device ever writes it
README
```

Never checked out. `push` and `pull` are git plumbing — `hash-object`, `mktree`, `commit-tree`,
`update-ref` — against a ref at `refs/kandy/log`, outside `refs/heads` so it never appears in
`git branch` or a branch picker. A test asserts the working tree, HEAD and branch list are all
untouched by a full push-and-pull cycle. That property is non-negotiable: the user is working in
this repo, and a sync that moves their HEAD is worse than no sync.

## Does the merge hold under concurrent append?

Yes, and not for the reason 11 gives. 11 says *"one file per device so merges stay trivial."* The
stronger and simpler statement is that **there is no merge at all.**

`pushLog` fetches the remote tree, rebuilds it with exactly one blob replaced — its own — and
commits that. When two devices push at once the loser's ref is stale and its push is rejected;
the retry re-fetches and rebuilds against the winner's tree. Nothing is ever merged, so there is
no content conflict to resolve, no `-X ours`, no dependence on git's rename or hunk heuristics for
data that has no business being diffed. The invariant is one writer per path, and it is enforced
by construction: a device only knows how to write `<its own id>.jsonl`.

The test `"a three-way push never conflicts"` runs the racy case — both devices write blind, both
push, both pull — and both boards end with both notes.

Two things I did not establish. The retry loop is three attempts and there is a genuine
fetch-to-push window; with two devices it settles immediately, but I never ran N devices pushing
on a timer, and that is where a livelock would show up if one exists. And every push re-fetches
and re-reads the whole branch, so "settles fine" is a claim about correctness, not about cost.

## Force-push, rewritten history, long absence

**A device offline for a month is the case that works best.** There is no handshake, no session,
no "last seen." The files carry full history and the watermark is `(origin, oseq)` in the local
`shared` table, so a device that missed five hundred events pulls the file and folds everything
above its own mark. Nothing expires. This is the single best property the design has, and it
falls out of append-only for free.

**A force-push is survivable and leaves permanent damage.** Nothing here defends against one.
`fetchLog` uses a `+` refspec — a forced update, by design — so a truncated branch silently
becomes our view of the truth. Then two things happen. Locally, already-folded events stay folded,
because `shared` remembers them, so my board keeps notes that no longer exist on the branch.
And `pushLog` computes "what does my file already have" *from the remote blob*, so against a
truncated file it re-appends events it has already published, with their original `oseq`s.

Consumers survive that: `isShared` rejects the second copy on read, so nobody's board doubles. But
the file now carries duplicate lines forever, and there is no detection and no repair path. If
this ships it needs, at minimum, a refusal to fast-forward backwards — compare the fetched commit
against the last one we pushed and stop rather than absorb a rewrite.

**Rewriting the code history is mostly orthogonal**, because the log is an orphan and shares no
objects with `main` (asserted: `merge-base --is-ancestor refs/kandy/log main` fails). One exception,
and it is a bad one: `repoKey` identifies the board by the repo's **root commit**. A squash to a
single commit, or a `filter-repo`, changes the root commit and therefore silently changes the
board key. Every device would decide it is looking at a different board. The root commit was the
right instinct — it is the only identifier already identical in every clone — but it is not as
immutable as I treated it.

## Size, and what to do when it is too big

Measured by shape, not by a year of use. A note that is written, assigned, run once and reviewed
is about ten events. Most serialise to 150–300 bytes; `note.created` is the outlier because it
carries the whole prompt. Call it 2–3 KB per note. Two people at twenty notes a day is roughly
1.5 MB a month. Ten people is about 180 MB a year. As stored bytes, none of that is a problem —
JSONL appends delta beautifully once packed.

The problem is not the bytes, it is **that every push rewrites the whole file as a new blob**.
Between garbage collections those are loose objects. Fifty pushes a day against a 5 MB file writes
250 MB of loose objects to say a few kilobytes. `exportable` also walks the entire local log on
every push, and `fetchLog` parses every device's entire file on every pull, so both sides are
O(total history) per sync for an O(new events) result.

The fix is cheap and I did not make it, because the spike existed to answer the merge question
with the least machinery: **chunk the path** — `<device>/<YYYY-MM>.jsonl`. One writer per path is
preserved, no merge is reintroduced, and both the blob rewrite and the parse become bounded by the
current chunk. Do this before anyone uses it twice.

The bigger size question is one this spike dodged. `run.output` and the transcript are not shared,
and that omission is doing all the work in the numbers above. Transcripts are orders of magnitude
larger than domain events — that is why 02 put them in their own table. But "same context, same
transcript" is the actual promise in 11. **The size analysis here is only valid for the version of
the feature that does not deliver the pitch**, and whoever picks this up should size the real one
before believing these figures.

## What the store needed, and what that says about ordering

Small: a `shared(origin, oseq, seq)` table, `appendShared`, `isShared`, `locallyAuthored`, and an
optional `ts` on `append` so a folded event keeps the timestamp of when the teammate did the thing
rather than when we happened to pull it.

What matters is what did *not* change. Local `seq` is still a single-writer autoincrement, which
is why projections, SSE and `Last-Event-ID` kept working without being touched. **An event now has
two identities**: a local `seq`, which is an arrival order, and a global `(origin, oseq)`, which
lives beside the log rather than in it. The store's own header comment — *"single writer, so a
monotonic integer sequence is sufficient ordering"* — is still true locally and is now misleading
globally, and should be amended if this goes further.

`locallyAuthored` excluding anything in `shared` is load-bearing and was not obvious up front. It
is what stops an event picking up a second identity as it transits a third device: each event is
published by exactly one device, its author, and everyone else reads it from that author's file.

The consequence is that **there is no total order across devices, and I deliberately did not
invent one.** Folded events land at the tail of the local log in the order they were pulled. The
last test demonstrates where that bites: A and B both rename the same note without seeing each
other, and afterwards each laptop is showing *the other's* title. Permanently. That is not
eventual consistency, it is stable disagreement.

Sorting by `ts` on fold would converge them and would require trusting two laptops' clocks. A
Lamport counter per device would do it honestly and is maybe thirty lines. Neither is needed for
sequential handoff — I stop, you start — which is exactly the framing 11 already argues for on
different grounds. That framing is now load-bearing for correctness, not just for marketing
honesty.

## What breaks first, if two people actually used this for a week

Two answers, because they break on different clocks.

**Functionally, it is already broken, on day one: the reviewer cannot see the diff.** A note handed
to B, run by B, pushed back to A arrives on A's board in `review` with a branch and a
`{files, insertions, deletions}` stat — the shape of the change, but not the change. `worktree` is
folded as `""` because B's path is a lie on A's disk, and the `diffs` table is local and is not
shared at all. So A gets a note asking for a verdict and no way to reach the thing being judged
short of `git fetch origin kandy/note_x` by hand. Review is the whole point of the handoff, and it
is the one step that does not survive the trip. It needs the note's branch pushed alongside the log
and the UI taught that a diff may live on a ref instead of in a worktree.

**Socially, by about Tuesday: nobody pushes.** There is no automatic sync. `push` and `pull` are
functions a test calls. A board that is only correct when both people remember to run a command
will be wrong quickly, and it fails silently — B's stale board is indistinguishable from "A hasn't
done anything today." And the obvious fix reopens the door the sequential framing was holding shut:
auto-push on emit and auto-pull on a timer means both boards are live, live means concurrent, and
concurrent means the divergence in the last test stops being a hypothetical about two people
racing and starts being what happens when two people work the same afternoon.

Third, quieter, and worth deciding before rather than after: **the prompt body goes onto the branch
in plaintext and stays there.** 11 argues this is a feature — transcripts stay as private as the
code — and for access control that is right. But `note.deleted` removes a note from the board while
its `note.created` line, body and all, remains on the branch forever. "Delete this note" will not
mean what a user assumes it means.

## What was not tested

Two processes, never two machines. No clock skew. No network failure mid-push. No auth, no large
repo, no `gc` interaction, no second daemon writing the same database. Transcripts never crossed
the wire, and neither did diffs.

## If this is picked up

In order, and the first two are not optional:

1. Push the note's branch with the log, and teach the review path to read a diff from a ref.
2. Chunk the files by month, before the branch has any history worth keeping.
3. Refuse a backwards fetch instead of absorbing a force-push.
4. Replace the root-commit board key with something a history rewrite cannot move.
5. Decide sequential-only and enforce it, or add a Lamport clock. Do not leave it implicit.

And settle the honest claim first, because it decides 1 and the transcript question with it:
**hand off the thread, not resume the session.** 11 already says so. This spike is the first place
it costs something.
