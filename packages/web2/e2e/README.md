# web2 e2e — tier 3

```
pnpm --filter @sequence/web2 build     # required first: this tier runs against dist/
pnpm --filter @sequence/web2 test:e2e     # shell-boot, board-grounded, board-lod, board-fit, visual-mode, shell-overlay, app-mounted
```

Exit codes: **0** every check passed (or skipped for want of a browser) · **1** the product is
wrong · **2** the harness could not run (no build, stale build, no playwright-core).

## Why this exists

Wave 2's gate found four locking criteria met at **vitest + jsdom** where the plan specifies E2E.
jsdom cannot measure a layout, cannot paint, has no font stack, does not substitute custom
properties, and its default window is 1024px — which already cost this package one test that
asserted the *runner's* window size and read as a statement about the product.

The entry condition for putting a check here: **jsdom answers it wrongly, or cannot answer it.**
If vitest can prove it, it belongs in vitest, and a copy here is a slower duplicate.

## The rules

1. **Address every element by `data-testid`.** Never a class name, never a DOM path, never an
   `nth-child`. `lib/anchors.mjs` is the inventory. IDENTITY is a testid — *what a thing is*.
   STATE is a named `data-*` attribute — *what state it is in*. v1 asked "is this card selected"
   with `.arch-rf-card-selected` and "what zoom is the board at" by parsing @xyflow's computed
   transform; the first dies with the stylesheet and the second was never this repo's contract.

2. **Run against `dist/`, never against the dev server.** They are different programs — the dev
   server never runs the production minifier or the CSS ordering that the bundle does, and item
   2.4's style block is an argument about cascade *order*. `lib/serve.mjs` refuses to serve a
   `dist/` older than `src/` rather than letting a forgotten build pass as a green run.

3. **Measure only after the document has stopped moving.** `settle()` finishes every running
   animation and waits two frames. A transition read mid-flight returns its *start* value, and
   this project has already reported one as final.

4. **Prove a resize took.** `resize()` asserts `window.innerWidth` actually moved before waiting
   on the product, so "the viewport never changed" cannot be reported as a layout bug — and a
   genuinely missing `resize` listener still fails, because nothing synthetic is dispatched to
   cover for it.

5. **A failing check does not stop the suite.** Four broken things should take one run to find,
   not four.

## Inherited from `packages/web/e2e`, and not inherited

45 v1 scripts were re-anchored onto 913 `data-testid` references in Wave 0 precisely so the
**behaviour** they assert survives v1's deletion. What carries across is the *shape*: boot a
server over a real build, drive a real browser, address by testid, skip loudly with no browser,
separate "the harness broke" from "the product is wrong".

**No line of those files is copied.** Their markup, selectors, layout expectations and class names
died with v1's stylesheet. Those 45 scripts were deleted with `packages/web` on 2026-08-20
(`20d1424`) — read them out of git history for *what they assert*, never for how. `packages/web2` may not
import from `packages/web` at all — `docs/PIVOT-V2.md`, enforced by `test/firewall.test.ts` — so
`lib/chromium.mjs` re-implements the browser lookup rather than importing v1's.

## Adding a spec

One file per spec, one npm script per file, appended to `test:e2e`.

```js
import { CHAT, SHELL } from './lib/anchors.mjs';
import { is, suite } from './lib/harness.mjs';

await suite('my-spec', async ({ page, base, check }) => {
  await page.goto(base, { waitUntil: 'load' });
  await check('what is true', async () => { /* … */ });
});
```

New anchors land **with** the surface that emits them, never ahead of it — an anchor for something
that does not exist yet is how a suite goes green against nothing.

## The specs

| file | what it proves |
| --- | --- |
| `shell-boot.mjs` | the frame arranges, the composer types, the fonts are local, nothing goes off-origin |
| `board-grounded.mjs` | **the board draws real nodes.** Scans this repository with the real analyzer, serves the result on `/archgraph.json`, boots the bundle and counts `[data-testid="board-node"]` — then checks every `data-node-id` against the ids the scan actually produced |
| `board-lod.mjs` | **the level-of-detail ladder, at the zoom it is argued about.** Presses zoom-out to the clamp floor and measures what the six silhouettes actually paint there — the four corner radii, the border treatment and the clip-path — against `graphite/pages/05-the-canvas.html` §05.8's last ladder row |
| `board-fit.mjs` | **Fit lands where a card still has a title.** Presses Fit over a real scan and reads the zoom back off the live cascade, against `--t-10 / --t-12` — §05.8's third ladder row, which is the lowest zoom at which a card still carries its name. Sweeps 290 frame sizes so the floor is a property of the ladder and not of one window |
| `shell-overlay.mjs` | **"Open a repository" opens a repository.** Stands up an origin whose `/api/status` answers `{attached:false}`, so the boot ladder lands on the one outcome that offers the attach action, clicks it, and asserts an attach dialog with a painted box inside the viewport — inside the shell's ONE overlay host, dismissible with Escape, and reachable again from Cmd-K |

