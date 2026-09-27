/** One constant, shared with the CLI: see packages/core/src/install.ts. */
export { INSTALL_COMMAND } from "@kandy/core"
import { INSTALL_COMMAND, INSTALL_COMMAND_WINDOWS } from "@kandy/core"
/** What a person runs on their laptop to connect it to this hub. */
export function joinCommand(origin = window.location.origin): string {
  return `kandy join ${origin}`
}

/** What an owner runs to let someone in, when the page is not at hand. */
export function inviteCommand(email: string): string {
  return `kandy invite ${email}`
}

/**
 * The message an owner pastes to someone they just added.
 *
 * Everything the newcomer needs in one block, in the order they need it —
 * the network first, because without it nothing after it resolves.
 */
export function inviteMessage(origin = window.location.origin): string {
  return [
    `You're on the kandy hub at ${origin}.`,
    `1. Make sure you're on our Tailscale network.`,
    `2. Install kandy:  ${INSTALL_COMMAND}`,
    `   (on Windows, in PowerShell:  ${INSTALL_COMMAND_WINDOWS})`,
    `3. Connect your machine:  ${joinCommand(origin)}`,
    `Then open ${origin} — your notes run on your own machine, with your own agents.`,
  ].join("\n")
}
