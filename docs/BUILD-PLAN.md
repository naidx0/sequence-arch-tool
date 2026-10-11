# The build plan — five phases, measured

**Written 2026-08-21.** The source of truth for what gets built next and in what order.
[`CANON.md`](CANON.md) still owns product, strategy and our advantage; this page owns the ladder.

Every number here was measured on real repositories during the session that wrote it. Where a
number came from a fixture it says so, because the difference turned out to be the whole point.

---

## Phase 0 — the tripwire, and what it found

Run before anything else ships more material into a prompt, because it can refute a strategic
assumption rather than add a feature. It did.

`buildAskPromptWithCoverage` (`packages/analyzer/src/explain/explain.ts:1802`) ships the digest,
coverage, risks and impact into **every** ask, unconditionally. The predicate: render that prompt
for three different repositories and measure how much of it is actually about the repository.

| repo | prompt | edges the digest saw | risks computed |
| --- | --- | --- | --- |
| **this monorepo** | 4,586 chars (~1.1k tok) | **0 of 1,204** | **0** |
| **ml-harness** | 29,055 chars (~7.3k tok) | 147 of 1,338 (11%) | **0** |
| shopfront *(fixture)* | 12,910 chars | 39 of 39 (**100%**) | 6 |

**93% of the prompt for this monorepo is text that would appear whatever repository you pointed it
at** — 12 of its 15 lines are identical to the ml-harness prompt and to the fixture's.

The edge kinds explain it:

| repo | kinds present |
| --- | --- |
| this monorepo | `import` 1198, `db_read` 2, `db_write` 4 |
| ml-harness | `import` 1150, `db_read` 128, `db_write` 60 |
| shopfront *(fixture)* | http 8, grpc 1, queue_publish 1, queue_consume 2, db 13, import 14 — **eight kinds** |

A hand-built 36-node fixture has a rich interaction graph. Two real repositories have imports and
(since this session) datastores, and nothing else. **The product's grounding looks excellent on the
fixture it was built against and is close to empty on real code.** CANON already warned about
exactly this — *"fixture scale proves logic; only a REAL repo proves the result"* — and this is what
it looks like when it happens.

### Why there are no http edges, measured

ml-harness is a FastAPI backend with a React SPA that calls it. It produces **zero** http edges and
**zero** http warnings — the joiner never even got a fact to discard. Two independent causes:

1. **The SPA is not a service.** `collectManifestRoots`
   (`packages/analyzer/src/discovery/codefirst.ts`) returns at the first manifest it finds and does
   not descend, so `frontend/package.json` is never read. One service exists, and an http edge in
   `join/join.ts` requires a **second named service** to point at — so it is unrepresentable before
   any detection question is asked.
2. **Real frontends call through a wrapper.** ml-harness's SPA holds literal routes —
   `/api/threads`, `/api/providers`, `/api/projects` — but passes them *into* one client:
   ```js
   fetch(`${session.baseUrl}${path}`, { ... })   // frontend/src/lib/engine/client.ts:153
   ```
   `detectors/http.ts` matches a literal path at the `fetch` site. Every modern frontend funnels
   through a client like this, so the detector sees a template of two variables and nothing else.

This is the finding the ladder is built around: **the interaction graph is the product, and on real
repositories it is missing.** Everything downstream — risks, coverage, paths, verification — is
computing over a graph that is almost entirely `import` edges.

---

## What the inventory found, and why it reordered this page again

A full inventory of the wave plan against the tree (2026-08-21) verified 40+ items as shipped and
returned **19 outstanding**. Two of them outrank everything the tripwire found, because they are
what a user meets in the first ten seconds:

**1. THE ASSISTANT IS A DEAD UI.** Nothing in `packages/web2` ever calls `/api/ask` or
`/api/ask/stream`. The only mentions in the whole package are in two test files. `store.ts:106`
says so in as many words — *"WHAT THIS FILE DELIBERATELY DOES NOT DO: fetch… Item 2.9 owns the ask
transport"* — and item 2.9 was never built. Confirmed in the running app: type a question, press
Send, and the message lands in the transcript while **no request is made at all**. No answer, no
error, no way to stop it. The product's primary interface does nothing.

