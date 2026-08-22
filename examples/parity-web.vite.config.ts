import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"
import { musePlugin } from "@muse/vite"

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [musePlugin()],
  build: {
    rollupOptions: { input: fileURLToPath(new URL("./parity-web-index.html", import.meta.url)) },
    outDir: "../parity-web-dist",
    emptyOutDir: true,
  },
})
