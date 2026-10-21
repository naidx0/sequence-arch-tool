# PERF 0.1.8.3: the client speed program, numbers

Slice S1 (docs/plans/0.1.8.3-speed-plan.md): the harness and its verification. Nothing is optimised here. The BEFORE
baseline is taken later, on the final 0.1.8.2 build, with the machine quiet. The two runs below are a **harness check,
machine shared**: they show the instrument repeats, not what the app costs.

## Method

`node tools/bench/client/run.mjs [--runs 10] [--throttle 1|4] [--fixture this|shopfront] [--out f.json] [--trace] [--build] [--exe path] [--cycles 50] [--only a,b,c,d,e,f] [--inject-block-ms N]`

- **App under test:** the packaged app (`electron-builder --dir --win`, `CSC_IDENTITY_AUTO_DISCOVERY=false`; `--build` runs prepare-server and that). It is copied out of the repo to a temp dir first (the repo guard refuses to launch it inside). Driven over CDP (`--remote-debugging-port`, playwright-core `connectOverCDP`).
- **Isolation:** every launch has a scratch HOME, USERPROFILE, APPDATA, LOCALAPPDATA, `--user-data-dir` and SEQUENCE_USER_DIR; fake `claude`/`codex` that exit 1 are first on PATH; no variable that looks like a key or token is passed (the release smoke's `buildEnv`/`envLeaks`). The run aborts if the app wrote nothing into the temp userData.
- **Profile:** once per invocation an unmeasured session skips onboarding, attaches the fixture through the app's own Open project dialog, and seeds two chats through `PUT /api/sessions` (40 turns and 500 turns, `tools/measure/lib/benchApp.mjs` `makeTurns`). The profile is snapshotted with Chromium caches removed and restored before every run, so every run starts from the same bytes and a cold cache. Fixtures: `this` = git-tracked files of this repo, git-inited; `shopfront` = `packages/analyzer/test/fixtures/shopfront`, git-inited; both under the scratch home.
- **Throttle:** `Emulation.setCPUThrottlingRate` on every renderer page from the moment CDP attaches (about 100 ms after spawn). The main and server processes are not throttled.
- **Statistics:** `tools/bench/client/stats.mjs`, pinned by `stats.test.mjs` (nearest-rank p95, median of an even sample averages the middle pair). Output JSON has every run's raw numbers plus median, p95, min, max.

| id | metric | how it is read |
|---|---|---|
| a | `coldStartMs` | spawn to the composer field visible, enabled, no first-run gate (polled in the page every 8 ms), caches removed |
| b | `warmStartMs` | the same, second launch on the same userData |
| c | `open.<surface>.firstMs` / `reopenMs` | in-page `t0` at the click or Enter, to the next animation frame after the frame in which the surface's content marker is on screen; first open, and median of three reopenings. Settings (`settings-body`, no `settings-loading`), Search (`search-query`), Help (`help`), Files (`files-panel`), Board = the architecture tab (`.react-flow__node`), Spaces = the whiteboard (`wb-canvas`), Terminal (`terminal-pane-surface`). Search and Help open from the command palette (already filtered; the timed action is Enter); the others from their rail button or tab. |
| d | `typing.*` | 60 characters typed at 45 ms spacing into the composer of the 40-turn chat while a fake answer streams (18-char chunks every 50 ms). `keyP50/P95/Max` = keydown `timeStamp` to the paint after the next frame; `inpMs` = second-worst interaction from `PerformanceObserver` event timing (entries under 16 ms are not reported by the browser); long tasks and dropped frames over the same window. |
| e | `frames.transcript.*`, `frames.boardPan.*` | rAF deltas while 120 wheel events scroll the 500-turn transcript up and down, and while 6 drags pan the architecture board. `dropped` = frames swallowed by deltas past 1.5 display periods (the period is the median delta, at least 16.6 ms, because a remote or 55 Hz display makes every delta read over 16.7 ms); `frameP95Ms`, `frameMaxMs` too. |
| f | `memory.<overlay>.*` | JS heap after 3 forced GCs (`Runtime.getHeapUsage`) before and after 50 open/close cycles of Settings, Search, Help; `heapDeltaMB`; sum of private bytes of the app's process tree (main, renderers, GPU, server child) after, and its delta. Private bytes move by tens of MB between samples; read the heap numbers for a leak. |

### What the harness does not measure, and why

- **Streaming is a stand-in.** `POST /api/acp/run-node` is replaced inside the page by a timed SSE stream (the frames `tools/measure/stream-bench.mjs` plays). There is no model, but the server side of a turn (agent spawn, event merge) is not exercised, so S3 must not read server cost from (d).
- **Typing runs in the 40-turn chat, not the 500-turn one.** Typing in a 500-turn transcript is a separate, heavier case.
- **Start under throttle 4** slows the renderer only; the main process and the server child start at full speed.
- **Process private bytes** come from `Win32_Process.PrivatePageCount`, sampled with PowerShell; coarse.
- **GPU/compositor frames** are read from rAF in the page, not from the compositor; the machine's display is a remote session, so absolute fps is not meaningful, only differences between builds.
- **Terminal** is timed to its surface appearing, not to a shell prompt.

## Harness check (not a baseline)

Build: packaged from branch commit 6a9d59584 (origin/main 7d618c149, the 0.1.8.2 code, plus this branch's harness and the test-only hook). Shopfront fixture, throttle 1, 10 runs each, back to back on 2026-10-17. Machine: AMD Ryzen 7 5700X 8-Core Processor, 16 threads, 15.9 GB RAM, Windows_NT 10.0.26200 x64, Node v24.13.0. The release gate had finished, but other agents were still using the machine (free RAM at launch was 1.4 GB for run 1 and 2.7 GB for run 2), so this is a **harness check, machine shared**, not the BEFORE baseline. The BEFORE is re-taken later on the final 0.1.8.2 build with the machine quiet.

Raw per-run numbers: `docs/bench/perf-0.1.8.3/harness-check1.json` and `harness-check2.json`. Both runs completed 10 of 10 with no phase error.

### Run 1 (check1)

| metric | median | p95 | min | max | n |
|---|---:|---:|---:|---:|---:|
| coldStartMs | 694.6 | 1014.7 | 637 | 1014.7 | 10 |
| warmStartMs | 742 | 830.3 | 680.5 | 830.3 | 10 |
| open.settings.firstMs | 55 | 73.2 | 53.9 | 73.2 | 10 |
| open.settings.reopenMs | 36.8 | 41.6 | 36.5 | 41.6 | 10 |
| open.search.firstMs | 36.7 | 37.8 | 36 | 37.8 | 10 |
| open.search.reopenMs | 18.1 | 18.4 | 17.9 | 18.4 | 10 |
| open.help.firstMs | 36.1 | 36.6 | 35.8 | 36.6 | 10 |
| open.help.reopenMs | 18.1 | 18.7 | 18 | 18.7 | 10 |
| open.files.firstMs | 36.3 | 36.7 | 35.5 | 36.7 | 10 |
| open.files.reopenMs | 18.1 | 18.5 | 17.9 | 18.5 | 10 |
| open.board.firstMs | 18.2 | 19.8 | 18 | 19.8 | 10 |
| open.board.reopenMs | 18.4 | 18.8 | 17.9 | 18.8 | 10 |
| open.spaces.firstMs | 36.5 | 54.6 | 35.5 | 54.6 | 10 |
| open.spaces.reopenMs | 18.2 | 18.5 | 18 | 18.5 | 10 |
| open.terminal.firstMs | 36.1 | 36.7 | 35.3 | 36.7 | 10 |
| open.terminal.reopenMs | 18.3 | 18.5 | 18 | 18.5 | 10 |
| typing.keyP50 | 27 | 28.2 | 26.8 | 28.2 | 10 |
| typing.keyP95 | 34.7 | 35.5 | 33.3 | 35.5 | 10 |
| typing.keyMax | 35.8 | 36.4 | 34.5 | 36.4 | 10 |
| typing.inpMs | 72 | 72 | 32 | 72 | 10 |
| typing.longTasks | 0 | 0 | 0 | 0 | 10 |
| typing.longTaskMaxMs | 0 | 0 | 0 | 0 | 10 |
| typing.droppedFrames | 0 | 0 | 0 | 0 | 10 |
| frames.transcript.dropped | 0 | 0 | 0 | 0 | 10 |
| frames.transcript.frameP95Ms | 18.5 | 18.6 | 18.1 | 18.6 | 10 |
| frames.transcript.frameMaxMs | 19.1 | 20.8 | 18.6 | 20.8 | 10 |
| frames.boardPan.dropped | 0 | 0 | 0 | 0 | 10 |
| frames.boardPan.frameP95Ms | 18.5 | 18.6 | 18.2 | 18.6 | 10 |
| frames.boardPan.frameMaxMs | 19 | 19.3 | 18.6 | 19.3 | 10 |
| memory.settings.heapAfterMB | 20.9 | 21.1 | 20.6 | 21.1 | 10 |
| memory.settings.heapDeltaMB | 1.3 | 1.5 | 0.5 | 1.5 | 10 |
| memory.settings.privateAfterMB | 612.8 | 690.3 | 606 | 690.3 | 10 |
| memory.settings.privateDeltaMB | 48.5 | 122 | 24.3 | 122 | 10 |
| memory.search.heapAfterMB | 21.4 | 21.8 | 21.3 | 21.8 | 10 |
| memory.search.heapDeltaMB | 0.7 | 1.2 | 0.2 | 1.2 | 10 |
| memory.search.privateAfterMB | 580.1 | 597 | 572.2 | 597 | 10 |
| memory.search.privateDeltaMB | -30.3 | -19.3 | -74.9 | -19.3 | 10 |
| memory.help.heapAfterMB | 21.9 | 22.3 | 21.7 | 22.3 | 10 |
| memory.help.heapDeltaMB | 0.2 | 1 | 0 | 1 | 10 |
| memory.help.privateAfterMB | 527.8 | 572.4 | 519.6 | 572.4 | 10 |
| memory.help.privateDeltaMB | -51.5 | -8 | -67.8 | -8 | 10 |

### Run 2 (check2)

| metric | median | p95 | min | max | n |
|---|---:|---:|---:|---:|---:|
| coldStartMs | 673.3 | 1188.8 | 643.2 | 1188.8 | 10 |
| warmStartMs | 742 | 809.4 | 674.1 | 809.4 | 10 |
| open.settings.firstMs | 55.5 | 92.2 | 54.8 | 92.2 | 10 |
| open.settings.reopenMs | 36.6 | 41 | 36.1 | 41 | 10 |
| open.search.firstMs | 36.2 | 37.3 | 35.6 | 37.3 | 10 |
| open.search.reopenMs | 18.1 | 18.8 | 17.8 | 18.8 | 10 |
| open.help.firstMs | 36.2 | 37.4 | 35.5 | 37.4 | 10 |
| open.help.reopenMs | 18.1 | 18.8 | 18 | 18.8 | 10 |
| open.files.firstMs | 36.2 | 36.8 | 35.6 | 36.8 | 10 |
| open.files.reopenMs | 18.4 | 18.7 | 18.1 | 18.7 | 10 |
| open.board.firstMs | 18.1 | 18.6 | 17.8 | 18.6 | 10 |
| open.board.reopenMs | 18.3 | 18.8 | 17.9 | 18.8 | 10 |
| open.spaces.firstMs | 36.6 | 36.9 | 35.5 | 36.9 | 10 |
| open.spaces.reopenMs | 18.2 | 18.8 | 17.9 | 18.8 | 10 |
| open.terminal.firstMs | 36.1 | 37.1 | 35.6 | 37.1 | 10 |
| open.terminal.reopenMs | 18.3 | 18.7 | 17.9 | 18.7 | 10 |
| typing.keyP50 | 27.5 | 28.1 | 26.2 | 28.1 | 10 |
| typing.keyP95 | 34.4 | 35.9 | 32.9 | 35.9 | 10 |
| typing.keyMax | 35.8 | 36.5 | 35 | 36.5 | 10 |
| typing.inpMs | 56 | 72 | 32 | 72 | 10 |
| typing.longTasks | 0 | 0 | 0 | 0 | 10 |
| typing.longTaskMaxMs | 0 | 0 | 0 | 0 | 10 |
| typing.droppedFrames | 0 | 0 | 0 | 0 | 10 |
| frames.transcript.dropped | 0 | 0 | 0 | 0 | 10 |
| frames.transcript.frameP95Ms | 18.5 | 18.6 | 18.3 | 18.6 | 10 |
| frames.transcript.frameMaxMs | 19 | 19.2 | 18.7 | 19.2 | 10 |
| frames.boardPan.dropped | 0 | 1 | 0 | 1 | 10 |
| frames.boardPan.frameP95Ms | 18.5 | 18.7 | 18.2 | 18.7 | 10 |
| frames.boardPan.frameMaxMs | 19.1 | 37 | 18.6 | 37 | 10 |
| memory.settings.heapAfterMB | 20.7 | 21.1 | 20.5 | 21.1 | 10 |
| memory.settings.heapDeltaMB | 1.1 | 1.4 | 0.6 | 1.4 | 10 |
| memory.settings.privateAfterMB | 625.3 | 665.1 | 601.6 | 665.1 | 10 |
| memory.settings.privateDeltaMB | 42.4 | 82 | 30.3 | 82 | 10 |
| memory.search.heapAfterMB | 21.4 | 21.9 | 21.3 | 21.9 | 10 |
| memory.search.heapDeltaMB | 0.8 | 1.2 | 0.3 | 1.2 | 10 |
| memory.search.privateAfterMB | 588.9 | 610 | 575.4 | 610 | 10 |
| memory.search.privateDeltaMB | -34.7 | -10.9 | -72.8 | -10.9 | 10 |
| memory.help.heapAfterMB | 22 | 22.3 | 21.8 | 22.3 | 10 |
| memory.help.heapDeltaMB | 0.8 | 1 | 0 | 1 | 10 |
| memory.help.privateAfterMB | 534.6 | 580.6 | 525.4 | 580.6 | 10 |
| memory.help.privateDeltaMB | -52.7 | -1.3 | -67.1 | -1.3 | 10 |

### Agreement of the two runs

A = run 1, B = run 2. "agree" means each run's median lies inside the other run's min to max.

| metric | A median (min-max) | B median (min-max) | B vs A | ranges | verdict |
|---|---:|---:|---:|---|---|
| coldStartMs | 694.6 (637-1014.7) | 673.3 (643.2-1188.8) | -3.1% | overlap | agree |
| warmStartMs | 742 (680.5-830.3) | 742 (674.1-809.4) | +0% | overlap | agree |
| open.settings.firstMs | 55 (53.9-73.2) | 55.5 (54.8-92.2) | +0.9% | overlap | agree |
| open.settings.reopenMs | 36.8 (36.5-41.6) | 36.6 (36.1-41) | -0.5% | overlap | agree |
| open.search.firstMs | 36.7 (36-37.8) | 36.2 (35.6-37.3) | -1.4% | overlap | agree |
| open.search.reopenMs | 18.1 (17.9-18.4) | 18.1 (17.8-18.8) | +0% | overlap | agree |
| open.help.firstMs | 36.1 (35.8-36.6) | 36.2 (35.5-37.4) | +0.3% | overlap | agree |
| open.help.reopenMs | 18.1 (18-18.7) | 18.1 (18-18.8) | +0% | overlap | agree |
| open.files.firstMs | 36.3 (35.5-36.7) | 36.2 (35.6-36.8) | -0.3% | overlap | agree |
| open.files.reopenMs | 18.1 (17.9-18.5) | 18.4 (18.1-18.7) | +1.7% | overlap | agree |
| open.board.firstMs | 18.2 (18-19.8) | 18.1 (17.8-18.6) | -0.5% | overlap | agree |
| open.board.reopenMs | 18.4 (17.9-18.8) | 18.3 (17.9-18.8) | -0.5% | overlap | agree |
| open.spaces.firstMs | 36.5 (35.5-54.6) | 36.6 (35.5-36.9) | +0.3% | overlap | agree |
| open.spaces.reopenMs | 18.2 (18-18.5) | 18.2 (17.9-18.8) | +0% | overlap | agree |
| open.terminal.firstMs | 36.1 (35.3-36.7) | 36.1 (35.6-37.1) | +0% | overlap | agree |
| open.terminal.reopenMs | 18.3 (18-18.5) | 18.3 (17.9-18.7) | +0% | overlap | agree |
| typing.keyP50 | 27 (26.8-28.2) | 27.5 (26.2-28.1) | +1.9% | overlap | agree |
| typing.keyP95 | 34.7 (33.3-35.5) | 34.4 (32.9-35.9) | -0.9% | overlap | agree |
| typing.keyMax | 35.8 (34.5-36.4) | 35.8 (35-36.5) | +0% | overlap | agree |
| typing.inpMs | 72 (32-72) | 56 (32-72) | -22.2% | overlap | agree |
| typing.longTasks | 0 (0-0) | 0 (0-0) | - | overlap | agree |
| typing.longTaskMaxMs | 0 (0-0) | 0 (0-0) | - | overlap | agree |
| typing.droppedFrames | 0 (0-0) | 0 (0-0) | - | overlap | agree |
| frames.transcript.dropped | 0 (0-0) | 0 (0-0) | - | overlap | agree |
| frames.transcript.frameP95Ms | 18.5 (18.1-18.6) | 18.5 (18.3-18.6) | +0% | overlap | agree |
| frames.transcript.frameMaxMs | 19.1 (18.6-20.8) | 19 (18.7-19.2) | -0.5% | overlap | agree |
| frames.boardPan.dropped | 0 (0-0) | 0 (0-1) | - | overlap | agree |
| frames.boardPan.frameP95Ms | 18.5 (18.2-18.6) | 18.5 (18.2-18.7) | +0% | overlap | agree |
| frames.boardPan.frameMaxMs | 19 (18.6-19.3) | 19.1 (18.6-37) | +0.5% | overlap | agree |
| memory.settings.heapAfterMB | 20.9 (20.6-21.1) | 20.7 (20.5-21.1) | -1% | overlap | agree |
| memory.settings.heapDeltaMB | 1.3 (0.5-1.5) | 1.1 (0.6-1.4) | -15.4% | overlap | agree |
| memory.settings.privateAfterMB | 612.8 (606-690.3) | 625.3 (601.6-665.1) | +2% | overlap | agree |
| memory.settings.privateDeltaMB | 48.5 (24.3-122) | 42.4 (30.3-82) | -12.6% | overlap | agree |
| memory.search.heapAfterMB | 21.4 (21.3-21.8) | 21.4 (21.3-21.9) | +0% | overlap | agree |
| memory.search.heapDeltaMB | 0.7 (0.2-1.2) | 0.8 (0.3-1.2) | +14.3% | overlap | agree |
| memory.search.privateAfterMB | 580.1 (572.2-597) | 588.9 (575.4-610) | +1.5% | overlap | agree |
| memory.search.privateDeltaMB | -30.3 (-74.9--19.3) | -34.7 (-72.8--10.9) | +14.5% | overlap | agree |
| memory.help.heapAfterMB | 21.9 (21.7-22.3) | 22 (21.8-22.3) | +0.5% | overlap | agree |
| memory.help.heapDeltaMB | 0.2 (0-1) | 0.8 (0-1) | +300% | overlap | agree |
| memory.help.privateAfterMB | 527.8 (519.6-572.4) | 534.6 (525.4-580.6) | +1.3% | overlap | agree |
| memory.help.privateDeltaMB | -51.5 (-67.8--8) | -52.7 (-67.1--1.3) | +2.3% | overlap | agree |

41 of 41 metrics agree (each median inside the other run's range)

Reading it: all 41 metrics agree. The widest spreads are in start-up (cold 637 to 1015 ms in run 1, 643 to 1189 ms in run 2; medians 695 and 673 ms, 3% apart) and single outliers (Settings first open 73 and 92 ms against a 55 ms median; one 37 ms board frame). Opens read in steps of one display frame (about 18 ms here), so an effect has to be more than one frame to show. `typing.inpMs` is quantised (event timing, 8 ms) and ranges 32 to 72 ms: it is the least stable number, read it beside the key-to-paint p95 (33 to 36 ms in both runs). Private-byte deltas swing by tens of MB between samples (search and help go negative) and are not growth; the JS heap deltas (about 1 MB after 50 cycles per overlay, at most 1.5 MB) are the leak signal.

## Negative control

The test-only hook in `V3OverlayHost` busy-waits 300 ms in a layout effect each time an overlay opens, only when localStorage `sequence.bench.blockMs` is set (the runner sets it from `--inject-block-ms 300` or env `SEQUENCE_BENCH_BLOCK_MS`). Same build, 5 runs each, `--only c`: A = no block (`harness-noblock.json`), B = 300 ms block (`harness-block300.json`).

| metric | A median (min-max) | B median (min-max) | B vs A | ranges | verdict |
|---|---:|---:|---:|---|---|
| coldStartMs | 720.4 (683.6-1555.7) | 734 (653.7-762.6) | +1.9% | overlap | agree |
| open.settings.firstMs | 55 (54.2-76) | 362.9 (360.3-413) | +559.8% | disjoint | DIFFERENT (beyond noise) |
| open.settings.reopenMs | 36.5 (36.2-45.7) | 341.7 (339.2-342.6) | +836.2% | disjoint | DIFFERENT (beyond noise) |
| open.search.firstMs | 36.7 (36-37.2) | 339.8 (338.4-340.9) | +825.9% | disjoint | DIFFERENT (beyond noise) |
| open.search.reopenMs | 18 (17.9-18.8) | 304.2 (303.5-305.2) | +1590% | disjoint | DIFFERENT (beyond noise) |
| open.help.firstMs | 36 (35.6-36.3) | 340.8 (338.7-342.8) | +846.7% | disjoint | DIFFERENT (beyond noise) |
| open.help.reopenMs | 18.5 (17.9-18.8) | 306 (303.7-307.7) | +1554.1% | disjoint | DIFFERENT (beyond noise) |
| open.files.firstMs | 36.1 (35.8-54.5) | 36.1 (35.7-37.2) | +0% | overlap | agree |
| open.files.reopenMs | 18 (17.9-18.8) | 18.5 (18.3-18.8) | +2.8% | overlap | medians outside the other range |
| open.board.firstMs | 18.2 (17.8-18.5) | 18.8 (18.4-18.9) | +3.3% | overlap | medians outside the other range |
| open.board.reopenMs | 18.2 (18-19.2) | 18.4 (18-18.9) | +1.1% | overlap | agree |
| open.spaces.firstMs | 36.3 (35.4-55.4) | 35.8 (35.3-36.9) | -1.4% | overlap | agree |
| open.spaces.reopenMs | 18.2 (17.9-18.7) | 18.5 (17.9-18.9) | +1.6% | overlap | agree |
| open.terminal.firstMs | 36.5 (35.4-37.2) | 35.9 (35.5-36.5) | -1.6% | overlap | agree |
| open.terminal.reopenMs | 18.3 (18-18.4) | 18.6 (18.2-18.9) | +1.6% | overlap | medians outside the other range |

6 of 15 metrics agree (each median inside the other run's range)

The three overlays rise by about 300 ms (Settings first open 55 to 363 ms, Search 37 to 340, Help 36 to 341; reopen 37 to 342, 18 to 304, 18 to 306) with disjoint ranges, while Files, Board, Spaces, Terminal and cold start stay within noise (the few "medians outside the other range" rows there are one display frame, 18 ms, apart). The instrument sees a 300 ms regression where it was put, and nowhere else.

## S2 start-up / S4 surfaces: BEFORE attempt on a loaded machine (not usable as a baseline)

Base: wip/0183-perf-harness ae45ab278, packaged with prepare-server and `electron-builder --dir --win`, shopfront, `--only a,b,c`. Free RAM at launch was 0.2 to 1.5 GB of 15.9 GB (other agents' suites running). Raw: `perf-0.1.8.3/s2s4-before-x1.json` (throttle 1, 8 of 10 runs ok, 2 failed with "no app window appeared" after 150 s) and `s2s4-before-x4.partial.json` (throttle 4, 2 ok of 4 before it was stopped).

| metric | quiet-ish harness check (check1) | this attempt, throttle 1 |
|---|---:|---:|
| coldStartMs median (min-max) | 694.6 (637-1015) | 2472 (815-4445) |
| warmStartMs median (min-max) | 742 (680-830) | 2345 (977-2835) |
| open.settings.firstMs median | 55 | 93.5 (67-210) |
| open.files.firstMs median | 36.3 | 71 (54-112) |

The run-to-run range here is wider than the 10 % effect the keep rule looks for, so no change can be kept or reverted on it. No S2 or S4 change was made.
