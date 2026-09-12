# Interface

## What it looks like, and why

A dark desk with paper on it. Columns are the lanes of the note lifecycle;
notes are warm paper cards that tilt very slightly, straighten when you reach
for them, and lift on hover.

The restraint that matters: **one paper tone carries almost every note.** Status
is a coloured dot and a word, not a coloured card. Only two statuses change the
surface — `blocked`, which is the single state that legitimately demands
attention, and `done`, which recedes until it is nearly invisible.

Accents are three muted tones and nothing else: amber for work in flight, coral
for work that needs a human, sage for work that landed.

## What we tried and reverted

We built a version against a monochrome typographic spec (`DESIGN.md`) with a
3D board — real card geometry, lighting, parallax, lanes in space.

It was worse. Two lessons worth keeping:

**3D cost legibility and bought nothing.** A board answers two questions — what
is in flight, and what is blocked on me. Perspective makes cards different sizes
for reasons unrelated to their importance, text bends away from the reader, and
dragging in a projected plane is strictly harder than dragging in a list. The
depth was decoration on top of a tool whose whole job is a fast glance.

**A no-colour rule fought the product.** Forcing status into value and motion
alone was an interesting constraint and produced a legible *language* — inversion
for blocked, a sweeping hairline for running. But a board is a status display,
and status is the one thing hue is genuinely good at. The monochrome version made
every note look equally important, which is the opposite of the point.

What survived from that detour: the status dot idea, the sweeping line for
running work, and the discipline of not tinting whole cards.

## Rules we're keeping

- **One accent per meaning.** If a third thing wants to be amber, one of them is
  wrong.
- **Status is never only colour.** Every state has a dot *and* a word, because
  eight percent of men can't reliably separate the coral from the sage.
- **Motion means something is happening.** The sweep runs only while an agent is
  actually working. Decorative animation trains people to ignore animation.
- **`blocked` is the loudest thing on screen** and nothing else is allowed to
  compete with it.
- **Drag shows where it will land.** A drop indicator between cards, always —
  dropping should never be a guess.

## Layout

Columns flex to fill the window so the default five lanes need no horizontal
scrolling; a wider board scrolls. The inspector is a fixed right panel rather
than a modal, because steering an agent means reading the stream and typing at
the same time.

## The inspector

Where the work actually happens:

- **Stream** — the agent's transcript: what it said, what it ran, what it was
  refused. Autoscroll only when already at the bottom.
- **Diff** — what the branch actually changed, against the commit it branched
  from.
- **Steer** — a message box that reaches the live agent, or queues a follow-up
  run resuming its session. The panel says which of the two happened, because
  from the user's side that difference is the entire feel of the thing.
