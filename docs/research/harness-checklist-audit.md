# Harness-engineering checklist — audit of this repo

**Measured 2026-09-01** against the owner-supplied rubric (12 checks + 2 structural ideas).
Read-only audit: no code changed. Every row below carries `file:line` evidence; where a
capability exists on one code path and not another, the row says so, because "we have X" and
"X is reachable on the path that matters" are different claims and this repo has both shapes.

Two paths run agents and they are **not** equivalent. Throughout: **ASK** = the chat/tool loop
(`askPipeline.ts` + `askTools.ts`, also the headless `sequence ask` CLI and the SWE-bench
adapter). **PROGRAM** = server-side program runs (`programRunner.ts` + `schema/scheduler.ts`,
including ACP agent nodes). A capability on one is not a capability on the other.

---

## 1. The scorecard

| # | Check | Verdict | Evidence |
|---|---|---|---|
| 1 | Success defined before execution (goal/inputs/output/constraints/done_when) | **PARTIAL** — prose for humans, nothing for a run | `.cursor/skills/agency-loop/SKILL.md:119-130` (6-field owner-problem contract), `:165-184` (builder brief: CONTEXT DIET / MAY TOUCH / MUST NOT TOUCH / DELIVERABLES / GATE / MAX 40 tool calls), `.cursor/rules/owner-seat-ui.mdc:25`, and `:13` "'Tests pass' is never Done when". But `AskPipelineInput` (`askPipeline.ts:294-386`) carries `question`, `permission`, `maxRounds` — no goal, no output shape, no acceptance. `Program` (`schema/program.ts:212-219`) carries nodes/edges/state — no acceptance either. The string `done_when` appears **nowhere** in `packages/`. |
| 2 | Right knowledge without loading everything (map, not manual) | **PARTIAL** | Real map: the scanned graph + digest, and `AskPipelineResult.coverage` (`askPipeline.ts:152-163`) which reports what the answer could *not* see. Progressive disclosure: `harness/skillLoader.ts:49-72` (summaries always) + `:127-149` (one body on match). Doc index is CI-enforced (`tools/ci/docs-catalog.test.mjs:1-8`). Human-agent diet rules: `CLAUDE.md:18`, `AGENTS.md:208`, `docs/research/subagent-failure-diagnosis.md`. **Weak:** `docs/codemap/codemap.lock` pins commit `bb6deb96`, `generated_at 2026-08-05`, and its `scanned_scope` still lists `packages/web` — deleted 2026-08-20. Nothing in CI checks codemap freshness. `matchSkillBody` returns the **first** match on a ≥4-char substring of any description word (`skillLoader.ts:140-166`) — a coarse matcher, one body, no ranking. |
| 3 | Every tool has a contract and a failure state | **SOLID**, with two named holes | One registry is the source for both the provider schema and the UI verb: `askTools.ts:3426+` (`ASK_TOOL_REGISTRY`), projected to OpenAI defs at `:3658`. Uniform result shape `{ ok, evidence, … }` at `:825-871`; unknown tool refused honestly at `:919`; per-tool caps are constants (`:531`, `:543`, `:546`, `:584`, `:589`, `:591`, `:640`); command refusals carry an actionable `refuseReason` (`harness/verifyGate.ts:229-266`). Holes: canvas tools (`askTools.ts:883-918`) and `fetch_url` (`:925-927`) return **before** the allowlist check at `:919` and the permission check at `:954`. Historical precedent for taking dead contracts seriously is in `schema/program.ts:99-131` (three declared agent fields deleted for being read by nothing). |
| 4 | Execution isolated from production | **MISSING** (product) / present only in the bench | The only containment is a path jail — `jail.ts:33-85`, careful and layered, but it constrains *where in the repo*, not *whose tree*. Writes land in the user's live checkout: `applyAskFileWrites.ts:86-88`. The sandbox shell is explicitly never enabled by the app: `askPipeline.ts:1109-1115` and `askTools.ts:685-695` ("NEVER set for the product"), `:2208`. Worktrees exist but only as a manual handoff endpoint (`gitWorkspace.ts:631-659`, `:913`; `POST /api/git/worktree`) — no run creates one. ACP agent nodes write the tree with their own tooling, outside jail, hooks and policy (`runChangeStats.ts:14-22`). The terminal declares its own bypass (`terminal.ts:13-48`). Concurrency is unsound by admission: `runChangeStats.ts:31-41` — two runs on one tree cannot be separated. Only the SWE-bench adapter gets real isolation, from the container, not from us (`tools/bench/claw/sequence_adapter.py`). |
| 5 | Important decisions stored outside the conversation | **SOLID** for state; **MISSING** for decisions-as-such | Everything durable lives under `<repo>/.sequence/` (`store.ts:20`): `checkpoints/<sessionId>/{checkpoints.jsonl,tracked.json,blobs/}` (`checkpointStore.ts:14-17`), `program-runs/<runId>/{run.json,events.jsonl}` (`programRunStore.ts:4-11`), `ask-turns/<runId>/events.ndjson` (`askTurnLog.ts:44-49`), `trajectory/<runId>.json` (`trajectoryStore.ts:1-12`), `refinements/<id>/` (`harness/refineProposal.ts:102-127`), `runs/results.tsv` + `program.md` (`programMemory.ts:29-60`), `permissions.json` (`permissionRules.ts:53`), sessions/board/canvas (`sessionsStore.ts:49-80`). Reviewable-text-in-repo is a stated law (`permissionRules.ts:18-24`). **But** the grounded ADR builder — `schema/decisionRecord.ts:263` `buildDecisionRecord` / `:381` `decisionRecordToMarkdown` — has **no non-test caller in any package**. Decisions the agent makes are recorded as events, never as a decision record. |
| 6 | Every risky transition has evidence (sensors) | **PARTIAL** | Strong sensors exist: `harness/verifyGate.ts:328-350` (`runDesignatedVerify`, and `isVerifyPassed` is true only for `passed` — a skip is never a pass, `:348`); the syntax gate compile-checks every written `.py`/`.js` and appends the failure to the same round's tool result (`askPipeline.ts:438-512`), plus a Python import smoke that blames the file, not the environment (`:470-505`); the claim check / lie detector against the scan (`askPipeline.ts:174-208`); `coverage` on every answer; `graphChecker` and the program `checker` node (`schema/program.ts:164-171`). CI is a genuine sensor bank (see #13). **Missing:** the verify contract on an edit turn is *prompt nudging*, not enforcement — the model is told its edit is unverified (`askPipeline.ts:1289-1305`, two demands then the turn ends anyway); nothing refuses to finish an unverified write. Program `agent` nodes have no verify at all. `runDesignatedVerify`'s `command` kind is still the four-command allowlist (`verifyGate.ts:29-34`); only ask `run_command` under Full gets the widened runner list (`:151-175`). |
| 7 | Irreversible actions protected by approval | **PARTIAL** — real algebra, no approval channel, and the runner has none | Genuine and well built: three lists with a stated precedence (`permissionRules.ts:474-497`), four path-anchoring forms (`:336-360`), managed/project/user sources (`:697-757`), circuit breaker (`:780-799`, `DEFAULT_DENY_STREAK=3` at `:72`), serialized to a diffable repo file with `$schema` and `version` (`:59-62`, `:633-660`). Four permission modes gate autonomy, and the default is not auto-write (`applyAskFileWrites.ts:94-96`). **But:** (a) `ask` never asks — it refuses, because "THERE IS NO APPROVAL CHANNEL OPEN IN AN ASK TURN" (`askTools.ts:947-952`, `permissionRules.ts:522-528`); (b) with no permissions file the default is `allow` and nothing is gated (`permissionRules.ts:177-183`); (c) **the program runner never loads or evaluates a policy** — its only gates are the command allowlist and the `.sequence/program.md` edit globs; (d) `requiresApproval` on program command nodes (`schema/program.ts:142`) is read by **nothing** — a grep across every package returns the declaration alone; (e) `fetch_url` and canvas tools dispatch before the gate (`askTools.ts:925`, `:883`), so a `deny fetch_url(...)` rule parses, validates, and never fires; (f) hooks fail open and only two of six events have a call site (`hooks.ts:66-85`, `HOOK_EVENTS_LIVE = {pre-write, pre-commit}`); (g) there is no approval *ledger* — rules are persisted, consents are not. |
| 8 | Every loop has a retry cap and a budget | **SOLID** | Round caps: `MAX_ASK_TOOL_ROUNDS=8` (`askTools.ts:216`), `FULL_EDIT_ASK_TOOL_ROUNDS=16` (`:316`), `ASK_ROUNDS_CEILING=32` (`:396`) with the reasoning that an override raises a limit and never removes one. Progress budget, not just a count: `UNPRODUCTIVE_ROUND_LIMIT=2` / explore 3 (`:347`, `:357`), scaled with a raised grant (`:360-380`). Write budget `ASK_TOOL_WRITE_CALLS_PER_TURN=16` (`:477`), once-per-turn latches (`:451`), evidence-ledger cap (`:640`), per-tool byte caps, command timeouts (`:591`, `:594`; `verifyGate.ts:181`). Provider retries clamped 0–5, default 0 (`provider.ts:2169`, `:486`). Scheduler: `maxSteps`, `timeoutMs` raced per await, `maxIterations` per loop (`schema/scheduler.ts:24-27`, `:673-699`). Money: `spendLedger.ts:31-39` (`committed + reserved + est <= hardCap`), `meter.ts:21-56`. Gap: the spend ledger is the **gateway** path only — a user-key ask turn has a round cap but no $ or token ceiling. |
| 9 | Can the run resume after interruption | **PARTIAL** — PROGRAM yes, ASK no | PROGRAM: `RunCheckpoint` with `completedNodeIds` and `retryNodeIds` (`schema/scheduler.ts:124-136`, `:317-327`, `:473`), resumable statuses (`programRunner.ts:191-208`), `resume()` at `:239`, wired end-to-end — `POST /api/program/runs/:id/resume` (`repoServer.ts:3522-3533`) and a UI button that only appears when a checkpoint actually exists (`web2/src/activity/ActivityPane.tsx:819-828`). Honest limits declared at `programRunner.ts:31-43`: nothing sweeps `.sequence/` at boot, so resume is always an explicit act. ASK: the turn log is durable, seq-numbered and commit-before-yield (`askTurnLog.ts:29-33`, `:98-106`) with a `?since=` replay route (`repoServer.ts:6178-6205`) — but socket close **aborts** the turn (`repoServer.ts:4172`, `:4179-4182`; `askPipeline.ts:388-394`). A reconnecting client replays what already happened; the work restarts from zero. (`askTurnLog.ts:9-19` still argues the provider runs on after disconnect — that comment is now stale.) |
| 10 | Can you explain every tool call and state change | **PARTIAL** | Everything streamed is on disk before the socket sees it (`repoServer.ts:4206-4215`), the trajectory doc lists only real events and invents no decision nodes (`trajectoryStore.ts:1-12`, `:138-146`), program runs have an append-only `events.jsonl` whose line ordinal *is* the SSE id (`programRunStore.ts:9-21`), and `command:log` carries cmd/exit/output (`askPipeline.ts:260-266`). **Gaps:** tool **arguments are never recorded** — `tool:start`/`tool:done` carry `{id, name?, evidence?}` only (`askPipeline.ts:228-229`), so a trace shows *that* `read_file` ran with a prose label, not what it was called with; there is no `permission:*` event, so a denial survives only inside an `evidence` string; the three bypassing tool paths emit no permission trace at all; ACP writes are invisible to the trace layer by construction (`runChangeStats.ts:14-22`); ask-turn logs are swept to the newest 50 (`askTurnLog.ts:49`). |
| 11 | Failure updates a guide/test/tool/policy | **PARTIAL — built, and dark** | The mechanism is real and grounded: `harness/refinePlanner.ts:1-27` reads persisted trajectories, finds a repeated **failure** pattern (≥2 failed asks sharing an intent, or a repeated file read across failed runs), and proposes the smallest evidence-backed edit — a `## Pitfalls` section on a matching `SKILL.md`, else a line in `.sequence/memory/NOTES.md`; it never writes the target itself. Accept is verify-gated and a failed gate returns 409 with the edit not landed (`api-types/src/harness.ts:104-115`), and there is a rollback (`refineProposal.ts:220-248`). `skillDistill.ts:1-23` distils successful clusters with no LLM required. **But nothing calls any of it.** The five `/api/harness/*` routes (`repoServer.ts:5645-5810`) have **no caller in `packages/web2`, no CLI subcommand, and no CI job** — grep returns the route definitions and the unit tests, nothing else. On the human side the loop is real: `docs/loop-log.md` per round, and two mechanical ratchets — `tools/ci/reachability-baseline.json` and `tools/ci/mutants.json` — where deleting a baseline row is the acceptance signal. |
| 12 | Can the final artifact be rolled back | **PARTIAL — and it misses the mode that needs it most** | The checkpoint store is the best-argued file in this area: baselines captured *before* the first touch so a restore is not a lie (`checkpointStore.ts:26-40`), "empty file" ≠ "no file" (`:117-130`), `planRestore` pure and `applyRestore` takes a plan so nothing acts without stating what it touches (`:44-49`, `:610`), missing blobs ⇒ refuse (`:441`), capped at 100 with a stored monotonic `seq` (`:19-25`, `:79`). **But `trackSessionWrite` has exactly one production call site — `repoServer.ts:2894`, inside `PUT /api/file`.** It is absent from `applyAskFileWrites.ts` and from `applyAskProposedFiles` (`repoServer.ts:7156-7190`). So **Auto-edit and Full — the two modes where the agent writes on its own — produce writes that no checkpoint can undo.** Checkpoints are also manual, not per-turn: the single production `captureCheckpoint` call is `POST /api/checkpoint` (`repoServer.ts:6298`), whose only client caller is the Review-pane apply (`web2/src/review/ReviewPane.tsx:376`). Refine rollback is real but confined to `.sequence/` (`refineProposal.ts:187-188`). There is no git-based revert path — git is used to measure and to commit, never to recover. |
| 13 | **Instructions become infrastructure** (each rule twice: guidance + mechanical check) | **SOLID — the strongest area in the repo** | 19 checks under `tools/ci/`, run as `node --test tools/ci/*.test.mjs` (`package.json:16`, `.github/workflows/ci.yml:54`). Several enforce a *named doc rule* verbatim: `graphite-freeze.test.mjs` (a brand sheet cannot change without a numbered decision in `GRAPHITE-DECISIONS.md` — exactly the rule `CLAUDE.md:39` states in prose), `canon-paths.test.mjs` (every path the authority docs point at must exist), `docs-catalog.test.mjs`, `merge-lanes.test.mjs`, `no-cron.test.mjs`, `inherited-constraints.test.mjs`, `repo-server-citations.test.mjs` (anchors not line numbers, after 87% pointer rot), `reachability.test.mjs` + baseline (the "built but not reached" ratchet), `mutants.test.mjs`, `no-control-bytes.test.mjs`, `api-types.test.mjs`, `dev-proxy.test.mjs`, `third-party-notices.test.mjs`, `p6-claims-ab.test.mjs`. `ci.yml:10` even cites the check that polices `ci.yml`. **Gaps:** there is no linter or git hook at all — every rule is a test file, which is fine but means a rule nobody wrote a test for is prose; the owner-problem contract in `owner-seat-ui.mdc` has **no** mechanical counterpart; codemap freshness is unchecked; `tools/qa-loop` and `tools/bench/*` are invoked by nothing in CI (`tools/qa-loop/README.md:7` — "Nothing in CI invokes this, which is why it was silent"). |
| 14 | **Change receipt per run** (context sources, policy version, model route, tools used, tests, corrections, retries, cost, artifact, rollback point) | **MISSING as an artifact; ~70% of the fields already exist, scattered** | Present somewhere: rounds / stopReason / wallMs / tokens / per-call latency (`askPipeline.ts:110-120`), `instructionHash` — a sha256 of the instruction belt, i.e. a real policy-version stamp (`askPipeline.ts:638`, `:705-716`), coverage (`:152-163`), tools executed (`:807`), commands with exit codes, files touched via git delta (`runChangeStats.ts`), spend (`spendLedger.ts`, `meter.ts`), the trajectory doc (`trajectoryStore.ts:56-82`), checkpoint `seq` as a rollback point (`checkpointStore.ts`). **Nothing assembles them into one record.** The headless receipt is the clearest proof: `sequence ask --json` emits `{text, coverage, usage}` and nothing else (`askCli.ts:595-601`) — no runId, no rounds, no stopReason, no tools, no model, no policy hash, no rollback point. Absent everywhere: **human corrections**, **retry counts**, and **model route**. The best receipt in the tree belongs to a bench script, not the product: `tools/bench/named-harness-shopfront-game-b.mjs:630-649` carries `measured_at` + `harness_version` + `git_sha` + `usd_spent`. |

