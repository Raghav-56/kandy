import { useCallback, useSyncExternalStore } from "react"

/**
 * Whether a media query matches, right from the first render.
 *
 * `useIsMobile` starts at false and corrects itself in an effect, which is
 * fine for a placeholder but not for layout: the wide layout would mount,
 * measure and persist its panel sizes before the narrow one replaced it.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
}
