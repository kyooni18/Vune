import { fileURLToPath, URL } from "node:url"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"
import { musePlugin } from "@muse/vite"

export default defineConfig({
  cacheDir: '../node_modules/.vite-muse-parity-vue',
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [musePlugin(), vue()],
  build: {
    rollupOptions: { input: fileURLToPath(new URL("./parity-vue-index.html", import.meta.url)) },
    outDir: "../parity-vue-dist",
    emptyOutDir: true,
  },
})
