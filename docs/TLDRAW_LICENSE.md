# tldraw licensing — what applied to Sequence (v1)

> **Status (v2 pivot, 2026-08-20):** **no live obligation.** `packages/web2` does not
> depend on tldraw; the v1 Task Board that did was deleted with `packages/web`
> (`20d1424`). The sections below are the historical record of the licence while
> tldraw shipped. If tldraw is ever added back, this file becomes binding again.

While it shipped, Sequence's **Task Board** was built on the **tldraw SDK**
(`tldraw` 5.2.5). tldraw is *source-available, not open-source*, and its license
terms changed materially in **v4.0 (Sep 2025)**. Figures marked "community-reported"
are not official quotes — tldraw does not publish pricing.

## Resolved (r95, v1 era): this was never a screenshot blocker

HANDOFF §8.11 tracked "get a real Task Board screenshot" as **blocked on a tldraw licence
decision** for several rounds. That framing was wrong for v1: the licence
question gated a *production build for customers*, not *looking at our own surface in
development* — and every other product surface already got its screenshots from a dev build.

**Verified directly against the installed `@tldraw/editor` source** (`LicenseManager.ts`,
`Watermark.tsx`), not assumed:
- With no host override, `LicenseManager.isDevelopment` is true on `127.0.0.1`/`localhost`
  regardless of `NODE_ENV` (`isLoopbackHost`). The e2e/dev server binds to `127.0.0.1`, so every
  screenshot script in this repo already runs tldraw in its free development tier.
- With `VITE_TLDRAW_LICENSE_KEY` unset, `getLicenseFromKey` returns `no-key-provided`, and
  `getLicenseState` maps that + `isDevelopment` to license state **`unlicensed`** — not
  `unlicensed-production` (that state is reserved for a non-loopback host with no key, which is
  the actual "you can't ship this" case).
- `Watermark.tsx` renders for `licenseManagerState` in `['licensed-with-watermark', 'unlicensed']`
  — so the dev/unlicensed state **does** show a watermark
  (`data-testid="tl-watermark-unlicensed"`), it just isn't a blocker to render, click, or screenshot
  the board.

**Automated then (v1 only — deleted 2026-08-20; see the status note at the end):** `packages/web/e2e/taskboard-shot.mjs` (`pnpm --filter @sequence/web
test:e2e:taskboard`) opens the board on the real Sequence monorepo, asserts tldraw actually
rendered (not just that the tab exists — a blank canvas fails the script), opens
"Import from Architecture", imports a real classifier, and asserts the resulting task card carries
that classifier's real title and a real multi-hundred-character ADR body rather than the
blank-card placeholder ("New task" / empty description). It captures `tmp-shots/taskboard.png`.
`packages/web/e2e/legibility.mjs` also gained a `taskboard` stop — the last product surface that
had no legibility coverage now has one.

**The watermark DOES appear in the dev screenshot**, exactly as `docs/TLDRAW_LICENSE.md` predicts,
and that is expected, not a defect: `tmp-shots/taskboard.png` shows the "Get a license for
production" badge element in the DOM at the board's bottom-right corner. In the app's *default*
post-attach layout the Task Board tab lands in the narrow left chat pane (~380px wide), and
tldraw's own responsive rule switches the watermark to its compact "mobile" form below 700px —
an 8-12px sliver rather than the full badge. It is still present and still functional (confirmed
via `getBoundingClientRect` and the `tl-watermark-unlicensed` testid), just easy to miss at a
glance in that narrow placement; opening the board in the wider main pane shows the full badge.

**What is still open, and still needs the operator, not an agent:** whether to buy a trial key
(free, 100 days, watermark-free) or a commercial key before any customer-facing/production build.
Nothing about that decision changed — only the "we can't even look at it" framing did.

## The short version
- **Development / local use: free.** No license key required. This is what we run today (`./start.sh`,
  the whole build, all screenshots). Nothing to pay to build on it.
- **Shipping a commercial product** (a paid/hosted Sequence) **requires a paid commercial license
  key.** The old "free with a *made with tldraw* watermark, usable commercially" path was **removed in
  4.x** — the watermark is now tied to the *non-commercial* hobby tier only, and you're contractually
  barred from removing/altering it on the free tiers.

## The tiers (current 4.x/5.x)
| Tier | Cost | Watermark | Use |
| --- | --- | --- | --- |
| **Development** | free | n/a | localhost/dev only — no key needed |
| **Trial** | free, 100 days | removed | evaluate in production for 100 days (one per commercial unit) |
| **Hobby** | free | **required** | **non-commercial** only |
| **Commercial** | paid (community-reported ~$5–10K/yr, 1yr upfront; **sales-gated, no public price**) | removed | commercial production; includes multiplayer sync + support |

## How it's wired in Sequence (a clean, no-cost-today seam)
- The board mounts `<Tldraw licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY || undefined} …>`.
- **In dev / today:** `VITE_TLDRAW_LICENSE_KEY` is unset → tldraw runs free and shows its watermark on
  the board canvas. That is expected and fine for development and demos.
- **At go-live:** drop a key into the env (`VITE_TLDRAW_LICENSE_KEY=…` at build time). A **free 100-day
  trial key** removes the watermark immediately for launch/evaluation; a **commercial key** is the
  permanent answer once you decide to pay. No code change — just the env var. The key is client-side
  and safe to expose (tldraw validates it offline); **no key is committed to this repo.**

## Go-live checklist for the board
1. Decide: trial (free, 100 days, watermark-free) to launch now, or start the commercial sales
   conversation (startup discounts exist; get a real written quote — pricing is the one true unknown).
2. Obtain the key at <https://tldraw.dev> (dashboard / sales form).
3. Set `VITE_TLDRAW_LICENSE_KEY` in the deploy build env (e.g. Vercel/Render build vars). Done.

## Why we adopted it anyway (recorded rationale)
tldraw gives the genuine best-in-class canvas feel, custom React components as first-class shapes
(our task cards), and built-in undo/redo, arrows-with-binding, freehand ink, and offline persistence —
things we'd otherwise hand-build. It's production-proven (Google, Shopify, ClickUp, Replit). We scoped
it to the **freeform Task Board only** and kept the auto-laid-out architecture graph on React Flow,
because tldraw has no auto-layout and would fight ELK. The single cost is the eventual commercial
license — a launch-time business decision, not a build-time blocker.

---

## Status under the v2 pivot (2026-08-20)

**The licence obligation is real if and only if tldraw is still a dependency. It is not.**

Answered 2026-08-21, by reading the manifests rather than guessing: `packages/web2/package.json`
does not list tldraw, and no package in the repo declares it. The Task Board and the whiteboard
were on the v2 CUT list (`docs/research/v2-architecture-and-gaps.md` §1.2) and did not come back,
and the harness cited above lived in `packages/web/e2e/`, deleted with v1 on 2026-08-20
(`20d1424`).

**So this file is history, not a live obligation.** Every command and path it names above belongs
to v1 and no longer resolves. It is kept as the record of what the obligation was while tldraw
shipped. If tldraw is ever added back, this file becomes binding again and its check must be
re-pointed at a `packages/web2` e2e harness.
