import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { museMacro } from '../src/vite.ts'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    museMacro(),
    react(),
  ],
  build: {
    outDir: '../demo-dist',
    emptyOutDir: true,
  },
})
