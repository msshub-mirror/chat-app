// ~/projects/chat-app/client/vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  server: {
    port: 3000,            // ← ここで固定
    proxy: {
      // /api/* はバックエンドに転送する
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
           '/socket.io': {
             target: 'http://localhost:4000',
             ws: true,
           }
    }
  },
  plugins: [react()],
})
