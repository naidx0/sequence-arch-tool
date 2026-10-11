# Competitive gap plan — 2026-08-22

**How this was built.** A 56-agent workflow surveyed four lenses against the tree — chat and
turns, review and diff, agency and runs, workspace and navigation — then a separate adversarial
pass tried to *refute* each finding by locating an existing implementation. 51 candidates
survived into 41 de-duplicated, ranked items.

**Every claim below was re-verified by hand before this file was written**, because the
verification pass refuted zero of fifty-one, and a verifier that refutes nothing has not been
shown to be working. The two highest-ranked items were checked first and both are worse than the
survey reported:

| | Claim | Verified |
| --- | --- | --- |
| **1** | The client never sends conversation history | **True.** `PostAskRequest.history` is in the shared contract, the server parses it (`repoServer.ts:3323`) and renders it into the prompt (`renderAskHistorySection`), and `connect.tsx:182` sends `{question, context}` only. Every follow-up is answered as if it were the first message. |
| **2** | Session switching 400s | **True, and a test pins it.** `PutActiveSessionRequest` declares `activeId`; the server enforces it and 400s otherwise (`repoServer.ts:2032`); `sessionsClient.ts:79` sends `{ id }`. `SessionsPanel.test.tsx:132` asserts the wrong body, so the suite is green while the only wired session action fails on every click. |

**The pattern across the whole list is one thing, and it is this repo's known failure mode:
BUILT BUT NOT REACHED.** Very little here is missing engine. Rank 1 is a mapping step in one
file. Rank 4 is a component with both buttons already drawn. Rank 8 is three finished panels with
no chrome. Rank 11 is a decision layer that is complete, correct and tested with zero production
callers. The work is overwhelmingly wiring, and the tests that should have caught it were written
against the props rather than the mount.

**Ranking rule:** what a user meets in their first session, weighted by effort. Not breadth.

---

## Status — phase 1 complete, all green, pushed to `main`

| # | Item | State | Locked by |
| --- | --- | --- | --- |
| 1 | Conversation history is sent | ✅ | `askHistory.test.ts` + `sendPayload.test.tsx`, mutation-tested |
| 2 | Session switching works | ✅ | contract-typed bodies; reverting now fails the BUILD |
| 3 | Bounded markdown — fences and inline code | ✅ | 17 parser + 4 rendered tests |
| 4 | Retry and Dismiss on the failure strip | ✅ | 5 tests, both halves mutation-tested |
| 5 | Copy an assistant message | ✅ | 4 tests incl. the clipboard-denied case |
| 6 | Escape interrupts the running turn | ✅ | 4 tests, both guards mutation-tested |
| 7 | The palette's first row works | ✅ | 3 palette + 2 store tests |
| 8 | Visible entry points for the built panels | ✅ | 3 tests, incl. one tying buttons to `SHELL_COMMANDS` |
| 9 | Review scope reaches the wire | ✅ | 2 click-driven tests, mounted as the app mounts it |
| 10 | What a turn cost | ✅ | 4 tests, incl. "no currency symbol" |
| 11 | The notification can fire | ✅ | 11 tests, `notifyPreference.test.ts` |

### Phase 2 — complete

| # | Item | Locked by |
| --- | --- | --- |
| 12 | The transcript survives a reload | ✅ **NOW.** Was marked done and was NOT reachable: `session/hydrated` had a reducer arm and nothing dispatched it, and nothing PUT the transcript. Twenty tests covered the pieces either side of a call nobody made. Hydrate + persist are wired, gated on attachment; mutation-tested. |
| 13 | The rail's filter is capped, and says what it withheld | 5 tests |
| 14 | Per-request round cap, clamped | 7 tests |
| 15 | The rail follows the board | ✅ **NOW.** `rail/reveal` wrote `rail.selectedPath` and no component read it. Wiring it turned up two more: selection keys on row id (a path there highlights nothing), and a FILE row could not render `data-selected` at all. 5 new tests. |
| 16 | Overlays are actually modal | 13 focus-trap tests |
| 17 | The composer names the model that will answer | 10 tests |

### Phase 3 — in progress

| # | Item | State |
| --- | --- | --- |
| 18 | Edit and resend a question | ✅ 12 tests |
| 19 | Queue a follow-up typed mid-stream | ✅ 9 tests |
| 20 | Read a file without leaving the product | ✅ 6 tests |
| 25 | The permission control is enforced, not decorative | ✅ **NOW.** The field was parsed by `/api/ask` and the client only posts to `/api/ask/stream`, so choosing Plan changed nothing for every real user. Fixed with the stream-parity work; asserted differentially against the tool belt. |
| 26 | The repository's own instruction file reaches the prompt | ✅ **NOW.** Wired into `/api/ask` only, so the item's own sentence — "nothing in the product ever opened either one" — stayed literally true after it was marked done. Fixed with stream parity. |
| 24 | A steered comment is marked as handed over | ✅ mutation-tested |
| 22 | Discard a change | ✅ **NOW.** Server half only; the control sat disabled behind a tooltip claiming no such route exists — false since the route shipped. Client + confirm arm built; mutation-tested. |
| 23 | Staged and unstaged read straight off porcelain X/Y | ✅ reading was correct; **WRITING was not.** `git commit -m` with no pathspec commits the whole index, so a file the user staged themselves was swept into a "selective" commit. Fixed and locked with 5 tests. |
| 27 | Rewind — captures, and has a door | ✅ 28 tests; proven end to end against the running app |
| 21 | Directories in the rail | ◐ **recorded, not built.** The rail is three rungs by design and `IndexRail.tsx` says why it fetches nothing itself — the store supplies, so "the rail mounted" and "the index loaded" stay one event. A fourth rung is an IA change to a sheeted surface, not a wiring job. The half of this item that was a real defect — files belonging to no service — shipped with `unscanned`. |

### Phases 4–5 — started

