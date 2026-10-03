# pultly.com

The public website: home page, blog, sign up and sign in, in English and Serbian (Latin script).
A React + Vite port of the Claude Design handoff "Pultly Website" (desktop and mobile), using the
Pultly design tokens (Forest Signal colours, Unbounded + Onest).

```bash
npm install
npm run dev      # http://localhost:5174
npm run lint && npm run build
```

- Copy lives in `src/content/copy.ts` (English and Serbian, same keys; TypeScript checks it).
  The visitor's language is remembered in localStorage (`pultly.site.lang`); English is the default.
- Blog posts live in `src/content/posts.ts`. The five posts there are sample content from the design:
  replace them before launch.
- Routes: `/`, `/#product`, `/#modules`, `/blog`, `/blog/:id`, `/signup`, `/signin`. The host must
  serve `index.html` for unknown paths (the Dockerfile's nginx does).
- Animations (rotating hero word, rising bars, count-up, the tilting product screen, scroll reveal)
  are off for visitors with "reduce motion" turned on.

Not done yet: the sign up and sign in forms and the Google button aren't connected to the app's
auth, and there are no Terms or Privacy pages to link to.
