import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"
import { musePlugin } from "@muse/vite"

export default defineConfig({
  cacheDir: '../node_modules/.vite-muse-web',
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [musePlugin()],
  build: {
    rollupOptions: { input: fileURLToPath(new URL("./web-index.html", import.meta.url)) },
    outDir: "../web-demo-dist",
    emptyOutDir: true,
  },
})
