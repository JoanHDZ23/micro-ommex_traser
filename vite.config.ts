import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,           // lo hacemos manualmente en main.tsx
      workbox: {
        // Precacha todo el shell de la app (JS/CSS/HTML)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: ['**/pdf.worker*'],  // too large, skip
        skipWaiting: true,
        clientsClaim: true,
        // Límite por archivo: 8 MB (chunks grandes de la app)
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        runtimeCaching: [
          // Cache-first para imágenes de R2/GitHub (fotos de operaciones)
          {
            urlPattern: /^https:\/\/(raw\.githubusercontent\.com|.*\.r2\.cloudflarestorage\.com|pub-.*\.r2\.dev)/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'operation-photos',
              expiration: { maxEntries: 300, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Network-first para la API (usa cache solo si hay error de red).
          // Matchea tanto la ruta relativa /api (dev) como la URL absoluta de producción.
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api') ||
              url.hostname === 'micro-ommex-traser.onrender.com',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-responses',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 200, maxAgeSeconds: 48 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Cache-first para Google Drive thumbnails
          {
            urlPattern: /^https:\/\/lh3\.googleusercontent\.com/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'drive-thumbnails',
              expiration: { maxEntries: 200, maxAgeSeconds: 3 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'Ommex Tracer',
        short_name: 'Tracer',
        description: 'Registro fotográfico de operaciones de trazabilidad',
        theme_color: '#1e3a5f',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        lang: 'es',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  build: {
    target: ['chrome87', 'safari13', 'firefox78', 'edge88'],
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        timeout: 120_000,
      },
    },
  },
})
