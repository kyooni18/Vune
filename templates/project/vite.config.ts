import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { vunePlugin } from '@vune-ui/vite'

export default defineConfig({
  plugins: [
    vunePlugin(),
    react(),
  ],
})
