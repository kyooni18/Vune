import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { vuneMacro } from '../src/vite'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    vuneMacro(),
    react(),
  ],
  build: {
    outDir: '../demo-dist',
    emptyOutDir: true,
  },
})
