# PERF 0.1.9: before and after

Each section is one builder's work. Every number is the median (and p90 where the harness reports it) of 5
runs in headless Chromium, 1440x900, against `dist/` of the worktree's own build, served by the real app
server on a scratch copy of this repo with 203 seeded chats. Before/after were run on the same machine, but
other agents were running builds and tests on it at the same time, so read differences under ~10 % as noise.

## Files and editor

Harness: `content.mjs` (open-all-groups, large-file open) and `scroll.mjs` (wheel scroll, frame timing) of the
profiling pass, pointed at this worktree on port 4188. "Freeze" is the longest task the page reports in the
1.5 s after the click (`longMs`).

### Group by service, open all 11 groups (1,225 rows)

| step | freeze, median / p90 (ms) | DOM rows | scroll down fps / p95 frame ms | scroll up fps / p95 frame ms |
|---|---|---|---|---|
| before (`5e4094472`) | 6,955 / 7,043 | 1,225 | 24.8 / 74.0 | 23.9 / 74.4 |
| a. elision priced once (cuts remembered by content, per-letter pricing for the search, one shared ResizeObserver reporting width changes only, cached font string) | 1,858 / 1,890 | 1,225 | 25.9 / 73.1 | 24.7 / 73.0 |
| a+b. the tree mounts only the rows in view | 58 / 65 | 26 | 52.8 / 18.6 | 54.8 / 18.6 |

Scroll long tasks over the 100 wheel steps: 7,653 ms before, 7,266 ms after (a), 279 ms after (a+b, all of it the
first screenful of a new group's cuts on the first pass down; the way back up has none). The ungrouped tree (106
rows) is unchanged at 55 fps (the headless cap).

What did not help alone: remembering the cuts by content and caching the canvas widths per string (first attempt)
moved the open from 6,955 to 6,615 ms. The profile showed the cost was `elideAll` being re-decided for each distinct
room (a row with a "need" has a different width, so about 8 rooms per group of 1,000 to 2,000 names), each decision
pricing about 12,000 throwaway candidates with a canvas `measureText` (about 14 us each). Pricing the search with a
sum of letter widths and keeping the exact canvas measure for the row's own fit is what took it to 1,858 ms, and
windowing took the rest. A per-string width cache is a net loss for those throwaway strings (Map hashing cost
more than it saved) and is kept for the row's own exact measures only.

Uniqueness: the owner-seat dups script, rewritten to scroll the windowed tree top to bottom (it can only see mounted
rows), with every "+N more" cap lifted: 3,185 rows, 0 labels shared by siblings, at 1440 and at 1100 wide.
`serviceGroupsRealScale.test.tsx` and `groupedNames.test.ts` pass unchanged.

### Large file (repoServer.ts, 405 KB, 8.8k lines)

| step | open long task, median / p90 (ms) | gutter + listing elements |
|---|---|---|
| before | 632 / 645 | 17.7k |
| c. gutter and listing drawn for the lines in view only (+ the field shaped with `text-rendering: optimizeSpeed`) | 150 / 180 | about 230 |

What is left is the native `<textarea>` laying out 405 KB (with the field hidden the open has no long task at all;
`optimizeSpeed` on the field took 232 to 150 ms, `contain: strict` added nothing). The field stays one element
holding the whole file so selection, copy, Find and the caret are native. The harness's own `readyMs` is not
comparable before and after (it fires on the DOM commit plus two frames, which in the old build came before the 632 ms
of layout and paint); the long task is the number to read. Gutter numbers and listing lines stay on the same pitch
at every scroll position (checked at scrollTop 0, 30k, 90k, 150k: the caret line after a click equals the gutter
number under the pointer).

### Behaviour kept

- Windowing applies to lists over 120 entries once the tree has a measured height; shorter lists, and a tree with
  no layout (jsdom, a hidden pane), are drawn whole exactly as before. The editor does the same over 400 lines.
- Keyboard (Up/Down/Home/End), selection, the reveal-and-centre of a board card's file or service head, ARIA tree
  roles and `aria-level` are unchanged. An off-screen row is scrolled TO by index, since it is not in the DOM to be
  asked.
- `flow-plays.mjs` assumed every function row of a file is in the DOM. It now goes back to the top of the tree before
  collapsing the file and plays the first screenful of a file's functions (the first of a repeated id).

## Server

Branch `wip/019-perfserver`, base `5e4094472`. Repo under test: a copy of the 338-branch perf clone
(`scratchpad/perf-server/repo`, 5,142 commits, 340 remote refs). Windows 11, git 2.51.1. The machine
was busy with other agents during every run (a bare `git rev-parse HEAD` took 145 ms to 1.4 s), so read
the ratios, not the absolute milliseconds. The old numbers are the same repo, same machine, same hour.

### Fix 1: `GET /api/git/branches` (gitBranchRoutes.ts)

Cause: one awaited `git rev-list --left-right --count` per upstream-less branch, in a sequential loop.
Now: one `git for-each-ref` carrying `%(ahead-behind:<base>)` (git >= 2.41), result cached on a stat-only
fingerprint of HEAD, packed-refs, config and every ref file, concurrent callers share one computation, the
git children are killed when every caller hangs up, and the listing is warmed when a repo attaches.
Without the atom (older git) it falls back to at most 8 parallel `rev-list` children, newest 120 branches,
8 s budget. The response shape is unchanged.

