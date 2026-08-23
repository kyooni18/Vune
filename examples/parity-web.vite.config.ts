import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"
import { vunePlugin } from "@vune-ui/vite"

export default defineConfig({
  cacheDir: '../node_modules/.vite-vune-parity-web',
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [vunePlugin()],
  build: {
    rollupOptions: { input: fileURLToPath(new URL("./parity-web-index.html", import.meta.url)) },
    outDir: "../parity-web-dist",
    emptyOutDir: true,
  },
})
