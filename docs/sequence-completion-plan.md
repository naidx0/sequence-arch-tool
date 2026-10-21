# Sequence completion, 7 October 2026

End state: the installed Sequence application reliably opens projects and surfaces, preserves agent conversations, communicates progress and failures, and presents a consistent, readable workspace matching the owner's latest walkthroughs.

## Authority and recovered work

Latest owner instructions in this Codex conversation authorize local takeover, completion, verified push to codeforge main, and Windows installer rebuild. Earlier cloud-only and stop-local instructions are superseded. Baseline remote main confirmed by `git ls-remote`: `41654a100bef1d42e19a67a624151761c917ae68`.

Sources: owner's October 6 and 7 walkthroughs pasted in this conversation; 33-item cloud checklist; `lab/specs/round7-walkthrough.md`; `lab/specs/reskin-mix.md`; `lab/specs/r9-claude-stall.md`; latest `lab/log.md` entries. Latest UI requests supersede older design freezes and no-shimmer rules. Do not copy deleted v1 UI.

Preserved branches: r9/chat `4d1bfa58`, r9/shell `a0c35736`, r9/agents `0f435d26`. These are recovery inputs, not verified releases. Bundles under Projects/_cloud-handoff contain these same refs, not evidence of completed cloud work.

## Slices and dependency order

1. First shippable slice: durable agent transcripts and titles; honest queued/quiet/tool/approval states; bounded cancellation; per-turn diagnostics and usage. Isolated backend builder. Gate: fake bridge/replay tests proving persistence after restart, no overwrite by stale client PUT, cancellation releases queued turn, no secret logging; package typecheck.
2. Chat readability and controls, parallel to 1: Markdown, clean tools/thinking, visible activity, model-brand icons and content title, accessible provider-driven effort slider, clear context menu, simpler Settings. Builder owns chat and agents frontend only. Gate: targeted tests plus built browser checks in empty/content/narrow states.
3. Home and layout, parallel to 1/2: clickable no-surface launcher, usable default workspace, status boundaries, fixed footer plus scrolling rail, project/chat/skills rail, split snapping and Open project redesign. Builder owns shell2 and Files. Gate: locking interaction tests plus built browser checks at 1440 and 1024.
4. Board and agent trace completeness after relevant ownership frees: agent-label collisions, draggable architecture drawings, discoverable drawing tools, readable per-step duration/session tokens; reverify Map/Grid/Diff/Hotspots and drawing on real repo. Gate: deterministic geometry/replay tests and browser walk.
5. Full coverage audit and integration: primary-source DeepSeek/T3 behavior review, every page/menu/dialog listed, reproduce residual problems, fix by disjoint slices. Gate: complete checklist with evidence; changed-package gates during development; one full integrated build/test/CI plus perf ratchet and isolated desktop smoke.
6. Release: normal push to main only when green; rebuild installer and verify installed files/launch. Preserve user's dirty checkout and real session store. Screenshots at meaningful completed UI batches, not per edit.

## Owner checklist

All start UNVERIFIED; evidence/status is updated on integration, not on agent assertion.

