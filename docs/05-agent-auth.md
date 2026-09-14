# Agents, auth, and the policy question

## The mechanism

We spawn the user's already-installed CLI as a child process. It inherits the environment, and
therefore inherits whatever credential the user already logged in with. We never read a token,
never store one, never transmit one.

We do now read the **metadata beside** the tokens — when the sign-in expires and which plan it is
on — and nothing else. The reason is that existence was not enough: a credential file outlives the
credential inside it, so an expired Claude Code sign-in still looked ready and the first sign of
trouble was a run failing. Two fields, no secrets:

| Agent | Read | Not read |
| --- | --- | --- |
| Claude Code | `claudeAiOauth.refreshTokenExpiresAt`, `subscriptionType` | `accessToken`, `refreshToken` |
| Codex | `auth_mode`, and whether `OPENAI_API_KEY` is set | `tokens.*` |

Codex records no expiry. kandy reports `expiresAt: null` there rather than deriving one from
`last_refresh`, because a guess wearing a timestamp is worse than saying nothing: null means "it
did not say", never "it is fine".

Observed credential locations:

| Agent | Credential |
| --- | --- |
| Claude Code | macOS Keychain (`Claude Code-credentials`); `~/.claude/.credentials.json` elsewhere |
| Codex | `~/.codex/auth.json` (`$CODEX_HOME`), mode 0600 |
| Cursor | `~/.cursor/` — exact file undocumented |
| opencode | `~/.local/share/opencode/auth.json`, mode 0600, plaintext |
| Gemini | `~/.gemini/oauth_creds.json` |
| Grok Build | `~/.grok/auth.json`, mode 0600 |

This is the cleanest possible position: the credential never enters our process.

## The policy question — read this before building the pitch

**Anthropic reportedly restricted third-party wrapping of Claude Code's subscription OAuth
(~Feb 2026)**, limiting subscription auth to Claude Code and claude.ai themselves. The
sanctioned path for a third-party orchestrator is a user-supplied `ANTHROPIC_API_KEY`.

*This is reported, not confirmed from primary source.* It needs verifying against Anthropic's
current Usage Policy and Claude Code terms **before** it is load-bearing for the product
narrative, because it changes the answer to "does my Claude Max subscription work in kandy."

The other providers are less clear-cut. OpenAI, Google, and xAI terms center on not reselling
or pooling one subscription across many users — which a single-user local orchestrator
plausibly does not do. But none of them explicitly blesses "wrap me in your product," and
absence of prohibition is not permission.

**Practical stance for v1:**

- Support `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / etc. as a first-class, documented path.
- Spawn the user's CLI as-is when it is present — we are invoking a tool the user installed on
  their own machine, the same way a Makefile would.
- Never re-implement or proxy a provider's OAuth flow ourselves. That is the line that
  separates "a tool that runs your tools" from "a client pretending to be another client."
- Make the agent layer pluggable so a provider becoming unavailable is a config change, not a
  rewrite. **Do not build a business that depends on exactly one provider's goodwill.**

## Adapter notes

**Claude Code** — `-p --output-format stream-json --verbose`. The `--verbose` flag is
*required* for line-by-line streaming; without it output buffers to the end. Session id arrives
in the `system`/`init` event. `--resume <uuid>`, and `--session-id` can pre-assign an id.
`@anthropic-ai/claude-agent-sdk` is the more idiomatic TS integration than parsing stdout.

**Codex** — `codex exec --json`, `--output-last-message <file>` for just the final answer,
`-s read-only|workspace-write|danger-full-access` for its own sandboxing. Session id cannot be
pre-assigned; capture it from the stream. Resume via `codex exec resume <id>`.

The `codex exec --json` event vocabulary:

- `thread.started` carries `thread_id`, the session id used for
  `codex exec resume <thread_id>`.
- `turn.completed` carries a `usage` object with `input_tokens`,
  `cached_input_tokens`, and `output_tokens`.
- Items arrive as `item.started` / `item.completed`, with `item.type` of
  `agent_message`, `command_execution`, `file_change`, `reasoning`, or `error`.
- Codex refusals appear as a `command_execution` item with a non-zero `exit_code`,
  not as a distinct event type.

Codex reports tokens but no dollar cost.

**Cursor** — `cursor-agent -p --output-format stream-json`, `--stream-partial-output` for text
deltas. Events: `system`, `assistant`, `tool_call`, `result`. `--resume <chatId>`.

**opencode** — `opencode acp` speaks Agent Client Protocol over stdio as ndjson. A real
protocol beats scraping stdout; make this the reference adapter and shape the others toward it.

**Gemini** — `gemini -o json`. Known gap: headless JSON output does not reliably surface the
session id, so resume is unreliable. Ship it without resume rather than faking it.

**Grok Build** — `grok -p --output-format streaming-json`; NDJSON events `step_start`, `text`,
`tool_use`, `step_finish`, `error`. Requires a SuperGrok/X Premium+ subscription.

**Aider** — `aider --message <prompt> --yes-always --no-pretty --no-stream`.
The adapter leaves provider configuration and authentication to the child and
checks no credential files. Installed means available; provider authentication
is validated by aider when it runs. The model defaults to aider's own configured
choice. Auto/dirty commits are disabled. Repo policy also disables suggested
shell commands, automatic linting and automatic tests; aider has no OS sandbox.
Live steering and session-ID resume are not supported by this adapter.

Plain output is preserved as transcript text, with applied edits normalized to
tool frames. Token counts use aider's rounded sent/received figures. Per-message
costs accumulate; cumulative session costs are ignored. Split token/cost lines
are emitted separately without counting tokens or turns twice. Process exit,
not a usage summary, finishes the run. Output formats follow
[aider's implementation](https://github.com/Aider-AI/aider/blob/main/aider/coders/base_coder.py)
and flags follow its [scripting interface](https://aider.chat/docs/scripting.html).

## What this means for the Usage page

Both of the agents kandy ships adapters for are normally used on a plan — Claude Code on a
subscription, Codex on a ChatGPT account. On a plan there is no per-token bill, so **no figure on
the Usage page is a charge anyone makes.**

On top of that, only Claude reports a dollar amount for a turn at all. Codex reports tokens and
kandy prices them from a rate table, which is arithmetic on an assumed rate for a model kandy may
not even know: of 24 Codex runs on this repo's own board, zero carried a cost from the agent and
seventeen carried no model either.

kandy used to mark the derived ones with a `≈`. That drew the wrong line — it implied the
unmarked figures were exact when none of them is a bill. Usage says it once, in a sentence, and
the numbers are left clean. `costSource` is still recorded per run, because provenance is worth
keeping even when it is not worth printing on every row.
