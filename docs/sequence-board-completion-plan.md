# Bounded board completion

End state: existing architecture annotations move persistently, active agent chips stay readable without covering board evidence, and the smallest default MCP catalog supports board discovery and drawing.

Base: `06f6cc2f657e395379acb282b45ec2897a6a7c73`; branch: `codex/sequence-board-completion`.

1. First shippable slice: Select tool and annotation drag. Gate: pointer gestures at non-unit zoom write moved coordinates once through the board store; switch/remount retains them; anchors, bound arrows, cancellation and blank clicks have controls. Commit before final targeted gate.
2. Collision packing: measured screen-space chips avoid other chips, cards and annotation bounds. Gate: adjacent agents at normal/far zoom, narrow and empty cases; inspect a browser specimen without model calls. Keep all activity/evidence visible. Commit and targeted gate.
3. Catalog: add only list_boards/create_board/draw to the existing core set; measure serialized tool listing and preserve honest write hints/instructions. Gate: core discovery, default-repo draw persistence, negative unknown-board control, all-catalog preservation. Commit and targeted gate.

Dependency order is 1 → 2 → 3. Only canvas/boards/**, AgentOverlay and own helpers/tests/styles, packages/mcp/** are code ownership. Analyzer/server, ACP, agent runtime/state, shell/files, chat/settings and other canvas layout files are out. Any analyzer change becomes an exact parent handoff request. No push, full suite, model/GPU, real user store/config/credentials, or subagents.

Owner asks: “select/drag existing architecture annotations with persistent moved coordinates”; “collision-safe agent chips at far zoom, don't hide evidence”; “list_boards/create_board/draw discoverable without allBoardTools default toggle using smallest measured catalog.” Unit/specimen verification is not whole-app acceptance.

## Completed slices and verification

Status: **DONE_WITH_CONCERNS**. Implementation within the assigned ownership is complete. The ACP permission handoff and whole-app/real-repo acceptance remain the parent's work.

| Slice | Commit | Evidence at committed head |
| --- | --- | --- |
| Annotation Select, preview, one persistent put | `ee255ab3f825d03115f3803a6d85d6f6771622da` | `pnpm --filter @sequence/web2 test -- src/canvas/boards/annotationDrag.test.tsx src/canvas/boards/boardsModel.test.ts src/canvas/boards/boardsSurfaces.test.tsx`: bare exit 0, 26 tests. `pnpm --filter @sequence/web2 build`: bare exit 0. |
| Parent review: lost capture, item changes, pane/camera changes, scoped hit test; real mounted SVG/text/sticky at .25/1 | `21d02496c0f9a72d11aa5cb2dfd3372b0a6fac23` | `pnpm --filter @sequence/web2 test -- src/canvas/boards/annotationDrag.test.tsx src/canvas/boards/completionRendered.test.ts`: bare exit 0, 13 tests. Parent independently reported the same gate exit 0 and integrated as `3c63cb94`. |
| Measured chip packing and links around cards, marks, connectors, labels and controls | `a83c53f3c10aad9367cf9822e2ea20e5037234d1` | `pnpm --filter @sequence/web2 test -- src/canvas/agentChipPacking.test.tsx src/canvas/boards/completionRendered.test.ts src/canvas/agentOverlayMount.test.tsx src/canvas/agentActivityBoard.test.tsx src/canvas/board3c.test.tsx`: bare exit 0, 25 tests. `pnpm --filter @sequence/web2 build`: bare exit 0. |
| Exactly seven default tools; honest write hints; default-repo board round trip | `9e66cd43bd40dfd45502608c994c6c674d7507fd` | `pnpm --filter @sequence/mcp build`: bare exit 0. `node --test packages/mcp/dist/test/coreBoards.test.js packages/mcp/dist/test/s2a-session.test.js packages/mcp/dist/test/boards.test.js packages/mcp/dist/test/mcpHygiene.test.js`: bare exit 0, 18 tests. |

Installation: `pnpm install --frozen-lockfile`, bare exit 0, own pnpm installation, no node_modules junction. Prerequisite compilation only: schema/ink, export/api-types/acp, analyzer `tsc`, all bare exit 0; no analyzer tests or server/model were launched. Test processes after the initial drag reproduction explicitly set `SEQUENCE_USER_DIR=C:/Users/<user>/Projects/seq-completion-board/.tmp/board-completion-user`. Browser runs use fresh isolated headless contexts and only their own HTTP specimen. Each MCP storage test owns its temporary repository.

Fail-before controls: annotation gate on base = bare exit 1 (7/8 failures: missing Select/no moved writes); chip integration test before packing = bare exit 1 (no screen-space callouts); core catalog/default-board gate before catalog change = bare exit 1 (missing list_boards and only four tools). The rendered chip gate also caught an incorrectly measured full-pane furniture wrapper; it was corrected to the actual controls. A browser specimen request for 10% zoom timed out because the production camera floor is 25%; the rendered gate now tests the actual 25% floor. Pure packing additionally exercises 10% geometry without claiming that the UI camera can reach it.

Catalog measurement reads **actual SDK tools/list JSON including schemas/annotations**, with session repo defaulting: four original reads 1,197 tokens; seven default tools 2,013; all 19 tools 4,875 (ceil(chars / 4), not tokenizer output). Exact membership and a 2,200 budget are locked. Server entry selection already uses core; no allBoardTools flip or analyzer source patch is necessary.

Final source diff: `git diff --check 06f6cc2f6..HEAD`, bare exit 0. All implementation commits resolve, use `maxnaid1 <maxnaid41@gmail.com>`, and have no trailers. No push. Changed code is confined to canvas/boards/**, AgentOverlay plus its new agentChipPacking helper/styles/test, and packages/mcp/**. The only other files are this plan and [the exact runtime handoff](sequence-board-runtime-handoff.md).

## Limits and parent handoff

- A fully occupied viewport cannot fit every full chip while avoiding every obstacle. `packChip` returns null; the original full chip stays and the node gains `data-agent-chip-overflow=true`. No activity/evidence is discarded, but that capacity case is **not** a collision-free claim. A reserved overflow rail needs a parent-owned canvas layout decision. Adjacent-agent fixtures at 900/360px and 100%/25% zoom pass; a whole-app dense real-repo acceptance sweep was not run.
- Moving a bound arrow deliberately releases its endpoint bindings; Select's tooltip states this. Anchored mark offsets and by/identity remain intact.
- Browser screenshots were inspected. Committed-head rendered artifacts: `C:/Users/<user>/AppData/Local/Temp/seq-board-completion-shots-nG4QqR/` (drag-0.25.png, drag-1.png, chips-900-1.png, chips-900-0.25.png, chips-360-1.png, chips-360-0.25.png). These are temporary specimen evidence, not actual user-screen capture or production data.
- Web build emits circular-chunk/size and prerender canvas warnings, but exits 0. No assertion here that those unrelated warnings are repaired or full gates pass.
- ACP at parent 4df3d864 still treats the sequence server as entirely read-only and automatically accepts every sequence elicitation. The exact tool allowlist/empty-form consent gate and its replay controls are filed in `docs/sequence-board-runtime-handoff.md`; runtime must gate that patch and rebuild the packaged MCP bundle before claiming provider drawing complete. No live model, real configuration/credentials/userstore, full suite, subagent, or runtime source was used or changed.
