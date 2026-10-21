# 0.1.8.4 layout, browser contracts, and UI deletion evidence

Lane: `wip/0184-r2-layout`, based on `62e301864`. Product source measured at `6e6cea27e9f9cb20712db820102a052659490904`. Parent re-ran layout contracts at integrated HEAD `f45593d92` (see `0184-finish-layout-r3.md`). This is a local source acceptance report, not a packaged release claim.

## Changes and locking evidence

| Commit | Result | Before / after |
|---|---|---|
| `abd5c9bf5` | Chat-only layout gives the overview the last 4 px rather than compressing the chat below 900 px at a 1440 px viewport | Existing `g2-chat-only-width` failed at 896 px; now 900 px. Overview placement unit cases lock the geometry. |
| `0b484c0cc` | Architecture board controls fit a 240 px pane | `board-tags-narrow` exposed 151 px of content in a 146 px strip, including the clipped Add button; now 146/146 px. |
| `643866b2d` | Static graph hosting releases workspace fetches when `/api/status` is HTML, rather than waiting the 20 s guard | `bootFetchCache.test.ts` covers the non-JSON response. Rails/popover e2e previously timed out waiting for sessions; both now pass. This does not claim to fix the owner's entire large-project startup report. |
| `4f58b2d46`, `49671fbc6` | Empty prompts, normal transcript, and virtual transcript use the composer's horizontal rails | New `chat-composer-align` failed split and narrow cases before the fix (plain 4 px inset; virtual 10 px). Final exact left/right: split 263/653, desktop chat-only 306/1106, narrow 23/397. |
| `5f7746b79` | Camera e2e measures the board's actual painted background position, and anatomy waits for arranged/Fit before a real right-click | Flow initially failed 1/13 because removed CSS variables always read empty strings. Now 13/13; anatomy 11/11. No force clicks, private renderer transforms, disabled assertions, or changed product camera behavior. |
| `6e6cea27e` | Workspace controls require no lateral scrolling | New `workspace-nav-fit` failed at 1024 (459 > 356 px) and 420 (459 > 396 px). Tight stages now use named icons/tooltips and keep the focused closer; all surfaces remain reachable. Final 1024 and 420 nav is 184/184 px; 1440 and 760 retain full labels at 459/459 px. Existing rails assertion was rewritten for this newer owner contract; it still requires full desktop labels. |
| `d7b667701` | Reusable click-to-visible-delete benchmark for chats and Spaces | Real built app, fresh Chromium profile, isolated fixture/user store; page clock excludes harness round-trip. Probe refuses to time an absent row. |

## Gates run in this lane

All commands below returned bare exit **0**, with no skips. Logs live one directory above this checkout, under the owning workspace.

- `pnpm --filter @sequence/web2 build` ? `lane2-nav-green-build.log`.
- `pnpm --filter @sequence/web2 exec vitest run src/overview/overviewPanel.test.tsx src/boot/bootFetchCache.test.ts src/shell2/surfaceBar.test.tsx src/shell2/surfaceTabs015.test.tsx` ? 4 files, 104 tests, `lane2-resume-unit.log`.
- `node --import ./tools/test-guard/no-real-binaries.mjs packages/web2/e2e/<name>.mjs` ? `workspace-nav-fit` 8, `rails-match` 8, `chat-composer-align` 3, `g2-chat-only-width` 6, `board-tags-narrow` 7, `popovers-share` 4. Logs `lane2-<name>-nav-final.log`; **36 checks** total.
- Same guarded command for `flow-plays` ? 13 checks, and `anatomy-reached` ? 11 checks; `lane2-<name>-resume-green.log`. These ran at `5f7746b79`, before the later responsive nav CSS change; parent should rerun at the integrated head.

Red logs retained: `lane2-align-red2.log` (exit 1), `lane2-nav-red2.log` (exit 1), and `lane2-flow-plays-resume-red.log` (exit 1). Earlier builder logs retain the chat-width, board-tag, and boot/session failures.

## UI deletion speed at final product source

Command: `node --import ./tools/test-guard/no-real-binaries.mjs tools/bench/0184-ui-delete.mjs docs/bench/0184-fin-layout/ui-delete-nav-final 12` ? exit **0**. Node v24.13.0; Chromium on this Windows machine; source `6e6cea27e`. Each kind has 12 samples. Fixture chats have 40 turns; fixture Spaces have 200 items. No real user chats, Spaces, providers, or credentials used.

| Delete | Median DOM removal | p95 DOM removal | Median first animation frame without row | p95 first animation frame |
|---|---:|---:|---:|---:|
| Chat | 13.4 ms | 27.9 ms | 13.8 ms | 28.2 ms |
| Space | 15.0 ms | 18.2 ms | 16.7 ms | 20.2 ms |

Raw samples and exact source hash: [results.json](0184-fin-layout/ui-delete-nav-final/results.json). These are UI response measurements on synthetic data, not durable-disk deletion timings, large-history bounds, guaranteed paint timing, or a before/after speedup claim. p95 uses nearest rank; with 12 samples it is the maximum sample.

## Visual evidence and limits

The screenshot harness copied **5,745 tracked files** from this real Sequence checkout into an isolated temp repository; no `node_modules` or original user state was borrowed. It drove the built analyzer/UI at 1440, 1024, and 420 px. It explicitly waited for the startup scanning overlay to disappear before final captures. Desktop and narrow screenshots were visually inspected. Desktop prompts now align with the composer; 1024 workspace icons and its closer fit, and 420 chat controls/status fit the viewport.

- [Desktop real-source board](0184-fin-layout/real-repo-nav-final/architecture-1440.png)
- [1024 real-source board and compact navigation](0184-fin-layout/real-repo-nav-final/architecture-1024.png)
- [Desktop chat-only](0184-fin-layout/real-repo-nav-final/chat-only-1440.png)
- [420 chat-only](0184-fin-layout/real-repo-nav-final/chat-only-420.png)

Final sweep logs: `lane2-real-nav-shots-settled.log`. Full document width equals viewport width in every captured case. This does not claim every repository or every overlay is audited. The parent owns provider/trace UX, full combined tests, large-project launch measurements, package acceptance, and final integration. Add the new `chat-composer-align` and `workspace-nav-fit` suites to the package e2e entry during integration so these locks run routinely.