| Measure (338 local branches) | Before | After |
|---|---|---|
| Listing, cold, direct call | 45,346 ms | 715 ms |
| Listing, cached (refs unchanged) | 45,346 ms (no cache) | 11-16 ms |
| Listing, fallback path (no atom), cold | 45,346 ms | 3,354 ms (120 branches counted) |
| 4 cold callers at once | 4 x 45 s of git work | 895 ms (one computation) |
| Through the running server, 2 simultaneous boot requests | 102,418 ms and 102,731 ms | 3,557 ms (while the scan runs) |
| Same server, a third request 2.5 s later | 243,052 ms | 20 ms |

`git status` on this clone costs 0.9-2.4 s on its own. The HTTP route therefore serves an expired
`dirty` count as it stands when the last status took over 150 ms, and refreshes it in the background;
a direct `gitBranches(root)` call always counts fresh. Static assets during that boot window:
135-156 ms before and after (the harness fires them once, together, and the machine noise is the same
size), so no asset starvation was measurable in either run; the old server's 243 s third request is the
pile-up the fix removes.

### Fix 2: `GET /archgraph.json` body cache (repoServer.ts)

The unscoped body is serialized once and reused while the graph object, its `nodeDetail` object and the
existing ETag are unchanged (a rescan, a stale marker or a scoped read never uses it).

| Measure (4.45 MB body) | Before | After |
|---|---|---|
| fetch + read, median of 40 | 221-292 ms | 40-131 ms |
| fetch + read, fastest of 40 | 86-108 ms | 22-24 ms |
| client `JSON.parse` | 48-130 ms | 37-133 ms (unchanged: same bytes) |

Dropped: stripping import-edge evidence snippets. They are 1.18 MB of the 4.45 MB, but
`review/impactModel.ts` shows an edge's `snippet` for changed lines (imports included), so it
needs an evidence endpoint plus web2 reader changes
for a client-parse saving of roughly 10 ms. Not worth the ripple.

### Tests

`packages/analyzer/src/test/git-branches-perf.test.ts`, `http-archgraph-body-cache.test.ts`.

## Board and startup

Branch `wip/019-perfboard`, base `5e4094472`. Harness: the profiling pass's (`startup.mjs`, `screens.mjs`, `scroll.mjs`,
`prof.mjs`, Playwright Chromium 1440x900, DPR 1) pointed at this worktree's `packages/web2/dist` on port 4187, against
the seeded state (203 chats, a 500-turn chat active, the codeforge graph of 2,773 nodes). Median of N runs; "base" is
`5e4094472`'s bundle, "final" is this branch. Base and final were run alternately on the same machine, which was busy
with other work: absolute numbers are higher than the profiling pass's (base cold board 1,000-1,040 ms here against 874
there), so read the **ratios**, and treat any single cell under about 40 ms as noise.

### Result

| Metric (seeded) | base | final | change |
|---|---|---|---|
| Board drawn, cold (8 runs, 2 passes) | 1,044 / 997 ms | 808 / 839 ms | -19% |
| Board drawn, warm | 702 / 653 ms | 468 / 465 ms | -30% |
| Long task ms before the board, cold | 550 / 542 | 342 / 344 | -37% |
| Longest boot task, cold | 204 ms | 104 ms (p90 131-135) | -49% |
| Script ms, cold | 776 / 757 | 644 / 653 | -15% |
| Requests / decoded KB at boot | 71 / 7,487 | 69 / 7,152 | one 337 KB transcript fetch gone |
| Architecture reopen, first (5 runs) | 227 ms (173-208 ms long task) | 64 ms | -72% |
| Architecture reopen, second | 142-247 ms | 80-95 ms | -60% |
| Board zoom, 37 nodes + 203-row rail, 25 steps | 34.6 fps, p95 73 ms, 924 ms long | 51.2 fps, p95 36 ms, 0 ms long | +48% |
| Board drag-pan, same | 40.4 fps | 54.7 fps | +35% |
| Sessions rail wheel (203 rows) | 51 fps, 154 ms long | 54.8 fps, 0 long | |
| Board zoom, 4x CPU throttle, expanded | 6.3 fps | 13.9 fps | 2.2x |
| Commands palette | 20 ms, no long task | 20 ms | not reproduced (see below) |

Targets from the brief: cold board < 600 ms **not met** (808-839 ms here; scaling the profiling pass's 874 ms baseline by
the same ratio gives about 700 ms); Architecture reopen < 80 ms **met on the first reopen, borderline on the second**;
zoom >= 50 fps **met** (51.2 in, 49.9 out); no boot long task > 100 ms **missed by 4 ms at the median** (89-90 ms in the
first stage runs, 104 ms in the final alternating runs; p90 131 ms).

### Per fix (cumulative stages, each built and run on the seeded state, 5 runs)

