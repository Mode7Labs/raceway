import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const apiKey = process.env.RACEWAY_KEY;
const headers: Record<string, string> = {};

if (apiKey) {
  headers['Authorization'] = `Bearer ${apiKey}`;
  headers['X-Raceway-Key'] = apiKey;
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3005,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        headers,
      },
      '/events': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        headers,
      },
      '/status': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        headers,
      },
    },
  },
})
