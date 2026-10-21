import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: http://localhost:5173 with /api proxied to the FastAPI backend.
// Production: `npm run build` writes web/dist, which FastAPI serves at "/" (base "/").

/** Everything recharts pulls in, kept together so it loads as one cacheable chunk, only on pages that draw charts. */
const CHART_PKGS =
  /[\/]node_modules[\/](recharts|recharts-scale|victory-vendor|d3-[^\/]+|internmap|decimal\.js-light|eventemitter3|fast-equals|react-smooth|react-transition-group|dom-helpers|lodash|tiny-invariant|clsx|prop-types|react-is)[\/]/
const REACT_PKGS = /[\/]node_modules[\/](react|react-dom|react-router|react-router-dom|@remix-run[\/]router|scheduler)[\/]/

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
    chunkSizeWarningLimit: 450,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (CHART_PKGS.test(id)) return 'recharts'
          if (REACT_PKGS.test(id)) return 'react'
          return undefined
        },
      },
    },
  },
})
