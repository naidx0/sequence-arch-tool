# First-board performance instrument correction

2026-10-20. Lane `wip/0184-r2-traces`, source head `7327d7011`; product source/bundle unchanged since the trace lane build. The subject is the built analyzer and web2 against three isolated cold copies of `packages/analyzer/test/fixtures/shopfront`, never the owner's chats or user directory.

## Cause and correction

Fresh profiles now open chat-only. The old instrument waited four seconds for a board, clicked Architecture, and **stopped recording requests at that click**. It therefore excluded the board and ELK imports while calling the result first-board. The reported 1,260,207 bytes / 10 modules / 44 requests was the wrong subject.

`first-board.mjs` now has explicit scenarios:

- `--scenario fresh` (default): no seeded storage. Records a separate `freshComposer` checkpoint when the composer becomes visible, then opens Architecture if needed. First-board counts continue through the applied board layout, including requests after that click.
- `--scenario restored-architecture`: explicitly restores the historical Architecture layout. `perf-counts.mjs` uses this scenario for the existing board ratchet. Every sample must show visible Architecture, successful applied layout, zero corrective clicks and `landedOnBoard: true`.

Only a visible `data-testid="board"` with real nodes, `data-layout="idle"` and `data-arranged="true"`, following a laying-out edge, closes the window. Hidden, seed, failed and unrelated layout roots cannot close it. No fixed wait or network-idle shortcut replaces that endpoint.

## Measurements

All three restored reads agree: **2,663,972 script bytes, 5 modules, 34 requests**. The collector independently repeated the same three agreeing reads. Each restored sample landed on a visible board with zero clicks. The unchanged ceilings remain 2,664,076 bytes / 5 modules / 34 requests.

The fresh composer checkpoint varied: two reads captured **1,245,988 script bytes, 5 modules, 17 requests**, one captured **1,252,490 bytes, 6 modules, 18 requests**. Every read had 5 API requests and `architectureVisible: false`. This checkpoint is descriptive and is not ratcheted: an optional lazy request can race first-composer visibility. Median composer visibility was 270 ms. After one Architecture click all three full first-board windows agreed at **2,692,391 bytes, 9 modules, 41 requests**, median first node 1,516 ms and applied layout 1,696 ms. Timing is descriptive; the final fresh run shared CPU with the collector.

Raw reproducible data is filed alongside this report as `0184-finish-perf-restored.json`, `0184-finish-perf-fresh.json` and `0184-finish-perf-counts.json`. These are distinct scenarios; the fresh checkpoint is never substituted for the restored-board ratchet.

## Gates

| Command | Bare exit | Evidence |
| --- | --- | --- |
| `node --import ./tools/test-guard/no-real-binaries.mjs --test tools/measure/test/first-board-scenario.test.mjs tools/ci/perf-ratchet.test.mjs` | 0 | 21 positive/negative scenario, endpoint and ratchet tests |
| `pnpm measure:test` | 0 | 58 passed, 1 platform skip; includes the new scenario tests |
| `node --import ./tools/test-guard/no-real-binaries.mjs tools/measure/first-board.mjs --scenario restored-architecture --runs 3 --cold --out ../lane2-restored.json` | 0 | Three matching visible-board reads |
| Same command with `--scenario fresh --out ../lane2-fresh.json` | 0 | Untouched profile; separate composer checkpoint; three matching board totals |
| `node --import ./tools/test-guard/no-real-binaries.mjs tools/measure/perf-counts.mjs --out ../lane2-perf-counts.json` | 1 | Only `LOWER bootJsBytes: 2663972 ... ceiling 2664076`; modules, requests and render counts 1/1 pass |

Initial scenario and extracted-observer tests failed before their implementation (exit 1); red logs remain `lane2-perf-red.log` and `lane2-perf-observer-red.log` in the parent workspace. Current passing logs: `lane2-perf-tests.log`, `lane2-measure-tests.log`, `lane2-restored.log`, `lane2-fresh.log`, `lane2-perf-counts.log`.

The collector is intentionally not reported green: its byte ceiling needs a 104-byte reduction for this exact bundle. No ceiling was changed in this lane because the parent is merging additional product changes and must rerun three agreeing reads at the combined head before lowering it. No real import overhead remains above the module/request ceilings, so no speculative product refactor was made.

## Integration

Performance-only commits after trace evidence `df9ecf19a`: `d78e05ffb`, `da18bcead`, `4e7e2cc42`, `ff292a978`, `7327d7011`, followed by this evidence commit. Trace source stayed frozen. No source build ran during this performance slice.
