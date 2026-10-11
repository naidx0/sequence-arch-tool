# Speed slice plan

**End state:** the packaged desktop app reaches a typeable composer sooner than today's ~947 ms median launch-to-composer, every boot count is held by a ratchet, and the idle app does no hidden work, each item proven by its own before/after count.

## Slices, in dependency order

| # | Slice | Gate that proves it | Depends on |
|---|---|---|---|
| 6 | `tools/measure/perf-ratchet.json` + `tools/ci/perf-ratchet.mjs` checker; counts: boot modules, boot JS bytes, boot requests, React commits per composer keystroke, commits per streamed chunk | `tools/ci/perf-ratchet.test.mjs` (above ceiling fails, below ceiling says lower it, equal passes); collector run on the current head writes the first ceilings | none (first shippable slice) |
| 1 | Desktop waits for the analyzer child's "listening" line, keeps the health poll as fallback | `packages/desktop` tests: resolves on the line before any poll would; still resolves by poll when no line comes; dies early on exit. First-frame mark checked with the existing smoke marks | none |
| 2 | Server as one esbuild bundle in the analyzer build and in prepare-server; require shim, wasm and web-dist paths checked at runtime; V8 compile cache (`module.enableCompileCache` on Node 22.1+, else `vm.Script` cachedData); renderer `v8CacheOptions: 'bypassHeatCheck'` | bundle boots and serves `/api/status` from a copied folder outside the repo; import time before/after | 1 (same startup path) |
| 3 | Static composer and sidebar frame in `web2/index.html`; typed text and caret carried into React on mount; Send waits for readiness | keystroke hand-off test (no lost or reordered keys); static vs React alignment within 1 px at 3 viewports | none |
| 4 | Composer stays mounted across chat and tab switches; prefetch on hover (chat row → session, Architecture tab → graph, xyflow chunk, elk worker) | commits per tab switch; requests on hover | **asks the coordinator first**: V3Shell layout and the tab strip belong to the views builder |
| 5 | Idle audit (report only): reloads, intervals/polls in a 60 s idle window, duplicate storage writes, `:has()` on root or high-level nodes in graphite.css | a written list with file:line | none |

The end measurement (launch-to-composer and time-to-first-keystroke, packaged, n=9, median, machine quiet) runs once, after the kept slices, **only after the coordinator confirms the machine is quiet**.

## Stated edge (out)

- No change to canvas/**, V3Shell.tsx layout, the tab strip or onboarding without the coordinator.
- No live model calls; fakes and recorded data only.
- Item 5 changes nothing; it reports.
