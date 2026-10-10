# Anatomy view — the measurements it will draw

**Owner ruling, 2026-09-02 (relayed):** *"anatomy is the cleanest."* Clicking a node does not
open a side panel of text — it **opens the node**. Children are drawn as a packed grid of cells,
cell **area = lines of code**, and edges leaving the container are drawn **from the cell of the
file they actually leave from** rather than from the border of a box.

This document exists because the direction arrived with a table of figures attached, and the
sender flagged that an earlier version of that table had said *"one file is 19% of the package"*
as rhetoric rather than measurement. **Every number below was recomputed from
`.sequence/graph.json`** (scanned 2026-09-02T17:36Z, 1011 nodes / 2408 edges) before anything was
built on it. Understating or overstating either way is the thing this product exists to prevent,
so the correction is recorded here rather than quietly applied.

## 1. The data Anatomy needs already exists — this is a rendering change

| what Anatomy needs | field | coverage |
| --- | --- | --- |
| containment | `parentId` | 969 / 969 file nodes, **all 969 resolve to a real node** |
| cell area | `meta.loc` | 969 / 969, none zero |
| edge origin | `evidence[0].file` | 2408 / 2408 |

No scanner change. No `git log` per file. Confirmed by re-running the rollup, not by reading the
scanner.

## 2. CORRECTION — a service's direct file children are its TEST overflow, not its contents

The relayed table's first two rows describe something other than what they name, and a naive
treemap would inherit the error. Containment is **service → {modules, direct files}**, and under a
service the direct-file bucket is almost entirely tests:

| service | direct file children | of which tests | biggest direct child | biggest *production* direct child |
| --- | --- | --- | --- | --- |
| `analyzer` | 237 | **237 — all of them** | `ask-tool-loop.test.ts` 3,590 | **none exists** |
| `web2` | 181 | **181 — all of them** | `SessionsPanel.test.tsx` 1,407 | **none exists** |

*(Sharpened 2026-09-02 after a peer re-check.* This table first said 234/237 and named
`mock-provider.ts` (88 loc) as the biggest production file. Both wrong: a `\.(test|spec)\.` suffix
match misses test **harness** files that live in `src/test/` without a `.test.` in the name —
`mock-provider.ts`, `isolate-user-store.ts`, `ask-honesty-corpus.ts`. Matching `.test.` **or
`/test/`** catches all 237. There is **no** production file parented directly to either service;
the bucket is purely test material, which makes the correction stronger, not weaker.)

So `analyzer` is not "237 files, 52,233 loc, biggest file 6.9%". **52,233 is its test overflow.**
Its true total is **110,701 loc** — the direct files plus six module children (`server` 25,986,
`detectors` 10,986, `explain` 9,905, `llm` 5,009, `Score` 3,838, `harness` 2,744). `web2`'s true
total is **100,743**, not 43,337, across twelve modules. The biggest production file in the whole
analyzer package, `repoServer.ts` at 7,998, is **one level down** and never appears in that row.

**Spec consequence:** a node's children are its modules AND its direct files, mixed in one
treemap, and a cell may itself be a container. That makes the drill-down genuinely recursive —
which is what "anatomy" means — rather than one flat level. It also means the tests must be
visible as what they are, not silently blended into the package's shape.

The module rows in the relayed table are **correct as given**, because a module has only file
children:

| module | files | loc | biggest file | share | half the code in |
| --- | --- | --- | --- | --- | --- |
| `server` | 48 | 25,986 | `repoServer.ts` 7,998 | 30.8% | **3 of 48** |
| `canvas` | 49 | 11,381 | `ConnectedBoard.tsx` 1,598 | 14.0% | 9 of 49 |
| `chat` | 43 | 11,242 | `store.ts` 1,888 | 16.8% | 5 of 43 |
| `explain` | 17 | 9,905 | `explain.ts` 3,048 | 30.8% | **2 of 17** |
| `llm` | 13 | 5,009 | `provider.ts` 2,664 | **53.2%** | **1 of 13** |

## 3. The demo is `server`, and `llm` is stronger

`server` is the ruling's named demo and it holds: one cell covers **30.8%** of the module and half
the code sits in **three of forty-eight** files. Both figures verified.

`llm` is the better one and was not in the relayed table: **`provider.ts` alone is 53.2% of the
module, and half the code is in one file of thirteen.** A single cell covering more than half its
container is the clearest possible statement of the thing boxes-and-arrows cannot say.

## 4. Leader lines resolve at 100% — which is a trap, not a green light

For every one of the top six containers, **every** outgoing edge resolves from
`evidence[0].file` to one of that container's own cells:

