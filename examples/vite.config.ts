import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { ruiMacro } from '../src/vite.ts'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    ruiMacro(),
    react(),
  ],
  build: {
    outDir: '../demo-dist',
    emptyOutDir: true,
  },
})
