# Performance, 0.1.8.4: before and after

**Before** is the 0.1.8.4 integration snapshot (`5b327cc`, source of naidx0/sequence-arch-tool `09054fc17`, no cloud change applied). **After** is `release/0.1.8.4` at the commit that adds this file. Both trees were built and measured on the same box (CPU only, Chromium, headless), one tree after the other, alternating, with nothing else running. Nothing here calls a model.

The honest summary: one thing got measurably better (coming back to the Architecture tab), nothing got measurably worse, and everything else is inside the noise of the box. The 0.1.8.4 program itself (rail, Spaces, chat overview, genui cards, auto-compact) landed in the snapshot, so its cost is in *both* columns.

## What changed

Returning to the Architecture tab: the board used to start from its seed pile, compute a new arrangement, and settle, so a reader saw the cards jump twice. Now the last arrangement of the same set of cards stands in while the new one is computed (`canvas/layoutCarry.ts`, wired in `ConnectedBoard.tsx`), and a re-arrangement that gives the same result is not drawn twice.

| Reopen the Architecture tab (`tools/measure/board-reopen.mjs`, 8 runs each) | before | after |
|---|---|---|
| Different card arrangements on screen before the final one, median (max) | **12** (13) | **0** (0) |
| Click to the final arrangement, median, 1x CPU | 446 ms | **99 ms** |
| Arrangements before the final one, median (max), CPU throttled 4x | 4 (6) | **0** (0) |
| Click to the final arrangement, median, CPU throttled 4x | 1,145 ms | **604 ms** |

The "after" figures are one arrangement from the first frame: the cards do not move.

## Unchanged (inside the noise)

First board, cold start (`tools/measure/first-board.mjs --cold`, 10 runs in each of two passes, 20 reads per tree, medians; p95 in brackets):

| | before | after |
|---|---|---|
| Server ready | 595 ms (671) | 643 ms (689) |
| Composer usable | 464 ms (583) | 453 ms (504) |
| Board drawn | 1,441 ms (1,581) | 1,445 ms (1,510) |
| Layout settled | 1,738 ms (1,860) | 1,761 ms (1,931) |
| Boot requests | 33 (34) | 33 (34) |
| Boot API calls | 19 (20) | 19 (20) |

Streaming an answer at 120 chunks per second for 8 s (`tools/measure/stream-bench.mjs`):

| | 1x before | 1x after | 4x before | 4x after |
|---|---|---|---|---|
| Main thread busy | 55.5 % | 58.2 % | 99.2 % | 98.8 % |
| Script share | 17.0 % | 17.8 % | 34.1 % | 29.1 % |
| Layout share | 3.5 % | 3.6 % | 7.1 % | 7.2 % |
| Style share | 3.6 % | 3.9 % | 8.1 % | 9.1 % |
| Frame gap p95 | 33.4 ms | 33.4 ms | 116.7 ms | 100 ms |
| Long tasks | 0 | 0 | 93 | 112 |
| Switch chat mid-stream, median | 199 ms | 186 ms | 1,342 ms | 1,445 ms |

At 1x CPU there is no long task and the frame gap p95 is two frames. At 4x the main thread is saturated either way. A CPU profile of the stream shows the cost is mostly browser paint and raster (`(program)` 62 %); no cheap JavaScript win was found, so none was claimed.

Chat switch (`tools/measure/switch-bench.mjs`, 10 chats of 500 turns, medians):

| | before | after |
|---|---|---|
| 1x CPU, cold / warm p50 | 212 / 216 ms | 209 / 188 ms and 197 / 203 ms (two runs) |
| 4x CPU, cold / warm p50 | 739 / 788 ms and 910 / 757 ms (two runs) | 801 / 683 ms and 862 / 819 ms (two runs) |

Same within the spread. The JS heap after twelve switches reads 23 or 52 MB on the same build from one run to the next (garbage-collection timing), so no heap claim is made either way.

## Cost of the code that was added

| | before | after |
|---|---|---|
| First-page script (`bootJsBytes`, every read) | 2,654,677 B | 2,655,231 B (**+554 B**) |
| Boot modules | 5 | 5 |
| React commits per keystroke / per stream chunk | 1 / 1 | 1 / 1 |

The ceiling in `tools/measure/perf-ratchet.json` moved from 2,606,664 to 2,655,231 B. Of the +48,567 B, **48,013 B was already in the snapshot** (the program's own boot-path growth, never raised against the ratchet); the owner accepted it. This round adds 554 B. The note is in the file's `$raised` chain.

## Limits

- Timings come from one CPU-only container with throttling emulated in the browser (4x). Absolute numbers will differ on real hardware; the before/after comparison used one box and alternated trees.
- `bootRequests` reads 33 or 34 between cold reads on both trees (a poll that lands at the edge of the boot window). `tools/measure/perf-counts.mjs` therefore refuses to write a result and the ceiling stays 34. That is the harness's own agreement rule working, not a regression.
- `switch-bench.mjs` times out about half the time at 1x CPU on **both** trees, waiting for the 11th sidebar row (`.s2-it-hit` index 10) after reading 11 titles. The numbers above come from the runs that finished. The race is in the sidebar list settling after boot or in the bench's row lookup; it is not caused by this round and was not chased further.
- The streaming profile and the chat-switch figures are indicative; their run-to-run spread is as large as the differences shown.

## Reproduce

```
pnpm build
node tools/measure/board-reopen.mjs --runs 8 --throttle 1
node tools/measure/first-board.mjs --cold --runs 10
node tools/measure/stream-bench.mjs --throttle 1 --chunk-ms 25 --seconds 8
node tools/measure/switch-bench.mjs --chats 10 --turns 500 --throttle 4 --switches 12
node tools/measure/perf-counts.mjs
```

Throwaway repositories must live under `$HOME` (the app's repo jail); set `TMPDIR` accordingly. See `docs/bench/REPRODUCE.md`.
