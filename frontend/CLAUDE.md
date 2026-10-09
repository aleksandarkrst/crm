# Frontend rules (the app, React + Vite)

Read with the root [CLAUDE.md](../CLAUDE.md); these apply inside `frontend/`.

- The frontend is a port of the Claude Design handoff "Mini CRM v2.dc.html". Keep its tokens and spacing (`src/styles/global.css`): colours, fonts and shadows are `var(--…)` tokens, never literals in a screen.
- Screens only use `useStore()`. The store loads from the API (`store/remote.ts`) and saves in its actions (`store/store.tsx`); screens never call the API or `localStorage` themselves.
- Features without a backend yet stay browser-only (see docs/ARCHITECTURE.md "Frontend: store → API").
- Button labels are plain text: no trailing "…", "..." or similar (a busy state such as "Saving…" is a status, not a label).
- No browser dialogs: confirmations go through `askConfirm()`, messages through the flash; modals portal to `body`, never nested in another overlay.
- Layouts work at phone width (360 px) as well as desktop.
- Unit tests run with Node's test runner (`npm test`, `test/*.test.ts`); browser tests live in `../e2e/` and run only before a production deploy.
- Checks: `npm run lint && npm run typecheck && npm run build`.
- Before opening a pull request that touches `frontend/src/`, have the `design-fidelity-reviewer` agent read the diff (`/finish-issue` does).
