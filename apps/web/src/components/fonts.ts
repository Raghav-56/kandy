// Self-hosted so the board renders identically offline and in CI. troika (what
// drei's <Text> uses) needs a URL it can fetch, which Vite gives us with ?url.
import display from "@fontsource/inter/files/inter-latin-900-normal.woff2?url"
import body from "@fontsource/inter/files/inter-latin-400-normal.woff2?url"

export const FONT_DISPLAY = display
export const FONT_BODY = body