| # | Item | State |
| --- | --- | --- |
| 28 | Four advertised hook events that cannot fire now say so | ✅ 6 tests |
| 37 | A paused run can be resumed | ◐ **primitive only.** `resume()` works and is tested; NO CLIENT POSTS to the resume or pause routes and no UI control exists. Downstream of a deliberate drop: the fan-out runtime has no authoring or start surface in web2 (see DROPPED §1), so a user cannot produce a run to pause in the first place. The false "can be resumed" notification claim was fixed separately and stays fixed. |
| 29 | Onboarding | ◐ **OVERSTATED - not built.** Only the single app-bar Ctrl-K hint exists. Absent: first-run state, a walkthrough, a help/shortcuts surface reachable from the palette, keycap hints on palette rows, an Electron Help menu. |
| 30 | Rail keyboard navigation | ✅ `railKeys.ts`, arrows never wrap |
| 32 | Compaction | ◐ **measured, deliberately not wired.** The ask path's history is bounded — 20 turns, 1,200 chars each, ~24KB — and compaction is itself a provider round, so wiring it would spend a call every turn to shrink something with a ceiling. Recorded in the module header, which also says it is NOT dead code: `modelSessionService` is the unbounded path. |
| 33 | Crumb trail | ◐ **NOT BUILT - and the first reason recorded here was wrong.** It said "drill-down is one level". That is false about the GRAPH: containment on this repo runs repo -> service -> module -> file, depth 3, with 38 openable nodes. The real reason is a product ruling: the owner cut containment from the board, so it has **ONE structural level** (`BUILD-PLAN.md:145`, `OUTSTANDING.md:64`) - "opening REPLACES the view, one level is on screen at a time". Three recorded grounds: the level below systems is currently a liar (4 of 7 ml-harness modules are labelled `tests`), board nesting duplicates the rail, and it is the most expensive wave left. A crumb trail navigates nesting; with one level it always reads `System > X`, which the existing bar already says. It was implemented and then reverted on finding the ruling - the implementation would have re-enabled the nesting the owner cut. |
| 34 | Palette breadth | ◐ **OVERSTATED - one of three deliverables.** Fuzzy ranking landed. The **registry** (so board camera, undo, whiteboard switch and rail filter become reachable) is real remaining work. The **keybinding hints** are NOT, and measuring says why: `Shell.tsx` binds exactly two chords - Ctrl/Cmd-K at :344 and Escape at :349 - and no `SHELL_COMMANDS` entry has one of its own. A hint column would render empty on every row: a surface with nothing to show, which is the defect this register exists to remove. Giving commands chords is a design decision (which keys, what they collide with, sheet 12.4), not a wiring job. |
| 35 | Slash commands | ~~◐ **deferred.** The gap statement itself says it needs an owner ruling.~~ **SUPERSEDED 2026-09-02 — the ruling exists and it shipped them.** `docs/brand/GRAPHITE-DECISIONS.md` Decision 4 (Max, 2026-08-24, after running the app and finding no way to reach a skill: *"i want to introduce / commands for skills pleae add that"*) is exactly the owner ruling this row was waiting on. The row was written 2026-08-22, two days before it. Left struck through rather than deleted: this file is an audit of a moment, and what it got wrong is part of the record. |
| 38 | Repo search | ◐ **OVERSTATED - route only.** `/api/search` is correct and security-gated and NOTHING FETCHES IT, with no test, so deleting it turns nothing red. Same shape as the `/api/tree` defect. The results surface was never built. |
| 39 | Headless events | ◐ **CREDITED TO THE WRONG COMMAND.** The row was crediting `sequence program run --json`; the item is about `sequence ask`, which has no `--output-format`/stream-json flag and passes no emit callback. A CI consumer still cannot get machine-readable progress out of it. |
| 40 | ACP lane | ✅ verified in production use (`programRun.ts:172`), against a survey claim of "no production caller" |
| 36 | Change stats on the run list | ✅ measured with **git**, not with our own write tracking - an ACP agent edits the tree with its own tooling, so a counter built on `PUT /api/file` would report 3 files for a run that changed 40, silently. A **delta** between a sample at start and a sample at finish, so a run is never credited with edits that were already there. Two runs sharing a tree is **declared**, on both sides, because one tree cannot be attributed two ways. 28 tests; a real-repo probe caught untracked files reporting 0/0. |
| 31 | Attachments - paste long text, drop a text file | ✅ for TEXT, end to end: store → route → composer → prompt. Kept OUT of `ContextChip` deliberately: `state/types.ts` rules that a text chip "would be the product lying about grounding in the one place it promises not to", and a mention is a claim about the repo where an attachment is evidence the user brought. Separate type, separate row, separate prompt section that names whose it is. 44 tests, two mutation-tested. |
| 31b | Attachments - **images** | ◐ **recorded, not built, with the measurement.** The provider path takes `content` as a plain **string** (`llm/label.ts:220`) and the ACP client sends a hardcoded `[{type:'text'}]` (`acp/client.ts:312`). Images need that shape to become content blocks across every provider call, plus a vision-capability registry per model - a change that risks every existing call, for a payload nothing downstream can consume today. The composer REFUSES an image by name rather than accepting one and silently attaching its filename. |
| 41 | A chat turn that outlives its HTTP connection | ✅ durable per-turn log (commit **before** yield), `id:` lines on the ask stream, `?since=` replay, and a client that resumes on a drop but **never** after Stop. The premise that this trades recoverability against provider spend turned out to be **false**: `ProviderStreamOptions` declares only `onDelta`, so the abort signal `requestAbort` builds was never read and the call already ran to completion after the socket died. The old behaviour paid for the answer and threw it away. 18 tests, the Stop guard mutation-tested. |

### The audit that corrected this page — 2026-08-22

The rows above were rewritten after a **13-agent read-only adversarial audit**
re-verified every ✅ against the tree, asking one question: *can a user reach
this, or is it merely built?* It returned **15 non-clean verdicts**, and every
one was re-checked by hand before anything was changed.

**The register had been overstating.** The failure was always the same shape,
and it is this repository's documented one — BUILT BUT NOT REACHED:

| Found | |
| --- | --- |
| **Four features dead on one route** | `/api/ask` and `/api/ask/stream` are two handlers for one question and the client posts only to the streaming one. `attachmentIds`, instructions, `permission` and `maxRounds` were wired into the other. Guarded now by a test comparing both handlers' declared body shapes. |
| **Rewind had nothing to rewind to** | No client ever posted to `/api/checkpoint`. The end-to-end proof had passed because the checkpoint was made by hand with curl. |
| **A "selective" commit was not** | `git commit -m` with no pathspec commits the whole index. |
| **A tooltip that lied** | Revert sat disabled saying no discard route exists. One had shipped. |
| **An untested production line** | Deleting `snapshotTree:` from the server left all 28 change-stat tests green. |

Three items were also found to be **credited too generously** (29, 34, 38) or
**credited to the wrong command** (39), and their rows now say so.

THE LESSON, WRITTEN DOWN: every one of these had passing tests, and every one
of those tests exercised the pieces on either side of the seam rather than the
seam itself. That is exactly how rank 1 survived 991 green tests. A test that
asserts the props is not a test of the mount.

**Every ranked item is now shipped with a lock, or recorded with its reason.**
The only deliberate omission is the image half of 31, recorded above with the
measurement that decided it. Everything else in phases 4-5 is
either shipped with a lock or recorded above with the reason it was not built.
A row marked recorded is a decision with evidence, not a thing left undone.

### Full suite at the close of phase 1

| Suite | Result |
| --- | --- |
| CI hygiene | 63 pass |
| `pnpm -r build` | clean |
| schema · acp · export · ink · mcp · gateway | 380 · 31 · 130 · 18 · 53 · 17 |
| web2 | 1,060 across 79 files |
| analyzer *(excluded by CI on a stale claim)* | 1,385 in 123s |
| e2e (7 suites, real repo scan) | all checks passed |
| **Total** | **3,137 green, 0 failing** |

Verified live as well as in jsdom, because unit tests are exactly what missed
these defects: the session key checked against the running server
(`{"activeId":…}` accepted, `{"id":…}` rejected with the old error), and the
app bar, repository control, canvas tabs, `Imports (11)` toggle, four-rung
permission ladder and a working palette first row all read off the live DOM.

---

## What was deliberately DROPPED, and why

These were surfaced by the survey and rejected against `docs/CANON.md` rather than silently
dropped, because an agent that believes a false advantage builds the wrong thing.

DROPPED against canon, with reasons.

1. No subagents / delegation (large). Canon §2: "Do not attempt breadth — par with Claude Code's surface is a company, not a rebuild", and §3 marks "we're better at agent workflows" as ◐ specifically so nobody builds parity work to upgrade it. Also the gap statement overreaches: parallel fan-out and isolated context DO exist (scheduler parallel node; acp shareSession:false). The reachable defect inside it is not subagents at all — agent.tools, agent.model, agent.requiresReview and agent.skills are declared in the schema and read by no code, and the fan-out runtime has no authoring or start surface in web2. If any of this is picked up, pick up those, not delegation.

2. Hook decision payloads (JSON on stdout: decision/reason/additionalContext) and hook scope hierarchy (user + managed hook files). Both are Claude Code parity breadth with no first-session signal. Canon names lifecycle hooks explicitly as "breadth, and breadth is deliberately out of scope". Rank 28 keeps only the honesty half — four advertised events that cannot fire.

3. Auto-review agent over the diff (large). Codex-parity breadth, and an LLM critic on a diff is the shape most likely to revive "better at agent workflows". The canon-aligned substitute already exists and is named in CANON §3 as our advantage: computeImpact and computeRisks in packages/schema, plus rescanVerdict's architecture delta and riskDelta. Surfacing deterministic impact and risk beside the diff is triage the competitors structurally cannot do; an LLM findings pass is triage they already do better. Recommend the former as a NEW item outside this gap list rather than the latter. Note Sequence already ships a second-model critic (the `advisor` role) — it judges answer text, never a diff, and only when a distinct advisor binding is configured.

4. The theme switcher UI (small, and tempting because the state, action, reducer, persistence and data-theme stamp are all built). Dropped: GRAPHITE-DECISIONS Decision 1 defers light and says do not tune light values, so shipping a control that selects 'light' ships an untuned theme, and Graphite law 5 requires both themes at equal quality. Leave the plumbing dead until the decision is revisited. Everything else in the Settings-breadth gap (keybindings, telemetry, per-workspace overrides, a settings search box) is Cursor parity breadth and is also dropped.

5. Multi-file open, editor tabs and splits (large). Directly contradicts CANON §1: "The workspace is ONE live canvas... There is no inspector column... If you find yourself building a fourth column, stop." Converted to rank 33 — render the GraphScope.trail crumb trail, which is the one-canvas-shaped answer to "how did I get here" and is already a dead state stub.

6. Trimmed rather than dropped: the headless CLI gap lost --resume/--continue and --append-system-prompt (breadth) and kept only the stream emit (rank 39); the context-window gap lost the /context meter and /compact command and kept only wiring the existing compaction service (rank 32); the project-search gap lost the Cursor search view and kept exposing the existing search_files (rank 38); the session-history gap lost rename/pin/archive/preview and kept the 400 defect (rank 2) and transcript restore (rank 12).

CANON STALENESS FOUND WHILE RANKING — worth an owner pass, since canon is what agents build from:
- CANON §2 and §3 count checkpoint-and-rewind as shipped ("proven by restoring a real file's contents"). True of the server; no user can reach it, and nothing captures, so the tracked set is always empty. Rank 27.
- CANON §2 P3 says "the rule algebra is not built". It is built, tested and enforced at two chokepoints. What is not built is any surface over it. Rank 25.
- CANON §2 lists the auto-review agent as a competitor capability at line 85; keep it there, but the ranked plan deliberately does not chase it (drop 3 above).
- notifyModel.ts:132 tells users a paused run "can be resumed". False today. Rank 37.
- docs/loop-log.md and docs/release-gate.md:97 still reference a ModelPicker that lived in the deleted packages/web; docs/loop-log.md r211-r225 claims Radix focus-trap work on files that do not exist in this tree. Both are stale-v1 pointers of the kind CANON §5 says to repoint or delete — and they are the most likely source of a false "already shipped" refutation on ranks 16 and 17.

