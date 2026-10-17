# Board + session seat-walk — fulfillment plan

Owner feedback (2026-08-26), consolidated from two messages. This is the execution checklist for branch `mxcr/board-session-trap-3669`.

## Owner quotes → Done when

| # | Owner quote (paraphrased) | User-seat Done when |
|---|---------------------------|---------------------|
| 1 | Video didn’t show it; double-check repo/workspace escape is easy to assess and open | Leave project, Default workspace, and folder switch are obvious in Settings → Workspace and repo menu; demo video shows each path |
| 2 | Cursor mobile Exploring / Planning / Thinking / Working + ASCII + colored pot behind live status | Live work rows show one of those four words, cycling ASCII glyph, accent-tinted pulsing background; Reasoning fold uses same treatment |
| 3 | Still want context window visible for Chat users | Context ring + compact token label in composer; usage line shows `N of M` when window is known |
| 4 | Settings → Workspace: click project/folder icon to switch; Default workspace → chat home / all sessions | Workspace section has folder row (opens attach), Default workspace button (detach), current repo name with icon |
| 5 | Too many node kind signals — tags, entry double-icons, scattered layout | One header row: tinted kind icon left, title, expand right; no kind tag at rest; no entry second icon |
| 6 | Board notes too lowercase / off-putting | Service/datastore labels title-cased at first glance when scan gives bare ids |
| 7 | Index rail gap + expands too far; kind color on icon only | Rail width capped; header/body gap tightened; icons carry kind tint, unified card chassis |

## Inverted-fix ban

- Do NOT add more kind chrome (tags, silhouettes, legend clutter) to fix readability — subtract signals.
- Do NOT hide context window when model is configured but usage not yet metered.
- Do NOT remove attach/detach — make Settings actions real buttons.

## Locking tests

- `NodeCard.test.tsx` — no `.nd-k` at rest; single icon in header; no entry `.right` glyph
- `lod.test.ts` — `kindTag: false` at all rungs (selected-only if kept)
- `workRowModel.test.ts` — Exploring / Planning / Thinking / Working vocabulary
- `settingsSections.test.ts` — default-workspace + open-folder section ids
- `ContextRing.test.tsx` — ring visible with published window, zero usage

## Files

| Area | Files |
|------|-------|
| Settings workspace | `settingsSections.ts`, `SettingsPanel.tsx`, `App.tsx` |
| Live status / ASCII / pot | `workRowModel.ts`, `WorkRowLine.tsx`, `WorkProofStack.tsx`, `ThinkingMark.tsx`, `chat.css` |
| Context window | `ContextRing.tsx`, `Composer.tsx`, `chat.css` |
| Node cards | `NodeCard.tsx`, `board.css`, `lod.ts`, `project.ts`, `kinds.ts` |
| Index rail | `shell.css`, `rail.css`, `App.tsx` |
| Tests | files above + `boardRendered.test.ts` silhouette expectations |

## Verification

1. `pnpm --filter @sequence/web2 test`
2. `pnpm --filter @sequence/web2 build`
3. Manual: shopfront at `:4173` — repo menu, Settings workspace buttons, board cards, index rail, live ask status, context ring