```
server     outgoing 137  -> cell 137 (100%)   -> border 0
canvas     outgoing 135  -> cell 135 (100%)   -> border 0
chat       outgoing 129  -> cell 129 (100%)   -> border 0
detectors  outgoing  98  -> cell  98 (100%)   -> border 0
```

> **CORRECTED 2026-09-02, and it is this document's own error — the FOURTH instance of the same
> mistake.** This table originally carried `analyzer outgoing 547` and `web2 outgoing 544`. Neither
> reproduces under any definition, as the Anatomy builder reported rather than worked around. My
> script counted edges whose source is a **direct file child** of the service — which §2 establishes
> is the *test overflow*. So "547" is the number of edges leaving analyzer's test bucket. The real
> figures for `svc:analyzer` are **944** edges from anywhere in the subtree and **103** that leave
> the subtree (722 cross a cell boundary). The **module** rows above reproduce exactly, because a
> module has only file children — which is precisely why the error hid.
>
> Same root cause as §2, §6 and the peer's repo-root claim: **asking about direct children.** It
> survived four rounds of cross-checking because each round re-read the conclusion instead of
> re-deriving it. The load-bearing claim is unaffected — 100% resolve to a cell, 0 to the border,
> under all three definitions — which is why it was worth stating that claim separately from the
> counts.

The ruling requires a border fallback where evidence names a file not in the opened node. That
fallback is still **required for correctness** — and on this repo it will **never fire**. A branch
that no real input reaches is a branch that rots green. It must therefore be locked by a test that
feeds synthetic evidence naming a foreign file, not by opening `server` and observing that
nothing broke. Do not report the fallback as "working" on the strength of a 100% run.

Edge-origin concentration, for how many leader lines actually stack on one cell:

```
64 repoServer.ts    34 App.tsx    33 scan.ts    28 ConnectedBoard.tsx
21 connect.tsx      20 cli.ts     20 askPipeline.ts   17 Transcript.tsx
```

Sixty-four lines leaving a single cell is a legibility problem to design for up front, not a
detail. Bundle or fan them; do not draw 64 separate strokes into one 8px cell.

## 5. Shade — `meta.pageRank` is present; churn is correctly declined

The ruling says do not use churn: there is no churn in the graph and adding a `git log` per file
is a scanner change, not this change. Agreed, and recorded in the code.

But `meta.pageRank` **is** already on **969 / 969** file nodes, none zero. Area = size, shade =
centrality reads as: a big pale cell is bulk; a big dark cell is load-bearing. That pairing says
something neither channel says alone.

**Caveat that decides the scale:** the distribution is extremely skewed — min 0.0011, **p50
0.0015**, p95 0.0575, max 0.5745, and only **134 distinct values across 969 files**. A linear ramp
paints ~95% of cells the identical floor shade and reads as a bug. Shade must be **rank- or
quantile-based**, and cells tied at the floor must be visibly one band rather than pretending to
differ. If that cannot be made honest, leave cells neutral and let area carry it — which the
ruling already permits.

## 6. The empty state fires for exactly ONE node — and my first count was wrong

**Correcting this document's own first draft**, which made the same class of error it was written
to catch. It reported `3 / 42` containers as having no file children — `sequence` (repo),
`api-types` (service), `Database` (datastore) — and flagged `api-types` as a probable scanner
containment gap. That was a measurement of **direct** file children reported as though it were a
measurement of file children. `api-types` is fine: all **14** of its files (3,216 loc) are present,
parented one level down to three module children. The repo node likewise holds all 969.

Counted **recursively**, the real number is **`1 / 42`**: only **`ds:analyzer-db` (Database)**, a
datastore, which legitimately contains no files. So the empty state is rare but real, and it is a
datastore — the copy should say what a datastore is, not apologise for a missing scan.

**THE EMPTY-STATE PREDICATE IS "NO CHILDREN AT ALL", NOT "NO FILE CHILDREN".** A peer re-check
proposed the empty state fires for two nodes, `sequence` (the repo root) and `Database`. It does
not, and getting this wrong ships the worst possible false empty: **opening the repo root is the
top-level view of the entire product.** The repo node has **0** direct *file* children but **10**
direct *service* children and **969** file descendants. It draws ten cells.

| node | direct children | direct *file* children | file descendants | draws? |
| --- | --- | --- | --- | --- |
| `repo` (sequence) | **10** services | 0 | **969** | ten cells — never empty |
| `ds:analyzer-db` (Database) | **0** | 0 | 0 | the one true empty |

Both of the wrong answers this document has now produced came from asking about *file* children.
Ask instead whether the node has **any** children. One node in forty-two does not.

### 6a. "No children" and "no file descendants" are different rules, and this repo cannot tell them apart

Three candidate predicates, all run:

```
A  no children at all        -> 1   Database
B  no DIRECT file children   -> 3   sequence, api-types, Database     <- the trap, three times over
C  no file DESCENDANTS       -> 1   Database
```

**A is the rule.** A container may hold a child that is itself empty; the view draws that child as
a cell, and the honest empty belongs one level down when you drill into it. C would swallow the
parent whole.

But **A and C agree on all 42 nodes here — zero disagreements** — because the only childless node
is also the only one with no file descendants. They diverge the moment a container holds an empty
container (a module with no files under a service). No container in this repo holds only empty
containers today, so **that divergence cannot be exercised against `sequence` at all.**

**Therefore this lock must be synthetic**, exactly like §4's border fallback: a fixture with a
service holding one childless module, asserting the service draws **one cell** and only the
*module* reports empty. Without it, the first person to refactor into an empty package gets a
blank board and the suite stays green.

### 6c. Two of the five locks are unfalsifiable against the real repo — say so in the test file

| # | lock | provable on `sequence`? | what it kills |
| --- | --- | --- | --- |
| 1 | recursive rollup = 969 files / 247,227 loc, 0 duplicates | **yes** — three independent paths | miscounts, double-visits |
| 2 | cells keyed by node `id`, never `path` | **yes** — 6 modules share one path | sibling key collision |
| 3 | repo root draws 10 cells and reports **nothing** | **yes** — predicate B says "empty" here | predicate **B** |
| 4 | leader-line border fallback | **no — fixture only** (100% resolve here) | a rotting dead branch |
| 5 | empty *container* draws a cell; its child reports empty | **no — fixture only** (A ≡ C here) | predicate **C** |

*(Corrected: an earlier draft of this table called lock 3 fixture-only too. It is not — predicate
B reports the repo root empty on the real graph, so a real-repo assertion kills it outright. Only
the A-vs-C distinction needs a fixture. Two of five, not three.)*

A green run on the real repo proves locks 1–3 and **says nothing** about 4 or 5. That belongs as a
comment in the test file, not just here — it is precisely the shape of "green but wrong" this repo
has shipped before.

Cross-check that the recursive rollup is right — **three independent paths, agreeing on both
axes**:

```
PATH A  flat sum of every file node's meta.loc      969 files   <total> loc
PATH B  repo meta.languages  ts + js                969 files   <total> loc
PATH C  recursive rollup from the repo node         969 files   <total> loc
```

**Pin the file count as well as the loc**, plus `duplicates === 0` on the walk. A rollup that
visits one file twice and misses another can land on the right line total; loc alone would call
that green. Measured: zero duplicates.

**DO NOT PIN THE TOTAL ITSELF — PIN THE AGREEMENT.** This section first wrote `247,227`. A rescan
at 2026-09-02T20:49:46Z moved it to **248,456** (ts 241,867 + js 6,589) with the file count
unchanged at 969, and several other figures with it: `server` 25,986→26,246, `explain`
9,905→10,066, analyzer's test bucket 52,233→52,799. A test asserting the literal total would have
gone red on a scan, which is CANON's "never pin a number that moves". The invariant that does not
move is the **three-way agreement on both axes**, plus zero duplicates, plus a non-vacuity floor so
a rollup returning nothing cannot agree with itself. `llm`'s 53.2% holds exactly across the rescan.

## 6b. Modules are semantic clusters, not directories — and two are called "Top level"

Every module shares its parent's `src` path; `path` does not discriminate them. The scanner is
clustering by meaning and naming the cluster:

```
svc:analyzer  packages/analyzer/src -> 6 modules: server, Score, detectors, explain, harness, llm
svc:web2      packages/web2/src     -> 5 modules: activity, boot, canvas, chat, review
svc:api-types packages/api-types/src -> 3 modules: Top level, Attach, Sign-in & accounts
svc:schema    packages/schema/src   -> 3 modules: Top level, programs, Policy
svc:export    packages/export/src   -> 3 modules: Project, DiagramModel, Mermaid
```

These are **Louvain community clusters**, independently confirmed by a peer to partition their
files with **zero files claimed twice** — the clustering is correct and the shared `path` is an
artifact of the directory they were derived from. **Consequence: `path` is not a usable identity
for a module.** Six nodes legitimately share `packages/analyzer/src`. Key cells by node **`id`**;
where a breadcrumb or URL must name a level, use the label *with* the id, never the path.

**"Top level" is used three times**, not two:

| service | module | files | loc |
| --- | --- | --- | --- |
| `schema` | `mod:schema/0` | 19 | 5,760 |
| `api-types` | `mod:api-types/0` | 8 | 1,771 |
| `gateway` | `mod:gateway/1` | 5 | 601 |

