# The terminal board

Type `kandy` in a terminal and the board opens right there — this repository's
board if you're inside one. Everything the web board does for a day of work, you
can do from the keyboard.

![The terminal board: notes grouped by lane, what each changed, which agent ran it](/shots/terminal.png)

Piped, scripted or in CI, bare `kandy` prints a status summary instead — there
is nobody to press keys. `kandy board` opens it explicitly.

## The board

| Key | Does |
| --- | --- |
| <kbd>↑</kbd> <kbd>↓</kbd> or <kbd>j</kbd> <kbd>k</kbd> | move |
| <kbd>Enter</kbd> | open the note |
| <kbd>n</kbd> | write a note and run it (first line is the title; <kbd>Ctrl</kbd>+<kbd>J</kbd> for more lines) |
| <kbd>N</kbd> | write a note without running it |
| <kbd>r</kbd> | run the note — asks which agent if it has none |
| <kbd>x</kbd> | cancel its run |
| <kbd>d</kbd> | its diff |
| <kbd>/</kbd> | filter |
| <kbd>b</kbd> | switch board |
| <kbd>?</kbd> | every key |
| <kbd>q</kbd> | quit |

The header says how many notes **need you** — waiting for review, asking a
question, or held for your permission.

## A note

![A note in the terminal: the agent's summary, what it cost, and the keys for what to do next](/shots/terminal-note.png)

The transcript streams live while the agent works, and follows the end until you
scroll up. <kbd>G</kbd> jumps back and follows again.

| Key | Does |
| --- | --- |
| <kbd>m</kbd> | send the agent a message — steer it, or answer it |
| <kbd>d</kbd> | the diff; <kbd>]</kbd> <kbd>[</kbd> between files |
| <kbd>M</kbd> | merge (asks first) |
| <kbd>R</kbd> | send it back with a comment |
| <kbd>X</kbd> | discard (asks first) |
| <kbd>g</kbd> | give it to another machine — on a team |

## When something needs you

**An agent asks permission** — *"Claude Code wants to run: pnpm test"* is pinned
above the keys:

| Key | Does |
| --- | --- |
| <kbd>a</kbd> | allow, once |
| <kbd>A</kbd> | allow this kind of thing for this note |
| <kbd>D</kbd> | deny, with an optional note saying what to do instead |

**Someone wants to run a note on your machine** (on a team):

| Key | Does |
| --- | --- |
| <kbd>y</kbd> | run it |
| <kbd>Y</kbd> | run it, and always allow this person |
| <kbd>n</kbd> | decline |

## Looks

Mint for running and done, lemon for anything waiting on you, berry for errors
and deletions. `NO_COLOR` turns colour off. It fits in 80×24 and uses more room
when there is some.

`kandy help board` prints the same key list without opening the board.
