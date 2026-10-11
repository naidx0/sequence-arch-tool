# SEQUENCE V2 — THE REBUILD PLAN

**Status:** executable. Written 2026-08-20 from ten research lanes (four measuring this codebase, four surveying the field, two attacking the decision).
**Repo root:** `<repo>`
**How to use this:** each numbered section is self-contained. Hand §3 to an engine agent, §4+§6-W2 to a shell agent, §4+§6-W3 to a board agent. None needs to read the others. §5 and §7 are read-only context for whoever is deciding scope.

---

## 1. THE PIVOT

### 1.1 The owner's decision, verbatim

> "Nuke the entire actual UX/UI, everything. Keep only the logic that we have on the background, and remake the entire program from scratch. The only thing I like right now is the architecture board. Graphite is the source of truth for everything. Graphite is just truth. Forget how it used to look... Make sure it can rival and defeat Codex and Claude Code... then after you find the gaps, create a plan based off those gaps... not only on par with the competition, but better. Maybe better on token use because we have graphs to read, and we're better visually and so on. We're better at agent workflows."

### 1.2 What is thrown away

| Thrown away | Measured size | Why |
|---|---|---|
| All `.tsx` chrome in `packages/web/src` | ~145 files / ~30,000 LOC | The shell is the thing being replaced |
| `product.css` §3 compat layer + all 13 legacy sheets | ~23,000 LOC CSS (`styles.css` 5,240 + `styles/` 6,751 + `product.css:598-9658`) | 11,991 of those lines are already dead — `main.tsx:14-23` loads them only on `?popout=`, and `main.tsx:34-61` is a 27-line note from the previous author documenting that they paint nothing |
| 118 unreachable non-test source files | 15,607 LOC | No import path from `main.tsx` reaches them. Six abandoned canvases and boards, plus six dead modules inside the supposedly-firewalled `product/` tree |
| The source-grep test tier | 179 of 362 test files / 30,754 LOC (53.8% of the suite) | They `readFileSync` a component and assert on its characters. 64 of them already `ENOENT` on files deleted months ago. Zero render anything |
| 18 `ownerWalk*.test.ts` files | one per review round | Transcripts of arguments, several locking features *off* |
| Work mode, whiteboard, workflows surface, popout window, first-run tour, capability tray, L1/L2/L3 levels, isometric view | see §2.4 | Each justified individually in the CUT list |

### 1.3 What is kept, untouched

| Kept | Size | Note |
|---|---|---|
| `packages/analyzer` | 4,452-line HTTP server + scanner + explain + harness | The engine. Modified per §3.5, never rewritten |
| `packages/schema` | ArchGraph, SeqDiagramV1, FunctionGraph, Program, scheduler, plus 12 pure analysis engines (`impact`, `risks`, `cycles`, `placement`, `policy`, …) | Browser-safe, zero fs/network. This is the material asset |
| `packages/acp`, `packages/mcp`, `packages/export`, `packages/gateway` | 533 / 1,402 / — / — LOC | `packages/mcp` is the highest-leverage 1,402 LOC in the repo (§5.4) |
| **The architecture board** | 32 files / 6,425 raw lines in `product/arch/`, of which **~1,450 lines are pure, well-tested, React-free** | The one surface the owner named. Ported, not rewritten (§4.5) |
| 197 React-free modules | 30,548 LOC | `graph/` (7,650), `product/board/` models, `programs/` models, `panels/` models, `product/arch/` pure half. Salvage list in Lane 3 |
| `product.css:1-597` | 250 tokens transcribed from Graphite `_core.html` | Already Graphite. The one CSS asset worth carrying |

### 1.4 The one judgment call made against the order

The order was hardened by commit `315e7878` — *"demolition is literal"* — five minutes after the pivot commit. **This plan does not execute literal demolition on day 0.**

The old UI is not deleted until its replacement runs on the same repo, walks the five-verb loop end to end, and has been seen in a screenshot. The owner is away. He must not return to a dead app.

Two safeguards replace deletion as the anti-contamination mechanism, because contamination is a *process* risk with a *process* fix:

1. **Citation ban, enforced by review.** No v2 file may import from, or copy a class name, layout, or output format from, the v1 tree. This is already the ruling in `315e7878`; it is enforceable without `rm`.
2. **Trace-to-sheet requirement.** Every v2 surface names the Graphite sheet it implements, or names itself as unsheeted (§5.6 lists the eleven unsheeted surfaces).

The cutover was planned for Wave 7, *after* the replacement went green. It was **pulled forward**
and `packages/web` was deleted on 2026-08-20 in `20d1424` — deliberately, so that agents would stop
copying the old product. Read the Wave 7 rows below as history, not as pending work.

### 1.5 The pivot's own contradiction, resolved

`docs/PIVOT-V2.md` says *"Nothing is inherited — no layout, no component, no class name, no colour"* and four lines later *"The architecture board. The one surface the owner named as worth keeping."*

The board **is** a component (`ArchCanvasBoard.tsx`, 738 lines), with class names (`.arch-rf-*`, ~221 lines of `product.css`), a layout and colours. Both statements cannot hold.

**Resolution, and it is the plan's governing distinction:**

> **Pure modules are inherited. Rendered chrome is not.**

The board's 1,450 lines of pure logic — `orthogonalElbow.ts` (380, zero imports), `archKinds.ts`, `archLabels.ts`, `archLayout.ts`, `archNodeModel.ts` — are inherited verbatim. `ArchCanvasBoard.tsx`'s 603 lines of shell wiring (17 store selectors, two imperative `getState`/`setState` pokes, the draw bridge, the proposal bar, the scope bar) are rewritten, because they *are* the shell seam and any new shell replaces them regardless.

The same rule generalises to the whole tree: the 197 React-free files carry forward; every `.tsx` is authored fresh against Graphite.

### 1.6 Where the evidence says the owner's instinct is wrong

Stated plainly, because he asked for true over flattering.

1. **"Better on token use because we have graphs"** is measured at **1.15×–2.9×** against a well-formed grep, is **1.47× worse and less complete** than `rg -l` on a symbol, and is **10.4× worse** for orientation questions. *(Measurement snapshot below; code since then: `who_calls` ships `depth`, W1.7 hygiene landed, `scan_repo` no longer stamps a fixed 290k figure — Claims stay **UNVERIFIED** until the §5.5 A/B.)* Historically `scan_repo` emitted **465,538 tokens** while its description claimed 290k, and transitive closure was unshipped. Do not put a token-efficiency number in a deck until the A/B in §5.5 is run.
2. **"We're better visually"** describes a graveyard. Sourcetrail archived 2021. CodeSee acquired 2024, `codesee.io` returns HTTP 404. `repo-visualizer` archived. VS Code Maps is Enterprise-only. Sourcegraph's founders left to run a *terminal* tool with no graph. And Cognition shipped this exact thesis on **2025-11-04** (Windsurf Codemaps: graph view, click-to-source, `@codemap` into the agent) with nine months of iteration since. Visual understanding survives only as a *free feature inside a tool that already owns the workflow* — never as the product.
3. **"We're better at agent workflows"** was false in a specific, structural way at measurement time: v1 `runProgram` executed **in the browser** (`packages/web` — **deleted 2026-08-20**). *(Since then: `POST /api/program/run` + run list/events/cancel live in analyzer; web2 Activity starts workflows. Nesting depth vs Claude Code / Codex cloud task list remains a competitive gap — do not claim parity.)*
4. **The UI has never met a user.** Root `package.json` is `private: true, 0.1.0`. `git tag` → **0 tags**, across 1,346 commits since 2026-04-28. Every quantified defect the ten lanes surfaced — digest coverage, streaming, cancellation, progress, watching, `who_calls` recall, 7–8 s cache invalidation — lived in `packages/analyzer`, which the pivot preserves.

