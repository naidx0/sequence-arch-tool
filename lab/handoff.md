# Sequence lane hand-off

Updated 2026-10-05. Machine session on Jaden's computer, overhaul program (Phases 0-6, brief from the
project coordinator, 5 Oct 17:48Z). Specs: Sequence Atlas and Sequence Build Spec artifacts.

## Where the work is

- Worktree `C:/Users/<user>/Projects/seq-overhaul`, branch `overhaul`, off codeforge main 221f18cb.
  Jaden's checkout (`OneDrive/Documents/_Organized/Projects/sequence`) has untracked skill folders and
  one modified skill file; it is not touched. `overhaul` fast-forwards onto main when a phase is green.
- Baselines: `lab/log.md`, entry "Overhaul Phase 0". Raw JSON in the session scratchpad; the commands
  in that table reproduce them.

## Phases

| phase | state |
|---|---|
| 0 baselines | done |
| 1 audit and cleanup (hide unfinished surfaces, boot calls, bundle, full access) | done: boot 18 -> 13 calls, boot JS -255 KB, 5 shipped tabs, access modes |
| 2-5 run as three parallel streams from 18:26Z: onboarding+connect, agent-to-board, board+UI | running |
| 3 agent to board (hook route, live highlight, sub-agents, map.md) | - |
| 4 UI pass (screenshots to the coordinator before shipping) | - |
| 5 views, each A/B scored | - |
| 6 full gate, release build, installer smoke | - |

## Tools added

- `tools/measure/first-board.mjs`: launch-to-board timing, clicks, boot API calls and boot JS.
- `tools/bench/find-the-fix.mjs --at <sha>`: pins the snapshot so reruns use the same commits.

## Final gate additions (coordinator, 18:50Z)

