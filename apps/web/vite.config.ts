import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

// Default port for standalone dev, overridden by CRAFT_WEB_SERVER_PORT when running with electron:dev
const WEB_SERVER_PORT = process.env.CRAFT_WEB_SERVER_PORT || '3100'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: __dirname,
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      'react': resolve(__dirname, '../../node_modules/react'),
      'react-dom': resolve(__dirname, '../../node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist',
    emptyDirBeforeWrite: true,
    sourcemap: true,
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
  server: {
    port: 5175,
    open: true,
    proxy: {
      '/api': {
        target: `http://localhost:${WEB_SERVER_PORT}`,
        changeOrigin: true,
      },
    },
  },
})
