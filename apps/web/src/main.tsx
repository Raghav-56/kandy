import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
// Self-hosted: no network dependency for the display voice.
import "@fontsource/inter/latin-400.css"
import "@fontsource/inter/latin-500.css"
import "@fontsource/inter/latin-600.css"
import { App } from "./App"
import "./styles.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
