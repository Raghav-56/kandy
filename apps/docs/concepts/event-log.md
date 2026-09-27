# The event log

Every state change is an append to an immutable log. Views are projections of
it. This is not architecture astronomy — it is the cheapest way to get four
things kandy needs anyway:

- **Replay.** A client that reconnects asks for everything after sequence *N*.
  No snapshot diffing.
- **History.** "What did this agent do" is a query, not a log file someone
  forgot to write.
- **Audit.** Agents take destructive actions. You want the tape.
- **Teams.** A single writer means one order of events. On a team the
  [hub](/concepts/hub-and-runners) is that writer, so two machines can never end
  up disagreeing about a note.

Storage is SQLite via Node's built-in `node:sqlite` — no dependency, one file.

## Who did it

Every event carries an **actor**: the person who caused it, as the hub knows
them — or nobody, on a machine used by one person. It's stamped by whoever owns
the log, never taken from the event itself, so a runner on someone's laptop
can report what its run did but can't claim to be someone else. The Team page's
activity, and "who admitted whom", are just this field.

## Transcript is not the log

What an agent says and does streams to clients over the same connection, but
carries **no SSE `id:`**. Per the spec that leaves the client's `Last-Event-ID`
untouched, so a reconnect resumes the domain log exactly where it left off
rather than replaying megabytes of agent chatter.

Transcript lives in its own table, keyed per run, fetched only for the note you
actually opened. Board replay must never be proportional to how talkative the
agents were.

## Projections

The log is replayed once at startup; after that each appended event is folded
into cached views, so a read is a map lookup. The first version replayed the
whole log on every request — invisible at 500 events, ruinous at 500,000.

There is exactly one place a state change happens: append, project, publish, in
that order. Two call sites doing that by hand is how a cache drifts from its log.

## Readers absorb history

The log is immutable, so nothing is ever migrated. When a shape changes — a diff
stat that used to be git's printed summary and is now structured — the reader
normalises it. There is a test for that.
