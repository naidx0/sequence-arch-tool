# 2026-10-12 request: claim checklist

Every claim in `docs/requests/2026-10-12-jaden.md`, numbered. Owner **UX** is this branch
(`ux/0.1.8`); owner **BE** is the backend chat ("Sequence 0.1.8 backend"); **UX+BE** means the
backend ships the engine and this branch ships its UI. Status: `open`, `building`, `done`
(with commit and screenshot), `dropped` (with the reason).

## A. Components

| # | Claim | Owner | Status | Evidence |
|---|---|---|---|---|
| A1 | New feature "Components": native skills/plugins so users do not keep adding them by hand | BE | open | |
| A2 | Ship key components with updates (REA reverse engineer as the first example) | BE | open | |
| A3 | Turn components off in Settings | UX | done | merge d2dc9103; shots/settings |
| A4 | `/components` slash command to add components | UX | done | merge ca1c9afe; shots/chat |
| A5 | Load components from the composer `+` menu | UX | done | merge ca1c9afe; shots/chat |
| A6 | Components load at runtime as tools, not in context by default | BE | open | |
| A7 | Trigger words ("reverse engineer", "how an app works") make the component an option the model can opt into | BE | open | |
| A8 | Approval card: "Use the reverse engineering tool? Yes / No (regular workflow)"; never the default | UX+BE | done | merge ca1c9afe; shots/chat |
| A9 | Group as big components (e.g. "Design elements") with sub-components (the skills) | UX+BE | done | Components picker groups (e.g. Design elements) with sub-components; engine on backend |
| A10 | Setting "Auto-implement components": model picks and runs on its own | UX+BE | done | merge d2dc9103; shots/settings |
| A11 | Setting "Approval cards": when not auto, show a card | UX+BE | done | merge d2dc9103; shots/settings |
| A12 | When "use components in workflows" is off, components live only in `+`, not recommended | UX+BE | done | merge d2dc9103; shots/settings |
| A13 | Skill packs from the list (Jakub pack, make-interfaces-feel-better, OKLCH, taste, impeccable, design-review, flornkm, anatomy, remotion, grilling, claude-api, halo, RSI-Anything, REA) as SKILL.md; wrap plugins/MCP/repos; check licenses first | BE | open | |

## B. Inline drawings and Spaces

