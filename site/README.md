# Sequence — trysequence.app

Marketing site. **Vite + React + TypeScript + Tailwind v4 + shadcn/Radix.** No motion library: motion is hand-written CSS plus one small hook.

Visual system: **Apple product-page framework** (alternating light/dark tiles, huge type, product-as-hero) with Sequence Graphite gold only on CTAs (Decision 22). Mark is monochrome (Decision 26).

From-scratch rebuild (2026-09-15). Prior glass/ASCII marketing shell deleted.

| path | role |
| --- | --- |
| `index.html` / `benchmarks.html` | Vite MPA entries |
| `src/pages/` | Landing + Measured |
| `src/components/sections/` | Apple-style tiles |
| `src/components/ui/` | shadcn-style primitives |
| `src/styles/globals.css` | Tokens + type (motion tokens copied from the app's `graphite.css`) |
| `src/styles/native.css` | Interaction layer: tactile press, hover lift, 44px touch targets, swipe shelves, dialog exit |
| `src/components/lt/useDialogDismiss.ts` | Tour dialog exit and swipe-down-to-close |
| `src/data/release.ts` | Installer URLs (CI reads these) |
| `src/data/content.ts` | Modes / surfaces / help |
| `vercel.json` | Vercel: `npm install` → `npm run build` → `dist` |

## Brand mark

SoT: `docs/brand/marks/` (Decision 26). Site copies live in `public/` and `BrandMark.tsx`.

## Deploy

Vercel Root Directory = `site` → trysequence.app

## Local

```bash
cd site
npm install
npm run dev
npm run build
```

## Gates

`npm test` runs `tests/*.test.mjs`, including `native.test.mjs` (the press, exit and swipe rules exist and the motion tokens equal the app's).

`tools/ci/site-links.test.mjs` scans `site/src` hrefs and requires `site/dist`.