| Fix | What it measured | Kept |
|---|---|---|
| GAP 2: `openableNodeIds` O(n) (`canvas/openableIds.ts`), full-tier hint stored per graph and worked out when idle | Architecture reopen 209 -> 63 ms, its 189 ms long task -> 0. The O(n) pass is 204 -> under 1 ms on a 2,773-node graph. Cold board 1,019 -> 786 ms, warm 601 -> 441 ms | yes |
| GAP 8: card font faces read once per theme (`textFit.ts`), board title fit split from the zoom step (`Board.tsx`) | 1x: no change in fps (the page is layer-bound, see below). 4x CPU, zoom in on the expanded board 11.1 -> 13.9 fps, 12 cards 22.7 -> 25.7. `getPropertyValue` was 68 ms of 1,162 ms busy per 25 steps in the profile; it is gone | yes, CPU-bound machines only |
| GAP 5 web: transcript read once (`connect.tsx` hydrates from `GET /api/sessions/<id>`, shared with the doc channel; `V3Chat` no longer re-reads the thread for turns it just restored) | `/api/chat-memory` 337 KB + `/api/sessions/<id>` 337 KB -> one 337 KB read. Decoded KB 7,488 -> 7,152, requests 71 -> 69. Cold board 854 -> 719 ms (within run noise) | yes |
| `formatContextWindowTokens` skips `toLocaleString` under 1000 | First `toLocaleString('en-US')` on a fresh page costs 14.4 ms (8 pages, 13.2-15.3). The board time did not move beyond noise | yes (zero risk, test-locked) |
| GAP 6: AsciiStage `drawMosaic` drawn in 8 ms slices (`drawMosaicSliced`) | Longest boot task 169-171 -> 89-90 ms, long-task ms before the board 359 -> 235. Board time unchanged | yes |
| Board on its own compositor layer: `.board-scope .react-flow { will-change: opacity }` | Trace of 25 zoom steps with the 203-row rail open: `Layerize` 885 ms -> 303 ms of 1,718 ms main-thread. Zoom 36.7 -> 51.2 fps, drag-pan 41 -> 55 | yes (the main fix for scrolling) |

### What the profile said, and what it did not

- Zoom and pan on the expanded board were not JS-bound at 1x. The profile's JS fell after GAP 8 and fps did not move,
  because Chromium re-layerizes every paint chunk on the page each frame: with the 203-row sessions rail open that was
  885 ms of `Layerize` per 25 steps. Hiding `[data-testid="s2-groups"]` took it to 112 ms; `content-visibility` on the rows,
  `contain`, and `will-change` on the rail did not. The board is promoted instead (`will-change: opacity`, not
  `transform`, which would make it the containing block of its `position: fixed` menus; `.react-flow` is already a
  stacking context, so nothing re-orders). The rail itself is still the cost centre for every other surface's frames; a
  rail owner can find what makes 203 rows that many chunks.
- The mosaic's 160-213 ms is CPU the page needs either way. Deferring its first draw to idle (tried, 6 runs against the
  sliced build) changed the cold board by +1 to +25 ms, so it was dropped; slicing only removes the long task.
- Not kept: deferring the first mosaic to idle; `estimatedItemSize` 180 on the chat list (cold time to the latest turn
  477 vs 467-489 ms, no change); a cheaper `liftTo`/`importEdges` (warm 4.1 -> 2.1 ms, first call 21 -> 23 ms: no cold gain).
- The 148 ms Commands palette long task did not reproduce on this build (base 20 ms, no long task, five runs, cold and
  warm); the profile run's 98 ms was native `focus` and style work, no app function over 3 ms. Left alone.
- Remaining cold cost is the 7.1 MB decoded bundle (parse and execute, 644 ms of script), `markCut` forced layout in
  `ModelMenu` (58 ms), `@legendapp/list` `measureContainersInLayoutEffect` (40-44 ms) and the board's first React render
  (about 70 ms). The first three are outside this lane.
- 4x CPU startup numbers were too noisy to publish (base 4,211 and 7,681 ms across two passes).

### Tests

- `canvas/openableIds.test.ts`: the O(n) result equals the old quadratic form on a 2,773-node graph (with an orphan and a
  dangling parent), and runs under 25 ms.
- `canvas/fontCache.test.ts`: the faces come from the live tokens, the cascade is asked once, and the cache is dropped on a
  theme change, a typeface change, and a read made before the ramp loaded.
- `state/transcriptFetchedOnce.test.tsx`: no `/api/chat-memory` GET, one `/api/sessions/<id>` GET shared with a second
  reader, and the fallback to `/api/chat-memory` when the thread has no chat.
- `chat/formatContextTokens.test.ts`, `canvas/boardLayer.test.ts` (the layer rule, and that it never becomes `transform`).

Reproduce: `docs/bench/REPRODUCE.md`; the harness used here is the profiling pass's, with `scroll.mjs` and `tracez.mjs`
(Chrome trace of the zoom steps) added.

## Round 2: bundle, ModelMenu, chat list, board first render

Branch `wip/019-perf2`, base `7cc8120ee` (round 1 merged). Harness: the profiling pass's scripts plus an interleaved A/B
runner (`ab.sh`: one pass runs each variant in turn on the same machine state, the server fixed, only the `dist` it serves
swapped with `--web`, so a difference is the bundle and nothing else), a Chrome trace of a cold load (`tracecold.mjs`,
`tracelayout.mjs`), a layout-read timer (`forced.mjs`), and a per-file byte attribution of the entry chunk from its
sourcemap (`attr.mjs`). Seeded state as in round 1 (203 chats, 500-turn chat active, 2,773-node graph), headless Chromium
1440x900. The machine was quieter than during round 1: the round-1 head measures **474 ms cold board** here against the
808-839 ms recorded then, so the "< 600 ms" target is met by the round-1 build itself on this state of the machine; round 2
did not move that number.

### Result of round 2 alone (7cc8120ee against this branch, interleaved, same server)