**What this changes in the plan, not in the decision:** the rebuild proceeds, because the shell is genuinely 4× oversized (75,388 LOC vs ml-harness's 18,628 for a better chat loop) and the test suite is fake safety. But the engine track (§6, Wave 1) runs **in parallel and is resourced first**, and the competitive claims are labelled UNVERIFIED in every artifact until measured.

---

## 2. THE PRODUCT IN ONE PAGE

*No history. This is the whole product.*

### 2.1 Who

> **Sequence is for the AI-assisted engineer who has a repo they do not fully understand, and who needs to see the system — not read files — before they change it.**

One persona: **Code**. "Work" mode (planning a non-code system) is deferred entirely — it has no repo, therefore no evidence, therefore the grounding invariant forbids the board from drawing anything. Shipping it as the cold-start default (`productStore.ts:451`) made the first-run session the *least* capable configuration of the product.

### 2.2 The core loop — five verbs

```
   attach a repo
        ↓
   scan  →  ArchGraph  →  .seqd  →  the canvas paints itself
        ↓
   ask in chat ("explain this", "what breaks if I change X")
        ↓
   the canvas moves: focus, path, proposal ghost
        ↓
   drill: click a node → what it is / its parts / its files
          click a function → the flow plays across services
        ↓
   act: propose files → review → Accept → rescan → back to the canvas
```

**attach · see · ask · drill · act.** A surface that does not serve one of those five is not in the product.

### 2.3 The one screen

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ▎Sequence   repo › diagram › surface       [Attach] [New] [⚙]               │  40px
├──────────────┬──────────────────────────────────────────┬───────────────────┤
│   CHAT       │            THE CANVAS                    │   THE RAIL        │
│   (driver)   │            (the workspace)               │   (drill)         │
│   ~380px     │            flex: 1, never < 50%          │   ~280px          │
│   collapsible│                                          │   OPEN by default │
│  ┌────────┐  │                                          │  files ▸          │
│  │composer│  │                                          │   └ functions ƒ   │
│  └────────┘  │                                          │                   │
└──────────────┴──────────────────────────────────────────┴───────────────────┘
```

Not tabs. Not routes. Not modes-as-pages. One screen, three panes, two collapsible.

Below 1100px the rail becomes an overlay; below 820px the chat becomes an overlay and the canvas holds the frame. Decide this in the model layer before any CSS (see R9, §7).

### 2.4 Canvas states — five, and only five

| State | Trigger | Canvas | Rail | Chat |
|---|---|---|---|---|
| **S0 Empty** | boot, nothing attached | one invitation: *Attach a repo* | empty, CTA suppressed (no duplicate) | composer usable, no key needed |
| **S1 Overview** | scan completes | whole system, ELK-laid, fit to content AABB | file tree, collapsed to packages | "Ask about this repo" |
| **S2 Focused** | node click or `@mention` | one node lit, its edges highlighted, rest dimmed | that node's files + functions with `:line` | breadcrumb chip |
| **S3 Playing** | function clicked in rail | call path animates hop by hop, each hop carries its evidence ref | function marked playing, steps listed | numbered trace |
| **S4 Proposed** | agent returns diagram or file change | ghost nodes/edges over the grounded doc, dashed, + one Accept/Deny bar | **unchanged** — the rail never shows unaccepted topology | rationale |

### 2.5 Chat drives — five turn outcomes

A turn resolves into exactly one canvas effect. This is a typed union in the store, not a set of imperative calls.

1. **`focus`** — S2/S3 on existing grounded nodes. No document write. Should be the most common outcome.
2. **`propose`** — S4. Ghost layer, Accept/Deny, never merges without a click.
3. **`answer`** — prose only. **The canvas does not move, and the turn says so.**
4. **`act`** — file-edit proposal. Real diff, per-file accept/reject, line comments (§5.2).
5. **`coverage`** — *carried on every one of the above.* "answered from 296 of 2,326 edges · analyzer only". See §5.4; this is the product's single differentiating chip.

### 2.6 The three invariants — break one and it is not Sequence

1. **The canvas is grounded, or it is blank.** Every node, edge, and claim traces to scan evidence with `file:line`. When the model has nothing, the board says so and does not move. A plausible-looking diagram nobody can trace destroys the reason the product exists — "a picture of your architecture" is a commodity; "a picture you can trust" is not.
2. **The canvas is the workspace; chat is its driver.** Not siblings. The canvas never defaults to the minority pane.
3. **Understanding and editing are one document.** One `SeqDiagramV1`. Drawing writes it, chat writes it, export projects it. Two boards showing two truths makes this Miro with extra steps.

---

## 3. THE ENGINE CONTRACT

*Hand this section alone to whoever codes the new shell's data layer. Everything the shell may call is here. Line numbers from `packages/analyzer/src/server/repoServer.ts` unless noted.*

### 3.1 Shape of the thing

One raw `node:http` server, 4,452 lines. No Express, no router, no OpenAPI, no generated client. Dispatch is a flat `if (pathname === … && method === …)` chain from `handle()` at **:853** to the 404 at **:3451**. **52 paths / 62 method+path pairs / 1 WebSocket.**

Responses go through `sendJson(res, status, body)` (**:507**). Requests are `JSON.parse` + hand-written narrowing. **There is no shared wire-type module** — this is engine gap G12 and the fix is build item W0.5.

**Single global repo.** `let repoRoot`, `let currentGraph`, `let repoOwner` are closure variables (**:634-671**), documented in-code: *"hosted mode is SINGLE-ACTIVE-REPO — one attached repo for the whole server."* A multi-repo UI is not expressible against this contract. Do not design one.

Guard legend: **S** = in `SENSITIVE_EXACT` (401 without session when auth is on, **:246-281**) · **R** = `requireRepo()` 409 (**:777**) · **O** = `requireOwner()` 403 (**:1029**).

### 3.2 Routes the new shell codes against

**Auth / identity**
| Method | Path | Line | Response |
|---|---|---|---|
| GET | `/api/me` | 898 | `{signedIn, availableProviders[], provider?, name?, email?}` |
| GET | `/auth/login/:provider` | 919 | 302 + PKCE state cookie |
| GET | `/auth/callback/:provider` | 940 | 302 `/` + session cookie |
| POST | `/auth/logout` | 993 | `{signedIn:false}` |

**Attach / browse** — the S0→S1 path
| Method | Path | Line | Request → Response | Guards |
|---|---|---|---|---|
| GET | `/api/status` | 1007 | → `{attached, repoName?, root?}` | S |
| GET | `/api/browse` | 1023 | `?path` → `BrowseResult {root, path, parent\|null, entries: BrowseEntry[]}` (`browse.ts:25-43`) | S |
| POST | `/api/attach` | 1038 | `{path}` → `{attached:true, repoName, root, graphSummary}` | S |
| POST | `/api/detach` | 1117 | → `{attached:false}` | S |
| GET | `/api/recent` | 1132 | → `{recent:[{path,name}]}` | S |
| GET | `/api/policies` | 1153 | → `LoadedPolicies` (`store.ts:114`) | R,O |

`graphSummary` = `{nodes, edges, services, datastores, topics}` (**:4143**).
Attach errors the dialog must render: 403 jail escape · 400 home-dir-itself · 404 missing · **422 `{error, code:'no-manifests', repoName}`** (**:1096**).

**The graph** — what the board consumes
| Method | Path | Line | Response | Guards |
|---|---|---|---|---|
| GET | `/archgraph.json` | 1399 | `ArchGraph & {nodeDetail: Record<string, SeqDiagramNodeDetail>}` | S,R,O |
| POST | `/api/scan` | 1532 | same, forces re-crawl | S,R,O |
| GET | `/api/tree` | 1407 | `TreeNode {name,path,type,children?}` (`tree.ts:5`) | S,R,O |
| GET | `/api/functions` | 1689 | `{functionGraph: FunctionGraph, warnings[]}` | R,O (**not S**) |
| POST | `/api/explain` | 1546 | `{profile?, detailLevel?}` → `{tree: PlainNode, mode:'ai'\|'structural', provider?, profile, projectType?, detailLevel}` | S,R,O |
| POST | `/api/annotate` | 1623 | `{detailLevel?}` → `{annotations: Record<nodeId,string[]>, mode, provider?}` | R,O (**not S**) |
| POST | `/api/ddl` | 2972 | `{spec?, scope?}` → `{sql}` | S,R,O |

`nodeDetail` is derived per graph by `seqdNodeDetailFromStructuralTree` (**:645-648**) — MADR slots `{whatItIs, whatItDoes, parts[], talksTo[]}` (`packages/schema/src/seqdiagram.ts:97`). This is what the breakout renders.

**Files & git**
| Method | Path | Line | Note |
|---|---|---|---|
| GET | `/api/file` | 1415 | `?path` → **`text/plain`**, not JSON |
| PUT | `/api/file` | 1456 | `{path, content}` → `{ok, path}`. **Clears the cache without rescanning** (**:1520**) — the graph is knowingly stale after this call |
| GET | `/api/git/status` | 3321 | `{branch, files:[{path,status}]}` |
| GET | `/api/git/diff` | 3333 | `?path` → `{path, diff}` |
| POST | `/api/git/commit` | 3354 | `{message, paths?}` → `{ok, commit?}` |

Write refusals to render honestly: 403 reserved root (`.sequence`, `.git`, `.ssh`, `.aws`, `.gnupg` — `reservedRoots()` **:3715**) · 409 decision-record exists (**:1493**) · 403 outside `program.md` allowlist (**:1503**) · 413 over `MAX_FILE_BYTES`.

**Ask** — the assistant contract
| Method | Path | Line | Body |
|---|---|---|---|
| POST | `/api/ask` | 1877 | `{question, intents?, context?, mode?, surface?, history?, jobMode?, design?}` → `{text, diagram?, unsupportedIntents?, usage?, source?}` |
| POST | `/api/ask/stream` | 2045 | identical body → **SSE**, `data: <AskStreamEvent>\n\n` |

`AskStreamEvent` union — `packages/analyzer/src/server/askPipeline.ts:82-114`, 16 variants:
`trajectory:start{runId}` · `intent:start/done{id}` · `file:read/done{path}` · `step:start/done{id}` · `tool:start/done{id,name?,evidence?}` · `edit:proposal{title?,files[{path,content}]}` · `command:log{cmd,exitCode,output,ok}` · `provider:start/done` · `advisor{severity,note}` · `usage{inputTokens,outputTokens,estimated}` · `result{text,diagram?,unsupportedIntents?,usage?,source?,advisor?}` · `error{error,providerResponse?,httpStatus?}`

**There is no text-delta variant.** The `result` event carries the entire answer at once. Time-to-first-token = full generation time. Fixed by W1.2.

**Sessions / memory / board / trajectory**
| Method | Path | Line | Shape |
|---|---|---|---|
| GET/POST | `/api/sessions` | 1193 | GET `{index: SessionIndex}` · POST `{mode?}` → `{index, session:{id,chat,meta}}` |
| PUT | `/api/sessions/active` | 1225 | `{activeId}` → `{index}` |
| GET/PUT/DELETE | `/api/sessions/:id` | 1250 | GET `{chat: ChatMemoryShape, meta: SessionMeta, boardSeqd?}` · PUT patch |
| GET/PUT | `/api/chat-memory` | 1353 | compat shim on the active session |
| GET/PUT | `/api/board` | 1163 | `SequenceBoardDoc {version:1,nodes,edges,ink?,viewport?}` (`packages/schema/src/sequenceBoard.ts:55`) |
| GET | `/api/trajectory/:runId` | 3087 | `TrajectoryDoc` (`trajectoryStore.ts:56`) |
| POST | `/api/trajectory` | 3111 | `TrajectoryDoc` → `{runId}` |

`SessionIndex {version:1, activeId, sessions:[{id,title,createdAt,updatedAt,pinned?,titleEdited?,mode?,clonedFromId?}]}` — `sessionsStore.ts:12-28`.
`ChatMemoryShape {version:1, sessionId, turns:[{role,text,at?}]}` — `sessionsStore.ts:36`. **Prose only.** No tool results, no file bodies, no proposal contents survive a reload. The v2 memory record must hold evidence (W2.6).

**Provider / metering / generation**
`GET|PUT /api/ai-config` (2272, redaction `provider.ts:444-455`) · `GET /api/usage` (2340) · `POST /api/generate` (2875) · `POST /api/prompt-file` (3003) · `POST /api/design-suggest` (2826) · `POST /api/research` (1714).

**Agents / MCP / GitHub**
`GET /api/acp/available` (2392) · `GET /api/acp/agents` (2403, **read-only, CLI-only registration**) · `POST /api/acp/run-node` (2428) · `GET /api/mcp/tools` (3401) · `POST /api/mcp/call` (3412) · `GET|PUT|DELETE /api/github` (2572) · `GET /api/github/repos` (2621) · `POST /api/github/clone` (2656).

**Harness**
`POST /api/harness/distill-skills` (3150) · `POST /api/harness/refine/plan` (3191) · `GET /api/harness/refine` (3222) · `POST .../:id/accept` (3234) · `/deny` (3278) · `/rollback` (3296). Accept runs a verify gate, returns **409 `{verify: VerifyResult}`** on failure (**:3255**).

**Programs (partial)**
`GET /api/program/strategy` (1774, 404 when absent) · `POST /api/program/run-log` (1795) · `GET /api/program/run-log` (1823 — **`requireOwner()` missing here** while its POST twin at :1797 has it).

**There is a `POST /api/program/run`** (plus run list/events/cancel) — G1 closed after this measurement. Historical note below still describes the v1 browser path.

**WebSocket** — `/api/terminal`, `packages/analyzer/src/server/terminal.ts:42`.
Protocol (**terminal.ts:245-253**): binary frames = raw stdin bytes; text frames = JSON control, currently only `{"type":"resize",cols,rows}`; stdout+stderr return as binary. Five ordered guards: path → origin → enabled → requireRepo → cap of 8 (`MAX_TERMINALS`, **:45**).
**It is a pipe shell, not a PTY** (**:238-252**): no TTY echo, no line editing, `vi` misbehaves, **resize is a documented no-op.** Any terminal UI inherits all three.

### 3.3 Types the shell must speak — `packages/schema`

Browser-safe, zero fs/network, exported from `packages/schema/src/index.ts` (418 lines).

**Graph core** (`index.ts:22-112`)
- `NodeKind = 'repo'|'service'|'datastore'|'topic'|'module'|'file'`
- `EdgeKind = 'http'|'grpc'|'queue_publish'|'queue_consume'|'db_read'|'db_write'|'db_access'|'import'`
- `EdgeOrigin = 'deterministic'|'llm'|'design'`
- `ArchNode {id, kind, label, parentId?, path?, meta?{language,framework,loc,pageRank,description,llmLabeled,tech,…}}`
- `Evidence {file, line, snippet, note?}`
- `ArchEdge {id, srcId, dstId, kind, confidence:0..1, origin, evidence: Evidence[], detail?{method,pathPattern,topic,table,url,envVar}}`
- `ArchGraph {version:1, mode?:'scan'|'design', scannedAt, repoRoot, repoName, nodes, edges, warnings}`
- `validateGraph(g): string[]` (**:166**) — total, never throws, even on `null`
- **`INTERACTION_SRC_KINDS` / `INTERACTION_DST_KINDS` (:145-163)** — the legality table any edge-drawing UI must enforce

**Function graph** (`functions.ts`) — `FunctionNode {id,name,file,startLine,endLine,lang,kind?}`, `FunctionEdge {id,srcId,dstId,kind:'call'|'http'|'grpc'|'queue'|'db',confidence?,label?}`. Deterministic ids: `fn:${file}#${name}@${startLine}` (**:39**). This repo: **5,990 nodes / 7,759 call edges** and **no agent-facing surface**.

**SeqDiagram v1** (`seqdiagram.ts:197`) — `SeqDiagramV1 {version:1, kind, title, grounded{graphId,repoPath?,scopeNodeIds?,origin,unknowns?}, theme?, nodes, edges, groups?, flows?, primaryNodeIds?, boundaries?, externalDependencies?, unknowns?, layout{engine,direction}, projections{mermaid?,capNote?}, meta{diagramFamily:'software'|'process'}}` + `validateSeqDiagram` (**:288**).
**`groups?: SeqDiagramGroup[]` is declared at :205-206 and validated at :530-542, and nothing in the tree populates it.** That is the containment gap (W6).

**Board VM** (`board.ts:32`) — `PlainNode {id, title, summary?, kind, children[], sourceRefs[], edgeRefs?}`.

**Programs** (`program.ts`) — `ProgramNodeKind = start|end|agent|command|parallel|branch|loop|state|checker` (**:54**); `ProgramEdgeKind = seq|parallel|branch-true|branch-false|loop-body|loop-back` (**:164**); `Predicate` is a safe 8-op form, never eval (**:46**). Scheduler types incl. **`RunCheckpoint` (`scheduler.ts:116`) — checkpoints already exist in the type system and have no runtime.**

**Pure analysis engines, all browser-safe** — `impact.ts` (`computeImpact`, `ImpactRole='selected'|'impacted'|'dependency'`), `risks.ts`, `cycles.ts`, `riskDelta.ts` (`diffRisks`), `placement.ts`, `classify.ts`, `graphChecker.ts`, `policy.ts`+`policyChecker.ts`, `domain.ts`, `decisionRecord.ts`, `programMermaid.ts`. **This is the material advantage over a chat-only competitor and most of it has no UI.**

**ACP** (`packages/acp/src/index.ts:15-25`) — `AcpClient.start/newSession/prompt/dispose`; `AcpPromptResult {stopReason, text}` (**client.ts:65**); config exposes **`onUpdate(SessionNotification)` (:101)** and **`onPermission(req) → 'allow'|'deny'` (:99)**; `defaultPermissionPolicy` (**:112**) allows only `['read','fetch','search','think']`.

**MCP** (`packages/mcp/src/index.ts`, `TOOLS` at **:363-453**) — 8 tools: `scan_repo` (365), `who_calls` (379), `explain_repo` (397), `plain_tree` (405), `classify_repo` (413), `design_suggest` (423, needs key), `validate_diagram` (432), `export_diagram` (440). All return `ToolResult {content:[{type:'text',text}], isError?}` — structured error, never a throw. `who_calls` returns `GraphQueryAnswer` (`graphQuery.ts:77`) with `alsoNamed`, `didYouMean`, and **`omitted:{callers,callees}`** — nothing is dropped silently, which is exactly the property a token-efficient agent tool needs.

### 3.4 Where the data comes from — the S0→S1 path in full

```
archgraph.json (ArchGraph)
  └─ loadAttachedGraph()                      product/attachFlow.ts:93,:123
      └─ seqdFromGraph(graph, nodeDetail)      product/board/seqdFromGraph.ts:158  → SeqDiagramV1
          └─ store.seqdDoc                     productStore.ts:199 (hydrateGraphIntoBoard :191)
              └─ docWithProposalOverlay()      ProductBoard.tsx:113  (ghost merge)
                  └─ <ArchCanvasBoard doc>     ProductBoard.tsx:229  (lazy — RF is 374 KB of entry)
```

Inside the board: level filter → ELK layout (worker) → annotations fetch → `buildArchFlowModel` projection (`archNodeModel.ts:110`) → render. Full mechanism in Lane 4 §3; the v2 host reproduces it with a different store.

### 3.5 Engine gaps that must close for the UI to be good

Ranked by how much of the rebuild each blocks. **G1–G6 are Wave 1 build items.**

| # | Gap | Evidence | Blocks |
|---|---|---|---|
| **G1** | **CLOSED (finish-open P4).** Server `POST /api/program/run` + run ids / events / cancel; web2 Activity starts workflows. *(Historical measurement: v1 `runProgram` in deleted `packages/web`.)* | — | Nesting/parity vs Claude Code still owner/competitive, not this gap |
| **G2** | **CLOSED for token deltas.** Ask SSE emits `delta` via `askPipeline` + `stream:true` in `provider.ts`. *(Historical measurement: no stream.)* Seqd/incremental diagram stream stays parked (P8 / `seqd-stream-park.md`) | — | Fake seqd stream events still refused |
| **G3** | **CLOSED for ask Stop.** Client aborts fetch; `requestAbort` + provider `fetch({signal})` + askPipeline loop checks; metering races abort before `recordUse`. *(Historical: AbortController only on ACP run-node.)* Other AI routes’ Stop chrome may still be incomplete | — | Ask path Stop is real |
| **G4** | **No progress on long operations.** `/api/scan`, `/api/explain`, `/api/functions`, `/api/github/clone` are single blocking calls with no event emission | file | S0→S1 has a spinner and nothing else |
| **G5** | **CLOSED (finish-open P5 PARTIAL).** `repoWatch` (`fs.watch`) arms on attach → `markGraphStale`; UI Retry rescans. Still PARTIAL: scanner does not read `.gitignore`; B7 not built. *(Historical: grep found 0 watchers at measurement time.)* | — | Auto-rescan still refused |
| **G6** | **No push channel** beyond `/api/terminal`. Two windows on one repo diverge silently | — | Multi-window, multi-agent |
| **G7** | **`/archgraph.json` is all-or-nothing.** No `?scope=`, `?depth=`, no delta-since-`scannedAt`. `scopeGraph` exists (`brief.ts`, re-exported `analyzer/src/index.ts:7`) and is used only internally by `/api/generate` and `/api/ddl` | grep | Graph size ceiling; and it *is* the token-efficiency claim |
| **G8** | **No HTTP caching.** `sendJson` (:507) and `serveStatic` (`static.ts:36-49`) set only `content-type`. No ETag, no `Last-Modified`, no 304 — despite `ArchGraph.scannedAt` being a natural ETag | file | Every board mount re-downloads and re-parses the whole graph |
| **G9** | **ACP over HTTP discards both of the client's best features.** `new AcpClient(launch)` at **:2503** and **:2524** passes launch config only — **no `onUpdate`, no `onPermission`.** So streamed `session/update` notifications (already received at `client.ts:159-164`) never reach HTTP, and permissions fall through to `defaultPermissionPolicy`, which **denies every mutating tool.** A local Claude Code driven through Sequence today is read-only, silently | file | Any real agent integration |
| **G10** | **No agent CRUD over HTTP.** `addAgent`/`removeAgent` (`agentsStore.ts:89,105`) called only from `cli.ts:385,422` | grep | GUI-first onboarding |
| **G11** | **`command` program nodes have no result.** Per `webExecutors.ts:24-30`, "ok" means the text was written to a terminal socket. No exit code, no stdout. "Run tests, then branch" is unbuildable. Missing primitive: allowlisted `POST /api/exec {cmd}` → `{exitCode, stdout, stderr}` | file | Verification loops |
| **G12** | **No typed client / no wire schema.** No OpenAPI, no zod at the HTTP boundary (zod exists only in `packages/mcp`). ~60 shapes get re-derived by hand | — | Build item W0.5, mechanically, from §3.2 |
| **G13** | **No CORS headers.** `grep "access-control" packages/analyzer/src` → 0 hits. The new UI must be served from `webDist` by this server (**:3465**) or sit behind a Vite proxy | grep | Dev setup |
| **G14** | **Single global repo, no workspaces** (**:634-671**, self-documented) | file | Multi-repo UI is not expressible — do not design one |
| **G15** | **Auth-gate inconsistency.** `SENSITIVE_EXACT` (:246-273) omits `/api/annotate`, `/api/functions`, `/api/board`, `/api/chat-memory`, `/api/mcp/*`. They rely on `requireOwner()`, which **returns false when `repoOwner === null`** (:1030) — the state after a CLI `--repo` start. On loopback+auth started with `--repo`, `/api/functions` answers anonymously while `/api/tree` 401s | file | Security hygiene |

**Two more, measured in the token lane, both outside the HTTP surface but blocking:**

| # | Gap | Evidence |
|---|---|---|
| **G16** | **7–8 second cache invalidation after any write.** `packages/analyzer/src/server/graphCache.ts:79-99` `computeSignature` stats the *whole tree*; any mtime or size change invalidates everything. Measured: arch rescan 3,631–4,492 ms + function-graph rebuild ~3,400 ms. Ripgrep is 29–68 ms. **In an editing product, nearly every query pays 7–8 s to save ~600 tokens** — a 100–250× latency penalty |
| **G17** | **The function graph has 6 cross-package call edges out of 7,759 (0.08%)**, and all 6 point at file-less nodes. Same-file 4,348, same-package-different-file 3,405, cross-package 6. `who_calls <symbol>` therefore cannot cross a package boundary in a 9-package monorepo. `tools/` is not indexed at all (0 function nodes) |

---

## 4. THE ARCHITECTURE

*Hand this section alone to whoever builds the shell.*

### 4.1 Package layout

```
packages/web2/                    ← new. packages/web was deleted 2026-08-20 (early cutover)
  src/
    main.tsx                      one entry, one tree, no popout branch
    app/
      Shell.tsx                   the three-pane frame + resizers + breakpoints
      routes.ts                   there are no routes. This file documents that.
    tokens/
      graphite.css                the ONLY token file. Copied from product.css:1-597, extended
    chat/            ~10 .tsx      transcript, rows, coverage chip, proposal card
    composer/        ~4  .tsx
    canvas/          ~8  .tsx      the board host + card + toolbar + zoomcluster
    rail/            ~5  .tsx
    review/          ~5  .tsx      diff inspector (Wave 5)
    state/
      types.ts                     ← written and reviewed BEFORE any implementation
      store.ts                     one store, target < 600 lines
    api/
      client.ts                    generated-by-hand from §3.2, thin
  package.json
packages/api-types/               ← new, W0.5. Shared wire types, imported by web2 AND analyzer
```

*(Planned: `packages/web` stays on disk, buildable, until Wave 7. Actually: it was deleted early, on 2026-08-20.)* Nothing in `web2` may import from it. Enforced by a firewall test (W0.6) that asserts zero `../web/` specifiers and zero `.arch-rf-`/`.product-` class names in `web2`.

### 4.2 State — one store, types first

**The rule that prevents the week-1 merge-conflict pile-up:** `state/types.ts` is authored and reviewed as a standalone file **with no implementation**, before any surface is built. It is the contract every parallel builder codes against.

For scale: today `product/state/productStore.ts` is **1,627 lines / 92 action members** and `state/store.ts` is **2,387**. `ArchCanvasBoard.tsx` alone reads **17 selectors** plus two imperative pokes (`:382` `getState().nodePositions`, `:385` `setState({nodePositions})`). Those two stores are the coupling that inflates the board's dependency closure from 64 files to 110. **Target: one store, under 600 lines, zero imperative `getState`/`setState` from a component.**

Shape:

```ts
type Slice =
  | { k: 'session' }   // sessions[], activeId, chat turns, memory
  | { k: 'repo' }      // attached, repoName, root, graph, seqdDoc, scannedAt, stale
  | { k: 'canvas' }    // state: S0|S1|S2|S3|S4, focusId, flow, proposal, nodePositions, viewport
  | { k: 'rail' }      // tree, expanded[], selectedFn, coverageByPath
  | { k: 'composer' }  // draft, contextChips[], model, mentionQuery
  | { k: 'net' }       // inflight[], lastError, streaming
```

**Turn effects are a typed union, not imperative calls.** `sendAsk` returns `{ kind: 'focus'|'propose'|'answer'|'act', coverage: Coverage, … }` and the store applies it. This is the fix for the current build's worst legibility defect: the assistant sets `boardSurfaceMode` from three separate places (`ProductChat.tsx:512`, `:524`, `sendAsk.ts:739`) so the canvas changes out from under the user without a click.

**Coverage is a first-class store field, not a chat detail:**
```ts
type Coverage = { edgesSeen: number; edgesTotal: number; packagesSeen: string[]; packagesMissed: string[] }
```
It drives the chat chip, the rail badges, and the canvas dim state from one source.

### 4.3 Data flow

```
POST /api/attach  ──►  GET /archgraph.json  ──►  seqdFromGraph()  ──►  store.repo.seqdDoc
                                                                            │
                          ┌─────────────────────────────────────────────────┤
                          ▼                                                 ▼
                  <Canvas doc={docWithProposal(seqdDoc, proposal)}>   <Rail tree functions>
                          ▲                                                 │
                          │  turn effect (typed union)                      │ fn click → flow
                          │                                                 ▼
   composer ──► POST /api/ask/stream ──► SSE events ──► store.applyTurnEffect()
```

One direction. Chat never touches the canvas directly; it produces a turn effect the store applies. The rail never writes the document.

**Staleness is explicit.** `PUT /api/file` returns `{stale:true}` (W1.5) → `store.repo.stale = true` → a bar on the canvas: *"graph is stale · rescan"*. Never a silent lie.

### 4.4 Where Graphite tokens live

**One file: `packages/web2/src/tokens/graphite.css`.** Nothing else declares a colour, a radius, a type size, or a spacing value. Enforced by a lint test: no hex literal, no `px` font-size, outside that file.

Its base is `product.css:1-597` — **250 tokens already transcribed from `_core.html`** (which declares 174), including §1 the token layer and §2 declared extensions. `product.css:598-939` (§3, the legacy-name compat layer) does **not** carry forward.

Three-state theming per `GRAPHITE-DECISIONS.md` Decision 1: full light palette on bare `:root`; dark overrides under `@media (prefers-color-scheme: dark)` guarded `:root:not([data-theme="light"])`; the same tokens again under `:root[data-theme="dark"]`. Light theme is deferred by owner ruling but the token shape must support it from day 0 or the retrofit is a rewrite.

**Decision 2 — kinds without hue — is already landed and is the best-executed thing in the current tree.** `archKinds.ts:7-11` states the rule; `product.css:427-467` declares silhouette/style/weight/tone for all six kinds with **zero colour tokens in the `--arch-*` namespace**; all six consume all four tokens (`product.css:8205-8274`). The greyscale invariant is the locking test to carry forward. Hue is reserved for claims only.

**The typeface problem is a Wave 0 blocker, not a detail.** Graphite `_core.html:148-150` links Google Fonts for **Instrument Sans**; `_core.html:239` sets `--font-sans:"Instrument Sans", …`. `packages/web` ships `@fontsource-variable/inter` and `@fontsource/jetbrains-mono`. Instrument Sans is not a dependency, and `product/brandTokens.test.ts:601-607` **locks Inter in place with a passing test**. Meanwhile `CLAUDE.md` forbids a network fetch on boot. The book's measurements are not decorative: `GRAPHITE-MIGRATION-PLAN.md:195-217` lists nine px-locked `--t-*`/`--lh-*` pairs with non-uniform ratios (`--t-17/--lh-17` = 1.29, `--t-14/--lh-14` = 1.50, so every `line-height` call site moves), **255 usages currently on a half-pixel**, and **102 places rendering below the 10px floor**. Instrument Sans was chosen against Inter specifically because it holds shape at 10–11px. Different x-height and advance widths mean different truncation, different column fit. **Add `@fontsource/instrument-sans` and delete the Inter lock, or re-render the twelve sheets in Inter before building from them.**

### 4.5 How the board plugs in

**Port it. Do not rewrite it.** The board's engine — projection, kinds, levels, labels, ELK bridge, elbow router — is ~1,450 lines of well-tested pure code covered by `archModel.test.ts` (31 pure-function `it()`s) and `orthogonalElbow.test.ts` (6), which survive a shell rewrite untouched.

| Ports as-is, zero rework (~1,100 lines) | Ports with a seam change (~350) | Rewritten (~730) |
|---|---|---|
| `orthogonalElbow.ts` (380, **zero imports**) · `archKinds.ts` (126) · `archLabels.ts` (112) · `archLevels.ts` (206) · `archLayout.ts` (172) · `archAnnotate.ts` (45) · `LedgerToolbarDock.tsx` (215, React-only) · `useProductCanvasColorMode.ts` (60) | `archNodeModel.ts` (264 — pure except an `@xyflow/react` type import) · `ArchNodeCard.tsx` (247 — swap `useProductStore` for two props `onExpand`/`onMagic`, re-point `Icon`) | `ArchCanvasBoard.tsx` (603 code lines of shell wiring) · `ArchToolbar.tsx` (132) |

**Runtime dependencies — two, and only two.** `@xyflow/react` 12.11.2 (pulls `@xyflow/system` 0.0.79) and `elkjs` 0.11.1, the latter loaded *only* inside `graph/elk.worker.ts:13`. No d3 of our own, no dagre, no mermaid on this surface. Keep the lazy boundary — `ProductBoard.tsx:48-50` records that React Flow is 374 KB of a 944 KB entry chunk.

**Five files must move out of `canvas/` before `canvas/` is deleted:** `fit.ts` (137), `gridColors.ts` (68), `edgeStyle.ts` (535), `breakoutFraming.ts` (336), `serviceAdrContent.ts` (218), plus `MadrBreakout.tsx`'s logic.

**Two inherited constraints that must not be "cleaned up":**
1. `ArchNodeCard.tsx:126-163` — the eight inert `<Handle>` elements **cannot be deleted**. `@xyflow/system`'s `getEdgePosition` returns `null` without handle bounds and `EdgeWrapper` bails before mounting the custom edge, so removing the nubs **erases every edge on the board**. The escape is moving handle geometry onto `node.handles` so `parseHandles` reads it without touching the DOM — an `archNodeModel` change, unstarted.
2. `graph/elk.worker.ts:11` stubs `self.document ??= {}` because elkjs self-detects a worker environment and hijacks `self.onmessage`.

**One decision to carry, not reverse:** `ArchCanvasBoard.tsx:273` `const level: ArchLevel = 'L2'` is a **standing owner ruling** re-affirmed at `:238-272` and locked by name in four suites. This plan CUTs the L1/L2/L3 vocabulary (205 lines serving a constant) — but the *pin*, not the ruling, is what goes: v2 has one level and `scopedSeqdModel`'s repo/service/ask scoping delivers depth instead.

### 4.6 Testing architecture — the thing that has to change

Current state, measured: **362 test files, 179 (49%) `readFileSync` source greps, 3,418 `toContain(` assertions, 53 reading `product.css` directly, 7 files (1.9%) rendering a component, 0 `.test.tsx`** — and `vitest.config.ts` sets `environment: 'node'` with `include: ['src/**/*.test.ts']`, so a `.test.tsx` would not run even if written. `.github/workflows/ci.yml` says in a comment: *"Web vitest is not required."* 57,120 LOC of tests, zero gating a merge.

This is not hypothetical weakness. `docs/owner-feedback-log.md:36-97` documents the "cream canvas" defect shipping through two full rounds with every gate green, because `<ReactFlow colorMode="dark">` painted an opaque `#141414` rect no text-contrast rule could see. The log's own conclusion: *"only the screenshot showed the defect."*

**v2 test tiers, in order of authority:**

| Tier | What | Count target | Gate |
|---|---|---|---|
| **1. Pure-model unit** | The 197 salvaged React-free modules + new store reducers. No DOM, no fetch | ~200 files | required |
| **2. Render** | jsdom + `@testing-library`, `.test.tsx`, `include` glob fixed | ≥1 per surface, ~30 | required |
| **3. E2E behavioural** | The existing 46 Playwright scripts (12,985 lines), re-pointed onto `data-testid` — they currently use **zero testids** and select on `.arch-rf-card` ×23, `.product-composer-in` ×4, etc. | 46 ported | required |
| **4. Screenshot vs sheet** | Every surface compared against its Graphite sheet by a human or a vision pass | 1 per wave | **required — no wave ships without it** |
| ~~5. Source-grep~~ | **Banned.** Zero `readFileSync` of a source file in a v2 test | 0 | lint |

---

## 5. THE GAP LIST

Ranked. **PAR** = table stakes; absence is a defect. **BEAT** = where a grounded graph wins something a terminal or a prose-generated diagram structurally cannot.

### 5.1 PAR — the ranked table

| # | Gap | Them | Us, measured | Cost |
|---|---|---|---|---|
| **P1** | **Token streaming** | Codex streams; Claude Code streams | `provider.ts:765` has no `stream:true`; `AskStreamEvent` has 16 variants and no delta. TTFT = full generation, every ask | 1–2 d |
| **P2** | **Diff review as the primary review surface** | Codex `Cmd+Opt+B`: 5 scopes (Unstaged/Staged/Commit/Branch/**Last turn**), multi-repo, expand/collapse per file, **line-anchored `+` comments that steer the fix**, selective staging, revert, per-file accept/reject. Cursor 3 "diffs view", Zed multi-buffer | `FileEditProposalBar.tsx:24,40` renders **a list of bare filenames** (`fileEditProposalModel.ts:96-98`) with one whole-set Accept and one Deny (`:56-73`). No diff. No per-file control. No line comments | 6–8 d |
| **P3** | **Permission model** | Claude Code: 6 modes on `Shift+Tab`, a three-list allow/ask/deny algebra with per-tool specifiers (`Bash(npm run *)`, `Read(~/secrets/**)`, `Agent(model:opus)`), 4 path-anchoring forms, managed>local>project>user precedence. Codex: 3 modes in a control **under the composer**, plus an auto-review agent with circuit breakers (stop after 3 consecutive denials) | **No permission system.** One hard stance: `propose_files` never writes, a human clicks Accept. ACP is denied by construction — `packages/acp/src/client.ts:109-115` allows 4 of 10 `ToolKind` values and `onPermission` has no injection site | 5–7 d |
| **P4** | **Cancellation** | Both | 2 `AbortController` sites in 4,452 lines, both in `/api/acp/run-node`. Stop is cosmetic on 5 of 6 AI paths, and the call is still metered | 0.5 d |
| **P5** | **Node → agent context in one action** | Cursor Design Mode `⌥+click`; Codemaps `@{codemap}`; Codex `@` files | **The grounded graph cannot talk to the agent.** `ArchCanvasBoard.tsx:486-491` `onNodeClick` calls `onSelectNode` and nothing else. The "Send to assistant" button exists (`ArchNodeCard.tsx:183-197`) gated on `showMagic` = `isDrawMagicNode` = `drawSync.ts:281-283` `nodeId.startsWith('design:draw-')`. **It renders only on hand-drawn nodes.** Real nodes: 4+ actions, prose-only, on qualifying nodes only | 1 d |
| **P6** | **Progress on long operations** | Both | No `scan:progress`. A blocking call and a spinner | 1 d |
| **P7** | **Uncapped agent loop with a stop condition** | Claude Code: no default turn cap. Codex: goal with success criteria, `/plan` | `MAX_ASK_TOOL_ROUNDS = 3` (`askTools.ts:79`) | 2 d |
| **P8** | **Server-side runs** | Codex cloud tasks (Chats/Code reviews/Archive with change stats); Claude Code background sessions in worktrees | `runProgram` runs in the browser. Tab close kills it | 8–10 d |
| **P9** | **Activity view + OS-level status** | Codex: `Cmd+Opt+U`, states Unread/Running/Waiting/Blocked, desktop notifications, a floating pet. Cursor 3: one sidebar for local+cloud+mobile+Slack+GitHub agents | Nothing | 3 d |
| **P10** | **Checkpoint & rewind** | Claude Code: `/rewind`, 100 checkpoints, restore code/conversation/both, summarize-from/up-to. Cursor: click any checkpoint | Board + program-run persistence exists; no session-level file undo, no fork | 4 d |
| **P11** | **Lifecycle hooks** | Claude Code: **29 events**, 5 handler types, exit-code-2 blocks on 15 of them | **Zero.** The three gates in `CLAUDE.md:64-79` are enforced by prose | 4 d |
| **P12** | **Worktree isolation + handoff** | Codex `/worktree` → "Create branch here" / "Hand off"; Claude Code auto-worktrees background sessions | `gitWorkspace.ts` exports three functions, none creates a branch | 3 d |
| **P13** | **Memory that holds evidence** | Claude Code: 4 CLAUDE.md scopes, `.claude/rules/` with path globs, auto-memory with a 200-line index; `/context` shows the budget | `ChatMemoryTurn` is `{role,text,at,advisor?,usage?}` — prose only, truncated at 1,200 chars (`chatMemory.ts:144`). Nothing carries when the tab closes | 3 d |
| **P14** | **Headless entry** | `claude -p` composes with Unix pipes; Codex non-interactive mode, SDK, GitHub Action | The analyzer CLI has 12 verbs and **none is `ask`**. No unattended path exists | 2 d |
| **P15** | **Multi-tool breadth** | Claude Code: 45 tools. Codex: 24 slash commands | 7 declared ask tools, 6 live. Missing categories: notification, background/streaming (`Monitor`), worktree, structured-findings, question-to-user, file-to-user, web | — |

**Honest scope note on P15 and P11:** Claude Code's doc index is **139 pages across 26 groups**. "Par" with that surface is not a rebuild; it is a company. Do not attempt breadth. Attempt the seven items P1–P7, which are the ones whose absence a user notices in the first session.

### 5.2 The five things to steal verbatim

1. **The permissions control under the composer** — one always-visible dropdown, three modes, non-defaults opt-in from Settings. This is the solved interaction for the autonomy question.
2. **Review scopes as a segmented control** — Unstaged / Staged / Commit / Branch / **Last turn**. "Last turn" especially: *what did the agent just do to me*, one click.
3. **Line-anchored `+` comments that feed the chat.** Turns review from a verdict into a steering instrument. Cheapest high-value item on the list.
4. **Activity view + OS-level status indicator.** Multi-agent work is unusable without "which of my N threads needs me" answerable from outside the app.
5. **Worktree → "Create branch here" / "Hand off".** The app does the git.

### 5.3 BEAT — where a graph wins, ranked by evidence strength

| # | Win | Evidence for | Evidence against |
|---|---|---|---|
| **B1** | **Coverage on every answer.** Codex and Claude Code structurally cannot tell you what they did not read. Sequence knows the digest cut at 300 of 2,326 edges and which packages contributed zero | The mechanism exists. It is a chip, a rail badge, a dim state | The omission counter is currently blind — `explain.ts:1140-1143` computes against the already-capped digest, so it can never report the ~2,026 edges the cap removed. **Engine fix required first (W1.1)** |
| **B2** | **Impact beside the diff.** Codex reviews the change; nothing reviews the change's *consequences on the system*. The FunctionGraph (5,990 nodes / 7,759 call edges) already exists with no agent-facing surface. `computeImpact` and `computeRisks` already exist in `packages/schema` | This is the direct answer to the loudest structural complaint about agent coding — *"tests cannot catch code that deviates from the intent in some subtle way, while still being functional"* (HN 46891131). A diff cannot answer it | Wiring job, not research. But G17: cross-package call edges are 6 of 7,759. Impact across packages is currently import-level only |
| **B3** | **Diagrams that are derived, not written.** Every Codex visualization is prose-generated, ungrounded, snapshot-only ("they don't stay synchronized with connected data sources") and doesn't render in the CLI or the IDE extension. Codemaps and DeepWiki are **LLM-generated**. Sequence's come from a parser with `file:line` per edge | Architectural, not a feature a competitor ships next quarter | Only true if the grounded facts reach the model. And `who_calls gateway` currently returns **two false edges with citations**, from an nginx conf in a test fixture (`packages/analyzer/test/fixtures/shopfront/edge/default.conf:5`). A grounding tool asserting a false edge is worse than no tool. **Fix before claiming** |
| **B4** | **Transitive blast radius in one call.** Measured: full closure of `web/src/state/store.ts` = 146 files at depth 4, **2,360 tokens in 1 call**, vs **6,786 tokens in 78 grep round trips for depth 2 only** | The one genuine order-of-magnitude win, and its currency is round trips, not tokens | **SHIPPED 2026-08-20.** `depth` (default 1, max 5) is on `graphQueryShape`. Re-measured against the shipped code on this repo, `web/src/state/store.ts`: depth 1 = 78 callers / 1,366 tokens; depth 2 = 137 unique / 3,625; depth 3 = 145 / 4,110; depth 4 = **146 unique / 4,153 tokens in ONE call** — the closure saturates, adding one node at hop 4. The 146 reproduces this row's prediction exactly. The 2,360-token figure does not reproduce against `renderAnswer`; 4,153 is the measured cost. Against 6,786 tokens over 78 round trips to reach depth 2 alone, the win is ~1.9x on tokens and 78x on round trips — and round trips were always the real currency. |
| **B5** | **Degree-ranked centrality and named ambiguity.** `store.ts` 78 importers, `Icon.tsx` 61, `scan.ts` 55 — independently reproduced at 78/60/56. 47 filenames in this repo are borne by 124 files (`index.ts` by 14). `alsoNamed` + `didYouMean` + `omitted` are already in `GraphQueryAnswer` | Grep cannot rank and cannot name a collision at any token price | — |
| **B6** | **Spatial parallel-agent view.** Claude Code's own agent-teams limitations are dominated by observability failures — "task status can lag," "teammates fail to mark tasks completed." Their UI for a five-way debate is five rows of one-line summaries, three of which collapse into `2 idle agents` after 30 seconds | A board where each agent's claimed task and file ownership is visible eliminates the failure class rather than documenting it | Requires P8 (server-side runs) first. Wave 8+ |
| **B7** | **Graph-scoped permission rules.** `Edit(src/**)` is a string; the set of things that break is a transitive closure. `routeByBlastRadius.ts:16-23` already bands it | A rule drawn on the graph is not expressible in a `.json` matcher | Ship the string matcher first (P3), then the graph predicate. And serialize it to reviewable text or it loses the diffability argument outright |

### 5.4 The owner's three claims, adjudicated

**"Better on token use because we have graphs."** — **PARTLY SUPPORTED, currently overstated.**
Measured on this repo with real MCP handlers vs real ripgrep 15.2.0, scored against an independent non-graph ground truth:

| Question | Graph | Best grep | Verdict |
|---|---|---|---|
| 78 importers of `store.ts` | 1,705 tok, 98.7% recall | 1,955 tok | graph **1.15×** — inside the noise of one extra sentence, and grep's output is *strictly more informative* (it names the imported symbols; the graph row does not) |
| who calls `scanRepo()` | 1,822 tok, 89.5% recall | `rg -l` 1,243 tok, 100% recall | **graph 1.47× MORE expensive AND less complete** |
| orientation ("what is this repo") | `explain_repo` 38,754 tok | README + CLAUDE.md 3,711 tok | **graph 10.4× worse, worse answer** |
| shopfront cross-service topology | 249 tok | read 36 files, 4,661 tok | graph **18.7×** — but on a 43-file fixture that fits in context whole |
| transitive closure, depth 4 | 2,360 tok, **1 call** | 6,786 tok, **78 calls**, 3.3 s, depth 2 only | **the real win — now shipped via `who_calls` `depth` (W1.6); Claims still UNVERIFIED until §5.5 A/B** |

Plus a standing **1,471-token tool-surface tax** on every turn (the 8-tool `tools/list` serialized with real JSON Schema; `who_calls` alone is 447). At ~250–600 tokens saved per question, the surface must be used ~3× per session just to break even. *(Historical lie, fixed under W1.7:)* `scan_repo` once misstated its size by 1.6× — description said "~1.1MB, roughly 290k tokens" while measured pretty-printed output was **1,705,838 bytes / 465,538 tokens**. Hygiene now: compact payload, no fixed 290k stamp, descriptions audited.

**Restated honestly for the pitch: the moat is not fewer tokens per answer. It is fewer round trips and answers grep structurally cannot give** — transitive closure in one call, degree-ranked centrality, named ambiguity, cross-service runtime topology. Keep socials quiet until §5.5 A/B numbers exist.

**"We're better visually."** — **TRUE ONLY AS A FEATURE, FALSE AS A PRODUCT.**
The graveyard is total (§1.6.2). What survived is visualization inside something that already owns the workflow. The owner's instinct to keep only the board and make it part of the agent surface is exactly right; the danger is treating the board as the reason to buy.

**"We're better at agent workflows."** — **STRUCTURAL GAP SHRUNK, NOT CLOSED.**
At measurement time the workflow runtime was client-side only. Server runs (`POST /api/program/run`, run ids, events, cancel) and web2 Activity now exist. Still do not claim Claude Code nesting / Codex cloud-task parity. `packages/schema` typed DAG + visible resume-loss remains the idea worth keeping; P8 unparks stay owner-sequenced.

### 5.5 The one experiment that settles the token claim

Nobody has run it. Until it exists, every token number in every artifact carries **UNVERIFIED**.

> Same repo. Same model. Ten questions of the form *"who calls X"*, *"what breaks if I change Y"*, *"what talks to the database"*. **Lane A:** Claude Code with grep+read. **Lane B:** Claude Code with Sequence's MCP server. Compare tokens-to-correct-answer and correctness.

Note Anthropic's own large-codebase documentation contains, verbatim: *"if your organization already runs a code search or RAG index over the repository, expose it as an MCP tool so Claude queries it instead of reading files directly."* That is a product brief written by the incumbent. It costs **1,402 LOC** to answer (`packages/mcp`) versus **44,840 LOC** of new chrome to compete head-on — a 32:1 ratio in favour of the option the research keeps identifying. This does not cancel the rebuild; it means the MCP track (W1.6, W1.7) is not optional and should not be scheduled last.

### 5.6 The eleven surfaces Graphite does not cover

Grep across all 12 Sequence sheets: `"repo picker"` → 0 files. `"breakpoint"` → 0. `"three-pane"` → 0. `"coverage"` → 0. `"settings"` → 1 hit, an icon name in sheet 09.

The book covers the graph domain thoroughly (node, kinds, edges, canvas, selection, containment, density, icons, spacing, functions rail, agentic surfaces). Everything else is either lifted from ml-harness's book — sheets 15 dialogs-approval, 16 loading-empty, 17 the-left-rail, 18 top-bar, 19 composer, 20 transcript, 21 tool-rows, 28 diff-inspector, all drawn for *threads, runs, datasets and training metrics* — or unsheeted entirely:

**Unsheeted, being designed by whoever builds them:** three-pane geometry + resizers + collapse + breakpoints · the attach dialog · settings · the coverage chip · the topology-proposal Accept/Deny gate on the canvas (sheet 12's "The gate" is for a *run*, not a ghost overlay) · the session list · export · the diff inspector adapted from a training-metrics context · staleness bar · notifications · permission control.

**Budget the design time or write the sheets. The dangerous state is thinking the book covers them.**

---

## 6. THE BUILD ORDER

Each item is one agent-sized unit. `deps` names the items that must land first. `lock` is the test that must exist and pass before the item is called done. **A wave does not close without its screenshot-vs-sheet review (Tier 4, §4.6).**

### WAVE 0 — preconditions. Nothing is written until these land. ~4 days.

| # | Item | Deps | Locking test |
|---|---|---|---|
| **0.1** | Add `@fontsource/instrument-sans` to `packages/web2`; delete the Inter lock at `product/brandTokens.test.ts:601-607`. If the owner refuses the dependency, re-render the 12 sheets in Inter before proceeding | — | A render test asserts `getComputedStyle(body).fontFamily` starts with `Instrument Sans`, and a boot test asserts zero network requests to `fonts.googleapis.com` |
| **0.2** | Extract every "why" comment from `product/arch/`, `graph/`, `canvas/fit.ts`, `canvas/edgeStyle.ts`, `main.tsx` into `docs/rebuild/inherited-constraints.md`, each with original `file:line`. **1,406 comment lines across 24,788 non-test lines in `product/`** | — | The doc contains at minimum the 6 named constraints in §4.5 and §7-R8 |
| **0.3** | *(Historical — done, then superseded by Decision 3 on 2026-08-21.)* Freeze the book by copying it to `graphite/v1/` and citing that. The duplicate is now deleted: there is one copy at `docs/brand/graphite/`, and `tools/ci/graphite-freeze.test.mjs` fails any commit that edits a sheet without a numbered decision | — | A test asserts every cited sheet exists (`packages/web2/test/firewall.test.ts`) |
| **0.4** | Delete the source-grep test tier in `packages/web` — **delete, never repair.** Add jsdom + `@testing-library`; fix `vitest.config.ts` `include` to accept `.test.tsx` | — | `npx vitest run` in `packages/web` returns **0 failing files**. Post the number |
| **0.5** | Extract `packages/api-types` mechanically from §3.2 — every request and response shape, one file per route group. Imported by both `analyzer` and `web2`. This closes G12 | — | `analyzer` compiles with the shared types substituted for its hand-written narrowing on ≥10 routes |
| **0.6** | Firewall test for `web2`: zero imports from `../web/`, zero `.arch-rf-`/`.product-` class names, zero hex literals and zero px font-sizes outside `tokens/graphite.css` | — | The test itself |
| **0.7** | Add `data-testid` to the 12 anchor surfaces in `packages/web` and port the 46 Playwright scripts (12,985 lines) onto them. **These scripts are the only real behavioural asset in the test tree and they currently contain zero testids** | — | All 46 pass against v1 on testid selectors only |

### Wave 0 — orchestrator rulings, 2026-08-20

The Wave 0 gate found two acceptance criteria that cannot be met as written. Both are plan
defects, not unfinished work, and both are ruled here rather than left to drift.

**0.4's criterion is restated.** It read "`npx vitest run` in `packages/web` returns 0 failing
files". It returns 1: `productFirewall.test.ts`, reporting 20 allowlist violations, 13 from
`arch/`. Those are v1 production debt and **W3.1 is the item that owns them** — 0.4 could only
reach zero by deleting the test (which destroys W3.1's gate) or by allowlisting the violations
(which weakens it). Both are forbidden. The criterion is now: **0 failing files except
`productFirewall.test.ts`, which W3.1 owns and must drive to zero by fixing the code.** 0.4 is
complete: 362 → 306 test files, 58 deleted, zero production files deleted, and every deleted
`it()` verified to be a string match on source text.

**0.7's criterion is restated.** It read "all 46 pass". 21 of 45 pass. The gate established why:
**22 scripts drive a shell that no longer exists** — `home-browser` has zero hits in
`packages/web/src`, and 7,130 of 13,906 lines are dead. They are not broken tests, they are tests
of a deleted surface. The criterion is now: **the 22 live scripts pass on testid selectors only.**

The 22 dead scripts are NOT deleted now. 0.4 is the only deletion this wave authorises, and there
was no cost to carrying them until the cutover removed `packages/web` wholesale — whereas deleting them
early forecloses the chance that one encodes a behaviour worth keeping. They go with the rest of
v1, in the same commit.

### WAVE 1 — engine. Runs **in parallel with Wave 2+**, resourced first. ~12 days.

| # | Item | Deps | Locking test |
|---|---|---|---|
| **1.1** | **Coverage on the wire.** Fix `explain.ts:1140-1143` to compute against `graph.edges.length`, not the capped digest. Add `coverage: {edgesSeen, edgesTotal, packagesSeen[], packagesMissed[]}` to `AskPipelineResult` (`askPipeline.ts:75-83`) and to the `result` SSE event (`:85-114`). Plumb through `aiClient.ts:957` and `sendAsk.ts` | 0.5 | Asks a question about `packages/web`; asserts the returned `edgesTotal === 2326` (not 300) and `packagesMissed` names `packages/web` when the digest excluded it |
| **1.2** | **Token streaming.** `stream:true` at `provider.ts:765` + SSE parse; add a `delta{text}` variant to `AskStreamEvent` | 0.5 | A streamed ask emits ≥2 `delta` events before `result`; measured TTFT < 1.5 s |
| **1.3** | **Cancellation.** Thread `AbortSignal` through `askPipeline` → `provider.ts:765`; wire to request abort on `/api/ask`, `/api/ask/stream`, `/api/explain`, `/api/generate`, `/api/research`, `/api/annotate`. Ensure `recordUse` does **not** fire on an aborted call | — | Abort mid-generation; assert the provider fetch aborted and `usedThisMonth` did not increment |
| **1.4** | **Incremental cache invalidation.** Replace `graphCache.ts:79-99` whole-tree `computeSignature` with per-package or per-file signatures. **Currently 7–8 s after any write; ripgrep is 40 ms** | — | Write one file in `packages/mcp`; assert `who_calls` on a `packages/web` symbol returns in < 500 ms |
| **1.5** | **Staleness + progress.** `PUT /api/file` returns `{ok, path, stale:true}`. Add a `scan:progress{done,total,path}` event on the existing SSE shape for `/api/scan` | 0.5 | `PUT` then `GET /archgraph.json`; assert the response carries a stale marker. `POST /api/scan` emits ≥3 progress events |
| **1.6** | **`who_calls` depth.** Add `depth?: number` (default 1, max 5) to `graphQueryShape`; return layered results with the layer index. **LANDED** (`graphQueryDepth.test.ts`) | — | `depth:4` on a dense symbol returns multi-hop callers in one call |
| **1.7** | **MCP server hygiene.** Server `instructions`; `.describe()` ≤ 2 KB; `_meta["anthropic/maxResultSizeChars"]`; stop pretty-printing `scan_repo`; drop fixed 290k stamp. **LANDED** (`mcpHygiene.test.ts`) | — | Every tool description ≤ 2,048 bytes; `scan_repo` is compact |
| **1.8** | **Scoped graph read.** `GET /archgraph.json?scope=<ids>&depth=N` using the existing `scopeGraph`; add `ETag` from `scannedAt` and a 304 path to `sendJson` | 0.5 | Scoped fetch returns a strict subgraph; a repeat fetch with `If-None-Match` returns 304 |
| **1.9** | **Fix the false-edge class.** `svc:gateway`'s only two inbound edges come from `test/fixtures/shopfront/edge/default.conf:5` and its mutated twin. Exclude `test/fixtures/**` from the scanned graph, or tag fixture-origin edges so the UI can suppress them | — | `who_calls gateway` returns zero edges rather than two false ones; a test asserts no edge in the shipped graph has evidence under `test/fixtures/` |
| **1.10** | **ACP seams.** Pass `onUpdate` and `onPermission` at `repoServer.ts:2503` and `:2524`; surface `session/update` on the ask SSE stream; add an approval endpoint so a write can be allowed | — | A local agent run emits ≥1 tool-call update over HTTP, and a mutating tool reaches an approval prompt instead of a silent deny |

### WAVE 2 — the shell skeleton. ~10 days. Blocks everything visual.

| # | Item | Deps | Locking test |
|---|---|---|---|
| **2.1** | **`state/types.ts` only.** No implementation. Reviewed and frozen before 2.2 starts | 0.5 | It typechecks; a review sign-off is recorded |
| **2.2** | **`tokens/graphite.css`.** Copy `product.css:1-597`, extend for the unsheeted surfaces, three-state theming | 0.1, 0.3 | Greyscale invariant: no colour token in the `--arch-*` namespace. Both `[data-theme]` values and the bare `:root` default resolve every token |
| **2.3** | **`Shell.tsx`** — three panes, two resizers, localStorage widths, breakpoints (rail overlays < 1100px, chat overlays < 820px), `Cmd/Ctrl-K` → composer. **Canvas never below 50%** | 2.1, 2.2 | Render test at 1280×800 and 900×700; assert canvas width ≥ 50% at both, and that the rail renders as a `<aside>` column (not `role="dialog"`) above 1100px |
| **2.4** | **Boot + attach.** Platform probe → attached hydrate → static-graph fallback. Attach dialog with recents, browse-root callout, crumbs, dir list, and **the scannable/folder tag** (`ProductTopbar.tsx:221-227` — the best affordance in the current build; keep its behaviour verbatim). All five error states from §3.2 rendered honestly | 2.3, 0.5 | E2E: attach a real repo, assert S1 within 6 s; attach a non-repo, assert the 422 `no-manifests` copy |
| **2.5** | **Chat column** — transcript per Graphite/Codex form: user = short rounded bubble inset right, assistant = full-width prose, no bubble/avatar/name; compact one-line muted tool rows ("Thought 7s", "Explored 2 files"). One thinking-trace implementation, not two | 2.3 | Render test asserts the assistant row has no bubble background token and thread rows are 28px |
| **2.6** | **The coverage chip.** Next to the per-message token footer. `"answered from 296 of 2,326 edges · analyzer only"`. Plus evidence-carrying memory: the store's turn record holds tool results and proposal contents, not just prose | 1.1, 2.5 | E2E asserts the chip's denominator equals `graph.edges.length`; a reload test asserts a tool result survives |
| **2.7** | **Composer** — context chips with remove, `+` menu (**one** keeper list, not the current three at `agentModeTools.ts:10-47`, `composerModel.ts:82-108`, and the Work variant), models submenu, autosize with a 4-line cap, 28px controls / 26px icon buttons per Graphite law 3, `@` mention over services/files/functions | 2.3 | Render test on control heights; E2E on `@` resolving to a real node id |
| **2.8** | **Permissions control under the composer** (P3 phase 1: the control and three modes; the rule algebra is Wave 5) | 2.7 | E2E asserts non-default modes are unavailable until enabled in Settings |
| **2.9** | **Streaming + Stop wired to the UI**, with an honest staleness bar on the canvas | 1.2, 1.3, 1.5, 2.5 | E2E: press Stop mid-stream, assert the request aborted and no usage was recorded |

### WAVE 3 — the board. ~9 days. The surface the owner named.

| # | Item | Deps | Locking test |
|---|---|---|---|
| **3.1** | **Firewall cut in v1 first.** `productFirewall.test.ts` reports **20 allowlist violations, 13 from `product/arch/`** — `@xyflow/react`, `../../canvas/fit.js`, `../../canvas/MadrBreakout.js` (1,417 lines of legacy canvas), `../../canvas/gridColors.js`, plus 4 files reaching `../../graph/*`. Re-home `fit.ts` and `gridColors.ts`, extract `MadrBreakout`'s logic, allowlist or re-point `graph/*`. Also cut `programs/ProgramGraph.tsx:26`, the single import edge that drags 28 legacy `canvas/` files into the live bundle | — | `npx vitest run src/product/productFirewall.test.ts` → **0 violations** |
| **3.2** | **Lift the 8 pure modules** into `web2/src/canvas/` unchanged: `orthogonalElbow`, `archKinds`, `archLabels`, `archLayout` (+ worker URL), `archAnnotate`, `LedgerToolbarDock`, `useProductCanvasColorMode`, and `archNodeModel` with the RF type import | 3.1, 2.1 | `archModel.test.ts` (31 `it()`s) and `orthogonalElbow.test.ts` (6) pass unchanged in the new location |
| **3.3** | **`ArchNodeCard`** prop-ified — `onExpand`, `onMagic`, `Icon` re-pointed. **Do not delete the eight `<Handle>` elements** (§4.5) | 3.2, 2.2 | Render test asserts 8 handles present and every edge mounts. Greyscale test: no colour outside claim tokens |
| **3.4** | **New board host** (~600 lines) against the v2 store. No `getState`/`setState` pokes. Drop the dead `activeNameDraftId` subscription (`ArchCanvasBoard.tsx:237` — every rename keystroke re-renders the whole board). Hoist the edge box map out of `ArchElbowEdge` (currently `useNodes()`+`useEdges()`+`nodes.map()` **per edge** — ~960 box allocations per drag frame at 24 cards) | 3.2, 3.3, 2.3 | Perf test: one node drag at 24 cards allocates < 100 boxes. Render test covers S1/S2/S4 |
| **3.5** | **P5 — node → composer chip.** Click any grounded node → it becomes a `ComposerContextToken`. **One action.** This is the pattern every winning competitor converged on and today it exists only for `design:draw-*` nodes | 3.4, 2.7 | E2E: click a scanned node, assert a context chip with that node's id appears in the composer. **This is a Wave-3 acceptance gate, not a nice-to-have** |
| **3.6** | **Sheet 05 — the canvas.** (a) Field into the transform: delete the static `.arch-rf-root` background (`product.css:7628-7634`, `background-position: 0 0` hardcoded), un-hide React Flow's `<Background variant=Dots gap=24>` (currently `display:none` at `product.css:7766-7768` — the board ships a dead tracking layer and a live static one). (b) Zoom range 0.25…4.00, not 0.2…2.5. (c) `panOnScroll` on, `zoomOnScroll` off, `selectionOnDrag` on, `zoomOnDoubleClick` off. (d) Replace `<Controls>` with a real `.zoomcluster`: four controls, mono `--num` percentage readout, **Fit as a word**, routed through `ARCH_FIT_OPTS` — the current Fit button uses padding 0.10 / maxZoom 2.50 while programmatic fit uses 0.20 / 1.00, so a 3-node graph auto-fits at 100% and re-fits at 250% when the user clicks Fit. (e) Keymap `V D Esc 0 1 2 + −` (currently the only keydown in `arch/` is `Escape`) | 3.4 | Pan the board; assert the dot field's transform changed. Assert `fitView` and the Fit button produce identical viewports |
| **3.7** | **Sheet 02/03 — the card and the legend.** `.nd-ft` footer: evidence provenance left (`Traced`/`Declared`), count right — `evidenceRef` is carried at `archNodeModel.ts:70,:162` and **never rendered**; same for `partsPreview` (`:82,:174`). Kind tag on its own row. Reconcile `ARCH_CARD_H = 96` against `--arch-card-min-h: 56px` and read `archRfHitRegions` off `measured.height` (currently hardcoded 160×96, **over-tall by up to 58px** on a one-line card). Draw the module folder tab (`--arch-tab-w`/`--arch-tab-h` declared at `product.css:444-445`, consumed nowhere — the datastore cylinder and agent chamfer *are* drawn; module is the one silhouette missing). Legend chips carrying real silhouettes at half-card, not `<i className="arch-rf-legend-dot">`. Group separator before `entry` | 3.3, 3.4 | Render test asserts a footer exists with a provenance tag; visual test asserts the module glyph differs from service |
| **3.8** | **LOD ladder** at 1.00 / 0.91 / 0.83 / 0.67, then drop `ARCH_FIT_MIN_ZOOM` from 0.6 to 0.25. At the current 0.2 floor the `--t-12` title paints at **2.4 device px** | 3.6, 3.7 | Assert rungs hide at their thresholds; assert no text renders below 8 device px at any zoom |
| **3.9** | **Card budget from the frame, not a constant.** `DEFAULT_MAX_CARDS = 24` (`groupedArchModel.ts:181`) is derived at `:170-180` from fit-floor 0.6 on a **1400×900** canvas. In a three-pane shell at 1280 wide the canvas is **~614px**. Sheet 08: *"The budget is the frame, not a node count."* Derive at runtime from measured canvas width | 3.4, 2.3 | At 1280×800 with a >24-service repo, assert the scope bar engages rather than the cards overflowing |
| **3.10** | **MADR breakout, rebuilt as one layout.** The current `ProductMadrBreakout.tsx:283-410` has **four render branches** (ledger head / rich flow / notes panel / legacy panel) selected by three booleans, and `:4` imports from legacy `canvas/MadrBreakout.tsx` (1,417 lines). One layout: what it is → its parts → its files → its edges | 3.4, 3.1 | Render test asserts one branch; the `+N more` at the old `:292` expands in place to real content |

### WAVE 4 — the rail. ~5 days.

| # | Item | Deps | Locking test |
|---|---|---|---|
| **4.1** | **The rail as a column, open by default.** Files → functions with `:line`; `ƒ` legend. Not a `role="dialog"`, not `indexRailCollapsed: true` | 2.3, 3.4 | Render test: default open above 1100px, `<aside>` not `dialog` |
| **4.2** | **Function click → S3.** Flow list, trace strip, clear. Keep the honest empty case verbatim: *"shape unknown — no evidence on this hop"* | 4.1, 3.4 | E2E: click a function, assert the canvas enters S3 and each hop carries an evidence ref |
| **4.3** | **Node detail** — what it is / how (evidence files) / parts / evidence refs; open-scope drill | 4.1 | E2E: drill into a service, assert the scoped `.seqd` renders and Back returns |
| **4.4** | **Coverage badges in the rail.** Uncovered subtrees marked: `packages/web · 1,545 edges · ⚠ not in the last answer` | 4.1, 1.1 | E2E asserts a package excluded from the digest carries the badge |
| **4.5** | **Flow playback reduced** to play/pause, scrub, and the current hop's evidence ref. Not six controls plus a packet strip plus a detail line | 4.2 | Render test on the control count |
| **4.6** | **Git changes relocated** out of the rail into its own home (status/diff/commit already work server-side) | 2.3 | E2E: commit from the UI |

### WAVE 5 — review, the largest PAR gap. ~9 days.

| # | Item | Deps | Locking test |
|---|---|---|---|
| **5.1** | **Real diff rendering** — muted line-number gutter, low-saturation add/remove washes with a brighter edge, restrained syntax highlighting, "n files changed" + `+`/`−` counts in the header, click filename background to expand/collapse | 2.3, 1.5 | Render test on a 3-file proposal |
| **5.2** | **Per-file accept/reject** + selective staging + revert | 5.1 | E2E: accept 1 of 3 files, assert only that path was written |
| **5.3** | **Line-anchored `+` comments** that feed the chat as steering context | 5.1, 2.7 | E2E: comment on line 42, assert the next turn's context carries `path:42` |
| **5.4** | **Scope segmented control** — Unstaged / Staged / Commit / Branch / **Last turn** | 5.1 | E2E on all five scopes |
| **5.5** | **B2 — the impact panel beside the diff.** New edges, broken edges, cycles created/closed, callers of every changed function, using `computeImpact`/`computeRisks`/`computeCycles` and the FunctionGraph | 5.1, 1.6, 3.4 | E2E: a diff that introduces a cycle shows it named, with `file:line` |
| **5.6** | **Permission rule algebra** (P3 phase 2), serialized to a reviewable text file in the repo — never a database-only rule | 2.8 | A rule denying `Write(packages/analyzer/**)` blocks a proposal targeting it, and the rule round-trips through the file |

### WAVE 6 — containment. Its own wave. ~7 days. Do not fold into Wave 3.

Greenfield in three layers at once. Nothing exists: `grep "parentId|parentNode|extent: 'parent'"` across `product/` and `graph/` returns only `seqdFromGraph.ts:82`, `goalNetwork.ts` and `graph/aggregate.ts`. Zero React Flow parent-node usage anywhere.

| # | Item | Deps | Locking test |
|---|---|---|---|
| **6.1** | **Projection first** — `seqdFromGraph` emits `groups` from `parentId`. The checked-in `archgraph.json` has `parentId` on **114 of 115 nodes**; `SeqDiagramGroup` is declared (`seqdiagram.ts:205-206`) and validated (`:530-542`) and nothing populates it. Today `seqdFromGraph.ts:82` reads `parentId` only to flatten children into a comma list on the card face — which sheet 07.1 names as the explicit "Don't" | 3.2 | A scanned graph produces ≥1 non-empty `groups[]`, and `validateSeqDiagram` passes |
| **6.2** | **Hierarchical ELK.** `archLayout.ts:136-150` builds one flat `children[]` of fixed 160×96 boxes and reads `result.children` **one level deep**. ELK returns nested child coordinates *relative to their parent* — this needs recursion plus coordinate accumulation | 6.1 | A 2-level graph lays out with children inside parent bounds |
| **6.3** | **The `.nest` wall** — `--nest-1`, `--r-18`, `--sp-4` inset, 24px header, members at `--nest-2`. All tokens exist at `product.css:570-575` and nothing consumes them | 6.2, 3.7 | Render test on wall geometry |
| **6.4** | **Expand/collapse + edge re-termination.** On collapse, edges to hidden children re-terminate on the group and aggregate, carrying the **weakest** proof state of the edges they subsume | 6.3 | E2E: collapse a group, assert no dangling edge and the aggregate's proof state equals the weakest member's |
| **6.5** | **Depth-3 ceiling with drill-in** | 6.4 | Assert depth 4 forces a scope change rather than a fourth nest |

### WAVE 7 — cutover. ~3 days.

| # | Item | Deps | Locking test |
|---|---|---|---|
| **7.1** | **Walk the loop on a real repo**, screenshot every state S0–S4 against its sheet | all | Human sign-off recorded |
| **7.2** | **Switch the served entry** from `packages/web` to `packages/web2` | 7.1 | Build exit 0; all 46 e2e green against web2 |
| **7.3** | **Delete `packages/web`** in one commit — 377 source files, 25,425 CSS lines, 362 test files | 7.2 | Build exit 0 after deletion; bundle size posted (v1 entry: 698 KB JS + 201 KB CSS, plus a still-shipping 185 KB legacy `gridColors` chunk and a 200 KB dead `styles` chunk) |

### WAVE 8+ — after cutover, in priority order

P8 server-side runs (`POST /api/program/run`, run list, SSE status, resume from `RunCheckpoint`) → P9 activity view → B6 agents-as-territories on the board → P11 hooks → P12 worktrees → P10 checkpoints → Work mode, whiteboard, draw→logic.

**Draw is the wave-2-after-cutover headline, not a wave-1 item.** It is 1,598 lines (`DrawLayer` 553, `DrawDraftOverlay` 607, `drawSync` 438) whose finish-gesture is still owner-TBD and whose refusal path is unproven at scale. The core loop must be walkable first.

---

## 7. THE RISK REGISTER

| # | Risk | Early warning sign | Mitigation |
|---|---|---|---|
| **R1** | **No regression net.** 179 of 362 test files (49%) are `readFileSync` source greps; **3,418 `toContain(`** assertions; **7 files (1.9%) render anything**; **0 `.test.tsx`**, and the `include` glob would not run them. Baseline today: **27 files / 51 tests failing**, of which **64 failures are `ENOENT`** on files already deleted (`BoardChat.tsx` ×29, `Workspace.tsx` ×15, `App.tsx` ×11). The 46 e2e scripts (12,985 lines) contain **zero `data-testid`** and select on `.arch-rf-card` ×23 | Failing files climb faster than files deleted | **W0.4 + W0.7.** Delete the grep tier, never repair it. Port the e2e onto testids *before* touching a component |
| **R2** | **Underestimating by 2×.** `GRAPHITE-MIGRATION-PLAN.md:334-472` prices W0–W16 — the *reskin of an existing UI* — at **72–84 engineer-days**. The rebuild does not subtract that; it adds re-implementation first | End of week 2: is `attach → see → ask → drill → act` walkable on a real repo? | Demolish and re-shell rather than author from zero. Keep the 250-token layer, keep 197 pure modules, rewrite ~30 `.tsx`. Consider the ml-harness transplant (§7 note below) |
| **R3** | **Graphite was designed in a typeface the app does not ship and is forbidden from fetching.** `_core.html:148-150` links Google Fonts for Instrument Sans; `brandTokens.test.ts:601-607` locks Inter in with a *passing test*; `CLAUDE.md` requires boot with no network. Nine px-locked type/leading pairs with non-uniform ratios; 255 half-pixel usages; 102 sub-10px renders | Week 1: a label wraps differently in the rebuilt surface than in its sheet | **W0.1**, before any component |
| **R4** | **The differentiator ships as a plausible-looking number.** "Coverage on every answer" is described as UI; it is four engine files. `explain.ts:1140-1143` computes omissions against the *already-capped* digest, so it can never report the ~2,026 edges the cap removed | Week 1's engine ticket list does not contain "coverage on the wire, denominator = `graph.edges.length`" | **W1.1 is engine ticket #1**, with a test on the denominator |
| **R5** | **The engine cannot support the interaction model the shell implies.** No streaming, no cancellation, no progress, no watching, no push. The five-state canvas has no way to learn the graph changed, no honest "scanning…", no honest Stop | The first design review that asks "what does the canvas look like during a 4-second scan" | W1.2–1.5 in parallel with Wave 2. Cheapest first: staleness bar (hours), signal plumbing (0.5 d), then streaming (1–2 d) |
| **R6** | **Containment is greenfield in three layers.** Data drops at the projection, layout is flat by construction, the renderer has never used sub-flows. Plus edge re-termination, aggregate proof state, a depth ceiling | Week 3 of Wave 6 shows a nest wall but edges still terminate on hidden children | **Own wave (W6), gated.** Land the projection (6.1) as a one-day testable step first |
| **R7** | **"Just keep the board" is not currently true.** `productFirewall.test.ts` → **20 violations, 13 from `product/arch/`**, including `ProductMadrBreakout.tsx: ../../canvas/MadrBreakout.js` (1,417 lines). `selectorSafety.test.ts` → ~50 unscoped selectors, essentially the whole `.arch-rf-*` family. The built bundle still ships `gridColors-*.js` at 185 KB and `styles-*.css` at 200 KB | The firewall count is not 0 before the shell rewrite starts | **W3.1 first.** The test already enumerates the exact 20 edges. If it is not 0, "keep the board" means "keep `canvas/` too" and the demolition estimate is wrong by ~12,000 lines |
| **R8** | **Hard-won knowledge lives in comments a rewrite is licensed to delete.** The 8 inert handles (delete them and every edge disappears). The elkjs `self.document` stub. `DEFAULT_MAX_CARDS = 24` as derived arithmetic, not a round number. The `main.tsx:34-61` dead-stylesheet note. The `level = 'L2'` owner ruling. `explain.ts:766-790` recording what `slice(0,300)` cost. **1,406 comment lines across 24,788 non-test lines** | A v2 PR "cleans up" a constant with no comment | **W0.2.** Highest return-per-hour item on this page |
| **R9** | **The board's legibility ceiling is 24 cards, derived for a 1400×900 canvas.** The three-pane shell gives ~614px at 1280 wide. Sheet 08 says the opposite of a constant: *"The budget is the frame, not a node count."* Code and book already disagree and nobody noticed | Week 1: open at 1280×800 on a repo with >24 services | **W3.9** — derive at runtime. Decide the rail's narrow-window behaviour in the model layer before any CSS (near-free early, expensive retrofit) |
| **R10** | **"Better at agent workflows" has no server to render.** `runProgram` in the browser; no run id, list, status or resume; `MAX_ASK_TOOL_ROUNDS = 3` | Anyone schedules a workflow monitor in wave 1 | Do not rebuild the workflow surface before cutover. The minimum honest version is server run id + status + SSE — weeks, not a ticket |
| **R11** | **The design source of truth has changed twice in three days.** `docs/brand/` holds three complete books: Console (401 KB, 2026-08-18), Ledger (208 KB, 2026-08-17), Graphite (2026-08-19). `GRAPHITE-DECISIONS.md` is dated one day before this research. Each prior switch left a scar the tree still carries (`ledgerTheme.ts`, `product.css` §3 "the legacy names this tree still calls"). **Five books in seventeen days; `docs/owner-feedback-log.md` carries 19 rounds and the word "supersede" 13 times** | A sheet is edited silently mid-wave | **W0.3.** Freeze at `graphite/`; route rulings through numbered decisions |
| **R12** | **The book covers the graph, not the shell.** Eleven surfaces are unsheeted (§5.6). Adapting ml-harness sheet 17's *thread* rail into a repo/session rail, or sheet 28's *training-metrics* diff inspector into a proposal review, is design work, not transcription | A builder asks "which sheet is the attach dialog?" and there is no answer | Write the missing sheets, or budget the design time explicitly. The dangerous state is assuming coverage |
| **R13** | **The store is the serialization point and it is being rewritten.** 1,627 + 2,387 lines / 92 actions today; 17 selectors read by the board alone. Nothing finishes until the store settles, and every parallel builder edits it in week 1 | Two agents conflict on `state/store.ts` in week 1 | **W2.1.** Types first, standalone, reviewed, one owner for the implementation |
| **R14** | **Both "we win" claims are unproven and the UI is being designed on top of them** (§5.4) | A token-efficiency number appears in a deck or a README | Label UNVERIFIED everywhere. Run the §5.5 experiment. Make **W3.5 (node → composer chip) a Wave-3 acceptance gate** — it is the one action every winning competitor converged on and it does not exist today for a single scanned node |
| **R15** | **The specification loop, not throughput, is the constraint.** `packages/web` began 2026-07-07 and accumulated **+132,715 net lines in 44 days (~1,713 LOC/day)**. That same throughput produced the artifact now being discarded. Rebuilding at the same rate with the same loop produces the same outcome in another 44 days — this time with nothing running while it happens | A sixth brand book is commissioned mid-build | **The Tier-4 rule: no wave ships without a rendered screenshot compared against its sheet.** The cream-canvas incident (`owner-feedback-log.md:36-97`) is this repo's own proof that computed-value assertions do not see a black rectangle. `8d38fad3`'s closing line — *"nobody has looked at this with human eyes"* — is the same failure, still live |

**Four tripwires, if only four are kept:**
1. `npx vitest run` in `packages/web`, posted weekly. Today: 27 files / 51 tests failing.
2. `npx vitest run src/product/productFirewall.test.ts`. Today: 20 violations, 13 from the board. Must be 0 before the shell rewrite starts.
3. End of week 2: is `attach → see → ask → drill → act` walkable on a real repo?
4. Week 1: open the shell at 1280×800 on a repo with >24 services, in Instrument Sans.

---

## 8. WHAT THE ADVERSARY GOT RIGHT

The adversarial lane was asked to kill the pivot. It did not, but it landed five hits that changed this plan. Recording them rather than dropping them.

### 8.1 The 113 minutes

| commit | timestamp | what |
|---|---|---|
| `8d38fad3` | Wed Aug 19 **22:31:06** | `product: Graphite is on the app` — 26 files, +3,692 / −1,346 |
| — | Wed Aug 19 **23:42** | `packages/web/dist/` rebuilt — the app compiles and ships |
| `fe5ad926` | Thu Aug 20 **00:24:43** | `docs: the v2 pivot — rebuild the surface, keep the engine` |
| `315e7878` | Thu Aug 20 **00:29:59** | `demolition is literal` |

The Graphite migration landed on the running product at 22:31; the order to throw it away was written **113 minutes later**. Nothing was measured in between; nothing was screenshotted. `8d38fad3`'s own commit message says so verbatim: *"nobody has looked at this with human eyes — every claim above is a computed-value measurement, because the browser pane would not composite."*

And what landed was `W0` from the migration plan — *"The token layer swap · XL (~5–7 days) · prerequisite"*, the gate that unblocks W1–W5. It shipped with a measured gate (build exit 0, 592 modules; 51 failed / 3,727 passed against a 51-failed baseline — zero new failures), independently reproduced. **The incremental path cleared its hardest blocker and was cancelled within two hours of clearing it.**

**What changed in this plan:** §1.4 — the old UI is not deleted until the replacement runs. §6-W0.3 — the book is frozen by version. §4.6 Tier 4 and R15 — no wave ships without a rendered screenshot compared against its sheet. The decision to rebuild stands; the decision to rebuild *blind* does not.

### 8.2 There are no users, so "the UI was the problem" has no source

`private: true`, `0.1.0`, **`git tag` → 0 tags across 1,346 commits**. The entire evidentiary basis is one person reviewing his own unreleased application nineteen times. No funnel, no retention, no ticket, no session recording, no A/B.

And read as a corpus, the owner's own complaints in `docs/owner-feedback-log.md` are **majority functional**: *"scan failed: only URL … supported by the ESM loader on Windows"* · *"no repo attached … POST /api/attach. What does that even mean?"* · *"It's a brand-new file. Why would I touch repo?"* · *"why isn't the free model loading a key?"* · settled dislikes for *"silent failure in the scanner"* and *"any '+N more' that cannot be reached"*. **Not one of those is fixed by a stylesheet**, and every one still has a live analogue in §3.5.

**What changed in this plan:** Wave 1 (engine) runs in parallel and is resourced first, not after. §5.4 states the three competitive claims as adjudicated rather than assumed. The `+N more` complaint is a named locking test in W3.10.

### 8.3 The pivot contradicts itself, and the contradiction is load-bearing

*"Nothing is inherited — no layout, no component, no class name, no colour"* versus *"the architecture board, the one surface worth keeping."* The board is a component with class names, a layout and colours. A contamination firewall with a 6,425-line hole in it is a preference, not a firewall.

**What changed:** §1.5 states the governing distinction — **pure modules are inherited, rendered chrome is not** — and applies it to the whole tree, not just the board. It is the only reading under which both halves of the order are executable.

### 8.4 The test mass is answered by `rm`, not by a rewrite

53.8% source-greps, 1.9% rendering, `ci.yml` comment: *"Web vitest is not required."* 57,120 LOC of tests, zero gating a merge. And the repo documents the exact failure it causes: the cream-canvas defect shipped through two full rounds with every gate green.

The adversary's point is sharp: **the rebuild inherits the same testing culture unless someone names it.** Nothing in `PIVOT-V2.md` says the v2 suite must render.

**What changed:** §4.6 defines five tiers with the source-grep tier explicitly banned and lint-enforced, W0.4 deletes rather than repairs, W0.7 preserves the 46 Playwright scripts as the only real asset, and Tier 4 makes a screenshot a shipping requirement.

### 8.5 Throughput removes the classic "never rewrite" objection — and this is the strongest *pro*-pivot fact anyone found

`packages/web` began 2026-07-07 and accumulated **+173,050 / −40,335 = +132,715 net lines in 44 days across 697 commits — ~1,713 LOC/day**. At demonstrated throughput, the ~44,840 LOC of new chrome is **≈26 days of authoring**. The incremental path's remaining W1–W16 is **67–77 days**. The two paths are the same order of magnitude.

The adversary expected this to be its strongest argument and reported honestly that the numbers took it away. But it drew the right conclusion from them: **the same 44 days that prove a rebuild is fast also produced the artifact now being discarded. Throughput was never the constraint. Specification was.**

**What changed:** R15 is in the register with the specification loop, not the LOC count, as the named failure mode. And the plan does not author 44,840 lines from zero where a transplant is available — §7-R2's mitigation names `ml-harness/frontend` (**57 files / 18,628 LOC / 5,822 CSS**, already on Graphite three-state tokens, and the owner's own assessment is that it is better at chat, tool calling and prompting) as the shell to mount the board, the `.seqd` doc and the analyzer client onto. That is a decision for whoever executes Wave 2: **author, or transplant.** The plan is agnostic on which, and explicit that transplant is cheaper and has the property that something runs at every step.

### 8.6 What the adversary got wrong

Its counter-proposal — *don't rebuild, transplant + delete + spend the weeks on the engine* — treats the shell rewrite and the engine work as competing for the same budget. They do not. Wave 1 and Wave 2 have no shared files, no shared reviewer, and no shared blocker. Running them in parallel is the plan, and it is what makes the adversary's Move 3 and the owner's order compatible rather than exclusive.

It also under-weights the one thing the ten lanes agree on: **the grounded graph cannot currently talk to the agent**, on any scanned node, at all (`ArchCanvasBoard.tsx:486-491` + `drawSync.ts:281-283`). That is not an engine defect and not a stylesheet defect. It is a shell defect, it is one day of work, and it is the single action every winning competitor converged on. Fixing it requires a shell that was built to do it — which is the plan.

---

## APPENDIX — UNVERIFIED LEDGER

Carried forward from the lanes. Every one must be labelled UNVERIFIED wherever it is repeated.

- **Tokens-to-correct-answer, graph vs grep, in a real agent.** Never measured end to end. §5.5 is the experiment.
- **All `learn.chatgpt.com` quotations** — fetched through a summarizing model, not read raw. `DESIGN_DIRECTIVES.md:11-14` requires a screenshot of the current Codex build before any of it is copied as design law.
- **Whether the post-merger ChatGPT app still exposes every Codex surface** listed in §5. Docs describe a unified product; complaint sources say the PR space was lost.
- **TechRadar body (403), G2 reviews (403), OpenAI's Codex announcement (403), Devin Desktop rebrand details (429).** Headlines and secondaries only.
- **Copilot Workspace's exact sunset date** (2025-05-30) — no primary GitHub notice located.
- **ACP registry launch and "25+ agents"** — secondary only.
- **Codemaps' adoption/retention since 2025-11-04** — no data published.
- **Relative market size of Structure101 / Lattix / NDepend** — no usage data.
- **Whether `scan.ts` still drops non-relative imports** (476 `@sequence/*` specifiers previously invisible at `scan.ts:221-222`). Not re-checked this pass — and it is the likely root cause of G17's 6-of-7,759 cross-package call edges.
- **`who_calls` behaviour after commit `0c932928`.** Reported fixed in the brief; the token lane measured 89.5% recall, which is consistent with a fix plus G17, but the commit was not re-run in isolation.
- **The 15,607-LOC / 118-file unreachable figure** — one lane's transitive-closure crawl; spot-checked on 9 names (`DocsPanel`, `ArchExplainerPanel`, `askPracticeKit`, `SeqDiagramBoard`, `BoardPageChips` all confirm 0 non-test importers), not fully re-derived.
- **W0–W16 day estimates** are `GRAPHITE-MIGRATION-PLAN.md`'s own; summed (72–84 d), not audited individually.
- **The 26-day rebuild estimate** extrapolates historical LOC/day and excludes design iteration, integration and review rounds — historically the dominant cost here. **Floor, not forecast.**
- **`ml-harness/frontend` quality** is the owner's assessment. Only its size was measured (57 files / 18,628 LOC / 5,822 CSS).
- **Nothing in this plan was rendered.** No screenshot of the current or proposed UI was taken. Every claim about how anything *looks* is second-hand from `docs/owner-feedback-log.md`, commit messages, and CSS values read as text. This is the exact failure mode R15 names, and it applies to this document too.

**Two lanes (Claude Code, visual-field) arrived carrying a harness notice that their output matched an instruction-shaped pattern (`bypass-permissions`) with control tags neutralized.** Both were read as data. Neither contained a directive that was acted on. Flagged so the owner knows those two lanes were pattern-matched at ingest.

**No file in the repository was created, edited or deleted in the production of this plan.** `docs/lora-operator-guide.md` and `docs/lora-phase0-phase1-plan.md` were not opened.