**2. THE BOARD HAS EXACTLY ONE LEVEL.** `archGraphToSeqDiagram` places **2 of 609 nodes** on the
board for this monorepo — one service and one datastore — and the orphan pass adds the other nine
services back. **No module ever reaches the board**, so a service cannot be opened to show what is
inside it. The root cause is projection policy, not the renderer: the projector only admits nodes
that appear on a projected edge.

Both are ahead of the interaction graph, because an empty graph behind a working assistant is a
product you can use badly, and a perfect graph behind a dead assistant is a product you cannot use
at all.

---

## The ladder

Ordered so each phase is testable alone and leaves the product better than it found it.

### Phase 1 — THE ASSISTANT ACTUALLY ANSWERS

**After this phase:** you type a question, tokens stream back, you can stop it, and the answer says
what it did **not** read.

**Why first:** it is the product's primary interface and it does nothing today. Three of the five
verbs — ask, act, and the canvas movement ask is supposed to drive — are behind it.

**The work**
- Wire `POST /api/ask/stream` from the composer. The store deliberately holds no transport, so this
  is a client beside `boot/bootClient.ts` handing results in as actions — not a fetch in the store.
- A `delta` variant on the ask stream and an `onDelta` at the call site: the provider streams today
  and nothing carries it to the wire, so an answer would otherwise appear all at once.
- Stop, wired to the existing `AbortSignal` path (`repoServer.ts` already races aborts and already
  refuses to meter an aborted call).
- **The coverage chip beside the answer.** `computeAskCoverage` is what CANON calls "the single
  strongest thing we have" and it is rendered only in the rail. The sentence
  *"answered from 296 of 2,326 edges · analyzer only"* is the demo.
- `@` mention over services, files and functions, so context can be attached from the keyboard.
- Raise the three-round tool cap that currently ends hard questions mid-search.

**The gate** — real prompts against real repositories:
- On this monorepo: *"what talks to the database?"* streams an answer citing `file:line`, and the
  coverage chip names the packages that contributed nothing.
- On ml-harness: *"how does a request reach the database?"* — the answer must not claim an http edge
  the graph does not hold (Phase 2 is what makes that edge exist; until then the honest answer is
  that it cannot see one).
- Stop mid-stream and assert the provider call aborted and `usedThisMonth` did not increment.

**Stop and replan if:** the transport lands and answers are worse than the same question asked with
no digest at all. The tripwire below already shows the digest is 93% boilerplate on this repo —
if a measured A/B says the grounded artifact hurts, ship the record that the walk ran instead of the
walk's output, exactly as ml-harness measured (61% vs 92%, p=0.0002).

---

### Phase 2 — THE BOARD SHOWS THE SYSTEM

**After this phase:** the board draws more than one level, and on a real two-tier application it
draws a frontend, a backend, a datastore and the calls between them.

**Why here:** it is the surface the owner named as the one thing worth keeping, and it currently
shows eleven boxes and one line. It merges the projection fix with the interaction-graph work,
because a second level with no edges between the things in it is not worth drawing.

**OWNER RULING, 2026-08-21 — THE SYSTEMS LAYER, AND ONLY IT. Wave 6 containment is CUT.**

Max: *"i dont think im a fan — in the last build i had them pretty much taken out, since the only
levels that worked good was L3 systems, so i think we harness that aspect and keep it like that as
is."*

**CORRECTION — the ruling is about SEMANTIC LAYERS, not nesting depth.** An earlier draft of this
page attributed it to containment, which was wrong. The reference he was reading from
(`coding-canvas-demo.vercel.app`, recorded in [`OWNER-REFERENCES.md`](OWNER-REFERENCES.md)) offers
three layers of the same system — **L1 Business · L2 Systems · L3 Contracts** — and the same message
says *"I don't like the contacts, contracts, business. I just like the systems aspect of it."* So:
**Sequence draws the SYSTEMS layer and only the systems layer.** No business-capability layer, no
API-contract layer.

Containment is cut too, but on its own separate reasoning:

- **The level below systems is currently a liar.** On ml-harness 4 of 7 modules are labelled
  `tests`, and one of those holds `app/db.py` and `app/main.py`. Nesting into a level whose names
  are wrong makes the board worse than not having the level at all.
