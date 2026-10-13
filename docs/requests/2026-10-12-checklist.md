# 2026-10-12 request: claim checklist

The UX chat's own claim map is `2026-10-12-checklist-ux.md` (same claims, UI side).

Every claim in `2026-10-12-jaden.md`, numbered, with its owner and status. Two chats split the work:
**BE** = backend chat (branch `backend/0.1.8`), **UX** = the "Sequence 0.1.8 UX" chat. Status is one of
`open`, `in progress`, `done` (with evidence), `UX` (owned by the UX chat, tracked there), `not done` (with why).

## Components (skills shipped natively)
| # | Claim | Owner | Status |
|---|---|---|---|
| C1 | "Components": a native layer over skills and plugins so users don't keep adding them by hand | BE | done: components engine merged (47743935) after three Opus reviews; UX ships the cards and menu |
| C2 | Ship key components with updates (REA as the example) instead of grabbing skills from GitHub per project | BE | done: 38 components ship inside the app bundle; packaging fails if they are missing (8095ed14) |
| C3 | Turn components off in settings; a slash command to turn them off | BE (engine, command) + UX (settings row) | done: enabled switch + /components off; UX adds the Settings row |
| C4 | `/components` command to add components | BE | done: /components list, on, off, auto, approve, manual, <id> |
| C5 | The + next to the chat box loads/imports components | BE (API) + UX (menu) | done (API): add/remove to workspace + components:[id] in the ask; UX renders the + menu |
| C6 | Not loaded by default; loaded at runtime as tools (context stays small, may be a little slower) | BE | done: nothing injected by default; the components MCP tool loads text at runtime, paged |
| C7 | Topic triggers (e.g. "reverse engineer", "how an application works") make the component an option the model can opt into | BE | done: stem-tolerant ordered triggers, incl. "reverse engineer" and "how an application works" |
| C8 | Approval card "Use the reverse engineering tool? Yes / No, regular workflow"; never the default | BE (event) + UX (card) | done (events): component:offer, accept/decline route, component:used/skipped; UX renders the card |
| C9 | Three modes: auto-implement (model picks and runs), approval cards, off (only in the + menu, not recommended) | BE | done: auto / approve / manual; reverse engineering always asks |
| C10 | Label them like design elements; big components hold sub-components (which are skills) | BE (catalog) + UX (labels) | done: 5 groups; Interface design parent with sub-components |
| C11 | Integrate the listed open-source skills as native SKILL.md components; wrap plugins/MCP/plain repos as skills | BE | done: 38 components vendored at pinned commits (8665918d) |
| C12 | Check licenses; skip or flag those without one (design-review, RSI-Anything) | BE | done: 11 repos shipped with their licenses; design-review and remotion-dev are link-only (no license) |
| C13 | REA: review before enabling (security tooling) | BE | done: Opus security review; shipped with 5 edits, a safety preamble, offer-only (docs/research/rea-security-review.md) |
| C14 | Verify halo fine-tune skill location (unconfirmed) | BE | done: confirmed 10 Halo skills; shipped with the Halo license and a clone-first preamble |
| C15 | Deeper component support inline and on the surface (visual, video: Remotion; RSI workflow loops in the agentic workflow) | BE (tools) + UX (render) | done: video, scene, svg and workflow-loop support in Spaces (render, store, MCP); UX renders |

