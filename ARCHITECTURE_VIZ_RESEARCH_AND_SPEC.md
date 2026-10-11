# Architecture Visualizer — Research Findings & v1 Technical Spec

**Date:** 2026-07-07
**Status:** Research complete. No application code written (by design). This document is the hand-off artifact for a build session.
**The idea:** An interactive, infinite-canvas, Miro/Obsidian-style node graph of software system architecture with recursive drill-down (system → backend → services → files), showing **both** hierarchical containment **and** real inter-component interaction edges (API calls, message queues, shared database access) — inferred automatically from **static code alone** (no runtime tracing).

---

## TL;DR

1. **The gap is real.** After a thorough sweep of both prior-art categories, **no shipping product combines (1) interactive recursive drill-down, (2) real interaction-edge mapping, and (3) static-code-only input.** Every tool has at most two of the three. Closest: CAST Imaging (static + drill-down, but intra-app, enterprise legacy tooling), CodeViz (static+LLM, interactive, but single-repo code structure, no cross-service edges), IcePanel/LikeC4 (perfect UX model, 100% hand-authored).
2. **The wedge is confirmed, with one sharpening:** the differentiator is not just "static-only drill-down with interaction edges" — it is **trust**. Every edge must be *evidence-backed*: click an edge → see the `file:line` of the HTTP call / topic string / table access that created it, with a confidence score. This is the exact opposite of the market's current default (LLM-guessed Mermaid diagrams), and it is what Backstage's stale-YAML failure and GitDiagram's hallucinated edges both point at.
3. **Feasibility is high, and the hard part has a published ceiling.** A 2025 academic benchmark of 9 static microservice-architecture-recovery tools shows the winning approach (Code2DFD: ~40 narrow, framework-specific deterministic extractors) reaches **F1 ≈ 0.87 on interaction edges** in Java/Spring. gRPC/proto edges are near-certain (P ≥ 0.95); HTTP and pub-sub are 0.85–0.95 precision with recall as the limiter; shared-DB coupling ~0.9 precision. Deterministic extractors + confidence-scored joining + LLM only for the fuzzy residue is the recipe.
4. **Rendering stack is settled:** React Flow v12 (`@xyflow/react`, MIT) + elkjs in a Web Worker. Containment is drawn as **spatial nesting, not edges**; interaction edges are stored at leaf level and **aggregated to the deepest visible ancestor** with counts (the IcePanel/Cytoscape-meta-edge pattern). LLM is used **only to name and describe** deterministically-computed clusters (Leiden on the import graph) — never to decide membership or invent edges.
5. **Biggest risk:** interaction-edge recall on dynamic, config-indirected codebases (env vars injected at deploy, API gateways, computed URLs/topics). **De-risk with a UI-free spike first** (§3.3): CLI that emits service-level edges + evidence for 2 real polyglot repos, gated at ≥80% precision / ≥60% recall against hand-built ground truth, before any canvas work.

---

# Phase 1 — Competitive & Prior-Art Research

## 1A. Codebase / repo structure visualizers

