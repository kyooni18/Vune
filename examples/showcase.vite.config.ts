import { fileURLToPath, URL } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { musePlugin } from "@muse/vite"

export default defineConfig({
  cacheDir: "../node_modules/.vite-muse-showcase",
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [musePlugin(), react()],
  build: {
    rollupOptions: { input: fileURLToPath(new URL("./showcase-index.html", import.meta.url)) },
    outDir: "../showcase-dist",
    emptyOutDir: true,
  },
})
