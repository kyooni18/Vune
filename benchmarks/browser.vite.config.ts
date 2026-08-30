import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"
import { vunePlugin } from "@vune-ui/vite"

export default defineConfig({
  root: fileURLToPath(new URL("./browser", import.meta.url)),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-vune-browser-bench", import.meta.url)),
  plugins: [vunePlugin()],
  build: {
    outDir: fileURLToPath(new URL("../browser-benchmark-dist", import.meta.url)),
    emptyOutDir: true,
    minify: "esbuild",
  },
})
