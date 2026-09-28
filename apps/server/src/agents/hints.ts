/**
 * What to type to install an agent, and to sign in to it.
 *
 * One table, because "not installed" and "signed out" are said by the CLI
 * before a note is made and by the runner when a run cannot start, and a
 * command that differs between the two is a command someone copies wrong.
 * Kept in step with the pages under apps/docs/agents.
 */
export const INSTALL: Record<string, string> = {
  claude: "npm i -g @anthropic-ai/claude-code",
  codex: "npm i -g @openai/codex",
  cursor: "curl https://cursor.com/install -fsS | bash",
  opencode: "npm i -g opencode-ai",
  aider: "python -m pip install aider-install && aider-install",
}

export const SIGN_IN: Record<string, string> = {
  claude: "claude (then /login)",
  codex: "codex login",
  cursor: "cursor-agent login",
  opencode: "opencode auth login",
  aider: "set your model provider's API key",
}

/**
 * What to say when no agent here can take a note, and what to do about it.
 *
 * Installed but signed out is one command away, so those commands are named —
 * only for the agents actually installed. With none installed "sign in" is the
 * wrong instruction; opencode is offered first because it runs free models
 * with no account, so it is the one path that needs nothing else.
 */
export function noAgent(agents: readonly { id: string; installed: boolean }[]): { head: string; next: string } {
  const installed = agents.filter((a) => a.installed).map((a) => a.id)
  if (installed.length) {
    return {
      head: "no agent is signed in here",
      next: `sign in to one (${installed.map((id) => SIGN_IN[id] ?? id).join(" · ")})`,
    }
  }
  return {
    head: "no agent is installed here",
    next: `opencode runs free models with no account: ${INSTALL["opencode"]} — or ${INSTALL["claude"]}`,
  }
}

/** "aider isn't installed on this machine — install it: …" */
export function notInstalled(agent: string): string {
  const how = INSTALL[agent]
  return `${agent} isn't installed on this machine` + (how ? ` — install it with ${how}, or pick another agent` : " — pick another agent")
}
