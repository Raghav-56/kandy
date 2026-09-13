import type { ReactNode } from "react"

/**
 * Deliberately the native title attribute.
 *
 * A custom tooltip is a portal, a positioner, a delay timer and a focus trap —
 * a lot of machinery for a hint. When one of these needs rich content it can
 * graduate; until then this is honest.
 */
export function Hint({ text, children }: { text: string; children: ReactNode }) {
  return <span title={text}>{children}</span>
}
