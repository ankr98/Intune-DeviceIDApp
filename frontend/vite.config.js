import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  
  // --- DEVELOPMENT PROXY ---
  // This mimics the Nginx configuration you use in Docker.
  // It allows you to use relative paths ("/api/manufacturers") in your code
  // without worrying about CORS or ports.
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000', // Your running Python backend
        changeOrigin: true,
        secure: false,
        // We strip the '/api' prefix because your FastAPI endpoints 
        // are defined as '/manufacturers', not '/api/manufacturers'
        rewrite: (path) => path.replace(/^\/api/, ''), 
      },
    },
  },
})