| `app-mounted.mjs` | **the rail and review are in the shipped bundle, and reachable.** Serves a real scan, the engine's real function index and a real `git diff` of a throwaway repo; asserts the rail pane holds the rail and no not-yet panel, that every card rung carries an id the scan produced, that the function count printed on a file row equals the engine's own count for that file, that opening a file reveals its functions, and that Ctrl-K → "Review the working tree" opens the real review pane inside the ONE overlay host with git's own added line on screen |

`board-grounded.mjs` exists because the Wave 3 gate found that count at **0** while every board
unit test was green. Two wires were missing in `app/App.tsx` — no boot surface was mounted, so
nothing ever asked the origin for a graph, and `createStore()` was called with no projector, so a
graph that did arrive could not become a document. A jsdom test could not have caught either: item
3.5's acceptance test passed in jsdom against a synthetic document handed straight to the
component while the thing it described was unreachable in the product.

`board-lod.mjs` exists for the same reason one rung further down. `lod.ts` implemented a ladder
neither Graphite sheet states, and `lod.test.ts` asserted the invented numbers, so it was green in
both directions — while two presses of the zoom-out button turned all eleven nodes into one
identical `--r-full` pill. The greyscale invariant is explicitly "from the radii that actually
paint", and jsdom does not scale a radius by `min(side / sum of radii on that side)`, resolve a
`clip-path`, or lay out a scaled viewport. Proven red against the old bundle: `4 FAILED, 3 passed`,
with `distinct painted shapes at 25% for 2 kinds: expected 2, got 1`.

`shell-overlay.mjs` exists because `Board.test.tsx:315` asserted `store.getState().shell.overlay`
equalled `{kind:'attach'}` — that a DISPATCH LANDED — and stayed green for a whole wave while the
button it describes opened nothing. Two independent things stood in the way and either alone was
enough: `app/App.tsx` passed the shell no `renderOverlay`, and `Shell.tsx` kept a private copy of
the shell state, so the slice the dispatch changed was read by no renderer. Proven red against the
old bundle: `3 FAILED, 3 passed`, with `attach after the click: expected >= 1, got 0`. Re-proved
load-bearing afterwards by dropping `renderOverlay` again — `4 FAILED, 2 passed`.

`app-mounted.mjs` exists because Waves 4 and 5 are the same trap one turn later. Two lanes shipped
a rail and a review surface with 81 and 111 green tests between them, and neither lane was allowed
to edit `app/App.tsx` — the one file that decides whether a user can reach either. A test that
renders `<IndexRail>` answers "does this component work"; only this file answers "can a person who
opens the app see it", which is the question Wave 2 got wrong about an entire shell. Proven red
against the bundle that still carried the placeholders: `10 FAILED, 3 passed`, with
`notyet-index panels on screen: expected 0, got 1` and `card rungs drawn: expected 10, got 0`.

It is also the only tier that could have found the rail's zeros. Mounted against a store whose
function index is null — the state the store still produces — `buildRailRows` derives every count
from the index it was not given and the rail prints `0` beside every file and every card, on a
repository where the engine names 2,756 functions. Every one of the rail's own tests is handed a
real index, so all 81 were green over it. What found it was building the bundle and looking at the
screenshot, which is the second half of this tier and is not optional.

## Putting something in front of `dist/`

`suite(name, run, { routes })` — a route table the server answers **before** the SPA fallback sees
the path. A value is sent as JSON; `null` is a hard 404. That is the seam for anything the app
fetches: `board-grounded.mjs` uses it to be a static graph host, which is `runBoot`'s third rung.

## Next

- **Item 3.5's acceptance gate**: click a scanned node, assert a context chip carrying that node's
  id appears in the composer. Now reachable — the board draws nodes to click.
- **"attach a real repo, assert S1 within 6 s."** Needs the analyzer's repo server in front of
  `dist/` instead of the static server here — `serveDist()` is still the seam, and the route table
  above is the first half of it.
- **Tier 4** (screenshot vs sheet) is a separate pass and is not this directory's job.
