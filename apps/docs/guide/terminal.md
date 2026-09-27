# The terminal board

Type `kandy` in a terminal and the board opens right there — this repository's
board if you're inside one. It's a kanban: the board's columns side by side, and
every note a card you can move with the keyboard or the mouse. Everything the web
board does for a day of work, you can do here.

<p class="k-shot"><img src="/shots/site/terminal-kanban.webp" alt="The terminal board as a kanban: Inbox, Queued, Running, Review and Done side by side, each note a card coloured by what state it's in"></p>

Piped, scripted or in CI, bare `kandy` prints a status summary instead — there
is nobody to press keys. `kandy board` opens it explicitly.

## Reading the board

The columns are the board's own: **Inbox**, **Queued**, **Running**, **Review**,
**Done**. Notes move between them by themselves as agents work. Each card is a
sticky note whose colour says what it's waiting for:

| Card | Means |
| --- | --- |
| **plain** | a draft in the Inbox — not run yet |
| **blue** | running (or queued to run) |
| **yellow** | needs you — the agent asked something, or someone wants to run it on your machine |
| **green** | finished, waiting for your review |
| **red** | failed |
| **faded** | done — merged or discarded |

Each card shows its title, its state, and on the right what it changed, which
agent ran it, and how long ago. The card the keyboard is on has a bright border.

Along the top: a **tab for each board**, with how many notes there need you; a
**+** to add a board; and on the right what's running, how many need you, and
whether the board is live.

A column with more cards than fit shows **↑2 ↓3** in its header. When the
terminal is too narrow for every column, **‹1** and **2›** say how many columns
are off to either side — moving to one scrolls it into view.

## Keys

The footer shows the keys that matter for the card you're on; <kbd>?</kbd> shows
all of them.

**Moving around**

| Key | Does |
| --- | --- |
| <kbd>←</kbd> <kbd>→</kbd> or <kbd>h</kbd> <kbd>l</kbd> | the next column |
| <kbd>↑</kbd> <kbd>↓</kbd> or <kbd>j</kbd> <kbd>k</kbd> | the next card in the column |
| <kbd>g</kbd> <kbd>G</kbd> | the first / last card in the column |
| <kbd>Enter</kbd> or <kbd>o</kbd> | open the note |
| <kbd>/</kbd> | filter cards by text; <kbd>Esc</kbd> clears it |
| <kbd>v</kbd> | switch between columns and a single list |

**Writing and running**

| Key | Does |
| --- | --- |
| <kbd>n</kbd> | write a note and run it (first line is the title; <kbd>Ctrl</kbd>+<kbd>J</kbd> for more lines) |
| <kbd>N</kbd> | write a note without running it |
| <kbd>r</kbd> | run the note — asks which agent if it has none |
| <kbd>x</kbd> | cancel its run |
| <kbd>m</kbd> | message the agent while it works |
| <kbd>e</kbd> | edit the title and detail |
| <kbd>p</kbd> | switch between repo only and full access (full access asks first) |
| <kbd>Del</kbd> | delete the note (asks first) |

**Reviewing** — straight from the card; no need to open it

| Key | Does |
| --- | --- |
| <kbd>d</kbd> | its diff |
| <kbd>M</kbd> | merge (asks first, and says which branch it lands on) |
| <kbd>R</kbd> | send it back with a comment |
| <kbd>X</kbd> | discard (asks first) |

**Moving cards**