| # | Request | Status |
|---|---|---|
|1|Home icons open surfaces with none open|Browser pass: dark/light, 1440/1024; native Electron still pending|
|2|Backdrop cannot intercept clicks; no home overlap|UNVERIFIED|
|3|Full mode works in default workspace|Server consent/cwd mock gate passes (8 checks including cancellation); native provider acceptance pending|
|4|Claude silent stalls show reason/error/retry|UNVERIFIED|
|5|Send returns correctly after completion/cancel|UNVERIFIED|
|6|Agent conversations survive restart|Server persistence and authoritative same-row update gates pass; hydration/usage restore code integrated, browser restart acceptance pending|
|7|Chats titled from content; rename wins|Server test passes; rendered content-title workflow pending|
|8|Expanded sidebar does not hide Settings|Targeted tests pass; rendered footer fits four viewport/theme cells; long-rail pending|
|9|Status bar does not overlap rails/chat|Rendered footer bounds pass; remaining dock/short-height states pending|
|10|Markdown and bold headers|Targeted parser/render tests pass; screenshot checkpoint pending|
|11|Readable folded tool calls|UNVERIFIED|
|12|Clean thinking row|UNVERIFIED|
|13|Working/tool/stalled ASCII activity with restrained glimmer|UNVERIFIED|
|14|Title header replaces redundant Claude chip|UNVERIFIED|
|15|Claude/Codex marks and Sequence local mark|UNVERIFIED|
|16|Clear context UI|UNVERIFIED|
|17|Accessible real reasoning slider|Provider-driven range test passes; rendered menu checkpoint pending|
|18|Simplified, themed, persistent Settings|Theme selector and startup watcher integrated; targeted theme checks pass; corrected styled browser specimen pending|
|19|Projects/Chats/Skills rail|UNVERIFIED|
|20|Files drag/right-click/F2 organization|UNVERIFIED|
|21|Split snaps 25/33/50/67/75 percent|Targeted shell checks pass; updated built owner-seat matrix pending|
|22|Spacing and popup overlap audit|UNVERIFIED|
|23|Open project redesigned and easy|UNVERIFIED|
|24|Usable Files preview at 1024 with two surfaces|Built owner-seat matrix passes four theme/viewport cells; real tracked HTML preview visually inspected at 1024 light|
|25|Board agent labels do not collide|10 geometry/rendered checks pass, including adjacent callouts at 900/360 px and 25% zoom; full-app agent replay pending|
|26|Architecture drawings draggable|13 unit/rendered checks pass: normal/far zoom, SVG/text/sticky, capture/pane cancellation; full-app reload acceptance pending|
|27|Agent drawing tools without hidden more-tools requirement|UNVERIFIED|
|28|Simpler main-agent trace|UNVERIFIED|
|29|Step duration and stalled step readable|UNVERIFIED|
|30|Per-session token totals, separate from context|UNVERIFIED|
|31|DeepSeek Harness behavior study with source/license|Primary-source findings filed in lab/specs/deepseek-ux-followup.md|
|32|Every page/dialog/menu coverage audit|Production-path inventory filed; runtime acceptance sweep pending|
|33|R7/R8 verification: surface labels, themed ASCII, matching rails, cream light, HTML/editor, Settings saving, model freeze, Terminal X/default workspace|UNVERIFIED|

## Integration evidence, first checkpoint

At integration `06f6cc2f6`: frontend build exit 0; targeted chat gate 6 files / 87 tests exit 0; targeted shell gate 5 files / 47 tests exit 0; runtime transcript/cancel gate 4 tests exit 0. Self-run browser walk `node tools/measure/completion-walk.mjs --tag completion-shell` exit 0, 8 checks across dark/light and 1440/1024. These are bounded results, not completion of all asks. Screenshots: `tmp-shots/completion/completion-shell-*.png`; gate logs retained in `C:/Users/<user>/Projects/sequence-completion-*.log`. Fleet verifier unavailable; visual verification self-run.

## Integration evidence, second checkpoint

At `321b9825`: ACP/analyzer build exit 0; agent lifecycle gate 10 checks exit 0; ACP final-answer/adapter gate 10 checks exit 0; default-workspace consent/cancellation gate 8 checks exit 0; web command/theme/consent/run-store gate 20 checks exit 0. Annotation unit and real-Chromium specimen gate 13 checks exit 0. Commands initially failed with an undefined store; correction `c7a82875` made that exact gate pass. No full-suite rerun was used for these slices.

The first frontend build at this checkpoint failed, exit 2: chat presentation expected the old token shape while runtime reported scoped usage and nullable cache values. Correction `f6947158` resolves this mismatch: current frontend build exit 0, targeted title/activity/trace gate 28 checks exit 0. Built owner-seat matrix exit 0 covers 1440/1024 and light/dark using 929 real tracked file paths plus 80 explicitly synthetic chats; screenshots are in `tmp-shots/r9-shell`. Narrow HTML preview and Open project were visually inspected. This is not native installer or real-provider acceptance.

Independent reviews found fullscreen/Agents visibility, palette reveal/focus, modal focus, System-theme prepaint, compaction's empty-answer contract, and a second transcript-restoration path. All were assigned to the relevant builders with locking tests; none is waved through as pre-existing. File organization UI/backend commits exist but are held for worktree-scope checks so organizing files cannot silently mutate the base checkout. Default agent drawing and the remaining full-app route audit are still pending. No main push or rebuild yet.

## Stated edge

Keep the signed-in Claude CLI bridge, Codex app-server and local models; no new Gemini/Copilot/OpenCode providers. Use recorded protocol fixtures instead of live Codex quota. Never read credentials, change user's CLI config, capture the real desktop, run GPU jobs, or disturb unrelated repos. Application screenshots use an isolated store. No fabricated topology, models, token counts, or cloud billing claims.