- Access modes and sub-agent views must pass end to end against real agents, logged apart from mock results.
- Not installed here: codex-acp, claude-agent-acp (npm downloads need Jaden's yes). Installed: codex-cli 0.153.4 (Ready, ChatGPT), claude 2.1.280 (status says signed out).
- Plan without downloads: drive `codex exec` with the argv each mode maps to (read-only must refuse a write; workspace-write must allow it; danger-full-access must run with no prompt) in a temp git repo. For Claude, open `claude auth login` through the in-app Terminal and note whether Jaden has to finish the sign-in himself.

## Queue (coordinator round-2 review, 23:21Z)

Running: views builder (layout with Agents panel, agent chip, polish incl. Grid scaling, then Diff and Hotspots views with registered A/B); analyzer boot; map.md replication on a second model.
Next free slot, a chat/agents builder owning packages/web2/src/chat/** and src/agents/**:
- agent runs stream into the chat pane (node pinned as context; tool calls, diffs and approvals as collapsed 32 px cards); approvals also as a persistent bottom-right toast with Allow/Deny; node menu closes normally again; rename "Anatomy" to "Show inside";
- approval card draws Codex's file-change format and shows repo-relative paths;
- timeline with a time axis and a row per agent and sub-agent, bars labelled on hover; tree without the duplicate "Main agent";
- composer placeholder "Ask about the code or give an agent a task"; agent chip reads "Connect agent" in full;
- empty chat shows three starter actions tied to the board.
Final gate after that: a real Codex run per mode (Claude is signed out on this machine; say so), release build, installer smoke, before/after boot, bundle and installer numbers, final shots round on the review page.
- Next free slot (coordinator 23:36Z): desktop reacts to the child's listening line instead of the 150 ms poll, and the server ships as an esbuild bundle; report packaged launch-to-composer end to end (baseline ~947 ms median, desktop-smoke --packaged stage marks).

## Loop rules from 2026-10-06 00:13Z (owner, via coordinator)

- Merges into overhaul: typecheck + tests of changed packages only (a shared package also runs its dependents). Build + all suites + CI + desktop-smoke once, at the final merge.
- Screenshots once per batch at the end. Legibility counter: 1 run per cell (deterministic).
- map.md replication stops at its registered 3 pairs. Diff and Hotspots get one scored A/B each. Nothing else gets an A/B.
- Perf gates use deterministic counts in tools/measure/perf-ratchet.json (boot module count, boot JS bytes, boot requests, React commits per composer keystroke, commits per streamed chunk); a rise fails, a drop lowers the ceiling. Wall-clock once at the end: packaged, n=9, median, no other lane running.
- Reading a diff is review; it needs no run.

Speed slice for the next free slot (replaces the two queued boot levers): listening-line instead of the 150 ms poll; esbuild server bundle with a V8 code cache (compile cache if Node >= 22.1, else vm.Script cachedData; renderer v8CacheOptions bypassHeatCheck); static composer and sidebar frame in the HTML with keystroke handoff into React; composer kept mounted across chats and tabs, prefetch on hover; idle audit (reloads, idle polls, duplicate storage writes, :has() on high nodes, whole-message highlighting); the perf-ratchet file. Report launch-to-composer and time-to-first-keystroke against ~947 ms, measured once per the rule above.
## From 00:23Z (owner, via coordinator)

- No push to finish: the final full gate comes late, after more rounds. Keep building after the current items.
- Check logic first (read the diff, deterministic tests, replay recorded sessions, simulate in the web build); live model or GPU runs only where nothing else can answer.
- Builders' method questions go to the coordinator through my notes.
- Queued slot: usebastion.io audit. PNGs of usebastion.io and usebastion.io/design in light and dark; read the real tokens from the site source (naidx0/premai at C:/Users/<user>/Projects/premai: font, type scale, spacing, radii, glass button recipe, icon set); diff against Sequence's graphite.css and list mismatches. Change nothing yet.
- Coming from the coordinator: a uiarc.dev UI pass, a harness study (T3 Code, OpenCode, the one Jaden calls SYNARA), a Claude Code/Codex parity list.
## Next slices after the current items (coordinator 00:40Z; plan in lab/specs/build-spec-parts-4-7.html, Part 4)

Main finding: most of the gap to Claude Code and Codex is data the CLIs already send that acp/src/client.ts throws away (clientCapabilities {}, mcpServers [], text-only prompts, no session/load, only agent_message_chunk read). Three run in parallel, each its own builder:
- S0 replay harness first: record at most 5 Codex sessions once (edits, command approval, plan, todos, long silent tool, usage), replay through the real adapter, reducer and UI state (T3 replay.ts); Claude fixtures from the ACP schema and claude-agent-acp tests, labelled "not run live"; tests drain queues, never sleep.
- S1 agents that don't forget (persist sessionId/threadId, resume; ended/settled/hung states; watchdog paused during approvals; recovery cards; respawn server once).
- S2a the agent sees the board (inject packages/mcp; image paste/drop; board PNG to agent; @-mentions as resource_link).
- S2b show what the CLI does (plan card, todo and subagent strip, model/effort from configOptions and model/list, context ring with Compact, CLI slash commands and skills, folded tool rows).
- S3 undo anything (shadow git-dir checkpoints, revert to here, last-turn diff with hunk revert, into the Diff view).
- S4 motion and glass pass after the usebastion.io audit, PNGs to the coordinator before merging; CSS only; ratchets on infinite animations and backdrop-filter count; no hold-to-confirm.
- S5 never miss a turn (notifications, badge/flashFrame, keys, turn/steer and editable queue, allow-always at command-prefix arity, reject with feedback).
- S6 long chats stay smooth (50 ms coalescing, @legendapp/list, bounded payloads).
- S7 chats in their own worktree.
## Open gap: Claude recordings (2026-10-06 02:35Z)

Claude fixtures are hand-built from the ACP schema and labelled not run live. Better source: raw JSONL snapshots in github.com/agentclientprotocol/claude-agent-acp at commit 0724b17, src/tests/acp-scenarios/__snapshots__/v2/ (40 files, ~280 KB) plus src/tests/fixtures/usage-limit-session.jsonl (Apache-2.0), into lab/fixtures/claude-acp/ with a NOTICE line, installing nothing. Not fetched: a download needs Jaden's own yes in this machine session (asked; he replies `download claude-agent-acp`). Relayed standing permissions are not taken as that yes. Work continues on S1, S2a/S2b, S3, chat and toolbar fixes, then S4 after the usebastion.io audit.

## S4 queued for the next free slot (coordinator 03:12Z)

Defaults until Jaden answers the three design questions ("Mix"): Archivo for UI text (bundled locally: woff2, latin subset, weights 400 and 500 only, no network font, font bytes ratcheted), current mono for code, blue light-mode accent, Sequence's warm grey dark ground #1D1D1C. Each one a single token so switching is one line ("Match Bastion": dark ground #0b0d12; "Keep Sequence": Inter, gold, grey). Rest of S4 per lab/specs/build-spec-parts-4-7.html Part 4 UI rules and lab/specs/bastion-audit.md adoption notes. PNGs on the review page before merge. Audit is published there (round "Bastion audit").
## S4 rulings (coordinator review of the Bastion audit, 03:14Z)

- Primary component reference: the Ramp Kit at /design (premai app/(legacy)/design/html.ts). Chat parts look like its Graphite parts first, recoloured through our tokens; uiarc supplies motion numbers only. Parts: thinking folds to "Thought for N s"; block cursor while streaming; tool rows as cards; approval gate "Allow once Y · Always for <prefix> A · Deny N" (given to the speed builder now); "Applied N edits to <file> · Undo" toast wired to the S3 checkpoint; "25% ctx · $0.04" chip in the chat header fed by usage events (S2b); agent status strip; empty state; braille loader (re-enable chat/chat.css:358-369).
- Type: Archivo 350/400/450, tracking --tr-head -0.02em from --t-17 up, no 600/700 anywhere; board box labels 450. Variable woff2 subset to latin plus the wght axis, bytes ratcheted. Settle the face in docs/brand/graphite/_core.html and styles/base.css too (a sheet change needs a numbered entry in docs/brand/GRAPHITE-DECISIONS.md; CI enforces it).
- Glass controls: fill ink 4% (hover 10%), rim 16% (hover 28%), blur 12px, saturate 1.2, no inset; panes over a static ground lose blur; pointer light as a static hover radial, no JS.
- Spacing: larger steps only for empty states, onboarding, Settings and the Files reader; rhythm 24/40; prose 46-60ch; board, rails and toolbars stay dense.
- Icons: 1.5 stroke, 0.7 opacity in buttons (1 on hover), 2 px nudge on forward arrows.
- ASCII: static SVG text pattern for the empty board and boot only; no canvas.
- Tests: re-run only src/boot/contrast.test.tsx and src/tokens/graphite.test.ts for contrast.
- PNGs before merge on the review page, light and dark, 1440 and 1024, each beside the Ramp Kit part it copies.
## Rule (2026-10-06): the perf ratchet never buys bytes with accessibility

No lane removes aria-* attributes or informative titles to meet a ceiling. A removal is allowed only when the attribute duplicated an existing accessible name, and the commit says so.

## Final gate checklist additions (2026-10-06)

- One real Codex Ask run: call one board (sequence) MCP tool and log whether mcpServer/elicitation/request appeared and how it was answered.
- One real Codex run per access mode (Ask, Auto-edit, Full) through app-server; Claude stays untested live (signed out), stated as such.
- Packaged installer build and desktop-smoke --packaged; confirm the board MCP server starts from the packaged layout.
- Wall clock once, packaged, n=9, median, no other lane running: launch-to-composer and time-to-first-keystroke against ~947 ms.
- Full suite once (build, every package, CI, perf, style ratchet).

### Final gate additions (coordinator, 2026-10-06)
- Real Codex runs, one per mode: Ask, Auto-edit, Full access, Plan. The Ask run calls one board tool; log whether elicitation appeared. Full access runs with zero approval prompts ("full access mode is skip permissions").
- After the gate, screenshot round 5, placed at the top of the review page: board light and dark; Diff and Hotspots; a chat with plan, todos, strip and folded tool rows; a worktree chat with the merge panel; onboarding; settings; the 1024 layout.
- Packaged smoke: confirm the shipped analyzer carries disarmConsoleListKill and the shipped node-pty still exposes _agent._getConsoleProcessList (grep the packaged files, or run the pty-shell control test against the packaged copy).

## Round 9 handoff to the cloud (2026-10-07 04:10Z)

Main on GitHub is e61bc5e5 (rounds 7 and 8, all gates green, installed on Jaden's desktop). Round 9 was stopped by the weekly usage limit; nothing from it is on main. Its work-in-progress is saved as local WIP commits only, not green and not pushed: r9/agents 0f435d26 (diagnosis plus the start of the stall fix), r9/chat 4d1bfa58 (ChatTitle and chatIcon committed at 7bde2122; markdown, thinking and tool-row work in progress), r9/shell a0c35736 (two commits plus WIP: home icons, layout). These live in worktrees under C:/Users/<user>/Projects/seq-r9-* on Jaden's machine. Local builds are stopped.

Round 9 scope (Jaden, 2026-10-07 03:36Z to 03:45Z), for the cloud to continue from main:
1. Agents (the diagnosis is in lab/specs/r9-claude-stall.md):
   - save agent turns to chat.json server-side, with titles from the first message;
   - acp:waiting heartbeat every 10 s (queued, approval waiting, tool X for N s, bridge quiet, process gone);
   - Stop disposes an unsettled turn after a grace period;
   - Send returns when Claude's answer is complete even if the bridge holds session/prompt for background subagents;
   - a bounded per-turn agent log;
   - tokens per run plus tokensBySession (AgentRun.tokens; AgentRun.usage stays the context window);
   - step durations and the slowest step in the Agents tree.
2. Chat:
   - Markdown answers;
   - a one-line thinking row with an ASCII spinner;
   - clean tool rows with durations;
   - an always-visible working line with spinner and shimmer that reads AgentRun.lastEventAt and stalled;
   - the chat header shows ChatTitle, not the agent name;
   - chat icons are the model's brand mark (chatIconFor);
   - a real reasoning slider (role=slider);
   - a context popover;
   - Settings simplified into a larger sheet with half the text.
3. Shell:
   - BLOCKING: with no surface open, the icon pills don't open surfaces;
   - full screen on the default workspace;
   - no overlaps on the home screen;
   - cards end above the status bar;
   - the sidebar scrolls between a fixed header and footer;
   - Projects / Chats / Skills sections;
   - Files drag, right-click and F2 rename;
   - splitters snap to 25/33/50/67/75%;
   - a spacing pass;
   - the Open project screen rebuilt as a B sheet.
4. A DeepSeek Harness UX study and a full reskin coverage audit (every page, dialog and menu, marked new, partly old or old), not started.