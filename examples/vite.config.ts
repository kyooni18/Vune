import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { vunePlugin } from '@vune-ui/vite'

export default defineConfig({
  cacheDir: '../node_modules/.vite-vune-react',
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    vunePlugin(),
    tailwindcss(),
    react(),
  ],
  optimizeDeps: {
    entries: ["./index.html"],
  },
  build: {
    outDir: '../demo-dist',
    emptyOutDir: true,
  },
})
