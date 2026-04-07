import { defineConfig } from 'vite';

export default defineConfig({
  // Proxy API calls in dev mode to Express backend
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  }
});
