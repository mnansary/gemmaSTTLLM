import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 9001,
    strictPort: false,
    proxy: {
      '/ws': {
        target: 'wss://localhost:9000',
        ws: true,
        secure: false,
      },
      '/health': 'https://localhost:9000',
      '/config': 'https://localhost:9000',
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