| Key | Does |
| --- | --- |
| <kbd>J</kbd> <kbd>K</kbd> or <kbd>Shift</kbd>+<kbd>↓</kbd> <kbd>↑</kbd> | move the card down / up its column |
| <kbd>H</kbd> <kbd>L</kbd> or <kbd>Shift</kbd>+<kbd>←</kbd> <kbd>→</kbd> | move it to the next column — see [what that means](#moving-a-card-between-columns) |

**Boards and the team**

| Key | Does |
| --- | --- |
| <kbd>[</kbd> <kbd>]</kbd> | the previous / next board |
| <kbd>b</kbd> | pick a board from a list |
| <kbd>B</kbd> | add a board — a git repository on this machine |
| <kbd>t</kbd> | the [team screen](#the-team) |
| <kbd>?</kbd> | every key |
| <kbd>q</kbd> | quit (also <kbd>Esc</kbd>, <kbd>Ctrl</kbd>+<kbd>C</kbd>) |

## The mouse

| Do | To |
| --- | --- |
| click a card | select it |
| double-click a card | open it |
| drag a card | move it — within a column, or to another |
| scroll over a column | scroll that column |
| click a tab | switch to that board (**+** adds one) |
| click a key in the footer | do what the key does |

While kandy has the mouse, a plain drag doesn't select text — hold
<kbd>Shift</kbd> (<kbd>Option</kbd> in some macOS terminals) to select as usual.
To keep the mouse for your terminal instead, start kandy with
`KANDY_NO_MOUSE=1`.

**On Windows the mouse is off**: Node reads the Windows console as keys only, so
clicks never reach kandy — every key still works. `KANDY_MOUSE=1` turns it on for
a setup that does pass them through.

### Moving a card between columns

The columns aren't places a card can simply be put: kandy moves each note to the
column its state belongs in. So dropping a card on another column — with the
mouse, or <kbd>H</kbd> <kbd>L</kbd> — means the action that would put it there:

| Drop | Does |
| --- | --- |
| a draft onto **Queued** or **Running** | runs it |
| a card in **Review** onto **Done** | merges it (asks first) |
| a card anywhere else in its own column | reorders it |
| anything else | nothing, and says why |

## A note

<kbd>Enter</kbd> or a double-click opens a note.

<p class="k-shot"><img src="/shots/site/terminal-note.webp" alt="A note in the terminal: the agent's summary, what it cost, and the keys for what to do next"></p>

The transcript streams live while the agent works, and follows the end until you
scroll up (the wheel works here too). <kbd>G</kbd> jumps back and follows again.
The note's own keys work here just as on its card — run, cancel, message, diff,
merge, send back, discard, edit, access, delete, and answering questions — plus:

| Key | Does |
| --- | --- |
| <kbd>d</kbd> | the diff; <kbd>]</kbd> <kbd>[</kbd> between files |
| <kbd>g</kbd> | give it to another machine — on a team |
| <kbd>q</kbd> | back to the board (also <kbd>Esc</kbd>, <kbd>←</kbd>) |

## When something needs you

The card turns yellow, and the keys to answer lead the footer — on the board or
in the note.

**An agent asks permission** — *"Claude Code wants to run: npm test"*:

| Key | Does |
| --- | --- |
| <kbd>a</kbd> | allow, once |
| <kbd>A</kbd> | allow this kind of thing for this note |
| <kbd>D</kbd> | deny, with an optional note saying what to do instead |

**Someone wants to run a note on your machine** (on a team) — the card says
*waiting to run*:

| Key | Does |
| --- | --- |
| <kbd>y</kbd> | run it |
| <kbd>Y</kbd> | run it, and always allow this person |
| <kbd>D</kbd> on the board, <kbd>n</kbd> in the note | decline |

## Boards

Every repository you use is a board, with a tab along the top. Switch with a
click, <kbd>[</kbd> <kbd>]</kbd>, or <kbd>b</kbd> for a list. <kbd>B</kbd> (or
the **+**) adds one: give it the path to a git repository on this machine, and
kandy guesses its [setup command](/guide/settings#setup-command) the same way it
does everywhere else. Each tab shows how many notes there need you, so nothing
waits unseen on another board.

## The team

<kbd>t</kbd> opens the team screen.

<p class="k-shot"><img src="/shots/site/terminal-team.webp" alt="The team screen: whose notes may run on this machine, the machines connected with their agents, the people on the team with their roles, and recent activity"></p>

- **This machine** — whose notes may run here: only you, people you've approved,
  or anyone on the team. <kbd>c</kbd> changes it. It's kept on this machine,
  never on the hub. ([Why](/modes/permissions#running-on-someone-s-machine))
- **Machines** — every machine connected to the team, whose it is, which agents
  are signed in on it, and when it was last seen.
- **People** — who's on the team, and their roles. Owners can press <kbd>i</kbd>
  to invite someone (and get the message to send them), or select a person and
  press <kbd>Enter</kbd> to change their role or remove them.
- **Recent** — what people did, newest first: *bob gave «…» to alice-laptop*,
  *alice declined «…»*.

On your own, the team screen says how to [start or join a team](/modes/).

## Narrow terminals

Two columns need about 50 cells. Narrower than that — or after <kbd>v</kbd> — the
board is a single list, grouped by column, with every key and click still
working. It fits in 80×24 and uses more room when there is some.

## Looks

The colours are kandy's: blue for running, yellow for anything waiting on you,
green for work ready to review, red for errors and deletions. They're tuned for
dark terminals. `NO_COLOR` turns colour off; cards are then plain outlines, and
the selected one is drawn double.

`kandy help board` prints every key without opening the board.
