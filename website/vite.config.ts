import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // 5174 so it can run next to the app's dev server (5173).
  server: { port: Number(process.env.VITE_PORT) || 5174 },
});