SEQUENCING NOTE: phase 1 is deliberately not the ten cheapest items — it is the items where the product currently tells the user something untrue in the first ten minutes (a follow-up answered as a first turn, a session click that 400s, a Staged tab showing the worktree, a Retry that cannot retry, a palette row that says "not mounted"). Dependencies inside the list: rank 12 needs rank 2; rank 15 is best after rank 13; rank 21 shares rank 20's endpoint; rank 23 needs rank 9's second half; rank 29 and 34 need ranks 7-8; rank 32 is meaningless before rank 1. Local-first holds throughout — every phase-1 and phase-2 item works with no network and no key.
---

### Phase 1

#### 1. Conversation memory across turns — send session.turns as history

- **State:** PARTIAL — server half complete and tested; client half absent (declared, initialised, never written)
- **Effort:** small

The second message in any thread is answered as if it were the first: "and its callers?" resolves against nothing. Every other item on this list is cosmetic next to a chat product that cannot hold a conversation. The wire contract, the server parse, renderAskHistorySection and askPipeline historyLines are all real and tested; state.session.turns already holds the committed transcript and is already threaded into connect.tsx. Verified: the Action union in state/store.ts has no history action and composerPropsFrom's onSend builds `{ question, context }` only. This is a mapping step in one file, not a feature build.

#### 2. Session switching 400s — activate() posts the wrong key, and the test locks the bug in

- **State:** BROKEN — wire key mismatch, with a test pinning the wrong key
- **Effort:** small

Verified in the tree: sessionsClient.ts:79 sends `JSON.stringify({ id })` to PUT /api/sessions/active, while repoServer.ts:2032-2034 reads `raw.activeId` and returns 400 'activeId required'; PutActiveSessionRequest in api-types/src/sessions.ts:30 and sessions-api.test.ts both use activeId. SessionsPanel.test.tsx:139 asserts the body equals `{ id: 'session-a' }`, so the suite is green while the only wired session action fails every time a user clicks a row. One-line fix plus a re-pointed test; highest value-per-character on the list.

#### 3. Bounded markdown in the transcript — fenced code, inline code, lists, tables

- **State:** ABSENT and deliberately guarded — no parser, no dependency, no CSS; adjacent highlighter already built
- **Effort:** medium

This is the surface that displays every answer the product exists to give, and it renders fenced code as literal backticks in an unindented paragraph. Grounded answers full of paths and snippets are the core claim; the renderer cannot format a path. Effort is medium only because it must stay bounded — the guard comment on paragraphs() is right that this must not become a general markdown renderer. Reuse review/syntax.ts highlight/languageOf (already shipped, already Graphite-compliant) keyed off the fence info-string, add chat.css rules for code/list/table, and keep AssistantTurn.text flat with parsing at render time. Owner logged this ask on 2026-08-06 (docs/owner-feedback-log.md:347).

#### 4. Retry and Dismiss on the failure strip (and IndexRail's stale-index Retry)

- **State:** PARTIAL — rendered, unwired; the dismiss half is absent at the state layer
- **Effort:** small

A failed ask currently leaves a permanent, undismissable error strip above the composer and no way to re-run the question. FailureStrip is fully built with both buttons; composerPropsFrom hardcodes `retryable: false` behind a comment citing item 2.9, which has since shipped as chat/askClient.ts. The question is recoverable from session.turns plus composer.chips. Verified: the Action union has `net/failed` (store.ts:219) and no clearing action, so Dismiss additionally needs one `net/clear` case. The identical omission repeats at ConnectedIndexRail.tsx:45.

#### 5. Copy an assistant message

- **State:** ABSENT — no control, no shortcut, no palette entry, no export path
- **Effort:** small

Copy is the most-used affordance in any chat UI and the only way an answer leaves the product today is dragging the mouse across a scrolling column. Zero clipboard calls exist anywhere in source, and the `copy` glyph is missing from web2's closed IconName vocabulary even though the Graphite book specs ic-copy for message actions. Needs an icon, one control per prose item, and a place to hang it on the TranscriptItem union. Pairs with rank 3 — a copied code block is only useful once fences survive.

#### 6. Escape interrupts the running turn

- **State:** PARTIAL — transport built and mouse-reachable; no keyboard path exists
- **Effort:** small

Cancellation is genuinely shipped end to end — stop button, liveTurn abort, requestAbort(res) on res.on('close'), askAbort.signal into the metered provider call — but it is mouse-only, and Escape is the reflex every terminal-agent user has. A window-level handler that dispatches the existing onStop when session.inFlight is unsettled, with an explicit precedence decision against Shell.tsx's palette/overlay branch and Composer's mention picker, plus an 'Esc to stop' hint. While in there, resolve store.ts:633's hardcoded `abortable: false` and its stale G3 comment — no component reads the field, so it is dead state, not a user-visible lie.

#### 7. The command palette's first row is dead in the shipped app

- **State:** ABSENT at the root — command declared, no implementation anywhere, disabled state locked by test
- **Effort:** small

First keystroke, first row, default-selected, Enter — and the user reads the words 'not mounted'. It is the worst possible first impression of the only command surface in the product. Needs both halves: an actual focus mechanism into Composer.tsx (ref or store-borne focus request), and an `onCommand` passed at the App.tsx mount, which is currently omitted on purpose. Shell.test.tsx:307 locks the disabled branch and must be re-pointed or retired.

#### 8. Visible entry points for Settings, Sessions and Activity — and for the palette itself

- **State:** BUILT — no chrome; keystroke-only
- **Effort:** small

Three fully built, fully mounted panels are reachable only by guessing Cmd/Ctrl-K, a chord that appears nowhere on screen; Settings additionally hides behind the composer's 'Models' toolbelt item. A user who never guesses the chord cannot reach session history or the activity view at all. This is app-bar chrome over features that already exist: a gear or overflow menu dispatching the existing shell/overlay actions, a visible palette affordance or chord hint, Cmd+, alongside the existing handler in Shell.tsx, and a Preferences item in the Electron buildMenu. No new panels.

#### 9. Review scope segments are inert, and Staged lists the whole dirty tree

- **State:** PARTIAL — backend correct for all five scopes; client reads the wrong variable, and the status wire cannot express staged-vs-unstaged
- **Effort:** small for the click wiring; medium for the index-aware status shape