- **The rail already drills down, and does it well** — measured on ml-harness rendering
  `asking.py 45`, `diagnosis.py 115`, `main.py 63`. CANON assigns exactly that job to the rail:
  *"chat on the left drives it, an Obsidian-style rail on the right drills into it."* Board nesting
  duplicates the rail.
- **It is the most expensive wave left.** Item 6.2 alone is recursive ELK with coordinate
  accumulation; 6.4 is edge re-termination on collapse. That budget buys the interaction graph.

So the board has ONE structural level — systems — and the work is making that level TRUE, not
deeper. `SeqDiagramGroup` stays declared and unpopulated on purpose; that is now a decision rather
than a gap, and item 6.5's "depth-3 ceiling" is moot.

**KEPT, and not what the ruling is about:** the five LOD rungs in `packages/web2/src/canvas/lod.ts`.
Those are zoom-driven RENDERING detail — rung 2 drops the kind tag, rung 3 the subtitle, rung 5
leaves the silhouette alone — and every threshold is derived arithmetic (`--t-10 / --t-11`), i.e. a row is
dropped exactly when it would paint under one device pixel. They are what stops a 600-node board
turning to mush when you zoom out.

**The work — projection**
- The orphan pass rescues services onto the board; that stays. Modules are deliberately NOT
  admitted (see the ruling above).

**The work — the interaction graph (was Phase 1)**

- Descend past the top-most manifest so nested app roots become services
  (`discovery/codefirst.ts` `collectManifestRoots`). ml-harness gains a `frontend` service.
- Resolve a client wrapper one indirection: when a function's body fetches a templated base plus a
  parameter, attribute its **callers'** literal path arguments as client facts. The function graph
  already attributes cross-boundary hops onto an enclosing function
  (`functions/crossServiceEdges.ts`), so the machinery exists.
- Stop dropping an external host silently (`join/join.ts` — the literal-host branch ends in a bare
  `continue`; the env branch warns). Ollama and Hugging Face are seen and discarded with no record.
- Fix the Go trailing-slash prefix route match before any "dangling route" claim ships:
  `shipping/main.go:53` registers `/shipments/` and the gateway calls `/shipments/:id`; segment
  matching fails and produces a **false** 404.

**The gate** — real repositories, not fixtures:
- ml-harness draws **≥2 services** with **≥1 http edge** between them, cited to
  `frontend/src/lib/engine/client.ts` and to the FastAPI route it hits.
- `microrealestate` (five services, one mongo — ground truth already at
  `docs/ground-truth/microrealestate.json`) draws all five and their store.
- `Online Boutique` (`docs/ground-truth/online-boutique.json`, 14 hand-verified gRPC edges) draws
  the Go/Python/Node services and **names** the C# and Java ones it could not follow.
- The digest's coverage on this monorepo and on ml-harness rises from 0% / 11%, and `risks` stops
  computing 0 on both.

**Stop and replan if:** the wrapper resolution produces edges that cannot be cited to a line, or the
false-404 class survives. A wrong edge with a citation is worse than no edge — CANON records that
`svc:gateway`'s only two inbound edges were nginx confs inside test fixtures.

---

### Phase 3 — WHAT WE ALREADY PARSE AND THROW ON THE FLOOR

**After this phase:** a table, a route, a topic and a test are first-class things you can ask about,
and the board can print four negatives nobody else can.

**Why here:** it is the cheapest slab in the product — most of it is already computed and discarded
— and Phase 1 is what makes its answers non-empty.

**Already computed, then dropped**
- `analyzer/src/ddl.ts` builds `table → accessing services` and renders it as a CREATE TABLE comment.
- `joinInput.routes` is assembled in `scan.ts` and discarded when the join returns; the repo's whole
  HTTP surface is parsed every scan and thrown away.
- The unmatched-call signal survives only as a confidence penalty in `join/join.ts`.
- `testFiles.ts` knows a test file in five languages and the verdict is never recorded on a node.

**The four negatives** — each needs a complete model to subtract from: a table read by a service that
does not own it; a route with no in-repo caller; a topic published and consumed by nobody; and files
in your blast radius reachable by **no test**. Measured here: 57 of 305 product files have no test
anywhere in their reverse closure.