| # | Claim | Owner | Status | Evidence |
|---|---|---|---|---|
| B1 | Better inline drawings in chat (T3 Code-style examples) | UX | done | B8/B11/B12/B13 merged: inline charts, drawings, loops, scene previews, theme rules |
| B2 | Board: models need more drawing tools | UX+BE | done | merge 04bb6eb0; Spaces toolbar colours/groups/frames; agent draw tools on backend branch |
| B3 | Remove the background dots; blank tldraw-style dark-gray ocean by default | UX | done | merge 04bb6eb0; shots/spaces |
| B4 | Grid on/off option in the toolbar or three-dots menu | UX | done | merge 04bb6eb0; shots/spaces |
| B5 | Agent tools to add colors, draw lines, compose diagrams | UX+BE | done | merge 04bb6eb0; renderer reads backend board-item contract; agent ops on backend branch |
| B6 | Host the anatomy SVG in the whiteboard | UX | done | merge 04bb6eb0; shots/spaces |
| B7 | Closing/deleting the whiteboard errors and does not close the page; deleting the last one must close the surface | UX | done | merge 04bb6eb0; shots/spaces |
| B8 | Surface elements viewable inline, with "Open in surface"; source of truth stays on the board | UX | done | merge ca1c9afe; shots/chat |
| B9 | Rename Whiteboard to **Spaces**, a more creative surface | UX | done | merge 04bb6eb0; shots/spaces |
| B10 | Remotion video in Spaces: prompt it, keyframes, pause; works inline simply | UX+BE | done | merge 04bb6eb0; native scene: keyframes, play/pause, scrub, Export as Remotion, inline preview; stored locally until backend scene store merges |
| B11 | File links in chat do not work; paths must be followable | UX | done | merge ca1c9afe; shots/chat |
| B12 | Agentic workflow loops (RSI-Anything style) drawn inline and in the workflow surface | UX | done | merge a26d0bab; shots/loops |
| B13 | Rules so inline SVG/art follows the app theme, buttons, colors and font (unless the user's own project asks otherwise) | UX | done | merge ca1c9afe; shots/chat |

## C. Shell and surfaces

| # | Claim | Owner | Status | Evidence |
|---|---|---|---|---|
| C1 | Mac traffic lights blend into the Sequence title; add top buffer | UX | done | merge 6496bd05; shots/shell |
| C2 | Surface icon/name spacing not over-condensed; keep the fade | UX | done | merge 6496bd05; shots/shell |
| C3 | Surfaces sort by title, not recency | UX | done | merge 6496bd05; shots/shell |

## D. Agents and context

| # | Claim | Owner | Status | Evidence |
|---|---|---|---|---|
| D1 | Agents shows only the last five prompts; "Show more" adds five at a time | UX | done | merge 00556e54; shots/agents |
| D2 | Agents status bar spacing: file name vs status symbol (idle, working) | UX | done | merge 00556e54; shots/agents |
| D3 | Agent context and real context do not sync; "15 million" context is unexplained | BE | open | |
| D4 | Context jumps 50k mid-prompt in the same chat and model; test it hard | BE | open | |

## E. Files, diff, map, branches

| # | Claim | Owner | Status | Evidence |
|---|---|---|---|---|
| E1 | Files show status symbols for the current branch | UX | done | merge 689ed445; shots/files |
| E2 | Branch view shows exactly what changed | UX | done | merge 689ed445; shots/files |
| E3 | Diff page: scrollable changes, easier to reach | UX | done | merge 689ed445; shots/files |
| E4 | Diff page: writing, coloring, icon centering in buttons, easier to track diffs, readable grid; keep the "against main" metric and the architecture flow | UX | done | merge 689ed445; shots/files |
| E5 | Map as detailed as possible, also when expanded | UX | done | merge 689ed445; shots/files |
| E6 | Node click opens a sub-surface with AI analysis and a "Generate workflow" button (admin vs customer flows, page to page) | UX+BE | done | merge 689ed445; shots/files |
| E7 | Easier branch switching with a small git workflow UI | UX | done | merge 689ed445; shots/files |
| E8 | Switching branch updates the architecture board | UX+BE | done | merge 689ed445; shots/files |

## F. Pickers, skills, workspace, onboarding

| # | Claim | Owner | Status | Evidence |
|---|---|---|---|---|
| F1 | Model picker slider animates smoothly instead of snapping | UX | done | merge 6496bd05; shots/shell |
| F2 | Spacing around the white thumb on the blue track | UX | done | merge 6496bd05; shots/shell |
| F3 | Skills page: condensed, one short line per skill | UX | done | merge 00556e54; shots/agents |
| F4 | Hover a skill to add, edit or remove it from the workspace | UX | done | merge 00556e54; shots/agents |
| F5 | Workspace copy: explain "give coding agents every board tool" vs loading the map into context; what a turn costs (~4k per turn) | UX | done | merge d2dc9103; shots/settings |
| F6 | Explain auto-compaction (summary on compact) | UX | done | merge d2dc9103; shots/settings |
| F7 | Onboarding: the map buttons explained like skills, with real examples (500k context on vs off, what it looks like) | UX | done | merge d2dc9103; shots/settings |

## G. Platform and bugs

| # | Claim | Owner | Status | Evidence |
|---|---|---|---|---|
| G1 | Updates download the whole package instead of a delta (Mac) | BE | open | |
| G2 | Cmd+C / Cmd+V do not work on Mac | BE | open | |
| G3 | Study Pi's lean editor, map against us, plan improvements | BE | open | |
| G4 | Terminal sometimes loads blank; cwd must initialize | BE (UX fallback) | done | merge d2dc9103; shots/settings |
| G5 | Workflow buttons need more "wow" | UX | done | merge d2dc9103; shots/settings |
| G6 | Deleting needs Enter/Cmd+Enter; deleting chats fails on Mac | BE | open | |
| G7 | Working tree review: easier to orient | UX | done | G8 quick icons: Undo, Working tree, Find in files in the chat header |
| G8 | Three-dots at top of chat becomes quick icons (undo, working tree) | UX | done | merge 6496bd05; shots/shell |
| G9 | Find text in file / in project, in the files space | UX | done | merge e3f7f6a5; shots/find |
| G10 | Cmd/Ctrl+K lives bottom-left; remove other entry points; check why it opens differently | UX | done | merge 6496bd05; shots/shell |
| G11 | Tree and timeline do not switch; fix and make it easier to monitor | UX | done | merge 00556e54; shots/agents |
| G12 | Trust vs a Codex harness: find what to change | BE | open | |
| G13 | AI Canvas ships (it is Spaces); browser ships, free, no keys, open-source | UX+BE | building | Spaces surface + web search switch merged d2dc9103; backend owns web plugin |

## H. Process

| # | Claim | Owner | Status | Evidence |
|---|---|---|---|---|
| H1 | Use the "Sequence advantage and paper breakdown" plan for this turn | Both | done | advantages plan folded in as section I |
| H2 | Two chats: backend and UX | Both | done | this branch + backend chat |
| H3 | Hard-task workflow, parallel builders, heavy review and gates | Both | done | hard-task workflow: Sonnet builders, Opus reviewers per package, gates per merge |
| H4 | Save the prompt; re-check every item at the end | Both | building | this file |

## I. From the advantages plan (claims audit, 2026-10-12), UX-facing items

Source: `_cloud-handoff/claims-audit/PLAN.md`, `surfaces.md`, `ux.md`. Where the plan and
Jaden's message disagree, the message wins. Backend owns the plan's agent, install and update
engine items.

| # | Claim | Owner | Status | Evidence |
|---|---|---|---|---|
| I1 | Charts from `propose_chart` render inline in the chat turn (plan 3.1, surfaces P1); pairs with B8 | UX | done | merge ca1c9afe; shots/chat |
| I2 | AI Canvas ships as Spaces; plans and lesson charts stop going to a hidden surface (plan 3.10; Jaden: ship) | UX | done | merge 04bb6eb0; AI Canvas ships as Spaces surface |
| I3 | Teach reachable as a mode row and `/teach` (plan 3.2, surfaces P4) | UX | done | merge a26d0bab; shots/loops |
| I4 | Architecture-board Sketch uses the grouped shape model (plan 3.3, surfaces P2) | UX | done | merge ad242c9a; shots/board; offline A/B not run (sealed stroke data absent) |
| I5 | Drawn edge promoted when the scan finds it (plan 3.4, surfaces P3) | UX | done | merge ad242c9a; shots/board; offline A/B not run (sealed stroke data absent) |
| I6 | Files shows functions/symbols and clicks play the flow (plan 3.5, surfaces P5 option A); pairs with E1 | UX | done | merge 1e80359b; shots/files 05 |
| I7 | Export Mermaid / matrix / architecture note from the board menu (plan 3.6, surfaces P6) | UX+BE | done | merge 6186d41b; export rows in board menu |
| I8 | Review "Unstaged" shows real unstaged changes (plan 1.5, surfaces P9); pairs with G7 | UX+BE | building | backend owns (reviewClient unstaged) |
| I9 | Tool count copy in AgentMapSetting derived, not "All 16 tools" (plan 1.4/T3); pairs with F5 | UX+BE | done | merge d2dc9103; shots/settings |
| I10 | Coverage line under agent answers (plan 2.2) and answer path lit on the map (plan 3.9): UI render | UX+BE | done | merge 6186d41b; Show what it read lights services; coverage line on backend branch |
| I11 | Update notice in the status bar and an update-check switch (plan 4.4, 1.7): UI | UX+BE | done | merge d2dc9103; shots/settings |
| I12 | Short whiteboard flows top to bottom (plan 1.6, surfaces P8): A/B gated diagram change | BE | open | |
| I13 | Snap default Auto (plan 3.7, surfaces P7): A/B gated, needs people drawing | UX | dropped | gate needs people drawing with a mouse, and the sealed stroke set is not on this machine; default stays Suggest |

## Deferred (2026-10-13)
- I13 snap default Auto: its gate needs people drawing with a mouse, and the sealed stroke set is not on this machine. Default stays Suggest.
