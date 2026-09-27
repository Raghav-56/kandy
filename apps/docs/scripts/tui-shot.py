"""
Run kandy in a pseudo-terminal, press keys, and print the screen.

  python tui-shot.py [--cols N] [--rows N] [--keys "j;j;\\r;wait:1.5"]
                     [--cwd DIR] [--html] -- kandy-args…

The docs' terminal screenshots and command transcripts come from here, so they
are what kandy really draws — nothing typed by hand. kandy runs in a pty, so it
behaves exactly as in a terminal; `pyte` keeps the screen a terminal would
show; the result is printed as plain text (for transcripts) or as HTML with
kandy's colours (to screenshot).

Keys are separated by `;`. `wait:N` waits N seconds. Escapes such as \\r work.
Needs `pip install pyte`.
"""
import argparse
import fcntl
import html
import os
import pty
import select
import struct
import sys
import termios
import time

import pyte

CLI = os.path.join(os.path.dirname(__file__), "../../server/dist/cli.js")

ap = argparse.ArgumentParser()
ap.add_argument("--cols", type=int, default=100)
ap.add_argument("--rows", type=int, default=26)
ap.add_argument("--keys", default="")
ap.add_argument("--cwd", default=os.getcwd())
ap.add_argument("--settle", type=float, default=3.0, help="seconds to wait for the first screen")
ap.add_argument("--html", action="store_true")
ap.add_argument("args", nargs=argparse.REMAINDER)
opt = ap.parse_args()
args = opt.args[1:] if opt.args[:1] == ["--"] else opt.args

env = dict(os.environ, TERM="xterm-256color", COLORTERM="truecolor")
pid, fd = pty.fork()
if pid == 0:
    os.chdir(opt.cwd)
    os.execvpe("node", ["node", os.path.abspath(CLI), *args], env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", opt.rows, opt.cols, 0, 0))
screen = pyte.Screen(opt.cols, opt.rows)
stream = pyte.ByteStream(screen)


def pump(secs: float) -> None:
    end = time.time() + secs
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if not r:
            continue
        try:
            data = os.read(fd, 65536)
        except OSError:
            return
        if not data:
            return
        stream.feed(data)


pump(opt.settle)
for step in [s for s in opt.keys.split(";") if s]:
    if step.startswith("wait:"):
        pump(float(step[5:]))
    else:
        os.write(fd, step.encode().decode("unicode_escape").encode())
        pump(0.6)
pump(0.8)
try:
    os.kill(pid, 9)
except ProcessLookupError:
    pass

if not opt.html:
    lines = [line.rstrip() for line in screen.display]
    while lines and not lines[-1]:
        lines.pop()
    print("\n".join(lines))
    sys.exit(0)

NAMED = {"black": "#16151d", "red": "#e87fa4", "green": "#74d6ac", "yellow": "#e8c56a", "blue": "#87afff",
         "magenta": "#af87ff", "cyan": "#7ad0e0", "white": "#e8e6e3", "brightblack": "#8a8794"}


def colour(c, fallback):
    if c in (None, "default"):
        return fallback
    if isinstance(c, str) and len(c) == 6 and all(ch in "0123456789abcdefABCDEF" for ch in c):
        return "#" + c
    return NAMED.get(c, fallback)


BLOCKS = {"▀": (True, False), "▄": (False, True), "█": (True, True)}
cells = []
for y in range(opt.rows):
    row = screen.buffer[y]
    for x in range(opt.cols):
        ch = row[x]
        fg, bg = colour(ch.fg, "#e8e6e3"), colour(ch.bg, None)
        if ch.reverse:
            fg, bg = (bg or "#16151d"), fg
        # Block characters are drawn as colour, not glyphs: a glyph is shorter
        # than the line, so a logo made of them shows stripes a terminal never would.
        base = bg or "#16151d"
        if ch.data in BLOCKS:
            top, bottom = BLOCKS[ch.data]
            paint = f"linear-gradient({fg if top else base} 50%, {fg if bottom else base} 50%)"
            cells.append(f'<span class="c" style="background:{paint}"> </span>')
            continue
        style = f"color:{fg};" + (f"background:{bg};" if bg else "") + ("font-weight:700;" if ch.bold else "")
        cells.append(f'<span class="c" style="{style}">{html.escape(ch.data or " ")}</span>')
    cells.append("\n")
print('<html><head><meta charset="utf-8"><style>'
      "body{margin:0;background:#16151d}"
      "pre{display:inline-block;margin:0;padding:16px 18px;font:14px/1 'SF Mono',Menlo,monospace}"
      ".c{display:inline-block;width:1ch;height:1.3em;line-height:1.3em;vertical-align:top;white-space:pre}"
      '</style></head><body><pre>' + "".join(cells) + "</pre></body></html>")
