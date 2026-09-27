import { Agent } from 'node:http';
import { sentryVitePlugin } from '@sentry/vite-plugin';
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

/**
 * Readable stack traces in Sentry (CD-102): when the image build has a SENTRY_AUTH_TOKEN (a build
 * secret, never in the image), the build writes source maps, uploads them to the frontend project
 * for this release (VITE_APP_VERSION, the same one Sentry.init reports) and deletes them, so they
 * are never served. Without a token nothing changes.
 */
const uploadSourceMaps = !!process.env.SENTRY_AUTH_TOKEN && !!process.env.VITE_SENTRY_DSN;

export default defineConfig({
  plugins: [
    react(),
    ...(uploadSourceMaps
      ? [
          sentryVitePlugin({
            authToken: process.env.SENTRY_AUTH_TOKEN,
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            url: process.env.SENTRY_URL || 'https://de.sentry.io/',
            release: { name: process.env.VITE_APP_VERSION || undefined },
            sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
            telemetry: false,
          }),
        ]
      : []),
  ],
  server: {
    // Overridable so several copies can run side by side (e.g. parallel worktrees).
    port: Number(process.env.VITE_PORT) || 5173,
    // Same-origin in dev too: the browser calls /api, Vite forwards to the local backend.
    proxy,
  },
  // CSP_PREVIEW: serve the built app with this Content-Security-Policy enforced, to check the
  // production policy (CD-92): CSP_PREVIEW="$(node scripts/csp.mjs policy)" npx vite preview
  preview: { proxy, headers: process.env.CSP_PREVIEW ? { 'Content-Security-Policy': process.env.CSP_PREVIEW } : undefined },
  build: {
    // 'hidden': maps for the upload only, no sourceMappingURL comment in the served files.
    sourcemap: uploadSourceMaps ? 'hidden' : false,
    rolldownOptions: {
      output: {
        // Vendor code in its own chunks (CD-24): it changes less often than the app, so browsers
        // keep it cached across deploys. Screens are split by the lazy routes in App.tsx.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'router', test: /node_modules[\\/](react-router|react-router-dom|cookie|set-cookie-parser)[\\/]/ },
            // Error tracking (CD-8), loaded after startup and only when a Sentry DSN is built in.
            { name: 'sentry', test: /node_modules[\\/]@sentry[\\/]/ },
          ],
        },
      },
    },
  },
});