### One-line summary

Strongest: **budgets/caps (8)**, **durable state (5)**, **tool contracts (3)**, and **rules-as-CI (13)**
— that last one is genuinely unusual and worth defending. Weakest: **isolation (4)** and the
**change receipt (14)**; and the three that are *built but not reachable on the path that matters* —
**rollback for agent writes (12)**, **the learning loop (11)**, and **approval on the program
runner (7)**.

### The pattern worth naming

Three of the five gaps below are the same defect, and it is the one `CLAUDE.md` and `CANON.md`
already name as this repo's dominant failure mode: **built but not reached.** `trackSessionWrite`
works and is called from one route. `planRefineFromTrajectories` works and is called from no
client. `requiresApproval` is a field nothing reads. Each was a real build; each stops one call
short of being a capability. `tools/ci/reachability.test.mjs` exists precisely to ratchet this
class down, and none of these three is on its baseline.

---

## 2. The five highest-value gaps

> **Status 2026-09-02 — all five are built, reached, and locked.** G2 `34be2e55` (gate hoisted
> above every dispatch branch; five lock tests proven by revert), G1 `fdb863e5` (agent writes
> checkpointed under Auto-edit/Full; restore puts pre-turn bytes back on disk), G4 `4d691ea4`
> (`sequence harness refine|distill|list` + post-error server hook), G5 `91c4e2c2` (`doneWhen`
> on the ask input and `--done-when` on the CLI; a refusal is never a pass), G3 `2a1e727e`
> (`.sequence/receipts/<runId>.json` on the stream route and the CLI; absent-not-zeroed). A
> 7-lens adversarial review then confirmed 19 findings, all fixed in the follow-up commit —
> among them: the done-when gate now runs UNDER the permission policy, a call that exhausts its
> retries still counts them, and `sequence ask --done-when` exits 7 when the gate fails.
> Declared, not built: the web2 pending-proposals row (G4), the SWE-bench adapter passing
> `--done-when` (it must not be handed the hidden tests), and per-run spend on the receipt (no
> per-run cost exists on the ask path). The scorecard above is the pre-batch measurement and is
> left as written; rows 1, 6, 7, 11, 12 and 14 no longer read as they did.

