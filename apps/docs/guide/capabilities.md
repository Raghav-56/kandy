# Skills and MCP servers

Two ways to give agents more than the repository: **skills** (instructions an
agent loads when a task calls for them) and **MCP servers** (tools it can call).
Set each once, and every agent on the board gets it — in its own format.

![Settings → Capabilities: skills in the repository, and the board's MCP servers](/shots/capabilities.png)

## Skills

Skills live **in the repository**, in `.agents/skills/`, where the
[`skills`](https://github.com/vercel-labs/skills) CLI puts them and where Claude
Code, Codex, Cursor and opencode all look. kandy drives that CLI rather than
shipping another.

```sh
kandy skills                          # what's here, and which runs can see it
kandy skills add emilkowalski/skill   # install for every agent
kandy skills commit                   # commit the ones no run can see yet
kandy skills remove <name>
```

### Why "commit" matters

A note runs in a checkout of **git**, so a skill that's only on your disk reaches
no agent kandy starts. kandy marks uncommitted skills (○ in the terminal, a lemon
tag in Settings) and `kandy skills commit` commits exactly them — the skill, its
links, and `skills-lock.json` — and nothing else you had staged. Once committed,
git carries the skill to every note, every teammate and every handoff.

## MCP servers

MCP servers live **on the board**. Each agent keeps MCP config in its own
dialect, in your home directory — so a server set up for Claude is invisible to
Codex, and one set up on your laptop is invisible to a teammate. A board is
where one list can reach all of them.

```sh
# a local server: everything after -- is its command line
kandy mcp add github --env 'GITHUB_TOKEN=${GITHUB_TOKEN}' -- npx -y @modelcontextprotocol/server-github

# a remote one
kandy mcp add linear --url https://mcp.linear.app/mcp --header 'Authorization: Bearer ${LINEAR_TOKEN}'

kandy mcp                # list
kandy mcp rm linear
```

Or in **Settings → Capabilities** in the browser. Each server is added to every
run — never cached, so a new one is in the next run with no restart — and your
own servers still load alongside.

### Secrets never go on the board

Write them as `${NAME}`. kandy never fills them in: each agent's own config
expands them from the environment of the machine it runs on. So a board can say
`Bearer ${LINEAR_TOKEN}`, be shared with a whole team, and everyone's agent uses
their own token. kandy warns if a header looks like a literal secret.

| Agent | Gets servers via | Supports |
| --- | --- | --- |
| Claude Code | `--mcp-config` | everything |
| Cursor | the worktree's `.cursor/mcp.json`, for the run only | everything |
| opencode | inline config | everything |
| Codex | `-c mcp_servers.…` | a variable used under its own name, or as `Bearer ${TOKEN}` — anything else is skipped for Codex, with the reason in the transcript |
| aider | — | no MCP support; the transcript says so |

For Cursor, kandy approves the board's servers by name — not every server a
cloned repository might ship — and takes its files away again after the run, so
they never end up in the reviewed diff.
