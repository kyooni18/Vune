import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { museMacro } from 'react-muse-ui/vite'

export default defineConfig({
  plugins: [
    museMacro(),
    react(),
  ],
})