### GitDiagram (gitdiagram.com) — closest known prior art
- **What it does:** paste a GitHub URL → one system-architecture diagram of the repo. ~15.8k GitHub stars, ~250k+ users, MIT, self-hostable ([repo](https://github.com/ahmedkhaleel2004/gitdiagram)). Launched Dec 2024, went viral in 24h.
- **How it actually works (verified from source):** it **does not parse code at all.** Input = recursive file tree + README only. Pipeline: LLM pass 1 writes a plain-English architecture explanation → LLM pass 2 converts explanation + file tree into a node/edge JSON graph (explicit budgets: 14–24 nodes, ≤8 groups, 10–34 edges) → validation that every node path exists in the real tree, retry on violations → compiled to Mermaid.
- **Interaction model:** static Mermaid render; nodes are click-out links to GitHub. No drill-down, no canvas, no re-layout.
- **Weaknesses:** every "A calls B" arrow is an LLM guess — **edges are hallucinated by construction**; one fixed altitude; Mermaid breaks on large graphs and the LLM emits invalid Mermaid with no reliable fix (author-acknowledged); single-repo scope; accuracy collapses when large file trees must be truncated.
- **Lesson:** the two-pass prompt + validate-against-ground-truth-and-retry loop is worth stealing; everything else is the anti-pattern to beat.

### CodeSee — the cautionary tale
- Auto-generated interactive codebase maps (file/folder nodes, real import edges from static analysis, JS/TS/Py/Go/Java), Code Tours, PR Review Maps, and a beta Service Map. The closest spiritual predecessor.
- **Acquired by GitKraken May 2024; standalone product sunset** ([PR](https://www.prnewswire.com/news-releases/gitkraken-acquires-codesee-launches-new-devex-platform-including-support-for-google-geminis-ai-model-302144298.html)). ~$10M raised.
- **Why it failed:** file-level import maps are simultaneously too coarse to answer real architecture questions and too noisy at scale; the map was a destination app outside daily workflow; its Service Maps (the actually-differentiating part) never reached GA — and notably were **hybrid static + distributed tracing**, i.e. pure-static edges weren't good enough for them pre-LLM ([service maps page](https://www.codesee.io/service-maps)).

### Swimm — pivoted away
Now an enterprise "Application Understanding Platform" for mainframe/COBOL modernization (deterministic static analysis + GenAI → docs/rules, MCP-fed to agents). Not a visualization competitor; does validate "deterministic static analysis + LLM explanation" as an enterprise-sellable combination.

### Sourcegraph / Cody — no viz product
World's best code-intel infrastructure (SCIP precise indexing, cross-repo references) and **never shipped a visual navigation layer on it**. Cody Free/Pro terminated July 2025; individual focus moved to Amp. Existence proof that the underlying data is extractable at scale — and that the view layer is genuinely unbuilt.

### Sourcetrail — the discontinued gold standard for drill-down UX
- Desktop explorer, compiler-accurate indexing (Clang/JDT), interactive graph + synchronized code view; click any symbol to re-center. Best-executed "recursive drill-down on real static edges" ever shipped.
- Open-sourced 2019, **discontinued Sept 2021** ([archive issue](https://github.com/CoatiSoftware/Sourcetrail/issues/1214); active community fork petermost/Sourcetrail through 2025). Post-mortem reasons: unsustainable revenue; **per-language compiler-grade indexers were a crushing maintenance burden for 2 people**; desktop + per-project setup friction.
- **Lessons:** (1) users loved and mourn the UX — HN grieved twice; (2) never build compiler-grade per-language indexers — tree-sitter + heuristics + LLM assist changed this economics; (3) Sourcetrail's ceiling was symbol altitude: it answered "what calls this function," never "how does this system hang together"; the architecture altitude is unoccupied.

### Structurizr / C4 ecosystem (IcePanel, LikeC4)
- **C4 model** (Context → Container → Component → Code) is the de-facto vocabulary for exactly the target hierarchy — with interaction edges as first-class relationships. But in the entire mainstream ecosystem, **both elements and relationships are hand-declared** — the model is what the architect believes, not what the code does, and it drifts.
- **Structurizr:** cloud service EOL (read-only July 2026, shutdown Sept 2026), consolidating into self-hosted open-core "vNext" ([EOL notice](https://docs.structurizr.com/eol)).
- **IcePanel** (YC W23, ~$20/user/mo): best-in-class *manual* zoomable C4 UX with drill-down and connection roll-up between levels. Nothing inferred from code.
- **LikeC4** (MIT, active, [likec4.dev](https://likec4.dev/)): strongest OSS interactive C4 — DSL → single model → zoomable multi-level web diagrams, VS Code extension, **MCP server so agents can query the model**. Hand-written `.c4` files.
- **Lesson:** C4-land owns the correct ontology and drill-down UX and proves the demand; the entire category's cost — hand-maintenance — is precisely what static inference removes. Also: expose the model over MCP (LikeC4 and DeepWiki both validate this).

### Obsidian Canvas + OSS dependency visualizers
- Obsidian Canvas: validates the infinite-canvas + groups UX and offers **JSON Canvas** as an open interchange format; no codebase-analysis plugin of substance exists.
- dependency-cruiser (active, v18), madge, pydeps, etc.: commodity import-graph extractors with static-image output; file/module altitude only. They prove import edges are cheap; no product layer.

### gource
Animated commit-history playback (VCS log input — knows who touched which file, nothing about architecture). Non-interactive eye-candy; zero overlap beyond aesthetics.

### New entrants 2024–2026
- **DeepWiki** (Cognition/Devin, Apr 2025): repo → auto wiki with Mermaid diagrams + Q&A; enormous distribution. Static wiki pages, LLM-narrated edges, no interactive canvas or verified graph. Biggest gravity-well and a distribution threat.
- **CodeBoarding** (OSS MIT, ~2.3k stars): most technically aligned OSS — **static analysis first, LLM agents interpret, output validated against the static graph**; multi-level Mermaid with configurable depth. Ceiling: Mermaid rendering, LLM-decided boundaries, drill-down = regeneration not navigation.
- **CodeViz** (YC S24, $0/$19/$50 tiers): VS Code + web "living model of your software architecture," static analysis + Anthropic models, interactive diagrams from architecture down to function calls, click-to-code. **Nearest live commercial competitor.** Gaps: IDE-embedded editor rather than canvas product; single-repo/workspace; cross-service edges (queues, shared DBs across repos) not a demonstrated strength; AI-curated rather than exhaustively verified.
- **Eraser / Eraserbot:** AI diagrams from a connected codebase that auto-update on changes; conventional bounded diagrams, snippet-level LLM inference, no whole-program graph.
- **CodeLayers:** 3D dependency graph (files/functions) on iPhone/VisionPro + VS Code; real static edges, but symbol/file altitude only, 3D novelty over navigation.

## 1B. Service-interaction / distributed-system mapping tools

### Datadog Service Map + Software Catalog
- Auto-derived live topology from **APM distributed traces** and/or **eBPF (Universal Service Monitoring — kernel-level HTTP parsing, zero code changes)**. Interactive drill-*across* (click service → upstream/downstream), grouping by team/application, but **no containment hierarchy below "service"** — drilling into a service exits the map into flame graphs.
- $31–48/host/mo APM; notorious bill sprawl. ([Service Map docs](https://docs.datadoghq.com/tracing/services/services_map/), [USM](https://www.datadoghq.com/product/universal-service-monitoring/))
- **Weakness:** requires instrumented **running production traffic**; nodes age out after 30 days without traces; only traffic-exercised paths appear (cold paths, batch jobs invisible); can't map a system you haven't shipped.

### Honeycomb Service Map
Trace-derived, with a genuinely novel twist: filter the map by unlimited high-cardinality dimensions ("architecture as seen by this customer / this error class"). Runtime-only, flat service graph, debugging surface not documentation.

### Jaeger / OpenTelemetry / Grafana Tempo
OSS runtime service graphs. Jaeger's dependency view needs a creaky Spark batch job at scale; Tempo's metrics-generator emits service-graph metrics rendered by Grafana's node graph. OTel itself is instrumentation + wire format, no viz. All runtime-only, flat, minimal interactivity.

### Backstage (Spotify) — the canonical cautionary tale for declared metadata
- The closest existing **ontology** to this product: Domain/System/Component/API/Resource entities with `dependsOn`, `providesApis`, `consumesApis`, `partOf` relations. Visualized by the catalog-graph plugin (an entity-relationship viewer, not an architecture canvas).
- **Every fact is hand-declared in `catalog-info.yaml`.** No built-in or mainstream plugin statically infers edges from code. Result: chronic staleness, "Backstage backlash," metadata-maintenance fatigue; competitors (Cortex, OpsLevel, Port) differentiate on *auto-populating* the catalog. ([catalog docs](https://backstage.io/docs/features/software-catalog/))
- **Lesson:** Backstage proves demand for the containment+interaction model at enterprise scale *and* proves hand-maintained edges are the failure mode. Emitting `catalog-info.yaml` from inferred data is a plausible future integration.

### IaC / infra diagram generators
Inframap (OSS, slow-moving), Pluralith (stalled/abandoned — a data point that Terraform-viz-only startups struggle), Brainboard (design→Terraform, reverse direction), Cloudcraft (acquired by Datadog 2022), AWS Infrastructure Composer; AWS Workload Discovery retiring Aug 2026 in favor of CloudWatch Application Map / AI agents.
- **Category-wide weakness:** edges are infrastructure plumbing (SG allows 443, subnet contains instance), **not application semantics** — an IaC graph cannot show that `checkout` calls `payments POST /charge` or reads `orders_db.transactions`. But manifests/IaC are a **superb service-inventory and wiring source** (see §2.2e).

### Multiplayer (multiplayer.app)
"System Auto-Documentation" startup, $3M seed 2023. Edge derivation is **OTel runtime ingestion** (confirmed from docs), not static. By 2026, repositioned toward an OSS debugging agent; auto-documentation is no longer the lead story. **Lesson:** OTel-ingestion-for-architecture-docs was a hard standalone sell; validates the thesis, invalidates the runtime path for this use case.

### Others
- **AppMap:** interactive maps from *executed* code (test runs); coverage = what tests exercise; per-app.
- **vFunction:** "architectural observability" for Java/.NET monolith modernization; dynamic+static hybrid with an agent; enterprise, single-app.
- **CAST Imaging:** the strongest **static** prior art — semantic static analysis (150+ languages) auto-generating interactive drill-down maps incl. data-access and transaction paths, marketed for DB-dependency discovery and microservice extraction. Enterprise batch tooling, dated UX, intra-application depth; **cross-service distributed edges are not its strength**. Proof the static approach works at industrial scale — built over decades of per-framework analyzers.
- **Helios** (OTel dev-facing maps) acqui-hired by Snyk 2024; **Catio** ($3M, 2025) does infra-level "architecture digital twin" from cloud integrations, closed beta.

## 1C. The gap, plainly

| | Interactive recursive drill-down | Real interaction edges | Static-code-only, zero hand-metadata | Alive mid-2026? |
|---|---|---|---|---|
| GitDiagram / DeepWiki / Swark / Eraser | ✗ static pictures | ✗ LLM-guessed | ✓(tree only) | ✓ |
| CodeSee | ✓ | ~ (imports; service maps needed tracing) | ✓ | ✗ dead |
| Sourcetrail | ✓✓ (symbol altitude only) | ✓ (function calls, one project) | ✓ | ✗ (fork) |
| Structurizr / IcePanel / LikeC4 | ✓✓ | ✓ *hand-declared* | ✗ | ✓ |
| Datadog / Honeycomb / Jaeger / Tempo | ✗ flat | ✓ observed traffic | ✗ runtime | ✓ |
| Backstage | ~ weak viewer | ~ declared YAML → stale | ✗ | ✓ |
| IaC tools | ✗/~ | ✗ infra plumbing | ~ wrong layer | mixed |
| Multiplayer | ~ | ✓ | ✗ OTel | pivoted |
| AppMap / vFunction | ✓ (single app) | ✓ (single app) | ✗ needs execution/agent | ✓ |
| CAST Imaging | ✓ (single app, dated) | ✓ incl. DB (intra-app) | ✓ | ✓ enterprise |
| CodeViz | ~ (IDE, single repo) | ~ call graph, not cross-service | ~ static+LLM | ✓ |
| CodeBoarding | ~ (regenerate-to-drill) | ~ LLM-abstracted | ✓ | ✓ |

**Conclusion: the three-way combination does not exist.** The specific unclaimed territory is the **architecture altitude of interaction edges**: statically inferring *cross-service* edges (HTTP client call sites → route definitions in other services, queue producers → consumers, shared table access) and rendering them inside a recursively-openable containment hierarchy on a real canvas. Supporting signals: Backstage's staleness backlash (hand edges fail), Multiplayer's pivot (runtime-for-docs fails as a wedge), CodeSee/Helios/Pluralith deaths (single-plane viz alone is fragile), Sourcetrail's mourning (the UX is loved). The durable moat is the **inference engine + evidence model**; the canvas is the surface.

**Competitive threats to watch:** CodeViz (funded, converging on "living architecture model"), CodeBoarding (OSS, could add a canvas), DeepWiki/Cognition (distribution monster — could make diagrams interactive any moment), Eraserbot (owns the "diagrams that update with code" narrative).

---

# Phase 2 — Technical Feasibility

## 2.1 Multi-language structural parsing

**tree-sitter** reliably extracts, per file, across TS/JS/Python/Go/Java: module structure, function/class definitions, imports, call expressions, string literals, decorators — via declarative queries (the `tags.scm` mechanism GitHub and Aider use). Error-tolerant, no build needed, ~ms/file.

**Hard limits (all confirmed):** syntax only — no type inference, no cross-file symbol binding (you build the import-resolution layer yourself), no knowledge of what `client.get()` actually is. Dynamic features (barrel files, monkey-patching, dynamic require) invisible.

**Ecosystem reality check:**
- GitHub **stack-graphs** (build-free cross-file binding): **archived Sept 2025** — per-language rules were a multi-year effort each. GitHub `semantic`: archived. Kythe: maintenance-only since 2024. **Do not attempt full name resolution.**
- **Aider's repo-map** is the production pattern to copy: tree-sitter def/ref tags → file graph weighted by identifier references → **personalized PageRank** to rank important symbols/files. It matches by name only — *rank, don't resolve* — and PageRank makes the noise tolerable ([design post](https://aider.chat/2023/10/22/repomap.html)).
- **SCIP indexers** (scip-typescript/python/go/java) give real cross-file resolution but require buildable projects with installed deps — an onboarding tax. Optional precision lane, never the required path.
- **CodeQL:** licensing prohibits embedding in commercial products. **Semgrep:** LGPL engine; its YAML rule format (patterns that look like source) is the right *shape* for detector packs.

**v1 parsing stack:** tree-sitter (WASM, `web-tree-sitter`) + per-language import resolution (tsconfig paths/package.json; Python module paths) + Aider-style PageRank ranking. Architecture altitude tolerates approximation; rename-refactoring precision is not needed.

## 2.2 Static interaction-edge extraction — the hard core

### The calibrating benchmark
**"Comparison of Static Analysis Architecture Recovery Tools for Microservice Applications"** (Schneider et al., EMSE 2025; [arXiv 2412.08352](https://arxiv.org/abs/2412.08352)): 9 executable static SAR tools benchmarked on ~17 ground-truthed Java/Spring microservice systems. Results: **7 of 9 tools scored near zero or failed to run at all.** The winner, **Code2DFD** ([repo](https://github.com/tuhh-softsec/code2DFD)), reached components F1 0.98 and **connections F1 0.87** — by being unashamedly heuristic: ~40 narrow technology-specific extractors (`resttemplate, feign_client, kafka, rabbitmq, docker_compose, spring_config, spring_gateway, zuul, eureka, consul, database_connections, environment_variables, implicit_connections, …`), each emitting **evidence records with file:line traceability**.

**Three structural lessons:** (1) a battery of narrow framework-specific deterministic extractors beats general-purpose program analysis, by a wide margin; (2) F1 0.87 in Java/Spring — the most annotation-rich ecosystem — is the realistic *ceiling* for deterministic extraction; expect lower in Express/Flask-style dynamic code; (3) robustness on weird-but-real repos is itself a moat (7/9 research tools died on a friendly benchmark).

### Per edge type

**(a) HTTP/REST.** Call-site detection (fetch/axios/requests/httpx/RestTemplate/Feign) and route detection (Express `app.get`, FastAPI/Flask decorators, Spring annotations, Gin) are both tractable pattern matching. The hard part is **URL resolution + cross-service matching**:
- Split every URL expression into *static substrings + dynamic holes*; match on the skeleton (the technique from the prefetching literature — even CodeQL only tracks fragments).
- **The base-URL/host is the real discriminator:** `http://orders-service:8080` (compose/K8s DNS name), `ORDERS_SERVICE_URL` env var declared in manifests, Eureka/Consul logical IDs. Follow the chain: call site literal → config key → manifest value → service name. Deterministic and high-precision when present.
- Verb + path-skeleton matching against the target's route table as confirmation; **never create an edge from a path-only match** (generic paths like `/health` match everywhere).
- OpenAPI specs, when present, are canonical route tables and confidence multipliers; SDKs generated from a spec are near-certain edges.
- Expected: **P 0.85–0.95, R 0.5–0.8** (high end Spring/Feign/generated clients; low end freeform fetch).

**(b) gRPC/protobuf — strongest signal, ship first.** `.proto` files are explicit contracts. Stub usage (rigidly conventional generated names per language) → proto service → `*ImplBase`/servicer implementor = edge with near-certain semantics. Buf lockfiles (`buf.lock`) give explicit cross-repo proto consumption. **P ≥ 0.95, R ≥ 0.9** when protos are in-repo. No dedicated OSS gRPC-service-graph tool exists — low-hanging fruit.

**(c) Message queues / pub-sub.** Join `producer.send("topic")` / `@KafkaListener(topics=…)` / SQS/SNS ARNs / `redis.publish` on the **topic string**; also config-declared topics (spring.kafka.*, Terraform topic resources). Literal-topic joins: **P ~0.9+** (topic names are distinctive); recall killed by dynamic topics (`orders.{region}.{type}`) and pattern subscriptions (`orders.*`) — handle with skeleton/pattern intersection at reduced confidence. **Model the topic/broker as a first-class node** (producer→topic→consumer), which is more truthful and avoids N×M edge explosion. AWS/Google docs both explicitly state event-driven indirection defeats static tracking — accept the recall loss, mark confidence.

**(d) Shared database access.** Signals in decreasing reliability: (1) connection config — two services pointing at the same DB host+database in env/manifests = coupling edge (this **gates** everything else, avoiding same-table-name-different-DB false positives); (2) ORM models (`__tablename__`, `schema.prisma`, `@Entity`, GORM) — trivially extractable table bindings; (3) migrations directory = table *ownership* (owner migrates; non-owner touching it = consumer); (4) raw SQL string parsing for FROM/JOIN/INSERT tables. **P ~0.9, R 0.7–0.85.** Render as service—datastore—service coupling, visually distinct from call edges.

**(e) Deployment manifests — the correct v1 spine.** docker-compose `services:`, K8s Deployments/Services, Helm values enumerate the deployable units — solving "what even is a service in this repo?" deterministically and language-agnostically — and their env blocks (`ORDERS_URL: http://orders:8080`) literally declare the wiring that resolves (a) and (c). Caveats: `depends_on` is startup ordering, **not** communication (weak hint, ~0.6, never standalone — the benchmark's MicroDepGraph proved compose-only misses most real edges); compose may be dev-only fixture; Helm needs `helm template` rendering; deploy-time-injected env values are invisible. **Verdict: manifests give the node set + candidate wiring; code gives the real edges; the env-var/hostname chain is the join key. All three legs required.**

### Recommended extraction architecture (v1)
1. **Manifest pass** → service inventory, env wiring table, datastore/broker inventory.
2. **Deterministic extractor packs** (tree-sitter queries + Semgrep-style rules; Code2DFD's 40-extractor catalog as blueprint) → *evidence records* with file:line.
3. **Deterministic joiner** → edges with **calibrated confidence**: resolved host > proto contract > literal topic > path-skeleton-only > depends_on.
4. **LLM matcher for the residue only:** unmatched call sites + candidate route tables/topic inventories → proposed edges with rationale, **always marked "inferred," never silently merged** with deterministic edges. (Academic support: ArchAgent, arXiv 2601.13007 — dependency context in the prompt measurably improves LLM architectural accuracy. Nobody has shipped this in production; the lane is open.)
5. **OpenAPI/AsyncAPI/proto/Buf artifacts as confidence multipliers** wherever present.

### Failure modes, ranked by expected pain
1. **Config indirection terminating outside the repo** (vault/CI-injected URLs, API gateways rewriting paths — Code2DFD needed dedicated zuul/spring_gateway/nginx extractors). Dominant recall ceiling.
2. **Dynamic construction** (computed URLs, loop-registered routes, runtime topic names) — statically untrackable; mitigate with skeletons + LLM; accept the loss.
3. **Generic-string false positives** (`/health`, `events`) — require a host/config join before path-only matches count.
4. **Ecosystem variance** — everything published works best on Java/Spring; per-framework extractor work is the permanent cost center (the CAST/Code2DFD lesson).
5. **Brittleness on weird repos** — robustness + evidence-traceable output is the credibility moat.

## 2.3 LLM semantic clustering (structure → labeled architecture)

**The proven architecture: "static analysis proposes, LLM disposes, validator checks."**
- **Deterministic backbone:** recursive **Leiden** community detection on the weighted import graph (imports + directory co-membership; optionally git co-change), resolution-tuned to 5–12 children per level. Leiden > Louvain (fixes disconnected communities, better modularity, scales). Fixed seed → identical clusters per commit → **stable diagrams between runs** (run-to-run instability is poison for a tool whose value is a durable mental map).
- **LLM only names and describes:** per-cluster labeling from member lists + top-PageRank file signatures + README context, JSON-schema-constrained over **provided IDs only**. This is exactly Anthropic's Clio pipeline (embed → cluster → LLM titles → recursive hierarchy naming) applied to files. **The LLM can mislabel but cannot fabricate** — hallucinated components are eliminated by construction.
- **Validate + retry with feedback** (GitDiagram's loop): every referenced ID must exist; violations fed back for regeneration.
- **Cost math (1k-file repo ≈ 2.5M tokens raw source):** Leiden-pre-cluster + label-only ≈ **$0.45–0.90/scan** (Sonnet-class, batched) vs ~$2.60–5.25 for full hierarchical file-by-file summarization; per-file summaries worth doing once, **cached by content hash**, making incremental re-scans cents. At 10k files: $3–8/scan. GitDiagram-style tree-only: cheap but stops working (~200k-token trees).
- Reliability references: RepoAgent (parse reference graph first, LLM writes prose about found nodes), CodeBoarding (validates LLM output against static graph), hierarchical-summarization papers (ICSE/ICCSA 2025) confirm the bottom-up pipeline shape.

## 2.4 Canvas / node-graph rendering

### Scorecard (1–5)

| Criterion | React Flow v12 | tldraw | Rete.js | JointJS(+) | Cytoscape.js | G6 v5 | Sigma.js |
|---|---|---|---|---|---|---|---|
| Infinite canvas / pan-zoom feel | 4 | **5** | 3 | 4 | 3 | 4 | 4 |
| Nested/compound + expand-collapse | 4 (subflows; collapse DIY) | 1 | 1 | 4 (+ paid) | **5** native | **5** combos | 1 |
| Dual edge classes / routing | 3 (custom edges + ELK) | 1 | 2 | **5** | 4 (meta-edges) | 4 | 2 |
| Semantic zoom (rich per-zoom rendering) | **5** (nodes are React components) | 3 | 2 | 3 | 3 (canvas-drawn) | 4 | 2 |
| Perf @100 / 1k / 10k nodes | 5 / 2–3 / 1 | 5/2/1 | 4/2/1 | 5/3/1 | 5/4/3(WebGL) | 5/**5**/4 | 5/5/**5** |
| Auto-layout (ELK) integration | **5** (positions fully external) | 2 | 2 | 4 | 4–5 (fcose compound-native) | 4 | 3 |
| License / pricing | **5** MIT (Pro optional $169/mo) | 1 ($6k/yr + watermark) | 5 MIT | 3 (MPL + ~$2.9k/dev) | 5 MIT | 5 MIT | 5 MIT |
| Ecosystem health mid-2026 | **5** (funded team, AI-workflow boom) | 4 | 3 | 4 | 4 | 3.5 (CN-centric) | 4 |

- **tldraw disqualified:** freeform whiteboard engine, no graph model, and production use costs $6k/yr (Business license to remove watermark; SDK licensing changed from Apache-2.0).
- **Rete.js disqualified:** dataflow/pipeline-execution editor, wrong center of gravity.
- **Cytoscape.js is the only serious alternative** (native compound nodes; the iVis-Bilkent expand-collapse extension auto-creates **meta-edges** on collapse — exactly the needed semantics; new WebGL renderer 2025 handles 1k–5k elements). But nodes are canvas-drawn, not React components — rich per-zoom node UI (service cards, file lists, badges) is a fight. Falls to React Flow because the aggregation logic must live in our data layer anyway (~200 lines), at which point Cytoscape's built-in advantage evaporates while its DX disadvantage remains.
- **Layout: elkjs is the only serious option** — ELK Layered natively supports compound graphs (`elk.hierarchyHandling: INCLUDE_CHILDREN`) and routes **cross-hierarchy edges** (interaction edges crossing container boundaries), which dagre simply cannot do (no compound support; effectively unmaintained). Known ELK caveats: INCLUDE_CHILDREN has open routing bugs, the ~1.4MB GWT bundle, and multi-second layouts at hundreds of nodes → **run in a Web Worker**, prefer per-container bottom-up layout with caching, INCLUDE_CHILDREN selectively.

### The dual-edge UX (containment vs. interaction) — solved pattern, five implementations to copy
1. **Containment is spatial nesting, not drawn edges.** Children render inside parent bounds (C4, Graphviz clusters, Cytoscape compounds, G6 combos all agree). This single decision eliminates most clutter. Drawn edges are reserved for interaction.
2. **Edge aggregation on collapse ("edge lifting"):** store only **leaf-level** interaction edges, each annotated with both endpoints' ancestor paths. Given the current expansion state, compute each edge's visible representative `rep(x) = deepest visible ancestor of x`; group leaf edges by `(rep(src), rep(dst))`; drop internal self-pairs (show as a badge/count on the collapsed container); emit one aggregated edge per pair with count + drill-through list ("Service A → Service B — 14 calls"). Pure O(E) function of `(leafEdges, expansionState)`, memoizable, renderer-independent. Prior art: IcePanel "lower connections" roll-up, Cytoscape meta-edges, G6 combo edge reconnection, Graphviz `lhead`/`ltail`, Holten's hierarchical edge bundles.
3. **Visual channels:** interaction edges colored + arrowheaded + labeled with counts, drawn over nodes; typed by kind (HTTP / gRPC / queue / DB coupling) with distinct styling; confidence rendered (solid = deterministic, dashed = LLM-inferred).

### React Flow gotchas to budget for
Subflow z-index/edge stacking issues (edges under opaque parents — use `edge.zIndex`, transparent parent bodies); children must follow parents in the nodes array; v12 renamed `parentNode`→`parentId` (LLM-generated snippets will be wrong); `onlyRenderVisibleElements` mounts everything initially and is defeated by fit-to-view — **cap what enters React Flow state** (only visible/expanded nodes) instead of relying on culling; memoize custom nodes, stable `nodeTypes` objects; measure node sizes before ELK layout; ELK layered isn't incremental — use per-container layout isolation + animated transitions to preserve the mental map.

## 2.5 Scalability & readability limits
- Cognitive/diagramming guidance converges: **5–15 nodes per expanded container**, hard-cap ~25 visible top-level elements, auto-aggregate overflow ("+12 more…" node). **Visible edge count matters more than node count** — keep under ~40 per view via roll-up. GitDiagram's empirical budget (14–24 nodes, ≤8 groups, 10–34 edges) and C4's "50 boxes = too granular" agree.
- **Never render the whole graph.** Sourcetrail's model — local neighborhood around the current focus — plus progressive disclosure. With roll-up aggregation, any view stays ≤~300 mounted elements, inside React Flow's comfort zone; raw-scale ceilings become irrelevant.
- **Semantic zoom:** 3–4 discrete LOD bands read from canvas zoom (z<0.4: container = colored block + big label, aggregated edges only; 0.4–0.9: children as chips, top-k labels by PageRank; >0.9: full detail). Discrete bands keep rendering cheap and predictable; tie band transitions to expand/collapse so "zoom in" and "drill down" converge (Google Maps mental model). Prior art: ExplorViz semantic-zoom paper (2025), CodeCity, Furnas' degree-of-interest.

---

# Phase 3 — Synthesis: worth building? What's the wedge?

## 3.1 Is there a real gap? Yes — with honest caveats
The three-way combination does not exist (Phase 1 matrix, verified across ~30 tools in both categories). But be honest about why the graveyard is full: CodeSee, Sourcetrail, Pluralith, Helios, and Multiplayer's pivot show that **visualization alone is a fragile business** and that this space punishes (a) per-language engineering burden, (b) maps disconnected from daily workflow, (c) unverifiable output. The gap survives *because* the hard part — trustworthy static cross-service edge inference — was uneconomical before cheap LLMs + tree-sitter maturity + the Code2DFD-style heuristic playbook. That's the "why now" on the technical side; the market "why now" is that AI writes leaf code, shifting the differentiating skill to system design and making a system-level navigable map the natural human interface over AI-maintained codebases (also: agents themselves need this graph — MCP exposure is a second customer).

## 3.2 The wedge — confirmed, sharpened
> **"Point it at any repo and get a trustworthy, navigable map of your system in minutes — no instrumentation, no YAML, no deploy."** Interactive recursive drill-down (system → service → module → file) with typed, **evidence-backed** interaction edges (HTTP, gRPC, queues, shared DB), every edge clickable through to the exact `file:line` that creates it, confidence-labeled, deterministic core with LLM used only for naming and fuzzy-residue matching.

Three sharpenings from the research:
1. **Trust is the product, not a feature.** The anti-GitDiagram: no unverifiable arrows. Solid = deterministic evidence; dashed = LLM-inferred; click-through always available. This is the credibility battleground versus tracing (which is trivially correct) — static must compensate with transparency.
2. **Brokers and datastores are first-class nodes**, not edge labels (producer→topic→consumer; service—db—service). More truthful, avoids edge explosion, and matches how engineers think about coupling.
3. **Static beats runtime on three axes it should own loudly:** works pre-deploy and on any repo instantly (zero instrumentation); sees cold paths tracing never sees; free to run in CI on every PR.

## 3.3 Single hardest risk + the de-risking spike
**Risk: interaction-edge quality on real-world, config-indirected polyglot code** — specifically recall (deploy-time-injected config, gateways, dynamic URLs/topics) and false positives from generic strings. If edges are wrong or sparse, the product is a prettier GitDiagram; everything else is downstream of this.

**De-risk with a UI-free spike (build this before any canvas work):**
- A CLI (`archviz scan <repo> --out graph.json`) implementing: manifest pass + HTTP/queue/DB/gRPC detectors + joiner + evidence records. No LLM, no UI.
- Run on 2 real polyglot microservice repos with documented architectures to serve as ground truth — recommended: **Google's `microservices-demo` (Online Boutique)** (Go/Python/Node/Java/C#, gRPC-heavy, has architecture diagram) and one Kafka/HTTP-style compose repo (e.g. `microrealestate` or similar TS/JS+Python compose project); optionally validate against the EMSE benchmark's ground-truth dataset (17 Java/Spring systems, published).
- Hand-build the ground-truth edge list from each repo's docs + reading the code (a day each).
- **Gate: ≥80% precision and ≥60% recall on service-level interaction edges, with every emitted edge carrying correct file:line evidence.** Pass → proceed to v1. Fail → diagnose per edge type; if HTTP matching is the failure, narrow v1 to gRPC+queues+DB (the high-precision types) and add the LLM residue-matcher earlier.
- Timebox: ~1–2 weeks. Total cost of a negative result: two weeks, not a build-out.

## 3.4 Verdict
**Worth building.** Real gap, feasibility de-riskable in two weeks, published accuracy ceilings high enough to be useful, informal demand validation, structural "why now," and a research-verified rendering/UX recipe. The honest failure modes are known and named — build the spike first, keep the LLM on a leash, and attach the map to workflows (onboarding, PR review, agent context via MCP) rather than selling a destination app.

---

# Phase 4 — Scoped v1 Technical Spec

## 4.1 Product definition (v1)
**Scan-first only.** User points the tool at a local clone of a **docker-compose-based polyglot repo (TypeScript/JavaScript + Python)**; the tool statically infers services, hierarchy, and interaction edges, and renders an interactive drill-down canvas. Read-only exploration; single user; runs locally.

**v1 user story:** "I clone an unfamiliar microservices repo, run one command, open the browser, and in <5 minutes I understand what services exist, how they talk (HTTP/queues/shared DBs), and can drill from the system view into any service down to its files — with every edge showing me the code that proves it."

## 4.2 Tech stack (with reasoning)

| Layer | Choice | Reasoning |
|---|---|---|
| Language (whole project) | **TypeScript end-to-end** (Node ≥20 for the analyzer CLI, React for the app) | One language, one toolchain; analyzer must eventually run in CI and possibly in-browser (WASM tree-sitter permits both) |
| Monorepo | **pnpm workspaces** + Vite | Boring, fast |
| Parsing | **web-tree-sitter (WASM)** + grammars for TS/JS/Python (+ JSON/YAML) | No native-build friction, same artifact works in Node and browser; error-tolerant; no build/deps needed on target repos (§2.1) |
| Cross-file layer | Custom import resolution (tsconfig paths, package.json; Python module paths) + **PageRank ranking** (Aider pattern) | Rank-don't-resolve; SCIP deferred (out of scope) |
| Edge detection | **Declarative detector packs**: tree-sitter queries + rule modules per framework (Express, Fastify, FastAPI, Flask, fetch/axios/requests/httpx, kafkajs/aiokafka/confluent-kafka, pg/Prisma/SQLAlchemy, .proto) | The Code2DFD lesson: narrow framework-specific extractors win; packs keep the permanent cost center (framework coverage) modular |
| Manifest analysis | docker-compose parser (+ .env resolution) | Service inventory + env wiring spine (§2.2e); K8s/Helm deferred |
| Graph model | **graphology** + plain-JSON schema (`archgraph.json`) | Renderer-independent; Louvain via `graphology-communities-louvain` (fixed seed) as v1 clustering — Leiden noted as an upgrade, not worth a Python sidecar in v1 |
| LLM | **Claude API (Sonnet-class), structured outputs (JSON schema), temperature 0, content-hash caching; Batch API for full scans** | Used ONLY for (a) naming/describing deterministic clusters, (b) residue edge-matching, always flagged `inferred`. ~$0.50–1 per 1k-file scan (§2.3) |
| Canvas | **React Flow v12 (`@xyflow/react`, MIT)** | Rich React nodes decide it — semantic zoom LOD is just conditional rendering on store zoom; healthiest ecosystem; MIT (§2.4). Budget for the subflow gotchas list |
| Layout | **elkjs in a Web Worker**; per-container bottom-up with caching; `INCLUDE_CHILDREN` selectively for cross-boundary edge routing | Only compound-aware option; dagre disqualified (§2.4) |
| State | **Zustand** | Expansion state, focus, filters; keeps React Flow store lean |
| Aggregation layer | Own module: leaf edges + expansion state → aggregated visible edges (deepest-visible-ancestor grouping, counts, internal-edge badges) | The core UX algorithm (§2.4); renderer-independent and unit-testable |
| Serving | CLI writes `archgraph.json`; `archviz serve` = static Vite app + local file API for evidence click-through | No backend/SaaS in v1 |

## 4.3 Data model (`archgraph.json`, the contract between analyzer and UI)

```
Node {
  id, kind: repo|service|datastore|topic|module|file,
  label, parentId?,            // containment tree
  path?,                       // repo-relative, for file/module
  meta: { language?, framework?, loc?, pageRank?, llm?: {description, confidence} }
}
Edge {                          // LEAF-LEVEL ONLY; UI aggregates
  id, srcId, dstId,
  kind: http|grpc|queue_publish|queue_consume|db_read|db_write|import,
  confidence: number,           // calibrated: resolved-host > proto > literal-topic > path-skeleton > llm-inferred
  origin: deterministic|llm,
  evidence: [{ file, line, snippet, note }],   // NEVER empty — the product's soul
  detail?: { method?, pathPattern?, topic?, table? }
}
```
Topics and datastores are nodes, not edge labels. Import edges stay intra-service (drive clustering + module-level drill-down); interaction edges cross services.

## 4.4 Repository structure

```
archviz/
  package.json / pnpm-workspace.yaml / tsconfig.base.json
  packages/
    schema/            # archgraph.json types + JSON schema + validators (shared)
    analyzer/          # the CLI: `archviz scan`
      src/
        cli.ts
        discovery/     # compose parser, .env resolution, service inventory, wiring table
        parse/         # web-tree-sitter setup, per-language queries (ts.ts, python.ts), import resolution
        detectors/     # one module per pack: http-client.ts, http-routes.ts, queues.ts, db.ts, grpc.ts
        join/          # env-var/hostname chain resolver, topic joiner, table joiner, confidence calibration
        cluster/       # PageRank, Louvain communities, hierarchy builder
        llm/           # cluster labeling + residue matcher (schema-constrained, cached, flagged)
        emit/          # graph assembly, validation, archgraph.json writer
      test/
        fixtures/      # tiny synthetic polyglot repo(s) with known ground-truth edges
        golden/        # expected archgraph.json snapshots
    web/               # the viewer: `archviz serve`
      src/
        state/         # zustand: expansion, focus, filters, zoom band
        graph/         # aggregation layer (rep(), edge roll-up), elk worker, layout cache
        canvas/        # React Flow setup; nodes/ (ServiceNode, ContainerNode, FileNode, TopicNode, DatastoreNode); edges/ (typed + confidence styles)
        panels/        # inspector: edge evidence list -> code viewer, node details, search
        lod/           # zoom-band logic
  examples/            # scan outputs for the 2 benchmark repos (checked in for demo)
  docs/                # this spec, ground-truth edge lists for the spike
```

## 4.5 Explicitly OUT of scope for v1
1. **Design-first / hand-editing mode** (no drawing, no editing the model — read-only scan output).
2. **Runtime tracing / OTel / eBPF integration** of any kind.
3. **Real-time collaboration, sharing, auth, SaaS hosting** (local single-user only).
4. **Languages beyond TS/JS + Python** (no Go/Java/Rust/C#; detector-pack architecture keeps the door open).
5. **Kubernetes/Helm/Terraform manifest support** (docker-compose only).
6. **Function-level graph inside files** (leaf = file; symbol drill-down later).
7. **SCIP/LSP precise indexing, CI drift detection, PR-diff views, Backstage/catalog export, MCP server** (all attractive, all later).
8. **Cross-repo scanning** (one repo/monorepo per scan; multi-repo systems later).

## 4.6 Build checklist (ordered for earliest possible end-to-end demo)

**Stage 0 — De-risk spike (gate: §3.3 — do not skip, do not build UI first)**
- [ ] 0.1 Pick the two benchmark repos; hand-write ground-truth service + edge lists into `docs/ground-truth/`.
- [ ] 0.2 Scaffold monorepo; `schema` package with types + validator.
- [ ] 0.3 Compose discovery: service inventory + env wiring table.
- [ ] 0.4 tree-sitter setup + HTTP detectors (routes + client calls) for Express/FastAPI/Flask + fetch/axios/requests/httpx.
- [ ] 0.5 Joiner v0: env-var/hostname chain + verb/path-skeleton confirmation; evidence records; confidence scores.
- [ ] 0.6 Queue + shared-DB + gRPC detectors and joins.
- [ ] 0.7 `archviz scan` emits `archgraph.json`; score precision/recall against ground truth; write up results. **GATE: ≥80% P / ≥60% R.**

**Stage 1 — Ugly but real end-to-end demo**
- [ ] 1.1 Hierarchy builder: compose services as top level; directories as interim containment inside each service (no clustering/LLM yet).
- [ ] 1.2 Web app skeleton: load `archgraph.json`, React Flow canvas, service nodes only, aggregated interaction edges between them (aggregation layer v0), elkjs top-level layout in a worker.
- [ ] 1.3 Expand/collapse one level (service → its directories/files) with edge re-aggregation on toggle.
- [ ] 1.4 Click an edge → inspector panel lists evidence → click evidence → file viewer at line. **← This is the demo moment; everything after is polish.**

**Stage 2 — Make the hierarchy meaningful**
- [ ] 2.1 Import-graph extraction + PageRank per service.
- [ ] 2.2 Louvain clustering (fixed seed) → module-level containment replacing raw directories where it improves grouping (5–12 children/level, overflow aggregation node).
- [ ] 2.3 LLM labeling of clusters + service descriptions (schema-constrained, ID-validated, retry loop, content-hash cache).
- [ ] 2.4 LLM residue matcher for unmatched call sites (edges flagged `inferred`, dashed).

**Stage 3 — Make it feel like a product**
- [ ] 3.1 Zoom LOD bands (3 discrete) tied to expand/collapse; animated transitions; layout caching per container.
- [ ] 3.2 Typed edge styling (HTTP/gRPC/queue/DB), confidence rendering, edge filters, search + focus-neighborhood mode.
- [ ] 3.3 React Flow hardening: z-index fixes, node measurement before layout, ≤300 mounted elements enforced, perf pass at ~300 elements while panning.
- [ ] 3.4 Incremental re-scan (content-hash caching end-to-end); polish inspector; README with GIFs; publish scans of the two example repos as the public demo.

**Definition of done for v1:** on both benchmark repos — one `archviz scan` + `archviz serve` gives a navigable system map meeting the Stage-0 accuracy gate, drill-down to file level, every edge evidence-clickable, stable across two consecutive scans of the same commit, any view ≤300 mounted elements at interactive frame rates.

---

## Appendix — key sources
- EMSE 2025 static SAR benchmark: arxiv.org/abs/2412.08352 · Code2DFD: github.com/tuhh-softsec/code2DFD
- GitDiagram: github.com/ahmedkhaleel2004/gitdiagram · DeepWiki: cognition.com/blog/deepwiki · CodeBoarding: github.com/CodeBoarding/CodeBoarding · CodeViz: codeviz.ai
- Sourcetrail archive/post-mortem: github.com/CoatiSoftware/Sourcetrail/issues/1214 · CodeSee acquisition: gitkraken.com/blog/gitkraken-launches-devex-platform-acquires-codesee
- C4/Structurizr EOL: docs.structurizr.com/eol · IcePanel: docs.icepanel.io/core-features/diagramming · LikeC4: likec4.dev
- Backstage catalog model: backstage.io/docs/features/software-catalog · Datadog USM: datadoghq.com/product/universal-service-monitoring · Multiplayer OTel docs: multiplayer.app/docs/configure-opentelemetry
- Aider repo-map: aider.chat/2023/10/22/repomap.html · stack-graphs (archived): github.com/github/stack-graphs · SCIP: sourcegraph.com/blog/announcing-scip
- React Flow v12: xyflow.com/blog/react-flow-12-release · perf: reactflow.dev/learn/advanced-use/performance · elkjs: github.com/kieler/elkjs · INCLUDE_CHILDREN: eclipse.dev/elk/reference/options/org-eclipse-elk-hierarchyHandling.html
- Cytoscape expand-collapse meta-edges: github.com/iVis-at-Bilkent/cytoscape.js-expand-collapse · tldraw licensing: tldraw.dev/community/license
- Clio (cluster-then-LLM-label): anthropic.com/research/clio · ArchAgent: arxiv.org/abs/2601.13007 · Hierarchical repo summarization: arxiv.org/abs/2501.07857 · RepoAgent: arxiv.org/abs/2402.16667
