/**
 * How someone installs kandy — in every invite, every onboarding screen, and
 * every "connect your machine" hint, read from here and nowhere else.
 *
 * The one-liners fetch a script from the docs site (apps/docs/public/) that
 * checks Node, installs the tarball below, and starts first-run setup on a
 * machine that hasn't had it. INSTALL_URL is what they install, and the
 * manual way for anyone who'd rather not pipe a script into a shell.
 *
 * From the newest GitHub release, not npm: the unscoped name `kandy` on npm
 * belongs to someone else, so `npm i -g kandy` would install a stranger's
 * package. `releases/latest/download/` always resolves to the newest release,
 * so this line doesn't change per version. Change it here, once, if kandy is
 * ever published to npm under a name of its own.
 */
export const INSTALL_URL = "https://github.com/hiteshbandhu/kandy/releases/latest/download/kandy.tgz"
export const INSTALL_NPM = `npm i -g ${INSTALL_URL}`
export const INSTALL_COMMAND = "curl -fsSL https://hiteshbandhu.github.io/kandy/install.sh | sh"
export const INSTALL_COMMAND_WINDOWS = "irm https://hiteshbandhu.github.io/kandy/install.ps1 | iex"