That is the settled owner dislike — *a generic one-word bucket covering unrelated things*, and *a
row that repeats its own name*. It is also the **only** repeated module label: 30 module nodes
carry 28 distinct labels, and the other 27 are specific (`server`, `canvas`, `chat`, `rail`,
`sessions`, `shell`, `whiteboard`, `charts`, `boot`, `review`, `explain`, `harness`, `llm`,
`detectors`, `moat`, `programs`, `Policy`, `Mermaid`, `DiagramModel`, `Attach`, `Score`,
`Project`, `activity`, `app`, `e2e`, `dist-test`, `Sign-in & accounts`). So the clustering is
working; "Top level" is the residual bucket it falls back to when a cluster has no theme.

Note which package one of them sits in: **`gateway`** is already under an open keep-or-cut
decision, and is one of the two packages the app itself reported as contributing nothing to an
answer. Anatomy would draw it as a small blandly-named cell inside an already-cold container —
a fair picture of its actual status, arrived at without anyone deciding to make that point.

**Do not invent a nicer label to hide any of the three.** Draw them honestly; the view earning its
keep by exposing a real naming defect is the point, not a bug in the view.

## 7. Things to carry into the build

- Deterministic squarified treemap (MADR amendment A4) — same graph in, same rectangles out.
- Open in place (A3). Escape / breadcrumb closes. **No fourth column** (CANON §1).
- Cells are mixed containers and files; a container cell is openable, a file cell is not.
- `prefers-reduced-motion` on the open/close transition.
- Graphite: tokens only, no hex in the sheet **including comments** — the firewall scans comment text.
- Say in the code **why churn was declined**, so the next agent does not add a `git log`.
- `Top level` appears as a module name under **two different services** (§6b). Generic bucket,
  settled dislike, and Anatomy is what makes it visible. Draw it honestly.
- **Roll up recursively, never by direct children only.** §6 is the worked example of getting this
  wrong: direct-child counts made a fully-scanned package look empty. A container's size is its
  descendants' size, and §6's cross-check (969 files / 247,227 loc, matching the repo node's own
  language totals exactly) is the assertion a test should pin.

## 8. SCOPE CONFLICT FOUND BEFORE BUILDING — and how it resolves

The Anatomy direction says *"clicking a node does not open a side panel of text, it opens the
node"*, citing MADR amendment A3. But A3's own text draws a boundary the direction crosses:

> **A3 — NEW: a node opens into detail, in place.** … **Tension to record:** the architecture board
> has a standing ruling that containment was cut and "opening REPLACES the view, one level at a
> time". That ruling is about the scanned architecture board. This is the chart/teaching surface …
> so it applies to charts, and **the board's one-level rule is untouched.**

Anatomy runs on the **scanned graph** (`parentId`, `meta.loc`, `evidence` — charts carry none of
these), so it lands on exactly the surface A3 excluded. The one-level rule is not a doc opinion; it
is enforced in code and locked:

- `packages/web2/src/canvas/BoardMenu.tsx` — `onOpen`: *"Open the service — REPLACES the view rather
  than nesting inside it."*
- `packages/web2/src/canvas/ConnectedBoard.tsx` — `openedService`, same comment.
- `packages/web2/src/canvas/boardMenuRendered.test.tsx` — the lock.
- `docs/COMPETITIVE-GAPS-2026-08-22.md` §33 records that a crumb trail **was implemented and then
  reverted** on discovering this ruling, because it "would have re-enabled the nesting the owner
  cut."

One of the ruling's three recorded grounds is the very thing §2 measured: *"the level below systems
is currently a liar."* On this repo it is 237-of-237 tests wearing a package's name.

**THE RESOLUTION — two different gestures, and the conflict dissolves.** `onOpen` is a **menu**
action; a plain click is **selection**. So Anatomy need not touch Open at all:

| gesture | meaning | status |
| --- | --- | --- |
| menu → **Open** | navigation. Replaces the view. One level on screen. | **untouched** |
| **Anatomy** | a detail rendering of ONE node, drawn in place | new |

Anatomy draws a treemap **inside the opened node's own footprint**. It adds no board nodes, no
board edges, no second structural level, and no crumb trail — so it re-enables none of the nesting
that was cut, and the lock in `boardMenuRendered.test.tsx` must still pass untouched. It is the
same class of object as an AI Canvas chart: a picture of what one node contains.

It also answers the "liar" ground rather than inheriting it. The old nesting would have drawn
`analyzer`'s direct children as a level and labelled 237 test files as the package. The recursive
rollup of §6 draws modules and files mixed, so the test bucket appears **as a bucket**, at its true
size, beside the six real modules.

**If the owner wants Anatomy bound to Open instead, that is his call to make** — it reverses a
standing ruling and should be reversed explicitly, not absorbed by a build. Recorded here so the
question is visible rather than decided by whoever wrote the layout first.
