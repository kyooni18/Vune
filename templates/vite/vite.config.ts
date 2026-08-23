import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { museMacro } from 'vune-ui/vite'

export default defineConfig({
  plugins: [
    museMacro(),
    react(),
  ],
})