| Metric (seeded, cold, 1x CPU, 20 runs each) | round-1 head | round 2 | |
|---|---|---|---|
| Board drawn, median / p90 | 474 / 712 ms | 474 / 695 ms | no change |
| Latest turn in the DOM | 316 ms | 309 ms | no change |
| Composer (React) | 183 ms | 186 ms | no change |
| Script ms | 396 | 381 | -4%, inside the noise |

| Same, 4x CPU throttle (secondary signal, 16 runs each) | round-1 head | round 2 | change |
|---|---|---|---|
| Board drawn, median / p90 | 2,401 / 2,915 ms | 2,304 / 2,524 ms | -4% |
| Latest turn | 1,412 ms | 1,332 ms | -6% |
| Composer (React) | 873 ms | 816 ms | -7% |
| Session row | 1,006 ms | 939 ms | -7% |

### What was tried, in order, and what was kept

| Change | Measured (interleaved A/B, cold) | Kept |
|---|---|---|
| Move the nine surface stylesheets (Files, Settings, Activity, Review, Whiteboard, AI canvas, Search, Help, Rewind: 142 KB, index.css 631 -> 489 KB) out of the eager sheet | board 606 -> 603 ms, style ms 98 -> 105, 15 runs. A cold load recalculates style on 1,650 nodes, so the rule count is not what the style time is spent on | no |
| Lazy-split JS that the first screen does not use | not built. The entry chunk (1,133 KB) is 808 KB of this repo's code, almost all of it the board, the chat, the shell and the store; what is left to move (agent folds, whiteboard model, ask-in-place, onboarding, settings client, about 100-150 KB) is code that is never called at boot, and the trace of a cold load shows V8 spends 4.4 ms pre-parsing the whole page against 77 ms compiling the functions that do run (`ParseFunction` 39, `CompileIgnition` 24, `CompileCode` 14). Moving never-called code cannot touch the 77 ms | no |
| Start `GET /archgraph.json` from `index.html` while the chunk loads | board 560 -> 451 ms, **latest turn 354 -> 501 ms**: the 4.3 MB hydrate then runs ahead of the chat and takes its place (gated to wait for the chat: board 563, nothing gained). Extended to status, session list and the transcript it names: board 461 -> 442, latest turn 310 -> 341, +1 request and +338 KB (the chain waits on a busy main thread, so the transcript was asked for after the app had already asked) | no |
| `drawDistance` 120 on the chat list (the brief's estimated-size / initial-scroll options; `estimatedItemSize` 180 was already measured in round 1) | 4x CPU, 16 runs: board 2,339 -> 2,353 ms, latest turn 1,338 -> 1,323 ms | no |
| Start the open chat's transcript at bundle start from a stored id | latest turn 306 -> 303 ms, board 469 -> 523 ms, composer 184 -> 206 ms (same request count once the second reader joined the first) | no |
| The surface strip is sorted with one `Intl.Collator` (`localeCompare` with options built a collator per comparison: 12 ms in the boot profile) | with the next two: see the 4x rows above | yes |
| `starterActions` (the top-service pass over every edge) only for a thread that shows the starters | 6.8 ms in the boot profile | yes |
| First soft-edge mark of `ModelMenu` and `StatusBar` left to their ResizeObserver, which reports once before the first paint (the layout-effect call forced a layout in the middle of the first commit; `markCut` was 16 ms self in the profile) | the layout count is unchanged (38 -> 39): the observer's first report is a layout of its own. Kept for the 4x gain above, which is the three changes together | yes |

Commit: `1dae6af4`. Locking tests (each fails on the old source and passes on the new, with a positive control):
`chat/ChatStarters.test.tsx` (no edge read for a chat with turns; the empty thread does read), `shell2/surfaceTitleOrder.test.tsx`
(`localeCompare` is never called and the order equals the old form), `shell2/statusBarRing.test.tsx` and
`shell2/modelMenu.test.tsx` (no width read until the observer reports; without an observer the mount still marks).

### Where the cold board's time goes now (Chrome trace of a cold load up to the board, mean of 4 runs)

| Event (main thread, exclusive) | ms |
|---|---|
| `FunctionCall` + `v8.callFunction` (React render and app code) | 322 |
| `Layout` | 83 |
| `UpdateLayoutTree` | 64 |
| V8 parse + compile of executed functions (`ParseFunction` 39, `CompileIgnition` 24, `CompileCode` 14) | 77 |
| `Layerize`, `PrePaint`, `Paint` | 39 |
| `evaluateModule` | 14 |
| `ParseAuthorStyleSheet`, `ParseHTML`, pre-parse | 12 |

Layout reads that take 0.3 ms or more during boot (`forced.mjs`, 21 reads, 91 ms in all): `Shell2` status-bar measure 20.2, the
chat list's container measure 18.5 and 6.9 (`@legendapp/list`), `AsciiStage` 12.5, `stickToBottom` 10.1, `useAskInPlace` 8.0, `softEdge` 5.7.
Each is the first read after the DOM changed, so it pays for a layout the browser does at the next frame anyway; none of them is
a second layout of the same tree, which is why moving them (tried for `markCut`) does not shorten the boot. The two biggest
single events are the first style and layout of the 631 KB sheet for the static shell (13.8 + 28.1 ms, before any script) and a
24 ms style recalculation that the first `getComputedStyle` in `readShellTokens` (module load of `V3App`) forces when the
web fonts arrive. After the board is drawn, `AsciiStage`'s mosaic (about 100 ms of CPU in 8 ms slices) and the idle
`computeRisks` pass (30 ms, already deferred by round 1) are what keeps the main thread busy.

What is left is therefore JS that has to run (the board's first render is many small needed pieces; sampler ms, which run about twice the real time: `seqdFromGraph`
15, `enrichNodeDetailFromGraph` 7, `importEdges` 10, `routeEdges` 9, `NodeCard` 12, `indexAnatomy` 5; none repeats), the compile of
that JS, and two layouts of a 631 KB stylesheet. Nothing found is large enough to measure against run-to-run noise (about +-30 ms at 1x).

### Round-1 effects found while comparing against `3ba0d701d`

Measured with only the `dist` swapped (same server), 15 cold runs each:

| | `3ba0d701d` | round 1 `7cc8120ee` | this branch |
|---|---|---|---|
| Board drawn | 558 ms | 449 ms | 449 ms |
| Latest turn in the DOM | 276 ms | 304 ms | 315 ms |
| Longest boot task | 122 ms | 59 ms | 57 ms |

- **The latest turn appears about 10 % later (+28 to +39 ms)** with the web bundle alone, because the board now renders ahead of the chat commit. It is
  not recoverable by asking for the transcript earlier (tried above). End to end, with the server changes of round 1 (one transcript fetch instead of two), the
  latest turn is still earlier than the baseline (395 -> 266 ms in the startup harness), but the harness's own "nav start to latest turn in the DOM" step
  reads 281/291 -> 324/315 ms, so read this as "chat +10 %, board -20 %, everything else faster".
- The Commands palette reads 20 -> 29 ms on the second open. One frame in the headless browser is 18.6 ms, a reopen sits on either side of a frame
  boundary, and the round-1 head shows the same 29 ms, so it is round 1's and below the resolution of the harness; an inject test
  (`will-change` off, rail hidden) did not separate it from the noise (22.9, 19.5, 22.3 against 29, 22.9).
- `files: open repoServer.ts`'s `readyMs` reads 95 -> 197 ms and its long task 530 -> 120 ms. As round 1 wrote, `readyMs` fires on the DOM commit plus
  two frames, which in the old build came before 530 ms of layout; the long task is the number to read.
- `tools/ci/perf-ratchet.mjs` is red on the round-1 head already (`bootJsBytes` 2,605,263 against a ceiling of 2,562,588, `bootRequests` 42 against 31; this branch
  2,605,393, 42), and `src/classCoverage.test.ts` is red on it (31 classes unstyled against 30: `workflow-launch-bar` and others). Neither is caused by round 2 and
  neither ceiling was raised here.

### End to end, before vs after (3ba0d701d vs final)

Every metric of the original profiling pass (`run-all.sh`: startup seeded and empty, screens, content, scroll), same machine, back to back in the
order base, final, final, base (`base` = a build of `3ba0d701d` in a scratch worktree, `final` = this branch at `1dae6af4`), 5 runs per cell, median of the 5. Each cell
shows the two passes (a / b); "change" compares the mean of the final passes with the mean of the base passes. These runs use the full stack of each
commit (client and server), unlike the A/B above. Scroll and Content were re-run after the first pass because `content.mjs` and `scroll.mjs` wait for 400
Files rows in the DOM, which the windowed tree of round 1 no longer has; both now wait for the tree's scroll height (30,000 px), which both builds satisfy. Cells
under about 40 ms, and any change under about 10 %, are noise; the chat-scroll fps are capped by the headless 55 fps.
Raw outputs: the scratchpad `perf2/results/*-{base1,base2,final1,final2}.txt`.


#### Startup, seeded (203 chats, 500-turn chat active), cold (ms unless a unit is in the name)

| metric | cold median base (a / b) | cold median final (a / b) | change |
|---|---|---|---|
| fcp | 160 / 160 | 116 / 116 | -28% |
| lcp | 704 / 720 | 332 / 348 | -52% |
| composerStatic | 43.5 / 42.9 | 30.1 / 32.3 | -28% |
| composerReact | 256 / 260 | 169 / 169 | -35% |
| sessionRow | 287 / 299 | 188 / 191 | -35% |
| board | 736 / 825 | 422 / 447 | -44% |
| latestTurn | 395 / 400 | 266 / 281 | -31% |
| longTaskMsToBoard | 373 / 459 | 53.0 / 107 | -81% |
| longestTask | 165 / 183 | 53.0 / 55.0 | -69% |
| tbtApprox | 237 / 310 | 3.0 / 7.0 | -98% |
| jsHeapMB | 21.7 / 21.7 | 29.9 / 30.1 | +38% |
| scriptMs | 580 / 625 | 351 / 372 | -40% |
| layoutMs | 124 / 137 | 84.0 / 93.0 | -32% |
| styleMs | 106 / 117 | 70.0 / 71.0 | -37% |
| requests | 71.0 / 71.0 | 69.0 / 69.0 | -3% |
| transferKB | 7506 / 7506 | 7274 / 7274 | -3% |
| decodedKB | 7485 / 7485 | 7254 / 7254 | -3% |

#### Startup, seeded, warm (reload)

| metric | warm median base (a / b) | warm median final (a / b) | change |
|---|---|---|---|
| fcp | 56.0 / 56.0 | 72.0 / 56.0 | +14% |
| lcp | 540 / 544 | 272 / 292 | -48% |
| composerStatic | 26.2 / 26.1 | 16.7 / 17.7 | -34% |
| composerReact | 71.9 / 72.4 | 44.6 / 50.5 | -34% |
| sessionRow | 120 / 122 | 73.2 / 84.4 | -35% |
| board | 543 / 533 | 252 / 264 | -52% |
| latestTurn | 167 / 169 | 138 / 138 | -18% |
| longTaskMsToBoard | 184 / 177 | 0.0 / 0.0 | -100% |
| longestTask | 184 / 186 | 0.0 / 0.0 | -100% |
| tbtApprox | 213 / 215 | 0.0 / 0.0 | -100% |
| jsHeapMB | 45.9 / 46.1 | 28.2 / 28.3 | -39% |
| scriptMs | 1136 / 1136 | 594 / 643 | -46% |
| layoutMs | 159 / 166 | 102 / 112 | -34% |
| styleMs | 200 / 202 | 121 / 128 | -38% |
| requests | 70.0 / 70.0 | 68.0 / 68.0 | -3% |
| transferKB | 903 / 903 | 667 / 667 | -26% |
| decodedKB | 7452 / 7452 | 7221 / 7221 | -3% |

#### Startup, empty state, cold

| metric | cold median base (a / b) | cold median final (a / b) | change |
|---|---|---|---|
| fcp | 160 / 152 | 132 / 116 | -21% |
| lcp | 320 / 304 | 220 / 220 | -29% |
| composerReact | 251 / 240 | 180 / 182 | -26% |
| board | 601 / 580 | 351 / 340 | -41% |
| longestTask | 163 / 143 | 61.0 / 58.0 | -61% |
| requests | 43.0 / 43.0 | 43.0 / 43.0 | 0% |
| decodedKB | 6377 / 6377 | 6482 / 6482 | +2% |

#### Screens: open a surface (ms, median), first open

| metric | first open base (a / b) | first open final (a / b) | change |
|---|---|---|---|
| files | 76.4 / 76.9 | 76.5 / 76.4 | -0% |
| agents | 40.1 / 39.6 | 39.4 / 39.5 | -1% |
| spaces | 39.3 / 39.1 | 38.7 / 39.5 | -0% |
| terminal | 39.7 / 39.1 | 39.2 / 39.5 | -0% |
| architecture(reopen) | 205 / 193 | 48.2 / 52.2 | -75% |
| settings | 43.7 / 42.1 | 44.9 / 40.9 | -0% |
| commands | 19.9 / 19.7 | 29.5 / 28.8 | +47% |

#### Screens: second open

| metric | second open base (a / b) | second open final (a / b) | change |
|---|---|---|---|
| files | 52.5 / 51.5 | 50.5 / 48.7 | -5% |
| agents | 36.7 / 34.7 | 34.5 / 29.0 | -11% |
| spaces | 39.9 / 38.7 | 35.5 / 36.1 | -9% |
| terminal | 35.5 / 34.5 | 33.0 / 35.2 | -3% |
| architecture(reopen) | 114 / 105 | 67.4 / 59.8 | -42% |
| settings | 26.5 / 24.4 | 24.1 / 24.9 | -4% |
| commands | 19.1 / 19.1 | 18.8 / 19.1 | -1% |

#### Content: ready (ms, median)

| metric | ready base (a / b) | ready final (a / b) | change |
|---|---|---|---|
| longchat-boot (nav start -> latest turn in DOM) | 281 / 291 | 324 / 315 | +12% |
| files: open tab -> root rows | 170 / 165 | 168 / 168 | +0% |
| files: expand packages (dir, 12 children) | 18.9 / 18.7 | 18.5 / 18.7 | -1% |
| files: expand packages/analyzer | 19.0 / 18.9 | 18.8 / 18.9 | -1% |
| files: expand packages/analyzer/src (~300 files) | 36.9 / 31.2 | 35.3 / 39.1 | +9% |
| files: expand tools (355 files, big folder) | 29.1 / 35.1 | 32.1 / 32.5 | +1% |
| files: open repoServer.ts (405 KB, 8.8k lines) click -> code painted | 89.5 / 97.9 | 190 / 204 | +111% |
| files: group by service -> 11 group heads | 56.5 / 56.5 | 49.8 / 47.2 | -14% |
| files: group by service, open ALL groups | 6145 / 5859 | 49.7 / 44.9 | -99% |
| board: expand analyzer in place (click -> more nodes) | 57.1 / 61.4 | 55.4 / 60.1 | -3% |
| sessions: Show all 203 (click -> 203 rows) | 102 / 107 | 82.6 / 106 | -10% |
| sessions: switch to a short chat (click -> its transcript) | 87.9 / 89.7 | 65.2 / 74.9 | -21% |
| sessions: switch to long chat (click -> latest turn in view) | 184 / 171 | 150 / 173 | -9% |
| chat: jump to turn ~250 (scrollTop 20000 -> older text painted) | 63.6 / 58.4 | 29.2 / 43.9 | -40% |
| chat: jump to oldest turn (scrollTop 0 -> turn 1 painted) | 47.5 / 47.4 | 28.2 / 29.3 | -39% |
| chat: jump back to latest (scrollTop = end -> latest painted) | 37.0 / 40.7 | 21.0 / 21.1 | -46% |

#### Content: longest long-task sum in the window (ms)

| metric | longMs base (a / b) | longMs final (a / b) | change |
|---|---|---|---|
| longchat-boot (nav start -> latest turn in DOM) | 60.0 / 60.0 | 55.0 / 54.0 | -9% |
| files: open tab -> root rows | 118 / 197 | 116 / 106 | -30% |
| files: expand packages (dir, 12 children) | 0.0 / 0.0 | 0.0 / 0.0 |  |
| files: expand packages/analyzer | 0.0 / 0.0 | 0.0 / 0.0 |  |
| files: expand packages/analyzer/src (~300 files) | 0.0 / 0.0 | 0.0 / 0.0 |  |
| files: expand tools (355 files, big folder) | 0.0 / 0.0 | 0.0 / 0.0 |  |
| files: open repoServer.ts (405 KB, 8.8k lines) click -> code painted | 555 / 503 | 115 / 129 | -77% |
| files: group by service -> 11 group heads | 0.0 / 0.0 | 0.0 / 0.0 |  |
| files: group by service, open ALL groups | 5992 / 5702 | 0.0 / 0.0 | -100% |
| board: expand analyzer in place (click -> more nodes) | 0.0 / 0.0 | 0.0 / 0.0 |  |
| sessions: Show all 203 (click -> 203 rows) | 89.0 / 92.0 | 67.0 / 82.0 | -18% |
| sessions: switch to a short chat (click -> its transcript) | 0.0 / 0.0 | 0.0 / 0.0 |  |
| sessions: switch to long chat (click -> latest turn in view) | 55.0 / 0.0 | 0.0 / 54.0 | -2% |
| chat: jump to turn ~250 (scrollTop 20000 -> older text painted) | 59.0 / 54.0 | 0.0 / 0.0 | -100% |
| chat: jump to oldest turn (scrollTop 0 -> turn 1 painted) | 0.0 / 0.0 | 0.0 / 0.0 |  |
| chat: jump back to latest (scrollTop = end -> latest painted) | 0.0 / 0.0 | 0.0 / 0.0 |  |

#### Scroll: frames per second (median)

| metric | fps base (a / b) | fps final (a / b) | change |
|---|---|---|---|
| chat: wheel up 80 x 120px (~9.6k px, 23% of 500 turns) | 53.4 / 53.4 | 55.2 / 55.3 | +3% |
| chat: wheel down 80 x 120px | 55.1 / 55.2 | 55.1 / 55.4 | +0% |
| chat: fling up 200 x 400px (80k px, through the whole chat to the top) | 55.2 / 55.3 | 55.3 / 55.3 | +0% |
| chat: fling down 120 x 400px (to the end) | 55.2 / 55.3 | 55.2 / 55.4 | +0% |
| files tree (ungrouped, ~106 rows): wheel down 60 x 120px | 55.1 / 55.3 | 55.2 / 55.3 | +0% |
| files tree: wheel up 60 x 120px | 55.1 / 55.2 | 55.2 / 55.3 | +0% |
| files tree (grouped, all open, ~1225 rows): wheel down 100 x 200px | 24.8 / 25.6 | 53.0 / 53.2 | +111% |
| files tree (grouped, all open): wheel up 100 x 200px | 24.9 / 25.3 | 55.2 / 55.3 | +120% |
| sessions rail (203 rows): wheel down 60 x 150px | 55.1 / 55.1 | 55.1 / 55.1 | 0% |
| sessions rail: wheel up 60 x 150px | 55.0 / 55.3 | 55.0 / 55.2 | -0% |
| board (12 service cards): drag-pan 80 moves | 55.2 / 55.4 | 55.2 / 55.3 | -0% |
| board: ctrl+wheel zoom in 25 steps | 55.2 / 55.1 | 55.2 / 55.0 | -0% |
| board: ctrl+wheel zoom out 25 steps | 55.1 / 55.2 | 55.0 / 55.1 | -0% |
| board (analyzer+web2 expanded): drag-pan 80 moves | 46.6 / 47.1 | 55.3 / 55.3 | +18% |
| board (expanded): ctrl+wheel zoom in 25 steps | 39.5 / 39.3 | 54.6 / 54.6 | +39% |
| board (expanded): ctrl+wheel zoom out 25 steps | 43.6 / 42.9 | 54.5 / 54.4 | +26% |

#### Scroll: p95 frame ms

| metric | p95 base (a / b) | p95 final (a / b) | change |
|---|---|---|---|
| chat: wheel up 80 x 120px (~9.6k px, 23% of 500 turns) | 18.6 / 18.6 | 18.6 / 18.6 | 0% |
| chat: wheel down 80 x 120px | 18.6 / 18.6 | 18.6 / 18.5 | -0% |
| chat: fling up 200 x 400px (80k px, through the whole chat to the top) | 18.6 / 18.5 | 18.6 / 18.5 | 0% |
| chat: fling down 120 x 400px (to the end) | 18.6 / 18.5 | 18.6 / 18.5 | 0% |
| files tree (ungrouped, ~106 rows): wheel down 60 x 120px | 18.6 / 18.6 | 18.6 / 18.5 | -0% |
| files tree: wheel up 60 x 120px | 18.6 / 18.6 | 18.6 / 18.6 | 0% |
| files tree (grouped, all open, ~1225 rows): wheel down 100 x 200px | 74.1 / 74.7 | 18.6 / 18.6 | -75% |
| files tree (grouped, all open): wheel up 100 x 200px | 89.1 / 89.7 | 18.6 / 18.5 | -79% |
| sessions rail (203 rows): wheel down 60 x 150px | 18.6 / 18.6 | 18.6 / 18.6 | 0% |
| sessions rail: wheel up 60 x 150px | 18.6 / 18.5 | 18.6 / 18.6 | +0% |
| board (12 service cards): drag-pan 80 moves | 18.6 / 18.5 | 18.6 / 18.6 | +0% |
| board: ctrl+wheel zoom in 25 steps | 18.6 / 18.6 | 18.6 / 18.6 | 0% |
| board: ctrl+wheel zoom out 25 steps | 18.6 / 18.6 | 18.6 / 18.6 | 0% |
| board (analyzer+web2 expanded): drag-pan 80 moves | 36.5 / 36.2 | 18.6 / 18.6 | -49% |
| board (expanded): ctrl+wheel zoom in 25 steps | 54.6 / 54.5 | 18.6 / 18.6 | -66% |
| board (expanded): ctrl+wheel zoom out 25 steps | 54.1 / 54.0 | 18.6 / 18.6 | -66% |

Reading the table:

- Startup, cold: board drawn 736 / 825 -> 422 / 447 ms (-44 %), LCP -52 %, longest boot task 165 / 183 -> 53 / 55 ms, total blocking time 237 / 310 -> 3 / 7 ms,
  script -40 %, layout -32 %, style -37 %. Warm: board 543 / 533 -> 252 / 264 ms (-52 %), no long task. The empty state boots 41 % sooner.
- Screens: the Architecture reopen 205 / 193 -> 48 / 52 ms (second 114 / 105 -> 67 / 60). The other surfaces are unchanged (they were already one or two
  frames). The Commands palette is the one cell that moved up (see "Round-1 effects" above).
- Content: Files "open all groups" 6.1 s -> 45-50 ms and its 6 s freeze -> 0; opening the 405 KB file 550 -> 115-130 ms of long task; switching and jumping in the
  500-turn chat 9-46 % faster. The `longchat-boot` step (nav start to the latest turn in the DOM) is the one content cell that is slower: +12 %.
- Scroll: the grouped Files tree 25 -> 53-55 fps and p95 frame 74-90 -> 18.6 ms; the expanded board pan / zoom 39-47 -> 54-55 fps. Chat scroll is unchanged at
  53.4 -> 55.2 fps up and 55 fps elsewhere (**no regression**: 55 fps is the headless cap).
- Requests at boot 71 -> 69, decoded 7,485 -> 7,254 KB, transfer 7,506 -> 7,274 KB (-3 %); the empty state's decoded bytes are +2 % (6,377 -> 6,482 KB, code the two rounds added).
- The JS heap after a cold boot is higher (21.7 -> 29.9 MB, +38 %); after the warm reload it is lower (45.9 -> 28.2 MB). Not investigated.

## Gate 2 (boot requests, bytes, transcript order)

Measured with `tools/measure/first-board.mjs --cold` (shopfront; the page opens while the server is still attaching, which is the real launch), 3 agreeing reads.

**Boot requests, 42 -> 34** (faa40d475 -> this branch; f5b32e707 was 36). Before: the page made its workspace reads (sessions, skills, acp/runs, goal-run, sessions/<id>, acp/agents, canvas-doc) once for the HOME workspace, then the whole set again when the attach landed (eb813d265): 8 wasted requests, a wrong chat for a moment, and AsciiStage plus the hero image pulled in by the longer window. After: the HTML starts `/api/status` (and `/api/sessions`) before the app script runs; workspace reads wait for that answer (`bootFetchCache` workspace gate: opens on an answer that is not "attaching", on a failed read, on a write, or after 20 s), so there is one wave. The rescan stale probe starts 3 s after boot instead of with the first frame (its poll landed on the window edge and made the three reads disagree).

Remaining, in order: document, status (HTML), sessions (HTML), index.js, css, 4 fonts, acp/live, workspace, ai-config, AsciiStage, hero image, status, sessions, skills, status, acp/runs, goal-run, sessions/<id>, acp/agents, canvas-doc, archgraph.json, git/status, repo-trust, annotate, status, git/branches, elk.worker, VisualMetaStrip, git/events, elk.bundled, font 500. Ceiling 31 -> 34 with a reason per request group in `perf-ratchet.json`.

**Bytes**: 2,605,393 -> 2,606,664 (ceiling 2,562,588 -> 2,606,664). The entry chunk had grown 26 KB since f5b32e707 across about 40 files, each small (V3Chat +3.5 KB, rescan controller and stale notice +6 KB, savedRuns +1.7 KB, ProposalFileRow +2.2 KB, ...); all are first-frame features, so the ceiling follows the measurement with the attribution in the baseline notes.

**Transcript before the board** (perf harness, interleaved A/B, 3 passes x 5 runs, A = gate only, B = early sessions list + last-thread hint): cold latest turn 355 -> 309 ms (-13 %), board 415 -> 421 ms (flat); warm latest turn 179 -> 142 ms, board 229 -> 243 ms. The transcript read used to wait for the sessions list (two round trips behind the board's graph read); the list now comes from the HTML's early read and the thread named last time is requested beside it.
