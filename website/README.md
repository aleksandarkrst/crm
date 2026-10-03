# pultly.com

The public website at pultly.com: home page and blog, in English and Serbian (Latin script).
Sign in and Try Pultly / Create account link to the app: https://app.pultly.com/login and
https://app.pultly.com/signup (`VITE_APP_URL` at build time points them at another app, e.g. staging).
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
- Routes are clean paths with no `.html`: `/`, `/blog`, `/blog/<post-id>`, plus `/#product` and
  `/#modules`. The host must serve `index.html` for any path it has no file for (the Dockerfile's
  nginx does; so does Cloudflare Pages).
- Animations (rotating hero word, rising bars, count-up, the tilting product screen, scroll reveal)
  are off for visitors with "reduce motion" turned on.

Not done yet: there are no Terms or Privacy pages to link to.
