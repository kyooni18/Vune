import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { vuneMacro } from '../src/vite'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    vuneMacro(),
    vue(),
  ],
  build: {
    outDir: '../demo-dist',
    emptyOutDir: true,
  },
})
