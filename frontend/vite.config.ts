import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Overridable so several copies can run side by side (e.g. parallel worktrees).
    port: Number(process.env.VITE_PORT) || 5173,
    // Same-origin in dev too: the browser calls /api, Vite forwards to the local backend.
    proxy: { '/api': process.env.VITE_API_PROXY || 'http://localhost:3000' },
  },
});
