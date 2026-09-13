# The kandy skill

Lets another agent — Claude Code, or anything that reads skill files — queue
work onto a kandy board instead of doing it inline.

Copy `SKILL.md` to `~/.claude/skills/kandy/SKILL.md` to make it available
everywhere, or leave it here to scope it to this repository.

It is deliberately CLI-only. The HTTP API is larger and changes more often; the
CLI is the stable surface, and shelling out means the skill needs no credentials
and no client library.
