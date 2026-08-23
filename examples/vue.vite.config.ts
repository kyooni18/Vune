import { fileURLToPath, URL } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"
import { musePlugin } from "@muse/vite"

export default defineConfig({
  cacheDir: '../node_modules/.vite-muse-vue',
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [musePlugin(), tailwindcss(), vue()],
  build: {
    rollupOptions: { input: fileURLToPath(new URL("./vue-index.html", import.meta.url)) },
    outDir: "../vue-demo-dist",
    emptyOutDir: true,
  },
})