**The gate:** on `microrealestate`, *"who else writes what `api` writes?"* returns owners, readers and
`file:line` on both ends. On `robot-shop`, the topic pair resolves. On this monorepo, the
untested-blast-radius line is produced and spot-checked by hand.

---

### Phase 4 — PATHS, NOT SETS

**After this phase:** you can ask for the route between two nodes and get ordered `file:line` hops
labelled by edge kind, plus a named list of every hop that could not be followed.

**Why here:** it needs Phase 1's edges to have anything to walk. Grepping `packages/*/src` for
`pathsBetween|shortestPath|findPaths|allPaths` returns **zero hits** — every consumer of the graph
returns sets. It is the largest gap between what the graph contains and what it can answer, and it
turns CANON's one surviving measured win (113 files at depth 4 in one call vs ~60 grep round trips)
from an unreadable set into a readable answer.

**The gate:** Online Boutique renders `frontend → checkoutservice → paymentservice` hop by hop, each
cited, and ends by naming `cartservice` (C#) and `adservice` (Java) as chains it could not follow.
The exception list is the product — every SCA vendor's published weak point is an unsound
"not reachable".

---

### Phase 5 — THE LIE DETECTOR

**After this phase:** an agent's reply is cut mid-sentence the moment it cites a `file:line` or an
edge the scanned graph does not hold, and a post-edit rescan says whether the architectural claim in
its summary is in the code.

**Why here:** it needs a graph worth checking against. It is also the one capability that is
**structurally** not copyable: an LLM-generated map cannot be a lie detector for an LLM, and Codex
and Claude Code hold no structural representation to diff against. Their answer to "the model was
wrong" is an exit code, which is blind by construction to the change that compiles, passes, and is
architecturally wrong.

**Already built:** `schema/src/graphChecker.ts` and `policyChecker.ts` already encode the posture —
*agents propose, code decides, no model judges a model* — but only against a proposed mutation.
`computeAskCoverage` already isolates what the digest rendered; that set **is** the ground.
`graphCache` makes a warm rescan 0.38s against 3.96s cold, so a post-edit rescan fits inside the loop.

**The gate:** `shopfront` → `shopfront-mutated` is already the exact pair — one edge disappears. The
agent performs that edit, summarises, and the sentence claiming the gateway still routes payments is
stopped, with the withheld draft written to the transcript rather than deleted.

**Honest limit, to be held RED rather than papered:** a claim about intent ("this is cleaner") is in
no pool by construction.

---

### Phase 6 — THE SECOND OPINION

**After this phase:** you can point Sequence at another agent's work — or an arbitrary diff — and get
the complement: what it never looked at.

**Why last:** it is the cheapest way to put our one surviving advantage inside the tool people
already use, and it needs Phases 1–3 for the denominator to be worth having.

`computeAskCoverage` is the one claim CANON says the competition structurally cannot make, and it is
computed **only** about Sequence's own digest, inside its own pipeline, reported **only** in its own
chat. **None of the 8 MCP tools exposes it.** An agent consuming us as a server cannot carry our
strongest claim.

**The gate:** Claude Code completes a real task in `microrealestate` with Sequence's MCP server
attached; Sequence returns the consumers in the blast radius that were never opened, with
`file:line`. Then the CI half on `robot-shop`: a PR adding a sync call into `payment` exits non-zero
with both anchors and a burn-down line.

---

## Deliberately not built

Each was researched and killed with a reason; they are recorded so they are not re-proposed.

- **Git-history / temporal coupling.** The commodity input every tool already has; the parse adds
  almost nothing, and an N-commit rescan does not fit the 4-second budget.
- **Runtime tracing / OTel ingestion.** Would upgrade inference to observation and costs local-first.
  The surviving form is a dropped-in file, no network — parked behind Phase 3.
- **Dead-code detection at function granularity.** 680 of 3,207 function nodes have zero inbound
  edges; 282 are module scopes, 386 are in tests, and the remainder is receiver dispatch and
  callbacks-as-values. `FunctionFact` has no `exported` flag. The honest subset is route-level and
  lives in Phase 2.
- **Column-level lineage.** `detectors/db.ts` extracts tables and direction, not columns. Promising
  column granularity would mean inventing a number. Table granularity is the boundary and Phase 2
  must say so out loud.
- **A prettier map.** CANON's graveyard is explicit and this plan does not argue with it.
