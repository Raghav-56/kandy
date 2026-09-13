import { useEffect, useState } from "react"

export type Theme = "dark" | "light" | "system"

const KEY = "kandy.theme"

/**
 * Theme as a data attribute on <html>, so every colour is a variable swap
 * rather than a second set of classes. "system" follows the OS and keeps
 * following it — a preference, not a one-time read.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem(KEY) as Theme) || "system"
    } catch {
      return "system"
    }
  })

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)")
    const apply = () => {
      const resolved = theme === "system" ? (media.matches ? "light" : "dark") : theme
      document.documentElement.setAttribute("data-theme", resolved)
      document.documentElement.style.colorScheme = resolved
    }
    apply()
    if (theme !== "system") return
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [theme])

  useEffect(() => {
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      // Private window, blocked storage — the theme just doesn't persist.
    }
  }, [theme])

  return { theme, setTheme }
}
