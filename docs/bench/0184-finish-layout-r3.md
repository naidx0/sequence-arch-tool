# 0.1.8.4 layout contracts — parent re-run (round 3)

Integrated branch `wip/0184-ux-finish-20261020`. Gates ran after locking `workspace-nav-fit` and `chat-composer-align` in `packages/web2` `test:e2e` (`f45593d92`; prior combined product tip `76d188973b8117e6af9c4ceb968617bae4119ceb`).

## Status

**DONE_WITH_CONCERNS** — all five commands exit **0**. Bench PNGs under `0184-fin-layout/real-repo-nav-final/` are not present in this checkout (only `ui-delete-nav-final/results.json`); lateral scroll is locked by `workspace-nav-fit` (1440/1024/760/420: `scrollWidth` equals `clientWidth` in `parent-layout-r3-nav.log`).

## Gates

| # | Command | Exit | Log |
|---|---------|-----:|-----|
| 1 | `pnpm --filter @sequence/web2 build` | 0 | `../parent-layout-r3-build.log` |
| 2 | `pnpm --filter @sequence/web2 exec vitest run src/overview/overviewPanel.test.tsx src/boot/bootFetchCache.test.ts src/shell2/surfaceBar.test.tsx src/shell2/surfaceTabs015.test.tsx` | 0 | `../parent-layout-r3-unit.log` (4 files, 104 tests) |
| 3 | `node --import ./tools/test-guard/no-real-binaries.mjs packages/web2/e2e/workspace-nav-fit.mjs` | 0 | `../parent-layout-r3-nav.log` (8 checks) |
| 4 | `node --import ./tools/test-guard/no-real-binaries.mjs packages/web2/e2e/rails-match.mjs` | 0 | `../parent-layout-r3-rails.log` (8 checks) |
| 5 | `node --import ./tools/test-guard/no-real-binaries.mjs packages/web2/e2e/chat-composer-align.mjs` | 0 | `../parent-layout-r3-align.log` (3 checks) |

**HEAD at gate time:** `f45593d9237464c99433577d2210d9983a30491f`

## Workspace nav (programmatic)

From `parent-layout-r3-nav.log`: no horizontal nav scroll at any width; 1024/420 use compact icon strip (`clientWidth` 184 px); 1440/760 retain full labels (`clientWidth` 459 px).
