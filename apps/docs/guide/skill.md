# Using kandy from another agent

kandy ships a skill so another agent — Claude Code, or anything that reads skill
files — can queue work onto a board instead of doing it inline.

```sh
kandy skill
```

That copies it to `~/.claude/skills/kandy/SKILL.md`, making it available in
every repository. The skill comes with kandy, so run `kandy skill` again after
an update to get the newest version of it. If it says `cannot find the skill
to install`, your kandy is older than the skill's packaging — `kandy update`,
then run it again.

## What it does

The agent reaches for kandy when work is **parallel** ("do all three"),
**asynchronous** ("start it, I'll check later"), or **isolated** ("try it
without touching my branch"). Otherwise it just does the work, which is usually
right.

## Why CLI-only

The skill drives the `kandy` command rather than the HTTP API. The API is larger
and moves more often; the CLI is the stable surface, and shelling out means the
skill needs no credentials and no client library.

## What it will not do

The skill is deliberate about its limits, and says so to the agent using it:

- It does not merge or open pull requests. Those are decisions a person makes
  after reading a diff.
- It cannot report whether a run succeeded — the work happens in another
  process, so the calling agent never sees it finish. It points you at
  `kandy ls` instead of guessing.

## These docs, for an agent

Every page here is also plain markdown: add `.md` to its address
(`/guide/getting-started.md`). [`/llms.txt`](/llms.txt) lists them all, and
[`/llms-full.txt`](/llms-full.txt) is the whole site in one file — hand either
to an agent that needs to know how kandy works.
