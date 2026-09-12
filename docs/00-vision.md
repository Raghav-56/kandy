# Vision

## The observation

Coding agents are good enough that the bottleneck has moved. It is no longer "can the agent
do this" — it is "how many can I have going, and how do I know which ones need me."

Every terminal agent ships the same interface: one conversation, one working tree, one thing
at a time. That interface is correct for a single task and wrong for a day's work. People
route around it with tmux panes, git worktrees, and a text file of what they were doing —
which is a kanban board, badly, reimplemented by hand, every time.

## The product

A board whose cards are units of agent work.

A note has a prompt, a repo, an assigned agent, and a lifecycle: **draft → queued → running →
review → done**. Moving a note from draft to queued is what starts execution. Running notes
stream their output onto the card. Notes that finish land in review carrying a branch and a
diff. Notes that need a decision — a permission prompt, an ambiguity — surface as blocked,
which is the only state that should ever demand your attention.

The board is the same whether you open it in the terminal, a browser tab on the same machine,
or a browser tab somewhere else. One server process owns the truth.

## What we are actually betting on

Not the drag-and-drop. The drag-and-drop is how the product is *sold*; it is a weekend of work
and anyone can copy it.

The bet is that **running many agents at once, safely, on one repo, with output you can trust**
is hard, and that the people solving it are mostly solving it by hand. Concretely that means:

1. **Isolation.** Every note gets its own git worktree and branch. Six agents editing one
   working tree is data loss with extra steps. This is the load-bearing wall.
2. **Review.** A note's output is a branch and a diff, presented for a decision — merge,
   discard, or send back with a comment. An agent that "did stuff in your repo" is a toy.
3. **Legible state.** At any moment: what is running, what is waiting on you, what is done and
   unreviewed. This is the entire value of the board metaphor and it must never lie.

If we build a beautiful board over an unsafe execution model, we have a demo. If we build a
safe execution model with a board on top, we have a product.

## Non-goals (for now)

- **We are not an inference product.** We do not host models, we do not proxy tokens, we do not
  want your API key more than we have to. Users bring agents they already have installed and
  authenticated. Our margin is not inference.
- **We are not an editor.** Review surfaces a diff and a decision. Deep editing happens in the
  user's editor, which is one keystroke away.
- **We are not a team collaboration tool yet.** Multiplayer boards are a real future; solving
  single-user parallelism first is the prerequisite, not a detour.

## The honest risk

`pingdotgg/t3code` ships a server-wraps-CLIs control plane with web, desktop, and mobile
clients today. Our surface area overlaps theirs almost completely. The difference we are
betting on is the interaction model: they are a better *chat* with agents, we are a better
*queue* of them. That difference has to be visible in the first thirty seconds of use or it
isn't a difference. See [`06-landscape.md`](06-landscape.md).