## Spaces (AI Canvas / whiteboard)
| # | Claim | Owner | Status |
|---|---|---|---|
| S1 | Better inline drawings (t3 code style examples) | UX | UX |
| S2 | Models need more tools to draw on the board: colours, lines, compose diagrams | BE | done: palette colours, stroke width, dashes, arrowheads, paths, frames, compose (96fce4a2) |
| S3 | Remove background dots; blank like tldraw; grid toggle in the toolbar/three dots; clean dark grey | UX | UX |
| S4 | Host an SVG (e.g. Anatomy) in the whiteboard area | BE (tool) + UX (render) | done: sanitized svg board item (96fce4a2) |
| S5 | Closing/deleting the whiteboard errors and does not close the surface; must auto-close | UX | UX |
| S6 | Surface elements viewable inline with "Open on surface"; whiteboard is the source of truth | BE (shared model) + UX | done: inline preview rendered from the Space (render.svg), open-on-surface from the draw result |
| S7 | Rename to Spaces: whiteboard with more creativity; ship AI Canvas as Spaces | UX (surface) + BE (tool support) | done (backend): Spaces tools merged; UX ships the Spaces surface |
| S8 | Remotion video in Spaces: prompt keyframes, pause, inline | BE (component) + UX | done: video + native scene items, /api/media with Range; Remotion component renders to .sequence/media |
| S9 | Links to files in inline output don't work; must follow the path | UX | UX |
| S10 | Workflow loops (RSI) drawn in the agentic workflow, inline too | BE (tool) + UX | done: workflow loops render inline (workflows/:id/render.svg) |
| S11 | Guidelines/rules so inline SVG follows app theme, buttons, colours, font (unless the user's own project) | BE (prompt rules) + UX (tokens) | done: theme rules in the drawing tool guidance (96fce4a2) |

## Shell, layout, chat
| # | Claim | Owner | Status |
|---|---|---|---|
| U1 | macOS traffic lights blend into the Sequence title; add top buffer | UX | UX |
| U2 | Don't over-condense surface icon/name spacing | UX | UX |
| U3 | Agents pane loads every question; show the last 5 prompts, "show more" per 5 | UX | UX |
| U4 | Status bar spacing: file name and status symbol (idle, working) | UX | UX |
| U5 | Model picker slider animated, smoother; spacing around the white circle | UX | UX |
| U6 | Skills page: shorter definitions, hover to add/edit/remove from workspace | UX | UX |
| U7 | Explain "every board tool" vs "map in agent context"; what "turn" means; auto-compaction summary explained | UX (copy) + BE (facts) | done: plain explanations from real token numbers; map-to-agents sub-setting explained |
| U8 | Onboarding for the map like skills: click-through, example of context cost (500k sample, large vs off) | UX | UX |
| U9 | Workflow buttons want a bit more wow | UX | UX |
| U10 | Review working tree: quick icons in the three dots at the top of the chat; drop the extra page; Cmd/Ctrl+K already bottom left | UX | UX |
| U11 | Tree and timeline don't switch between each other | UX | UX |
| U12 | Surfaces sort by name, not recency | UX | UX |
| U13 | Diff board: scrollable changes, easier to reach, colouring, grid readability, icon centering | UX | UX |
| U14 | Map as detailed as can be; expand a service; subsurface "Generate workflow" (admin vs customer flow) | UX (surface) + BE (generator) | done: grounded admin/customer service flows (POST /api/services/:id/flows); UX wires the button |

## Backend fixes
| # | Claim | Owner | Status |
|---|---|---|---|
| B1 | Context counter wrong (15M), Agents and chat don't sync, swings 50k on a near-identical prompt; test hard | BE | done: cumulative total no longer shown as context; one function for bar and pane; stable thread prefix (edb2864f) |
| B2 | Files show status symbols for the current branch | BE (status API) + UX | done: per-branch file status route (e3620b52) |
| B3 | Branch switch must update the architecture board; a git interface for switching branches | BE (rescan + API) + UX (picker) | done: branch switch route + HEAD watcher rescans the board, incl. terminal switches (e3620b52) |
| B4 | macOS update re-downloads the whole package; fix if not an Apple limit | BE | done in code: zip + blockmap partial download, in-place swap (e8a90bd3); verified at release |
| B5 | Cmd+C / Cmd+V don't work on Mac | BE | done: Edit menu on Mac (c112fdf0) |
| B6 | Terminal sometimes loads blank; must always initialise in the project path | BE | done: early input held, size clamped, path verified, retry (c112fdf0) |
| B7 | Deleting needs Enter/Cmd+Enter; delete chat doesn't work on Mac | BE | done: in-app confirm, mouse-only delete, no double fire (c112fdf0) |
| B8 | Study Pi (lean editor, benchmark leader); map gaps; improve | BE | done: study + changes merged (docs/research/pi-and-opencode-study.md) |
| B9 | Why Jaden trusts a Codex harness more than our agent; make it measurably better (A/B) | BE | partial: trust changes merged; sealed 32-task cheat-proof A/B harness; the model run is pending a free GPU |
| B10 | Browser: ship as a free plugin, no keys, study OpenCode | BE | done: keyless web_fetch + web_search for Claude, Codex and the built-in model (96fce4a2) |

## Process
| # | Claim | Owner | Status |
|---|---|---|---|
| P1 | Use the "Sequence advantages and paper breakdown" plan (claims-audit PLAN.md) for this round | BE | done: the claims-audit plan is the backbone (sections below) |
| P2 | Two chats (backend, UX); hard-task workflow; parallel builders; heavy review and gating between merges | BE | done: two chats, hard-task workflow, up to 3 builders, an Opus review on every merge |
| P3 | Save the prompt; at the end re-read it and confirm each item | BE | in progress: saved; final re-read at release |
| P4 | AI Canvas: ship (as Spaces). Browser: ship. Decided, don't ask again | BE + UX | done (backend): Spaces and browser shipped on the server; UX ships the surfaces |

## Claims-audit plan (Jaden: use it as the backbone; his Oct 12 message wins where they differ)
Backend phases of `_cloud-handoff/claims-audit/PLAN.md`. UX-facing parts (ux.md, surfaces.md UI) are the UX chat's.
| # | Plan item | Owner | Status |
|---|---|---|---|
| Q0.1 | `docs/claims.json` registry + `tools/ci/claims.test.mjs` (symbols exist, tests exist, deny-list) | BE | done: docs/claims.json + tools/ci/claims.test.mjs |
| Q0.2 | Fix the false words: A5, F4, T3, L2, U80/U81, V13, V19, V25, U26 | BE | done: false words fixed or scoped |
| Q1.1 | Four-part update versions (0.1.7.1) | BE | done: four-part versions + app-build.json |
| Q1.2 | Cursor rules in skill discovery | BE | done |
| Q1.3 | `serve` binds loopback | BE | done |
| Q1.4 | Tool counts derived: `toolListingTokens()` + settings payload (UX renders) | BE | done: real counts in the settings payload |
| Q1.5 | Review: real unstaged vs staged split, `scope=unstaged` (UX renders) | BE | done (e3620b52) |
| Q1.6 | Short flows top to bottom (A/B gated) | BE | open: A/B-gated layout change, not run |
| Q1.7 | Privacy copy + "Check for updates" switch route (UX renders) | BE | done: updates.check stops every automatic GitHub call |
| Q2.1 | Map in Claude/Codex context once per thread | BE | partial: built; opt-in (mapToAgents) until its A/B wins (669561f8) |
| Q2.2 | Coverage line for agent runs: `readPaths` per run | BE | done: coverage line for Claude and Codex runs (669561f8) |
| Q2.3 | /goal on Claude and Codex | BE | done: /goal on Claude and Codex in an open project |
| Q2.4 | Handoff to the built-in model carries agent turns | BE | done (669561f8) |
| Q2.5 | Refine note card for every chat; tighten "twice" | BE | done: card in every chat; wording made accurate |
| Q2.6 | find_files first (hook) or scope the words | BE | open: hook not built; words already scoped |
| Q2.7 | Publish agent-side token cost | BE | open: agent-side token measurement not run |
| Q2.8 | Memory summary route | BE | done: /api/memory/summary + Settings card (669561f8) |
| Q3.6 | Export routes from the app (UX renders) | BE | partial: GET /api/export merged; the board menu entry is the UX update |
| Q3.10 | AI Canvas and Browser: ship (decided) | BE + UX | done: decided ship |
| Q4.4 | Update notice at launch, silent install (routes) | BE | in progress: verified during the release |
| Q4.1-4.7 | Windows CI, CLI install, signing (needs key: owner), Linux smoke, proxies | BE | open: Windows CI, CLI install, signing (needs Jaden's key), Linux smoke, proxies |
| Q5.1-5.4 | Chat full-text search, in-place workspace switch, prefs on server, default local model | BE | open |
| Q6.1-6.7 | Evidence runs for real-but-unproven claims | BE | open: evidence runs need models |

## Release (Jaden, 2026-10-12 22:12: "do the final work, gate everything and push to main with packages ready and updates ready and working")
| # | Claim | Owner | Status |
|---|---|---|---|
| R1 | Build everything buildable in parallel; be thorough | BE + UX | in progress: Spaces done; platform, product and agents waves building |
| R2 | Integrate backend + UX, one full gate | BE | in progress: integrate/0.1.8 = backend + UX (Sketch, panel, stage merged) |
| R3 | Push to main | BE | open |
| R4 | Installers for Windows, macOS, Linux built and published (v0.1.8) | BE | open |
| R5 | Updates work from 0.1.7 to 0.1.8, including the Mac partial update | BE | open |
