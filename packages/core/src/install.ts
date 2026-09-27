/**
 * How someone installs kandy — in every invite, every onboarding screen, and
 * every "connect your machine" hint, read from here and nowhere else.
 *
 * From the newest GitHub release, not npm: the unscoped name `kandy` on npm
 * belongs to someone else, so `npm i -g kandy` would install a stranger's
 * package. `releases/latest/download/` always resolves to the newest release,
 * so this line doesn't change per version. Change it here, once, if kandy is
 * ever published to npm under a name of its own.
 */
export const INSTALL_URL = "https://github.com/hiteshbandhu/kandy/releases/latest/download/kandy.tgz"
export const INSTALL_COMMAND = `npm i -g ${INSTALL_URL}`
