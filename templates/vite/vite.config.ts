import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { vuneMacro } from 'vune-ui/vite'

export default defineConfig({
  plugins: [
    vuneMacro(),
    react(),
  ],
})
