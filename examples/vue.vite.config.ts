import { fileURLToPath, URL } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"
import { vunePlugin } from "@vune-ui/vite"

export default defineConfig({
  cacheDir: '../node_modules/.vite-vune-vue',
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [vunePlugin(), tailwindcss(), vue()],
  build: {
    rollupOptions: { input: fileURLToPath(new URL("./vue-index.html", import.meta.url)) },
    outDir: "../vue-demo-dist",
    emptyOutDir: true,
  },
})
