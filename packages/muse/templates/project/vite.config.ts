import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { musePlugin } from '@muse/vite'

export default defineConfig({
  plugins: [
    musePlugin(),
    react(),
  ],
})
