import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react({
    jsxRuntime: 'classic' // Per compatibilità con React 18
  })],
  logLevel: 'info',
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        secure: false,
      },
      '/images': {
        target: 'http://localhost:8080', 
        changeOrigin: true,
        secure: false,
      }
    }
  },
});
