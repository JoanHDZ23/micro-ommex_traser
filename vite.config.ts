import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // JS a sintaxis compatible con navegadores/WebView antiguos de teléfonos.
    // El CSS de Tailwind v4 se degrada aparte con scripts/downlevel-css.mjs
    // (aplana @layer y @property que Chrome <99 no soporta).
    target: ['chrome87', 'safari13', 'firefox78', 'edge88'],
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        timeout: 120_000, // 2 min — GAS puede tardar en responder
      },
    },
  },
})
