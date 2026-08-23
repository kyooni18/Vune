import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"
import { musePlugin } from "@muse/vite"

export default defineConfig({
  cacheDir: '../node_modules/.vite-muse-parity-web',
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [musePlugin()],
  build: {
    rollupOptions: { input: fileURLToPath(new URL("./parity-web-index.html", import.meta.url)) },
    outDir: "../parity-web-dist",
    emptyOutDir: true,
  },
})
