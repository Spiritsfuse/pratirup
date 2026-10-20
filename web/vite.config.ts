import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: http://localhost:5173 with /api proxied to the FastAPI backend.
// Production: `npm run build` writes web/dist, which FastAPI serves at "/" (base "/").
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
  preview: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
})