Merges two reports of one user-visible lie: clicking Staged/Commit/Branch changes the label and fetches `{kind:'worktree'}` anyway, and the file list is the entire dirty tree regardless of scope. Cause A is three lines — ReviewPane.tsx's fetch effect (:167-177) and revisions effect (:235) read the `scope` PROP where the control writes and renders `state.scope`, and App.tsx mounts <ConnectedReview /> with no prop, so it is permanently undefined. The tests pass the prop at mount, which is why they never caught it; each segment needs a click-driven test. Cause B is deeper: classifyStatus collapses the porcelain XY pair to one word so GET /api/git/status carries no index/worktree distinction, and the file list is never filtered by scope. This is exactly the defect the file's own comment says it exists to prevent.

#### 10. Show what a turn cost — tokens under the composer, USD beside them

- **State:** BUILT BUT UNREACHABLE — captured, stored, never rendered; USD computable but not on the wire
- **Effort:** small

Bring-your-own-key product, a tool loop that makes several provider calls per turn, and no number anywhere. The server already sums real usage across rounds and streams `{type:'usage', inputTokens, outputTokens, estimated}`; the store already folds it onto InFlightTurn.usage and carries it to AssistantTurn.usage on commit. Nothing renders it. estimateCostUsd with real rates already exists server-side, so part (b) is attaching a dollar figure to the streamed usage event. Note GET /api/usage exposes call counts only — do not mistake it for the per-turn number.


### Phase 2

#### 11. Fire the notification the user granted permission for

- **State:** BUILT BUT UNWIRED decision layer; firing mechanism and producer absent; preference non-persistent
- **Effort:** small

A user spends a one-shot browser permission prompt in Settings and then never receives a single notification — the decision layer (notifyControl, runFinishedNotice) is complete and tested with zero production importers, and `new Notification` appears nowhere in the tree. Long runs, the entire point of the durable run engine, still require sitting on the tab. Also make the on/off preference persist: it is currently component-local state in SettingsPanel.tsx:86. Either wire it or stop asking for the permission.

#### 12. The transcript survives a reload and a session switch

- **State:** COMPLETE server-side; ABSENT client-side (hydrating and hydrate are dead placeholders)
- **Effort:** medium

Refresh the tab or click another session and the whole conversation vanishes from the screen while sitting on disk — the user's own work is reachable by the server and not by them. GET/PUT /api/sessions/:id, sessionsStore.readSessionChat and checkpointStore are complete with passing tests; web2's sessionsClient covers only list/create/activate and no client ever PUTs a chat body, so the server-side data a restore would read is never written either. Needs: a get/put pair in sessionsClient, a commit-time PUT, hydration through createStore's existing `hydrate` option, SessionSlice.hydrating actually set, and the removal of App.tsx's `onSwitched={() => window.location.reload()}`. Depends on rank 2 landing first.

#### 13. Cap or virtualize the rail's rendered rows

- **State:** ABSENT — every matching row mounted, no cap, no windowing
- **Effort:** medium

Typing one or two characters into the index filter — the exact gesture the filter exists for — mounts thousands of DOM buttons at once and stalls the whole shell, on a repo the rail's own header measures at 5,990 nodes. filterRailRows applies no cap and IndexRail renders visible.map(renderRow) in full; no windowing dependency exists in any of the ten manifests. A result cap with a '+N more' affordance (the pattern NodeDetailPanel already uses at LIST_CAP=12) is the cheap half and may be enough before true windowing.

#### 14. Per-request round-cap override on the ask path

- **State:** ABSENT — hardcoded constants, no override on wire, CLI, env or UI
- **Effort:** small

Canon names this directly: P7, 'the round cap is still low'. A hard question stops at eight rounds with an apology and no way to say keep going; a throwaway question gets the same eight. MAX_ASK_TOOL_ROUNDS and UNPRODUCTIVE_ROUND_LIMIT are module constants read straight by askPipeline.ts:521-522 with no override at any layer. The program path already proves the shape — StartRunInput.timeoutMs/maxSteps clamped against defaults — and llm/compaction.ts:189 has the same clamped-override idiom. Thread one optional clamped field through AskPipelineInput, both HTTP handlers, the api-types contract, and a --max-turns flag in parseAskArgs.

#### 15. Reveal in the rail when the board selection changes

- **State:** ABSENT — rail selection is component-local; type stubs exist with no reducer
- **Effort:** small

