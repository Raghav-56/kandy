# Agents, auth, and the policy question

## The mechanism

We spawn the user's already-installed CLI as a child process. It inherits the environment, and
therefore inherits whatever credential the user already logged in with. We never read a token,
never store one, never transmit one.

Observed credential locations (existence verified; contents never read):

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
