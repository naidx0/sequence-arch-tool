# Sequence completion coverage — independent R9 audit

Date: 2026-10-07. Subject: `r9/audit`, base `e61bc5e59bbe2b512075397a161cfa2f11f0e8b3`. Initial source audit, filed early for the parent to dispatch disjoint work. This is **not** an acceptance report for another R9 builder's branch.

## Boundary and evidence

Read the parent `C:/Users/<user>/Projects/seq-overhaul/docs/sequence-completion-plan.md`, local `lab/specs/round7-walkthrough.md`, `lab/specs/reskin-mix.md`, `lab/specs/r8-boards.md`, relevant S1–S7/R6–R8 entries in `lab/log.md`, and the production entry/mounts and source paths below. The 33 numbered requests are the parent's reconciliation, not a claim to have recovered every historical chat verbatim. Later owner requests absent from those documents remain unverified.

Statuses: **implemented** = bounded behavior is present and reachable in source; **unverified** = source exists but the requested result requires runtime/owner-seat evidence; **broken** = a concrete source contradiction or documented baseline failure; **missing** = no implementation/reachable control in the inspected production path. A passing unit test is not a usability pass. No app launch, real-provider run, credentials, install, GPU, or full gates were used. Existing log screenshots are historical, not fresh evidence at this head.

Paths below are repo-relative. Main entry is `packages/web2/src/main.tsx` → `app/App.tsx` → `v3/V3App.tsx` → `shell2/Shell2.tsx`; there is no independent URL page router in this entry. Shell state controls pages and overlays.

## Immediate board/onboarding handoff

These are distinct, actionable gaps. Do not conflate draggable architecture **nodes** with movable architecture **annotations**, or an existing worktree's actions with creating the **first** worktree.

| Priority | Exact missing/broken path | Evidence and next independently shippable slice |
| --- | --- | --- |
| P0 | First worktree creation from a clean project | `shell2/SessionPanel.tsx`: `newChat(true)` is exposed only inside the `worktrees.length > 0` group. The old `v3/V3SessionsRail.tsx` worktree checkbox is not the mounted rail. Put the first-worktree action in the mounted project/new-chat path; gate using zero existing worktrees, then reopen the created chat. `worktree/WorktreeSettings.tsx` only configures setup/cap. |
| P1 | Drag existing architecture marks | `canvas/boards/ArchDraw.tsx`: `ArchTool` has drawing/text/erase tools, not a selection/move mode. `ArchCapture` creates/erases/edits text; there is no existing-mark drag operation. Board node layout dragging in `ConnectedBoard`/`boardLayoutMemory` does not satisfy this. Add mark selection/move and prove persistence after board switch/reload. |
| P1 | Agent drawing without a settings detour | `packages/mcp/src/index.ts`: `list_boards`, `create_board`, `draw` exist, but `CORE_TOOLS` contains only `map`, `who_calls`, `impact`, `architecture_changed`. `packages/analyzer/src/server/sequenceMcp.ts` and `repoServer.ts` gate the larger set on `allBoardTools`. Latest request supersedes R8's intentionally gated drawing. Decide a measured small default board-tool contract; do not silently expose the entire tool catalog. |
| P1 | Collision-free board agent labels | `canvas/AgentOverlay.tsx` chooses chip attachment from viewport half; this is not neighboring-chip/annotation collision packing. R8 final log records collisions. Gate at normal and zoomed layouts with multiple adjacent active agents and marks. |
| P1 | Redesigned, coherent Open project/onboarding | `onboarding/FirstRunGate.tsx`/`FirstRun.tsx` and `boot/AttachDialog.tsx` are separate paths; attach still says Open a repository and uses the older folder/path dialog. `v3/V3App.tsx` catches open failures with `console.error`, not an actionable dialog error. Gate both fresh workspace and an already-open project's switch path, including denied/missing path. |
| P1 | Workspace Full access | `v3/V3Chat.tsx` passes `groundedRepoRoot(state)` to `useAccessSwitch`; `chat/AccessControl.tsx` checks server consent and falls back to Auto-edit if not confirmed. Repo-less workspace/default behavior needs explicit verification before claiming Full by default. Preserve consent policy; do not infer authority to bypass it. |
| P2 | Light/cream room survives startup | `v3/V3App.tsx` unconditionally writes `data-theme='dark'`, overriding `index.html`'s pre-paint `seq.theme` read. Inspected mounted Settings has accent, not a light/dark selector. Light CSS/specimen screenshots alone do not establish a usable cream theme. |

