import { Agent } from 'node:http';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Where /api goes in `vite` and `vite preview`: the local backend. The backend listens on IPv4
 * (0.0.0.0), so "localhost" is pinned to 127.0.0.1: otherwise Node tries ::1 first on every
 * connect and only then falls back to IPv4.
 */
const apiTarget = (process.env.VITE_API_PROXY || 'http://127.0.0.1:3000').replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1');

/**
 * Reuse connections to the API (CD-75). Without an agent the proxy opens a new TCP connection per
 * request and asks the API to close it, which leaves one TIME_WAIT socket per request. On Windows,
 * a new connection then now and then gets a local port whose socket to the API is still in
 * TIME_WAIT, the connect fails with EADDRINUSE, and the browser sees a 502. Node's agent drops idle
 * sockets before the API's keep-alive timeout (it reads the Keep-Alive header), so a reused socket
 * isn't closed under a request.
 */
const apiAgent = new Agent({ keepAlive: true, maxSockets: 32 });

const proxy = { '/api': { target: apiTarget, agent: apiAgent } };

export default defineConfig({
  plugins: [react()],
  server: {
    // Overridable so several copies can run side by side (e.g. parallel worktrees).
    port: Number(process.env.VITE_PORT) || 5173,
    // Same-origin in dev too: the browser calls /api, Vite forwards to the local backend.
    proxy,
  },
  preview: { proxy },
  build: {
    rolldownOptions: {
      output: {
        // Vendor code in its own chunks (CD-24): it changes less often than the app, so browsers
        // keep it cached across deploys. Screens are split by the lazy routes in App.tsx.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'router', test: /node_modules[\\/](react-router|react-router-dom|cookie|set-cookie-parser)[\\/]/ },
          ],
        },
      },
    },
  },
});
