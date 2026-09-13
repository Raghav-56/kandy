---
layout: home
hero:
  name: kandy
  text: Stop babysitting your coding agents
  tagline: Queue a dozen jobs and walk away. Each comes back as a diff you approve.
  actions:
    - theme: brand
      text: Getting started
      link: /guide/getting-started
    - theme: alt
      text: The CLI
      link: /guide/cli
features:
  - title: Isolated by default
    details: One git worktree and branch per note. Agents never see each other's writes, and never touch your working tree.
  - title: Built to be left alone
    details: The list sorts by what is actually waiting on you. Coming back takes a minute, not an afternoon.
  - title: Nothing lands unread
    details: Every job ends as a diff and a decision — merge, open a PR, or discard.
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