Click a card on the board and the rail does not move; the matching row may be four hundred rows down and unhighlighted. The two panes that are supposed to drive each other only talk in one direction, which undercuts the one-canvas premise more than any missing feature does. RailSlice.selectedFunctionId/selectedPath already exist in types and initial state with no reducer arm; needs a rail/* action, a selection prop on IndexRailProps, expansion of the containing file row, and the first scrollIntoView in the package. Best done after rank 13 so the reveal is not scrolling into a stalled list.

#### 16. Make overlays actually modal — initial focus, Tab containment, focus restore

- **State:** ABSENT — no focus management anywhere in the tree
- **Effort:** small

Open Settings and press Tab: focus walks out of the dialog into the board behind the scrim. Close the palette with Escape and the next Tab starts from the top of the page. Four of five overlays declare role="dialog" without aria-modal or any focus work, which is a role that promises modality and does not deliver it; only CommandSurface manages focus and even it never records the opener. One shared focus-trap helper in shell/ plus a restore on close covers all five. Note docs/loop-log.md's Radix focus-trap entries are stale v1 records — Radix is in no manifest.

#### 17. A model picker that can actually pick a model

- **State:** ABSENT with stale-doc residue — reducer action is dead code; no route lists models
- **Effort:** medium

The composer draws a chevron that promises a menu and opens a settings panel where the model is a free-text field you must type by hand, and the chip renders an empty name because composer.model is never hydrated from /api/ai-config. There is no per-turn choice, so the same model answers a one-line lookup and a multi-file refactor. Four pieces: a model-list route (or a gateway /v1/models passthrough), hydration of composer.model on boot, a real submenu dispatching the already-built-and-dead `composer/model` action, and a model field on the ask request so the switch takes effect mid-conversation. Separately clean the stale references to the deleted packages/web ModelPicker in docs/loop-log.md and docs/release-gate.md:97.


### Phase 3

#### 18. Edit and resend a message

- **State:** ABSENT — send() appends and never mutates; no edit/resend/delete action exists
- **Effort:** medium

A typo or a badly-scoped question can only be fixed by retyping it as a new turn, leaving the mistake and the correction side by side in the transcript forever. Needs a turn/edit (replace-and-rerun) arm on the Action union, a control on the user item in Transcript.tsx, and ArrowUp draft recall in keyIntent, which currently returns `pass` for every non-Enter key. Ranked below the phase-1 defects because it is new surface rather than a lie being told, and it is much more valuable once rank 12 makes a transcript worth editing.

#### 19. Queue a follow-up typed while a turn is streaming

- **State:** ABSENT client-side; server-side serialization already exists and is tested
- **Effort:** medium

The textarea is deliberately left editable mid-stream so the user can draft the follow-up, then Enter is preventDefault'ed and the message is silently discarded — the field invites the gesture and eats it. Entirely client-side work: a queued-draft field, a queue action, a fourth 'queue' send state instead of 'running', a flush on turn/stopped, a pending row in the transcript, and dropping connect.tsx's liveTurn.abort() replacement semantics so a follow-up chains rather than kills the live turn. The server already serializes concurrent turns correctly (acp client turnQueue; modelSessionService per-key lock with maxQueuedTurns 4). Composer.test.tsx:76 locks the current no-queue behaviour and must be rewritten.

#### 20. Open and read a source file, reachable by keystroke

- **State:** Server BUILT AND UNWIRED (both routes, zero client callers); client viewer and jumper ABSENT
- **Effort:** medium

Merges quick-open and the missing viewer, which are worthless apart. A developer can see railModel.ts exists, see it has 14 functions, see a hop cite railModel.ts:270 — and cannot look at line 270. Every question about actual code sends them back to their editor, which is a hard ceiling on a grounded-evidence product whose whole pitch is file:line. The engine is done: GET /api/file returns jailed, owner-gated, size-capped text/plain, implemented twice and explicitly for evidence click-through, with zero non-test callers; GET /api/tree serves the index a jumper needs and web2 hardcodes state.tree to null. Build: a file view over /api/file, Cmd/Ctrl+P over /api/tree, and make evidence paths and rail rows open it instead of being inert <li>s.

#### 21. Directories in the rail, and files that belong to no service

- **State:** PARTIAL — three flat rungs by design; /api/tree built and never fetched
- **Effort:** medium

On this repo the rail is ~486 file rows in one flat alphabetical run per card, with no folder structure to collapse, and buildRailRows drops every file with no board-card ancestor — reported as one sentence at the bottom ('56 source files outside every service were not read') instead of as rows. Locating a file by where it lives is impossible. The three-rungs-and-no-fourth rule is a deliberate constraint, so this needs an owner ruling before it is built; the data is already served by /api/tree. Sequenced right after rank 20 because both consume the same unwired endpoint.

#### 22. Discard a working-tree change from the Review pane

- **State:** ABSENT — no route, no enabled control; adjacent rewind capability unreachable
- **Effort:** medium

The agent writes a file the user does not want and there is nothing in Review that undoes it: the Revert button is hard-coded disabled with an honest title, no engine route exists, and `git restore|checkout|reset|revert|clean` appears nowhere in production source. Per-file Reject only exists for last-turn proposals because reviewModel sets content:null for git-sourced files, so four of five scopes have no reject either. Needs a new discard route in gitWorkspace plus the client half. Do not point users at checkpoint rewind as the answer — it is whole-session, not per-file, and currently unreachable (rank 27).

#### 23. Real index staging — stage, unstage, and a commit that honours the checkboxes

- **State:** PARTIAL and wrong at the edge — staging is UI-local boolean state only
- **Effort:** medium

The worst correctness defect in Review: a file already in the index but left unchecked is still committed, because gitCommit runs `git add -- <paths>` then a bare `git commit -m` with no pathspec and no --only. The checkbox reads as a promise the commit does not keep. Staging without committing is impossible, unstage does not exist at all, and newFile() hardcodes staged:false so the box can never reflect git's real index. Needs POST /api/git/stage and /api/git/unstage, the index-aware status shape from rank 9's second half, and the checkbox rebound to server state.

#### 24. Line comments survive, and show which ones the agent already has

- **State:** PARTIAL — steering reachable; persistence absent; sent-marking built but never dispatched
- **Effort:** medium

The steering half is built and reachable — the `+` affordance, commentSteer's `path:line — clause`, the composer chip — and everything after it is missing. Comments die on scope change (scope/set returns emptyReview) and on overlay close (all review state is a useReducer inside the pane). Worse, the sent/not-sent badge is rendered and the `comment/sent` reducer case exists, but nothing dispatches it, so the badge tells a user a comment is unsent forever and pendingComments never shrinks — that half is close to a one-line fix at ReviewPane.tsx:296 once the send path knows the outgoing turn id. Threading (author/reply/resolved on LineComment) is a separate, larger, type-level change and can wait.

#### 25. The permission control is decorative, and an `ask` rule silently means deny

- **State:** Engine BUILT AND ENFORCED; every user-facing surface absent or wired to nothing
- **Effort:** medium

Merges two halves of one lie. The engine is real and genuinely enforced — allow/ask/deny with stated precedence, four path-anchoring forms, managed/project/user sources, a circuit breaker, and a 700-line suite including an end-to-end lock proving one line in permissions.json refuses a real pipeline call. What a user can reach is: nothing. The composer's four-mode control hard-gates two modes as REFUSED, gates a third behind an `enabled` list, and the surviving mode is never placed on any request body; there is no /api/permissions route at all, so loosening a deny means hand-editing JSON on disk. Meanwhile `ask` collapses to a refusal because no approval channel exists on the ask stream, so writing `ask` is strictly worse than writing allow or deny. Cheapest honest first cut: GET/PUT /api/permissions over the already-built parse/serialize/write functions, thread a mode onto PostAskRequest, and either build the approval event or stop accepting `ask`.

#### 26. Load a repo and user instruction file into the prompt

- **State:** ABSENT — no reader, no prompt slot, no type, no route; the scope-merge pattern exists next door
- **Effort:** medium

Every session starts blank: 'this repo uses pnpm', 'never touch generated/' must be retyped each turn, and a team cannot commit a file that tells the agent how their repo works. Nothing reads a repo- or user-level instruction file anywhere in the analyzer. The plumbing to copy is already here: loadPermissionPolicy implements the exact managed > project > user merge over ~/.sequence and <repoRoot>/.sequence, userStoreDir hardens the user root, and loadSkillSummaries already injects repo-scoped markdown into the prompt via AskComposition.skillSummaryLines. Smallest first step is reading back .sequence/memory/NOTES.md, which the refine planner already writes and nobody reads. Keep it to two scopes — four scopes and @-imports is Claude Code breadth.

#### 27. Make rewind reachable — and make it actually capture

- **State:** BUILT AND COMPLETELY UNREACHABLE server-side; NOT CAPTURING at all
- **Effort:** large

Merges three reports of one capability. checkpointStore (baseline tracking, content-addressed blobs, MAX_CHECKPOINTS=100, pure planRestore + applyRestore) and four routes are complete and covered by a test file that is their only caller. Two independent things are missing and shipping either alone produces a well-engineered no-op: (a) no client anywhere — no checkpoint client, no per-turn control, no chord, no palette row; (b) nothing captures — trackSessionWrite's one production call site is PUT /api/file gated on a sessionId that web2 never sends (the string appears zero times in non-test web2 source), and generateAndApply, the git routes and ACP subprocess writes bypass it entirely. That is precisely the 'failure that looks exactly like the feature working' the file's own header warns about. Move tracking to a chokepoint every write passes, thread a session id, add auto-capture at turn boundaries, then build a plan-then-confirm restore surface. Note CANON.md §2/§3 currently counts checkpoint-and-rewind as shipped.


### Phase 4

#### 28. Stop advertising four lifecycle hook events that never fire

- **State:** PARTIAL — two of six events real and tested; four unbuilt but advertised
- **Effort:** small

Honesty defect, not a breadth request. Two events fire end to end with exit-code-2 blocking and 28 tests (pre-write gating PUT /api/file, pre-commit gating the commit); the other four are typed in HOOK_EVENTS, three of them listed as blocking, accepted by parseHookFile, returned by GET /api/hooks as available, and rendered by name with a blocking badge in Settings — and have zero call sites in any package. A user writes `pre-tool`, trusts the repo, sees it listed, and nothing ever runs. Canon puts 29-event parity explicitly out of scope, so the canon-aligned fix is (b): shrink HOOK_EVENTS/BLOCKING_EVENTS to the two that fire so the API and Settings stop promising the rest. Wiring pre-tool/post-tool into the ask loop is defensible later on its own merits, not as parity.

#### 29. Post-attach onboarding and visible shortcut hints

- **State:** PARTIAL — pre-attach complete; post-attach absent in every form
- **Effort:** medium

Pre-attach empty states are genuinely strong; the moment a repo attaches, guidance stops dead. No walkthrough, no first-run flag in shellStorage, no help or shortcuts command, no keycaps in the palette, no chord text in any title or aria-label, no Help menu in the Electron shell. The two chords that exist (Cmd/Ctrl-K, and the board's Escape/0/1/2/+/-) are documented only in source comments. Ranked here rather than phase 1 because ranks 7-8 remove the reasons the palette is currently embarrassing to point at; teaching a chord whose first row says 'not mounted' would be worse than silence. A shortcuts overlay and a welcome tour both shipped once in the deleted packages/web — do not restore them, rebuild against the sheet.

#### 30. A rail that a keyboard can move through

- **State:** ABSENT — plain ul/li/button list, only aria-expanded on file rows
- **Effort:** medium

Every one of ~500 rows is its own tab stop, so a keyboard user tabs through the entire repository index to reach the bottom, arrow keys do nothing, and a screen reader announces a list of buttons rather than a hierarchy. Needs role=tree/treeitem, aria-level/setsize/posinset, a roving tabindex, arrow expand/collapse, Home/End and type-ahead. The repo has working precedent to copy in CommandSurface (combobox/listbox with aria-activedescendant) and PaneResizer (role=separator with arrows). Sequenced after ranks 13, 15 and 21 because the row set and the reveal behaviour it must navigate are changing underneath it.

#### 31. Attachments — paste an image, drop a file, paste long text as a chip

- **State:** ABSENT at all four layers — no orphaned module, no dead handler, nothing to wire
- **Effort:** large

A user who wants to show the assistant a screenshot, a stack trace or a log has no path at all; the reference must be a repo node or nothing. Genuinely absent at four layers simultaneously, which is why it is not cheap: no onPaste/onDrop and no file input in Composer; ContextChipKind closed to node|file|function with no shape for pasted content; no route accepting multipart, FormData or a base64 payload; and the ACP client sends a hardcoded text-only content block array. Local-first must hold — attachments stay on disk in .sequence and never require a network. Start by widening ContextChipKind and the prompt content array.

#### 32. Wire the compaction service that already exists, once history ships

- **State:** BUILT BUT UNREACHABLE (orphaned library); the /context and /compact surfaces are absent by choice
- **Effort:** medium

Only becomes real the moment rank 1 lands: today there is no conversation context to compact, which is why this reads as absent rather than broken. llm/compaction.ts (pinned decisions, grounded evidence refs, unresolved actions, source turn hashes, versioned records, hard 32KB cap) and modelSessionService (automatic compaction at 12k tokens, 4-turn verbatim tail, LRU, idle TTL, per-key serialization) are complete and covered by model-session-compaction.test.ts, with ADR-013 Phase C checked off — and createModelSessionService and requestModelRequest have no non-test callers, so the provider.ts seam is fed by nobody. Scope this to wiring the seam, not to building a /context meter: a budget UI is Claude Code surface parity, and coverage — edges seen vs total — is the number this product actually owns.

#### 33. Render the drill-down crumb trail

- **State:** ABSENT — dead state stub with a test pinning it as never-written
- **Effort:** small

Open a service, look inside, and the only move is all the way back out. GraphScope.trail: ScopeCrumb[] is declared with the comment 'How the reader got here, for the crumb trail', seeded in initial state, pushed by no action, popped by no reducer, rendered by nothing, and locked as never-changing by canvasReduce.test.ts. A crumb trail is the one-canvas-shaped answer to navigation history; tabs and splits are not (see notes). Small: an action, a reducer arm, and a row above the board.

#### 34. A palette worth opening — real coverage, fuzzy ranking, keybinding hints

- **State:** PARTIAL — nine literals, non-fuzzy by design, no registry, no hints
- **Effort:** medium

Nine hard-coded literals, substring-only matching on the label, and rows that teach the user nothing. Capabilities that exist and cannot be reached from it: board camera keys, undo, the Architecture/Whiteboard switch, the rail filter, and (after phase 1) the overlays. There is no command registry anywhere in the tree, so this is a small architecture step — a registry, a matcher, a shortcut table for hints — not a list edit. The `commands` prop on CommandSurface is already the right seam with exactly one caller. Deliberately after ranks 7-8: the palette must first not be broken and must be findable.

#### 35. Slash commands in the composer — only with an owner ruling first

- **State:** ABSENT and deliberate — no `/` detection, no chat-lane command list, absence locked by test
- **Effort:** medium

Every capability that is not 'type a question' lives behind a menu or a chord the user must already know, and the four-item + toolbelt is the entire discoverable action surface of a turn. But this absence is stated as a deliberate constraint in the design source (sheet 12.4, quoted in composerModel.ts's placeholderFor) and asserted by a passing test, so building it is a sheet change that needs a numbered decision in GRAPHITE-DECISIONS.md — not an agent's call. If ruled in, scope it to commands that already exist behind the palette and the toolbelt rather than importing Codex's 24. Tracked as P15 in docs/research/v2-architecture-and-gaps.md:479.


### Phase 5

#### 36. Change stats on the run list

- **State:** ABSENT for runs — Review-scoped stats exist and are correct; the run transport carries no counts
- **Effort:** medium

With several runs in the activity view a user cannot tell which touched forty files and which touched one without opening each. The stat exists two clicks away in Review and is not carried up to where triage happens — but the transport does not have the data either: ProgramRunSummary/ProgramRunRecord carry node counts, timings and errors and nothing computes numstat or shortstat anywhere. Three layers of new work (compute per-run stats, extend the summary type, render the row), which is why it sits below everything a first session touches. WorkOutcome{kind:'diff',added,removed} is rendered by WorkRowLine and never constructed — a dead adjacent branch, not a head start.

#### 37. Resume a paused program run, or stop telling users it can be resumed

- **State:** PARTIAL — scheduler primitive complete and tested; every layer above it absent
- **Effort:** medium

Pause is a one-way door: a 40-node run paused to look at something can only start again at node one and pay for every completed node twice, and a server restart stamps every live run `interrupted` for ever. The scheduler primitive is complete and unit-tested (RunOptions.resume, completedNodeIds skipping, retryNodeIds, checkpoints persisted on every onCheckpoint) and the entire application layer above it lacks the seam — no checkpoint field on StartRunInput or the wire request, no resume method on the ProgramRunner interface, no route, a GET-only client. Meanwhile notifyModel.ts:132 tells users a paused run 'can be resumed', which is false today; fixing that string is the small honest half and should not wait for the rest.

#### 38. Repo-wide text search, narrowed to what already exists

- **State:** BUILT BUT UNWIRED as an agent-internal tool; absent as a user capability
- **Effort:** medium

'Where is this string used?' has no answer inside the product: the rail filter is name-and-path only and no /api/search route exists. The honest scope here is NOT a Cursor search view — it is exposing executeSearchFiles, which already exists as an agent-only tool in the ask loop, as a route with a results surface, and being plain about its limits (substring only, always case-insensitive, glob include only, no regex, no context lines, capped at 20 results over 200 files). Ranked last of the navigation cluster because this product's real answer to 'where is this used' is the graph and its blast radius, which is the advantage canon actually names.

#### 39. Headless CLI: emit the event stream that already exists

- **State:** PARTIAL — the pipe half is genuinely shipped; the event stream is built and not emitted from the CLI
- **Effort:** medium

Narrowed hard from the original gap. Machine-readable progress from CI is nearly free — the AskStreamEvent union and the SSE route are fully built and used by the browser, and askCli.ts:347 simply calls runAskPipeline with no emit callback, so --output-format stream-json is a callback plus a serializer. Everything else on that gap (--resume/--continue, --append-system-prompt, --allowedTools) is `claude -p` parity and is breadth; --max-turns arrives free with rank 14. Also worth a line in the ask usage text: SEQUENCE_PERMISSIONS and .sequence/permissions.json already give headless tool control and are undocumented, so the honest statement is 'no per-invocation flag', not 'no control'.

#### 40. Decide whether the ACP lane is a product or dead weight

- **State:** BUILT AND UNREACHABLE — no session/load, no MCP forwarding, no production caller
- **Effort:** medium

Not a feature request — a scope question that should be answered before more is built on it. Neither /api/acp/run-node nor createAcpExecutor has a single non-test caller: no web2, desktop, ink or gateway code posts to the ACP endpoints, and programRunner never installs the ACP executor, so the whole lane is unreachable by any user. The two reported gaps inside it (no session/load, so a re-run re-derives everything and re-bills for it; hardcoded mcpServers: [], so a driven agent cannot reach any MCP server Sequence itself connects) are real but only matter after someone can reach it. Live-session reuse via acpSessionCache exists and is well tested — that is reuse, not resumption, and it dies with the process.

#### 41. A chat turn that outlives its HTTP connection

- **State:** ABSENT for the ask path; shipped and proven for program runs
- **Effort:** large

Close the tab, sleep the laptop or lose wifi mid-answer and the turn is gone along with everything it already read and paid for. The durable pattern is already proven in this repo — commit-before-yield, an id-numbered log, ?since= replay — and is used only by /api/program/runs/:id/events; the ask stream writes `data:` with no `id:` line at all, which programRunStore's own header calls out as exactly why a blip loses the turn. Large, structural, and correctly last: rank 12 removes the common case (a reload), and the rare case is worth doing properly rather than cheaply.

