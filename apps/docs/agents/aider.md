# aider

The long-standing open-source pair programmer, with any model provider. kandy's
support is written against aider's real output, but hasn't been driven end to
end much yet, and aider can do less inside kandy than the other agents.

## Install

```sh
python -m pip install aider-install && aider-install
```

See [aider.chat](https://aider.chat/docs/install.html). kandy needs the `aider`
command on your `PATH`.

## Sign in

aider has no login of its own: it uses your provider's API key, set however
aider expects — for example `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in your
environment, or its `.aider.conf.yml`. kandy never looks at those; if `aider` is
installed, `kandy status` shows it as ready.

## Run a note with it

```sh
kandy "Rename getUser to fetchUser everywhere" --agent aider
```

## What the access levels mean

aider has no sandbox, so the levels decide which of its automatic commands run.
File edits happen in the note's worktree either way.

| | What kandy passes | What the agent can do |
| --- | --- | --- |
| **Repo only** | `--no-suggest-shell-commands --no-auto-lint --no-auto-test` | Edit files. No shell commands, lint or test runs. |
| **Full access** | nothing extra | aider's defaults, including its own lint and test runs. |

kandy also passes `--yes-always` (nobody is there to answer aider's prompts) and
`--no-auto-commits` — kandy commits the note's work itself.

## What works — and what doesn't

- **Cost in dollars** when aider knows the model's price.
- **Models** — any model aider accepts; add the ids you use to the model menu.
- **No follow-ups in the same session**, and **no messages mid-run**: aider runs
  one message and exits, and keeps no session kandy can resume. Sending a note
  back starts a fresh aider run in the same worktree — it sees the files as they
  are now, but not the earlier conversation, so say in your message what it
  needs to know.
- **No MCP servers.** aider has no MCP client; the transcript says so rather
  than pretending.

More in [Troubleshooting](/guide/troubleshooting).