Board work owns canvas/MCP paths, not the chat/runtime or shell/files lanes. The parent must allocate onboarding/worktree changes without overlapping the existing shell/settings builders.

## The parent's 33 asks

| # | Request | Status | Exact source-grounded coverage |
| --- | --- | --- | --- |
| 1 | Home icons open with no surfaces | unverified | `shell2/Shell2.tsx` `openOnStage` handles the four `LIVE_PILLS`; `app/chromeTabModel.ts` gates shipped surfaces. Click-through on the no-surface stage has not been driven here. |
| 2 | Backdrop cannot intercept/overlap home | unverified | `shell2/shell2.css` `.s2-backdrop` uses `pointer-events:none`, zero-layer placement, and no-surface foreground stacking; `backdrop/AsciiStage.tsx` has no pointer lens. Actual hit testing remains unverified. |
| 3 | Full mode in default workspace | unverified | `chat/AccessControl.tsx` `useAccessSwitch` uses server-confirmed per-project consent; `V3Chat` supplies `groundedRepoRoot`. No proof here that repo-less workspace satisfies the requested default. |
| 4 | Claude stalls: reason/error/retry | broken | `packages/acp/src/client.ts` `AcpClient.prompt`/`runTurn` cancellation is best-effort notification while awaiting the provider; `repoServer.ts` cached client startup/open-thread precedes the turn watchdog. `chat/RecoveryCard.tsx` offers retry for failed runs, not an honest unresolved quiet turn. |
| 5 | Send completes or cancels | broken | `repoServer.ts` `runTheTurn` treats every non-refusal stop reason as successful `feed.end`; canceled/no-answer endings can look successful. Cached prompt serialization plus best-effort cancellation can hold a later turn. No fresh live reproduction was attempted. |
| 6 | Agent chat survives restart | broken | `state/connect.tsx` persists `state.session.turns` via `toChatMemory`; `agents/agentRuns.ts` keeps provider run transcripts in a separate in-memory store. Native `agentThreads` resume keys in `repoServer.ts` are not UI transcript persistence. |
| 7 | Content title; rename wins | broken | Title derivation/persistence follows the Sequence session turns, not the separate agent transcript. Mounted `shell2/SessionPanel.tsx` actions expose Pin/Delete, not Rename; rename in `v3/V3SessionsRail.tsx` is on the retained old rail. |
| 8 | Expanded sidebar keeps Settings visible | unverified | `SessionPanel.tsx` puts footer Open project/Settings outside scrolling `.s2-groups`; CSS uses flex/min-height. Long projects/chats/worktrees and short viewport were not visually checked. |
| 9 | Status bar cannot overlap | unverified | `Shell2.tsx` mounts `StatusBar` outside the row. Real dock, terminal and short-height layout remains unverified. |
| 10 | Markdown bold/headers | implemented | `chat/proseBlocks.ts` and `ProseMessage.tsx` support strong text, headings, lists, fenced/inline code, links and details. Tables/blockquotes/raw HTML are not full Markdown coverage. Rendering legibility remains visually unverified. |
| 11 | Readable folded tools | unverified | `chat/AgentRunThread.tsx` uses `AgentCard` and consecutive `RunGroup` folding with status/duration; existence of folding does not prove real long-path/output readability. |
| 12 | Clean thinking row | unverified | `AgentRunThread.tsx` `ThoughtItem` renders Thinking/elapsed thought with disclosure. No real-provider screenshot here. |
| 13 | Working/tool/stalled ASCII glimmer | missing | Current `AgentRunThread` starting/waiting footer is only present before items exist; tools/thoughts have existing activity styles, not the requested unified ASCII quiet/stalled cue. |
| 14 | Content title replaces redundant Claude chip | missing | `Shell2.tsx` topbar uses `agentName` or Sequence, not the active content-derived chat title. |
| 15 | Claude/Codex and local Sequence marks | implemented | `chat/ModelMenu.tsx` `ProviderIcon` and Sequence mark distinguish provider/local choices. Need a visual check across actual capabilities and saved profiles. |
| 16 | Clear context UI | missing | `chat/ContextRing.tsx` is measurement-only. `V3Chat.tsx` plus menu has **Compact the conversation**, invoking `agentRuns.start({compact:true})`; compaction is not explicit clear/reset context. Do not report that action absent. |
| 17 | Accessible real reasoning slider | broken | `ModelMenu.tsx` draws effort radio buttons as a slider, not a range/slider interaction. Provider capability efforts are used, but none/minimal both display Off; no drag/slider keyboard contract. |
| 18 | Simple themed persistent Settings | broken | `settings/settingsPanes.ts` supplies Agents/Models/App, but `SettingsPanel.tsx` App still contains extensive technical controls. `V3App` forces dark; no mounted theme choice found. Settings persistence/return focus is runtime-unverified. |
| 19 | Projects/Chats/Skills rail | missing | Mounted `SessionPanel.tsx` has Projects with nested chats and conditional Worktrees. Skills is only deep in Settings; no separate Chats/Skills rail sections. |
| 20 | Files drag/right-click/F2 organization | missing | `files/FilesPanel.tsx`, `FileTree.tsx`, and `state/connect.tsx` `ConnectedFilesPanel` provide browse/open/edit and tree sizing, not the requested organizing interactions. See source verification note below. |
| 21 | Split snaps 25/33/50/67/75 | missing | `shell2/layoutPrefs.ts` `clampSplit` is a continuous .2–.8 clamp. `Shell2` drag persists the raw fraction; keyboard steps .05. No specified snapping. |
| 22 | Spacing/popup overlap sweep | unverified | Source-only reachability inventory below. An every-menu screenshot/hit-test matrix at small heights/1024 and light/dark has not been performed. |
| 23 | Easier redesigned Open project | missing | Reachable `FirstRun` and `AttachDialog` implement existing open/browse workflows, not the newly requested unified redesign. `V3App.openProject` error is console-only. |
| 24 | Usable Files at 1024/two surfaces | broken | R8 final log identifies a squeezed preview. `layoutPrefs.ts` fixed chat min width and two-stage layout do not prove usable editor width; a new real screenshot/measurement is required. |
| 25 | Board agent label collisions | broken | `canvas/AgentOverlay.tsx` chip anchoring is not collision avoidance; baseline log reports remaining collisions. |
| 26 | Architecture drawings draggable | missing | `canvas/boards/ArchDraw.tsx` lacks an existing-mark select/move tool. Whiteboard selection and architecture node layout are different objects. |
| 27 | Agents draw without more tools | missing | MCP drawing tools are filtered out of `CORE_TOOLS`; larger registration requires `allBoardTools`. See board handoff. |
| 28 | Simpler main-agent trace | unverified | `agents/AgentsPanel.tsx` offers tree/timeline/detail, while `AgentRunThread` offers folded cards. Source presence does not show that main-agent flow is understandable; stop-reason classification is separately broken. |
| 29 | Readable duration/stalled step | broken | `agents/AgentsPanel.tsx` `elapsedOf`/`formatElapsed` shows node duration, but no reliable stalled-step classification. Watchdog delay and run-end semantics can label quiet/no-answer turns as healthy or complete. |
| 30 | Session totals separate from context | missing | `V3Chat.tsx` reads latest agent run usage for the ring; `agentRuns.ts` usage is used/size/cost, not durable per-session input/output/cache totals. Sequence turn accounting is not provider-session aggregation. |
| 31 | DeepSeek source/license research | unverified | Canonical `deepseek-ai/deepseek-harness` and MIT license verified from upstream; the distilled independent second document is still being filed. No install/copy/model call. |
| 32 | Every page/dialog/menu audit | unverified | Production route/mount inventory below is filed; runtime owner-seat audit of every state is not complete. Do not turn the inventory into a claimed UI pass. |
| 33 | R7/R8 naming/theme/editor/Settings/freeze/Terminal/default-workspace sweep | broken | Mixed result: shipped names and Terminal close path exist; HTML/editor source exists; cream theme startup is contradicted; model freeze/Settings saves/default workspace remain unverified; old dialogs remain reachable. See inventory. |

