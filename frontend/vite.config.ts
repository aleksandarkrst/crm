import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin in dev too: the browser calls /api, Vite forwards to the local backend.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
