import { fileURLToPath, URL } from "node:url"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"
import { vunePlugin } from "@vune-ui/vite"

export default defineConfig({
  cacheDir: '../node_modules/.vite-vune-parity-vue',
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [vunePlugin(), vue()],
  build: {
    rollupOptions: { input: fileURLToPath(new URL("./parity-vue-index.html", import.meta.url)) },
    outDir: "../parity-vue-dist",
    emptyOutDir: true,
  },
})