## Production page/dialog/menu inventory

This inventory follows shipped-surface allowlists, `Shell2` mounts, `V3OverlayHost`, command dispatch, and local conditional mounts. It is not a directory-of-components mistaken for navigation. All visuals are unverified unless noted otherwise.

| Entry / state | Reachability and retained UI |
| --- | --- |
| Home/no surface, Chat | `Shell2`/`ConnectedChatColumn`/`V3Chat`. Backdrop stage, rail and composer remain. New chat starts no board surfaces. |
| Files | `LiveSurface` → `ConnectedFilesPanel` → `FilesPanel`/`FilePreview`/lazy `CodeEditor`. Tree, edit save/discard, find, Markdown/HTML/image previews; repo-less workspace endpoints exist. Narrow multi-surface outcome remains broken/unverified. |
| Architecture | `LiveSurface` → `ConnectedBoard`. Board tabs/create/rename/delete, node map/drill, fit/focus, drawing tools, node context menu, anatomy, edge evidence, legend/more-tools and agent inspector are additional states, not independent URL pages. |
| Architecture alternate views | `canvas/views/viewModel.ts` `SWITCHER_VIEWS`: Map/Grid/Diff/Hotspots. Flow is disabled deliberately; not an unreported broken live route. |
| Whiteboard | `LiveSurface` → board-host whiteboard path. Selection/move, palette/context menu and board tabs exist; do not infer architecture mark dragging from this. |
| Terminal | `LiveSurface` → `TerminalPane`. Workspace-root fallback and strip X close exist. Provider sign-in also opens terminal from onboarding. PTY usability unverified. |
| Agents trace/dock | `Shell2` → `AgentsPanel`, tree/timeline/detail; agent run cards/recovery/question/approval in chat. Trace can replace stage for room; inspect narrow behavior separately. |
| Review dock / changed-files expansion | Shell dock and `shell2/ChangedFiles.tsx`: expanded diff/review and revert confirmation. Agent/Sequence source coverage needs real changed-file runs; do not assume every provider emits the same payload. |
| First run | `onboarding/FirstRunGate` → `FirstRun`: provider detection/connect/install affordances, recent project, browse, local setup/import and Continue without project. Skip lasts in session storage; only attach overlay suppresses gate, so unrelated overlay stacking needs checking. |
| Open project | Rail footer/command → `V3OverlayHost` attach → `boot/AttachDialog`. Older Open a repository path input/folder browser is still reachable. |
| Settings: Agents | `SettingsPanel` → `AgentsPane` / bridge install controls. Cached capability failures prevent automatic repeat probing; installation/sign-in is explicit. No execution performed. |
| Settings: Models | `LocalSetupCard`, saved-profile rename/forget/test, provider/advanced form and AI parameters. Tests may make real model calls; untouched. Shell's Open Settings callback selects provider/Models, not necessarily onboarding Agents. |
| Settings: App | Attention, notifications, declared hooks, AgentMap, worktree setup/cap, autonomy, skills/instructions, raw permissions/MCP JSON, workspace, status/accent and desktop `AppPane` controls. The optional facts section is not supplied by `V3OverlayHost`. Long technical content remains old-feeling despite three-tab chrome. |
| Activity, search, help | `V3OverlayHost` mounts corresponding panels, reached from palette/help actions. Existing component internals remain; full keyboard/focus/overflow sweep unverified. |
| Rewind / review overlay | `V3OverlayHost`; review command can carry `NO_PROPOSAL`. No-proposal and rewind empty/error states need real interaction. |
| Sessions overlay | Still a sentence telling the user to use the left rail, not a selectable session dialog. Enabled palette command reaches this dead-end. |
| Command palette | `V3CommandPalette` renders `SHELL_COMMANDS`. `pane.chat`, `pane.rail`, `pane.reset` fall through to Shell2's callback which handles only whiteboard/board IDs: enabled no-op commands. |
| Shell More / surface selection / full stage | `Shell2` local popovers and open/close/full controls. Full is a layout state, not Full access. Check escaped/focused close and short viewport. |
| Rail row Actions | Mounted `SessionPanel`: Pin/Delete; new-chat/worktree creation is conditional. Rename/project actions in the old rail do not count. |
| Composer menus | `V3Chat` plus menu (attachments/tools/compact), mode/access, `ModelMenu` provider/model/effort; `ContextRing` context popover. Need offscreen, keyboard and busy/disabled-state checks. |
| Full access confirmation | `chat/FullAccessDialog` lazy through `FullAccessConfirm`. Consent is server-backed per project; repo-less scope unresolved here. |
| Provider recovery / permission / question | `RecoveryCard`, chat takeover approval/question paths. Timeout, refusal, rate wait and cancel need distinct observable states, not generic done. |
| Worktree chip / Merge panel | `V3Chat` conditionally mounts `WorktreeChip`/`worktree/MergePanel.tsx`; diff/merge/check/discard and removal alert dialog remain older styling. Only appears after worktree metadata exists. |
| Confirmations / keyboard help | Shared `ConfirmDialog` and `KeysHelp`/command help are nested states. Verify focus restoration and cancel without model work. |
| Hidden/unmounted retained code | `app/chromeTabModel.ts` excludes AI Canvas and Browser from shipped activation/restoration. `v3/V3Shell.tsx` and `V3SessionsRail.tsx` are not the production `V3App` shell/rail. Their richer controls cannot satisfy mounted UI asks. Specimen/demo entries are not production pages. |

