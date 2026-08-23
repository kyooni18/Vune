import { fileURLToPath, URL } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { musePlugin } from "@muse/vite"

export default defineConfig({
  cacheDir: '../node_modules/.vite-muse-parity-react',
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [musePlugin(), react()],
  build: {
    rollupOptions: { input: fileURLToPath(new URL("./parity-react-index.html", import.meta.url)) },
    outDir: "../parity-react-dist",
    emptyOutDir: true,
  },
})
