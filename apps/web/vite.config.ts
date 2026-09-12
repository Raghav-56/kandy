import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    port: 5477,
    // Same-origin in dev so the browser's EventSource needs no CORS dance.
    proxy: {
      "/api": { target: "http://127.0.0.1:4477", rewrite: (p) => p.replace(/^\/api/, "") },
    },
  },
})
