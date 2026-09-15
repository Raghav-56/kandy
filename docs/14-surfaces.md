# Surfaces

The rules the interface is built from, and the measurements that prove it.

This exists because the same bug kept arriving in different clothes: a menu whose
rows touched its border, a focus ring painted outside a row, a picker that opened
into no space, fourteen font sizes in half-pixel steps. Each was fixed where it
appeared, which is how there came to be fourteen of them. What follows is the one
place to change instead.

Everything here was measured in a browser, not chosen by eye. Where a number is
given, it is a number the audit checks.

## The type scale

Eight steps, each with a job. They live in `@theme` in `styles.css` as
`--text-*`, so `text-ui` and `text-meta` are real utilities.

| Token | Size | What wears it |
| --- | --- | --- |
| `text-micro` | 10px | uppercase eyebrows and labels (`.label`) |
| `text-meta` | 11px | timestamps, counts, costs, diff stats |
| `text-aux` | 12px | secondary copy, chips, hints |
| `text-ui` | 13px | the default: rows, menus, buttons, fields |
| `text-title` | 14px | a note's title, a section's name |
| `text-prose` | 15px | transcript and markdown — read, not scanned |
| `text-lede` | 17px | the title of the thing you opened |
| `text-display` | 20px | a page heading, a headline figure |

There used to be 10, 10.5, 11, 11.5, 12, 12.5, 12.8, 13, 13.5, 14, 14.5, 16, 17,
19 and 20, spread across 175 hand-written `text-[13.5px]` arbitrary values. Half a
pixel is not hierarchy — it is drift, and nothing stopped the next one being 12.75.

**Never write `text-[Npx]`.** If a new size seems necessary, one of the eight is
wrong; fix that one.

## Floating surfaces

A menu, a select, a picker panel — they all obey the same three numbers, and they
are concentric: **outer radius = inner radius + padding**.

| | Value |
| --- | --- |
| Panel radius | `rounded-xl` — 14px |
| Panel padding | `p-1.5` — 6px |
| Row radius | `rounded-md` — 8px |
| Row | `px-2 py-1.5 gap-2 text-ui` — 31.5px tall |

6 + 8 = 14. A row inset by 6px in a panel cornered at 10px has visibly tighter
corners than the row inside it; that was the old value.

Two rules that are not about spacing:

- **A row shows focus with its background, never an outline.** An outline paints
  *outside* the box, so on a row that spans its panel's full width the ring lands
  on the panel's own border and past it. `styles.css` exempts menu rows from the
  global focus ring for exactly this reason.
- **Nothing in a row may be taller than the row.** A 24px button in a 31.5px row
  makes that row 36px and the menu uneven. Pull it back with `-my-1`; the target
  stays 24px and overflows into the panel's padding, where there is nothing to hit.

Selects open with the **popper**, not item-aligned. Item-aligned puts the list on
top of its own trigger, and half of kandy's selects live in the composer at the
bottom of the window, where that leaves no height at all.

## Rows and rhythm

| | Value |
| --- | --- |
| Sidebar nav row | 36px, 4px apart — a 40px rhythm |
| Menu row | 31.5px |
| Command palette row | 36px — a bigger surface, deliberately |
| Sidebar bands | 10px padding on header, group and footer alike |

## Targets

Nothing you can click is under **24px** in either axis. Where the control is
smaller than that by design — a 32×18 switch — the label beside it carries the
target: give the control an `id` and the words a `<label htmlFor>`, and the whole
row becomes clickable. Verified by clicking the text and watching `aria-checked`
flip.

## Motion

- Name the properties. `transition-all` charges every animatable property on every
  hover, including layout ones; `transition-[color,background-color]` is the shape
  to copy.
- High-frequency interactions get 150ms or less on colour and opacity.
- Every animated state change also has a static cue — colour, an icon, a label.
  Motion is never the only channel.

## The audit

The numbers above came from walking the running app and reading
`getComputedStyle`, not from reading the source. Screenshots cannot see a focus
ring painted one pixel outside a panel, or a shader that failed to compile; the
measurements can. When changing anything here, open each surface and check:

- panel inset equal on all four sides
- row heights identical within one surface
- every font size on the scale
- no interactive box under 24px
- `transitionProperty` never `all`
- nothing with `scrollWidth > clientWidth` under `overflow: hidden`