## Earlier requirements: reconciliation, not deletion

| Earlier owner requirement | Status and retained contract |
| --- | --- |
| Start without a repository; do not auto-install/run a model | implemented in source: `FirstRun` has Continue without project; explicit provider/local install actions. Workspace files/terminal have root fallback. Real boot remains unverified. |
| Read attached project vs default workspace honestly | unverified: `V3App.openProject/openWorkspace`, connected root selection and consent need a two-root acceptance check; don't infer workspace equals repo. |
| Detect Claude/Codex; sign-in/install only when requested | implemented in source: `ConnectAgents`, `AgentsPane`, `FirstRun` affordances. Capability failure caching exists; actual installed/login state not read. |
| Board changes persist and stream | unverified: `ConnectedBoard`, board store/SSE and `boardLayoutMemory` paths exist; marks, tabs, node layout and whiteboard need separate reload checks with actual boards. |
| Board tabs create/rename/delete and architectures/whiteboards coexist | implemented in source via `canvas/boards/BoardTabs.tsx` and host kind handling. Runtime create/rename/delete and focus return unverified. |
| Board labels, zoom/drill/fit/context remain readable | broken/partial: controls exist; agent label collision remains; no fresh zoom/annotation screenshot. |
| Agent drawing shares the actual board | missing default reachability: existing MCP draw targets board data but requires more-tools setting. Default-tool policy is the remaining edge. |
| Worktree setup/cap and isolated chat creation | broken entry: setup/cap is reachable in App Settings; creating the first isolated chat is hidden in the mounted rail. |
| Worktree merge/check/discard/removal safety | unverified: `MergePanel`/chip reachable for existing worktree sessions, with removal confirmation. No commands or destructive operations exercised. |
| Narrow, keyboard, light/dark, focus and loading/error states | unverified/broken where named: no visual acceptance sweep; forced dark contradicts persisted light; blank lazy fallback and older overlay paths need inspection. |
| Intent Plan/Build/Teach and permission honesty | unverified: `ModeRows`, `useAccessSwitch` and provider access mapping exist; Full consent and actual provider enforcement are not proven by labels. |
| Review/revert and changed-file evidence | unverified: `ChangedFiles` and review/rewind surfaces exist. Need actual provider edits and preserved history; fixtures do not establish result. |

## Verification ledger and dispatch order

Read-only commands checked the subject: `git branch --show-current` returned `r9/audit`; `git rev-parse HEAD` returned the full base above; initial `git status --short` was empty. `rg` and selected `Get-Content` inspected the named production paths. No unit suite, build, provider, UI, or full gate ran. A wrong lookup for `chat/fullAccessConsent.ts` was rejected and is not evidence; consent is actually routed through `AccessControl`/`accessMode` and the backend.

Dispatch runtime persistence/cancel/terminal truth first (existing runtime owner); board annotations/default drawing/collision next as an independent canvas/MCP slice; first-worktree/onboarding must be assigned with shell/settings ownership respected. Shell/files and chat/settings lanes should consume the exact gaps above. Follow with a built-app, real-data owner-seat matrix across every reachable state, including 1024/two surfaces and restart. This source audit cannot retire those acceptance checks.

Initial document intentionally leaves #31 research write-up and #32 runtime audit unverified. Research follows in `deepseek-ux-followup.md`; none of these statuses should be upgraded simply because another lane reports a test pass.
