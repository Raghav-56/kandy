---
layout: home
hero:
  name: kandy
  text: Stop babysitting your coding agents
  tagline: Queue a dozen jobs and walk away. Each one runs in its own git worktree, so agents never collide — and comes back as a branch and a diff you approve. Claude Code and Codex, on your machine, with the logins you already have.
  actions:
    - theme: brand
      text: Getting started
      link: /guide/getting-started
    - theme: alt
      text: The CLI
      link: /guide/cli
features:
  - title: Twelve agents, one repository
    details: Every note gets its own worktree and branch. They edit the same files at the same time and never see each other's writes — and your working tree is never touched.
  - title: Absence is the point
    details: A chat needs you present, watching a stream. A board does not. The list is sorted by what is actually waiting on you, so coming back takes a minute, not an afternoon.
  - title: Argue with it mid-run
    details: Send a message to a working agent, or queue a follow-up that resumes its session in the same worktree. Attach files it can open. It keeps its context either way.
  - title: Nothing lands unread
    details: Every job ends as a diff and a decision — merge here, open a PR, or discard. Each asks first, and says exactly what will happen to that branch.
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
