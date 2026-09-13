---
layout: home
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
