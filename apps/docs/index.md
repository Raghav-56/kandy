---
layout: home
hero:
  name: kandy
  text: A board for orchestrating coding agents
  tagline: One note is one job. It runs in its own git worktree, on its own branch, and comes back as a diff you can read.
  actions:
    - theme: brand
      text: Getting started
      link: /guide/getting-started
    - theme: alt
      text: The CLI
      link: /guide/cli
features:
  - title: Several agents, one repo
    details: Every note gets its own worktree and branch, so six agents can work the same repository without seeing each other's writes. Your working tree is never touched.
  - title: Work you can walk away from
    details: A chat needs you present. A board does not. Come back to finished branches, and a list sorted by what is actually waiting on you.
  - title: Steering, not just prompting
    details: Send a message to a running agent, or queue a follow-up that resumes its session in the same worktree. Attach files it can open.
  - title: Nothing is taken on trust
    details: Every note ends as a diff and a decision — merge here, open a PR, or discard. Each asks first, and says what will happen to that branch.
---

## In thirty seconds

```sh
cd ~/your-repo
kandy "fix the flash when a note is selected"
```

That writes a note, adopts the repo as a board if it has never seen it, starts
the daemon if it is not running, and hands the job to an agent in a fresh
worktree. Then:

```sh
kandy ls        # what is open here
kandy open      # the board in a browser
kandy stats     # what this board has actually done
```

## What this is not

It is not a better chat with an agent — chat wins at one task you are watching,
and always will. kandy is for the other case: several jobs, none of which you
want to sit through, and a pile of diffs to triage when you get back.

::: warning Alpha
kandy runs real work daily on its own repository, and it is still alpha. The
[unfinished list](/unfinished) is honest about what does not work yet.
:::
