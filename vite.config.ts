import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Splits the framework/SDK code (React, router, React Query, Supabase client) into its
        // own chunk, separate from app code. Without this, every feature we ship rewrites the one
        // eagerly-loaded entry bundle and invalidates the browser cache for React itself too, even
        // though it never changed — this chunk stays byte-identical across deploys that don't
        // touch a dependency, so returning visitors skip re-downloading it.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (/[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor'
            if (id.includes('react-router')) return 'vendor'
            if (id.includes('@tanstack')) return 'vendor'
            if (id.includes('@supabase')) return 'vendor'
          }
        },
      },
    },
  },
})
