import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5477,
    // Same-origin in dev so the browser's EventSource needs no CORS dance.
    proxy: {
      "/api": { target: "http://127.0.0.1:4477", rewrite: (p) => p.replace(/^\/api/, "") },
    },
  },
})