Ranked by (impact on agent reliability × cheapness to build). All five are wiring or assembly of
parts that already exist and are already tested — none needs a new subsystem.

### G1. Agent auto-writes are invisible to rewind

**Impact: highest.** Under Auto-edit and Full the agent changes the user's tree with no undo.
Rewind exists, is careful, and covers the one path where a human already clicked Apply. The
copy promises a restore point before a turn edits files; for the autonomous modes there is none.

**Sketch.**
- `packages/analyzer/src/server/applyAskFileWrites.ts` — add an optional
  `trackWrite?: (rel: string) => void` to `ApplyAskFileWritesOpts` and call it in the prepare
  loop, **before** `writeFileSync` at `:86-88`, for each accepted path. Keep the existing
  posture: a tracking failure never fails the write.
- `packages/analyzer/src/server/repoServer.ts` — accept `sessionId` on the `/api/ask` and
  `/api/ask/stream` bodies (parse next to `askPermission`, `:4035-4041`), validate with the
  existing `isCheckpointSessionId`, and pass a `trackWrite` closure into
  `applyAskProposedFiles` (`:7156-7190`) that calls `trackSessionWrite(activeRoot(), sessionId, rel)`.
- Also call `captureCheckpoint(root, sessionId, {label: 'Before <n> agent edits'})` once, on the
  turn's **first** write — mirroring the argument at `web2/src/review/ReviewPane.tsx:360-375`
  ("taken BEFORE the loop, because a restore point captured after the writes is a restore point
  to the state you are trying to escape").
- `packages/web2/src/chat/*` — send `checkpointSessionId()` (already exported from
  `web2/src/review/writeSession.ts`) on the ask request.
- Lock: a test that runs a Full-permission turn writing two files, then asserts
  `listCheckpoints`/`listTrackedFiles` see them and `planRestore` returns the pre-turn content.
  This is the shape `writeSession.ts`'s own header says was missing the first time.

### G2. Three tool paths dispatch before the permission gate

**Impact: high, cost: one code move.** `deny fetch_url(*)` parses, validates against
`knownTools`, produces no warning — and never fires. Canvas writers and design-mode proposals
have the same shape. Worse, the circuit breaker records those calls as `allow`
(`askPipeline.ts:640`), so a bypassed call *resets* a deny streak.

**Sketch.**
- `packages/analyzer/src/server/askTools.ts` — hoist the `if (ctx.permissions)` block (`:939-974`)
  to the top of `executeAskTool`, above the canvas branch at `:883`, the story branch at `:901`,
  the allowlist check at `:919`, the `fetch_url` early return at `:925` and the design-mode
  branch at `:928`. `permissionSubjects` (`:742`) already knows the `url` subject and
  `permissionRules.ts:378-380` already has the `url` match arm, so no new matcher is needed.
- Decide explicitly whether canvas tools are policy subjects; if they are not, say so in a
  comment *and* have `parsePermissionsDocument`'s `knownTools` reject a rule naming one, so a
  user who writes it gets the warning the module already promises (`permissionRules.ts:556-560`).
- Lock: `packages/analyzer/src/test/permission-rules.test.ts` — one case per bypassing tool
  asserting a `deny` rule actually refuses, plus one asserting the breaker counts it.

### G3. No change receipt — assemble one from fields that already exist

**Impact: high and compounding** (it is what makes every later regression arguable), **cost: low**
because nothing new needs measuring.

**Sketch.**
- New `packages/analyzer/src/server/runReceipt.ts` — a `RunReceipt` type and a pure
  `buildRunReceipt(...)`, written to `.sequence/receipts/<runId>.json` beside the trajectory,
  swept like `askTurnLog` does. Fields, all sourced from live values: `runId`, `startedAt`/
  `finishedAt`, `instructionHash` (the policy version — `askPipeline.ts:705-716`), model +
  provider route (`provider.ts` cfg), `permission` mode and the permission document's
  `version`/source labels (`permissionRules.ts:736-747`), `coverage`, tools executed with call
  counts (`executedToolNames`, `askPipeline.ts:1325`), commands run with exit codes, `metrics`
  (rounds, stopReason, tokens, per-call ms), provider retry count (`provider.ts:2169-2195` —
  needs a counter returned, the one genuinely new measurement), files written, spend
  (`spendLedger` reconcile), and `rollbackPoint` = the checkpoint `seq` from G1.
- `packages/analyzer/src/server/repoServer.ts` — write it in `finalizeTrajectory`
  (`:4245-4260`), where the terminal event is already in hand.
- `packages/analyzer/src/askCli.ts:595-601` — `--json` emits the receipt instead of
  `{text, coverage, usage}`; keep the three current keys at the top level so no consumer breaks.
- Honesty rule to carry into the type: a field that could not be measured is **absent**, never
  zeroed — the same argument `AskPipelineResult.coverage` already makes at `askPipeline.ts:158-162`.
- Leave `humanCorrections` out until there is a real producer. Do not add a field nothing sets;
  `schema/program.ts:99-131` is the standing precedent for what that costs.

### G4. Turn on the learning loop

**Impact: medium-high** (it is check 11 entire, and it is finished code), **cost: low** — the
engine, the verify gate, the accept/deny/rollback store and the tests all exist. What is missing
is a caller.

**Sketch.**
- `packages/analyzer/src/server/repoServer.ts` — after `finalizeTrajectory` on an **error**
  terminal, call `planRefineFromTrajectories(repoRoot)` (cheap, no LLM, returns `null` when
  there is no repeated pattern) and persist the proposal. It must stay a *proposal*: the planner
  never writes its target and the accept path is verify-gated (`api-types/src/harness.ts:104-115`).
- `packages/web2/src/…` — a pending-proposals row wherever refusals already surface, with
  Accept / Deny / Rollback bound to the three existing routes, showing `trigger`,
  `evidenceRefs.runIds` and a `before`/`after` diff. This is the piece with no code today.
- Alternatively, or first, a `sequence harness refine` / `sequence harness distill` CLI
  subcommand in `packages/analyzer/src/cli.ts` — cheapest possible caller, and it makes the loop
  testable from CI.
- Add the routes to `tools/ci/reachability-baseline.json` so the ratchet holds them once a caller
  lands.

### G5. Make the verify contract a real gate, and give a write turn a `done_when`

**Impact: medium-high** (checks 1 and 6 are the two structurally weakest rows, and they are the
same missing idea), **cost: medium** — the machinery is built, only the binding is missing.

Today an edit turn is *told* its edit is unverified and then ends anyway
(`askPipeline.ts:1289-1305`). `runDesignatedVerify` and `isVerifyPassed` already encode the right
law — only `passed` counts, a skip is never a pass (`verifyGate.ts:328-350`).

**Sketch.**
- `packages/api-types/src/ask.ts` + `askPipeline.ts:294-386` — add an optional
  `doneWhen?: { kind: 'command'; cmd: string } | { kind: 'skip'; reason: string }` to the ask
  input. `skip` must carry a reason, so declining the gate is a recorded choice rather than a
  default.
- `packages/analyzer/src/server/askPipeline.ts` — when `doneWhen.kind === 'command'` and the turn
  wrote a file, run it through `runAllowlistedRepoCommand` (already used by the syntax gate at
  `:449`) before the terminal event; put the `VerifyResult` on the result and in the G3 receipt,
  and make the answer's closing sentence state it. Failing verify does **not** revert the edit —
  it is named, and G1's checkpoint is the rollback point.
- `packages/analyzer/src/askCli.ts` — a `--done-when "<cmd>"` flag. This is what turns the
  SWE-bench adapter from "did it write a patch" into "did it write a patch that passes the
  command we named before it started", which is the rubric's check 1 with teeth.
- Widen `VERIFY_COMMAND_ALLOWLIST` (`verifyGate.ts:29-34`) or route `doneWhen` through
  `isRunnerCommand` (`:166-175`), or the gate is inert on any repo that is not this monorepo —
  the exact defect the block comment at `:246-257` already records for `run_command`.

### Runners-up (real, but a worse impact ÷ cost ratio)

- **The program runner evaluates no permission policy at all.** Loading `loadPermissionPolicy`
  and gating `command` nodes is cheap; gating ACP agent nodes is not, because those writes never
  pass through us (`runChangeStats.ts:14-22`). Half a fix here risks advertising a boundary that
  is not enforced — the exact thing `schema/program.ts:99-131` deleted three fields for.
- **Hooks fail open and 4 of 6 events never fire** (`hooks.ts:66-85`). The honesty is already
  documented; adding `pre-tool`/`post-tool` call sites in `executeAskTool` would close check 7
  further, but it is breadth, and CANON rules breadth out of scope.
- **Codemap freshness has no CI check** while `codemap.lock` is four weeks stale and names a
  deleted package — a `docs-catalog`-shaped test comparing `current_commit` against `HEAD`
  (or just asserting `scanned_scope` paths exist) would cost an hour.
- **Tool arguments are absent from every trace** (check 10). Adding `args` to `tool:start`
  requires a redaction pass first (paths and command strings are fine; `propose_files` bodies
  are not), which is why it is not in the top five.

---

## 3. Where this repo is genuinely strong

Stated plainly, because the point of an audit is calibration, not flattery in either direction.

- **Rules are enforced by tests, not by prose.** Nineteen CI checks, several of which police a
  specific sentence in a specific doc, including one that polices the CI file itself. Most
  codebases have the guidance half and nothing else.
- **The budget model is about progress, not counts.** `UNPRODUCTIVE_ROUND_LIMIT` measured over an
  id-independent evidence signature (`askTools.ts:347`, and the reason the id must be excluded)
  is a better loop guard than a round counter, and the comments carry the measurement that
  produced each number.
- **Honesty is load-bearing, and enforced in types.** `isVerifyPassed` refusing to count a skip;
  `coverage` absent rather than zeroed when there is nothing to measure; `askMetricsFromTerminal`
  returning `undefined` over an invented shape; `HOOK_EVENTS_LIVE` kept separate so the four dead
  events are declared dead rather than quietly advertised. The comment at `schema/program.ts:99-131`
  deleting three fields for being read by nothing is the standard the five gaps above should be
  held to.
- **The failure archaeology is real.** Nearly every cap, retry and gate in `askPipeline.ts` and
  `verifyGate.ts` cites the run that produced it (django-12304, sphinx-8035, django-11790, the
  mini-50 runs). That is what makes this audit possible at all: the code says what it learned.
