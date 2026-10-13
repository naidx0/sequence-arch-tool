# Backend route shapes the UX branch builds against (from the backend chat, 2026-10-12)

## Git (wip/018-git)
- `GET /api/git/branches` -> `{ current|null, detached, sha, branches:[{ name, upstream?, ahead, behind, against?, lastCommit:{ sha, subject, date } }], remoteBranches:[{ name, remote:true, lastCommit }], dirty }`
- `POST /api/git/switch { branch, create?, from? }` -> 200 `{ ok, branch, sha, created, changed, previous, rescan }` | 409 `{ ok:false, reason:'dirty'|'exists'|'git', error, files? }` | 404 | 400
- `GET /api/git/branch-changes?base=` -> `{ branch, base, mergeBase, head, files:[{ path, oldPath?, status:'A'|'M'|'D'|'R', added, removed, committed?, staged?, unstaged?, untracked? }] }` (per-branch file symbols)
- `GET /api/git/diff?scope=unstaged|staged|worktree|branch|commit` (Review "Unstaged" sends `unstaged`)
- SSE `GET /api/git/events`: `git:head { branch, sha, detached, previous, rescan }`, `graph:updated { reason:'git:head', branch, sha }` -> re-fetch the board
- Client helpers: `packages/web2/src/git/gitClient.ts`

## Update (wip/018-update)
- `GET /api/app/update` install job adds `installMode 'in-place'|'dmg'`, `mode 'differential'|'full'`, `downloaded`, `fullSize`, `reused`, `fallbackReason`, `received/total`.
- In-place finishes when the app quits: "Restart now" calls the existing shell action `quit` (`sequence:shell`).
- `versionModel.ts:86` copy says "installer is running"; should say it installs when Sequence quits.

## Context (merged on backend/0.1.8)
- `chatContext(runs, sessionId, agentRef)` in `agents/contextMeter.ts` is the one source for the bar and the Agents pane.

## Components
- Contract in `components-ui-contract.md`, plus `component:skipped { turnId, componentId, reason }`.

## Board items (wip/018-tools; wins over wip/018-spaces store changes at merge)
- `kind:'shape'`, `shape = rect|ellipse|diamond|line|arrow|path|frame`; optional `points [{x,y}]` (path: polyline, absolute board coords).
- `stroke`/`fill` are palette NAMES mapped to CSS vars: ink->--ink-1, muted->--ink-3, accent->--accent, positive->--fits, warning->--spills, danger->--wont, info->--info, chart1..6->--viz-1..6, fill surface->--surface-2, none->transparent; `#hex` only when `ownTheme:true` (use raw).
- `strokeWidth` 1-8; `dash` solid|dashed (6 4)|dotted (1.5 4 round); `arrowStart`/`arrowEnd` none|arrow|dot|bar; `labelPos` center|top|bottom|left|right; `fontSize` sm 12|md 14|lg 17; `label` (frame: title band 36px, no fill by default); `group` (items sharing a group are one diagram).
- `kind:'text'` gains `color`, `fontSize`, `ownTheme`.
- NEW `kind:'svg' {id, at:{x,y}, w, h, svg (sanitized, no <style>, ids prefixed), label?}`: render inline in a w x h box (not <img>) so currentColor/var(--ink-1) follow the theme; width/height 100% via viewBox. `boardsModel.itemBox` needs an 'svg' case.
- Renderer gap today: Whiteboard.tsx ~2254 sends every non rect/ellipse/diamond shape down the line branch; nothing reads stroke/fill/dash.

## Settings rows (wip/018-claims)
- "Check for updates" switch: `PUT /api/agent-settings {updates:{check:boolean}}`, GET returns it; when off, `GET /api/app/update` returns cached state with `checkDisabled:true` and only an explicit Check now fetches.
- Web plugin switch: agent-settings key `web.enabled` (default on) gates web_fetch/web_search for both engines.
- `GET /api/agent-settings` returns `tools:{all, core, allTokens, coreTokens}` (23 tools / 5726 tokens all; core measured from MCP) for the "every board tool" row copy (replaces the UI's optional `boardTools {total, default}` field).

## Spaces extras (wip/018-spaces-be)
- `scene` items in the store (contract as sent; dangling targets tolerated; at most 500 keyframes), a `draw` op for agents to author scenes, a poster in the server render. Flip `SCENE_ON_SERVER` to true when merged.
- `video` item kind `{at, w, h, src (repo-relative .mp4/.webm/.gif), poster?, label?}`, Range-served files.
- `GET /api/boards/:board/render.svg?group=` (inline preview from the Space), `GET /api/workflows/:id/render.svg`.
- `POST /api/services/:id/flows {audience}`: generates a grounded admin/customer flow onto a Space (the node panel's "Generate workflow" can call it).

## Export, readPaths, flows response (backend answers, 21:56)
- `GET /api/export?format=mermaid-flow|matrix-csv|arch-md` -> 200 `{ format, filename, mime, content: string }` (mermaid-flow text/plain, matrix-csv text/csv, arch-md text/markdown); 400 unknown format; 409 no scan.
- `StoredAgentRun.readPaths: string[]` (repo-relative, <= 400; reads/searches/map/find_files). web2 `AgentRun.readPaths` filled in agents/agentRunFold.ts and agents/savedRuns.ts; `coverageFromRun(run, graphFacts)` in chat/coverageLine.ts; AgentRunView renders the coverage line (backend, wip/018-agentparity). UI part left: light the answer path on the map by mapping readPaths to services with graphFactsOf.
- `POST /api/services/:id/flows` -> `{ board, group, steps, grounded: { routes, edgesFromCode }, notes }`. Read `board` and `group`.
