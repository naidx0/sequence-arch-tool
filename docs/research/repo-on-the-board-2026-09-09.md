# A real repository on the board — what a reader actually sees

**Written 2026-09-09.** A peer lane asked the flagship question directly: *"does an engineer who has
never seen this repo learn its shape from the canvas, or do they get boxes with filenames in them?"*
Max's brief is *"a systems or security engineer is handed a repository, runs Sequence locally, and
sees the whole thing broken down visually."* So this is the deliverable, not a detail.

**Nothing here is a design opinion.** Every number was recomputed today from a real scan of this
monorepo, using the product's own code paths, and every command is written down so a reader can
disagree with the measurement rather than the conclusion.

## What was run

```
node packages/analyzer/dist/cli.js scan . --out real-scan.json     # exit 0
projectEdges(graph)      from packages/export/dist                 # what the board may draw
indexAnatomy(graph)      from packages/web2/src/canvas/anatomy      # what Anatomy draws
```

## 1. The scan is 96% files and 99.8% imports

| | count |
| --- | --- |
| nodes | **1101** |
| — of kind `file` | 1059 (96.2%) |
| — `module` / `service` / `repo` / `datastore` | 30 / 10 / 1 / 1 |
| edges | **2922** |
| — of kind `import` | 2916 (99.8%) |
| — `db_write` / `db_read` | 4 / 2 |

## 1b. CORRECTION, 2026-09-10 — SECTIONS 2 AND 3 BELOW ARE WRONG, AND I WROTE THEM

**The board already draws package-level import connectors, and I said it did not.** Sections 2 and 3
were written from `projectEdges` alone. They are accurate about that function and wrong about the
product, which is the exact fault this lane has spent two days naming in other people's work: a
check accurate about itself, reported as a fact about the thing.

**What is actually there.** `deriveImportEdges` (`packages/export/src/derivedEdges.ts`) rolls imports
up to the service level and the board draws them behind an **Imports** toggle. Run on this scan it
returns **12 connectors, each carrying its count**:

```
analyzer -> schema      100 imports     web2 -> schema         72 imports
web2 -> api-types        71 imports     export -> schema       31 imports
api-types -> schema       7 imports     mcp -> schema           7 imports
analyzer -> api-types     6 imports     analyzer -> export      6 imports
analyzer -> acp           5 imports     mcp -> analyzer         4 imports
web2 -> ink               4 imports     web2 -> export          3 imports
```

**So §3's "DO NOT BUILD THAT WITHOUT ASKING MAX" was advice about a feature that already ships** —
and it ships with precisely the epistemics the ruling required. `ConnectedBoard.tsx` states it in
place: *"The word stays 'imports'. It is a fact about files, and every stronger verb here would be a
fact about behaviour that nothing measured."* The three refusals §3 cites are real, and they refuse
calling an import a **service call**; they never refused drawing it as an import. I conflated the two
and nearly told another lane to leave a shipped feature unbuilt.

**Why 12 and not the 14 pairs §3 computes.** `DERIVED_DEFAULTS.minImports` is **3**, with its reason
written down: a floor of one "draws every pair sharing a single import, which is the hairball
arriving by default rather than by choice". The two pairs missing from the twelve — `acp -> schema`
and `mcp -> export` — have **2 imports each**. My 14 was the unfiltered count.

**What survives from §2.** `projectEdges` really does return one connector, and the distinction still
matters: **measured** edges (db/http/queue) number one, **derived** edges number twelve, and the
product keeps them visually and verbally apart. The sentence that was wrong is "an engineer learns
essentially nothing about how this repo hangs together" — with the toggle on, they learn that schema
is imported by five packages and that analyzer/schema at 100 is the strongest coupling in the tree.

**The bound this leaves, and nobody says it.** The toggle reads **"Imports (12)"**. It does not say
that two pairs were dropped beneath the floor. A view that cannot draw something renders it as
absence, and absence reads as a fact — the same defect I fixed for the loose-file bucket in
`685cca21`, one surface over.

## 2. The board draws ONE connector

`projectEdges` on this graph returns **1 edge**:

```
analyzer -> Database [db_access]  read user_daily_usage, read user_usage,
                                  write user_daily_usage, write user_usage
```

2916 import edges are dropped at `packages/export/src/project.ts:133` (`if (e.kind === 'import')
continue;`). Of the remainder, all six db edges leave the same file (`pgStore.ts`) for the same
datastore, so lifting to service level collapses them into one.

**So on the connector question the peer's phrase is right: an engineer learns essentially nothing
about how this repo hangs together at runtime.**

## 3. THE CAUSE IS NOT A RENDERING OVERSIGHT, AND THE OBVIOUS FIX IS ALREADY REFUSED

The tempting recommendation is "roll imports up to package level". Measured, that would yield **14
distinct package-to-package edges** from 320 cross-package imports — a readable dependency graph
(`schema` is the foundation, five packages depend on it; `analyzer` is the hub):

| edge | raw imports | | edge | raw imports |
| --- | --- | --- | --- | --- |
| analyzer → schema | 100 | | analyzer → api-types | 6 |
| web2 → schema | 72 | | analyzer → acp | 5 |
| web2 → api-types | 71 | | mcp → analyzer | 4 |
| export → schema | 31 | | web2 → ink | 4 |
| api-types → schema | 7 | | web2 → export | 3 |
| mcp → schema | 7 | | acp → schema | 2 |
| analyzer → export | 6 | | mcp → export | 2 |

**DO NOT BUILD THAT WITHOUT ASKING MAX.** `docs/research/prompt-service-edges-prediction.md`
records the standing ruling: *"what the model reads as structure must be what the product is willing
to draw"*, and **the codebase has decided three times — board, impact, risks — that an import is not
a service-level claim, with a written incident behind it.** On 2026-09-05 a change deliberately took
the prompt's rolled service edges from **162 to at most 1** to end the one consumer that disagreed.
A lane "fixing" the thin board by rolling imports up would silently reverse that, in the one product
whose whole promise is grounded-not-guessed.

The narrow question a ruling could still turn on: *is "web2 imports schema" a build-time dependency
claim rather than the runtime service claim the incident was about?* That is a product call with an
incident attached, so it is Max's, not a lane's.

## 4. Containment and size are NOT thin — Anatomy already draws real structure

Anatomy is built (`packages/web2/src/canvas/anatomy.ts`, with `anatomyLocks` and `anatomyRendered`
tests) and Max ruled it on 2026-09-02: *"anatomy is the cleanest."* Run against this scan it is
well-formed — **duplicates in the containment walk: 0**, and the recursive total equals the flat
total exactly (1059 files / 275,837 loc), so the two independent counts agree.

| service | direct children | files | loc |
| --- | --- | --- | --- |
| `analyzer` | 291 | 438 | 130,881 |
| `web2` | 208 | 441 | 107,845 |
| `schema` | 42 | 86 | 18,339 |
| `export` | 20 | 35 | 6,377 |
| `mcp` | 14 | 14 | 4,131 |
| `api-types` | 3 | 14 | 3,352 |
| `gateway` | 6 | 14 | 1,815 |
| `acp` | 7 | 7 | 1,377 |
| `desktop` | 7 | 7 | 1,157 |
| `ink` | 3 | 3 | 563 |

**Two packages are 86.5% of the repository** (analyzer + web2 = 238,726 of 275,837 loc). That is a
fact about this codebase a newcomer would not get from `ls packages/`, and cell-area-equals-loc puts
it on screen without anyone writing a sentence about it.

## 5. The answer, in one line each way

- **Runtime topology: boxes with filenames, and the peer is right.** One connector for 1101 nodes.
- **Structure and mass: not boxes with filenames.** Containment is complete (1059/1059), sizes are
  real, the walk is duplicate-free, and the 86.5% concentration is legible.
- **The gap is in the DATA, not the renderer.** This monorepo is libraries plus one database: there
  are no http/grpc/queue edges between its packages because there are none in the code. A scanner
  that invented them would break the product's one non-negotiable.

**Consequence worth Max's attention:** the board's runtime-topology story is strongest on repos that
*have* runtime coupling, and this repo is the weakest possible demo of it. Testing "sees the whole
thing broken down visually" against `sequence` itself will keep understating the product. A repo
with real service-to-service calls would measure the claim honestly — and `board-grounded.mjs`
already carries that instruction in its own header, asking for "a repository whose scan actually
produces http/grpc/queue/db edges instead."

## 6. ADDED 2026-09-09 (later) — Anatomy at real scale does NOT degrade, and 74% of its cells are anonymous

The section below originally deferred this as "a separate seat-read, not a number". Part of it turned
out to be a number, so it is measured here rather than left as an open worry.

**The prediction was wrong, and being wrong is the useful part.** `analyzer` has 291 direct children
and `ANATOMY_MAP` is 129px, so I expected sub-pixel cells. `anatomyPanel` draws **8 cells for
analyzer, not 291** — loose files are bucketed (`284 loose files` is one cell). Across all ten
service panels: **66 cells drawn to scale, smallest 124.88 px², tightest dimension 8.87px, and ZERO
cells below 1px, 2px, or 4px².** The layout does not degrade at this scale; it buckets.

**What is thin is naming. 49 of those 66 cells (74%) carry no visible label.** A cell shows its name
only where the whole name fits — `rect.h >= 12 && rect.w >= label.length * 6 + 6` — and the reasoning
is sound (the alternative is an ellipsis that claims room while saying nothing, or a name that lands
on its neighbour and reads as the neighbour's; every cell keeps its full name in a `<title>`).

**REPORTING THE MARGIN, because "unlabelled" is one word covering two different facts:**

| cell | rect | short by |
| --- | --- | --- |
| `gateway/Top level` | 58.6 × 94.0 | **width 1.35px** |
| `analyzer/harness` | 24.6 × 10.5 | **height 1.52px** (and width 23.45px) |
| `export/17 loose files` | 87.4 × 82.3 | **width 2.58px** |
| `web2/chat` | 25.9 × 39.2 | width 4.06px |
| … 44 more | | |
| `mcp/coverage-gated.test.ts` | 16.1 × 26.0 | width 121.92px |

Three cells miss by under 3px and one misses by 122px, and the product currently treats them
identically. `analyzer/284 loose files` — the single most informative cell in that panel — is silent,
missing by 34.29px because its name is 15 characters. **No change is proposed here:** loosening the
predicate re-introduces the overflow it was written to stop, and I am not weakening a rule to improve
a number. The near-misses are recorded so that if anyone ever touches `CARD_W`, `--sp-10` or
`--nest-inset`, they can see that three labels are sitting within 3px of appearing.

## 7. ADDED 2026-09-10 — THE SEAT-READ. What a person actually sees, having looked.

Everything above this section was arithmetic. `anatomy-reached.mjs` (`79c9555d`) opened the view in
a real browser for the first time; this is what was on screen, measured off the DOM and confirmed
against two screenshots.

**THE BOARD TELLS YOU NOTHING ABOUT SIZE. Eleven cards, ONE distinct area between them: 160x70,
every one.** `ink` is 563 lines and `analyzer` is 130,881 — a 233x difference drawn as two identical
rectangles. So the headline finding of §4 — **two packages hold 86.5% of this repository** — is a fact
the product possesses, has verified three independent ways, and **does not put on screen anywhere**.
Max's sentence is "an engineer is handed a repository and SEES the whole thing broken down
visually", and the verb is the part that fails.

**THE ONE VIEW THAT WOULD SHOW IT IS UNREACHABLE.** Anatomy draws a container's children as a
treemap with area = lines, which is exactly the picture 86.5%-in-two-packages needs — but at the
REPOSITORY level, and `repo` is not drawn on the board (measured: `repo node drawn on board:
false`). Anatomy opens from a card's menu, so with no card there is no gesture. The model already
supports it: `anatomy-view-measurements.md` §6 works through the repo root's own rollup, and
`anatomyIsEmpty` was written specifically so the root would not read as empty. **Built, correct,
and with no way in.**

**OPENING ONE PACKAGE DOES WORK, at full zoom.** analyzer's anatomy at 400%: the map paints 516px,
five cells carry their names — `server`, `Types`, `moat`, `llm`, `Database` — and the note reads
*"One cell gathers 288 loose files at their combined size. Its name does not fit; hover it to read."*
That is the declaration shipped in `685cca21`, working, read off a browser.

**BUT THE ZOOM THAT MAKES IT READABLE PUTS IT OFF SCREEN.** At the board's Fit zoom (49%) the map is
62.6px and `--t-10` lands at 4.85px — 5.15px under the smallest type Graphite defines. Zooming to
400% (four clicks, then the control disables itself) makes it legible and moves the map's top to
**y = -417 in a 800px viewport**: over half the panel is above the window. There is no zoom at which
the anatomy is both readable and whole.

### The first thing I would change, having looked

**Give the repository itself a card, or the Anatomy gesture a repo-level entry.** One treemap of ten
packages, area = lines, and 86.5%-in-two-packages is answered in a glance with data that is already
complete (1,059 of 1,059 contained), already cross-checked three ways, and already trusted enough to
ship inside every other node. It is the smallest change with the largest claim, and unlike a
connector it invents nothing — the number is the same number.

**Second: open the anatomy at a zoom that fits it.** A panel that is legible only at 400% and only
half visible at 400% is not yet a view; whether that is auto-zoom-to-fit-the-node or painting the
wall at constant screen size is a ruling about a control the reader owns, so it is Max's.

Neither is built here. This section is a seat-read, and the third gate is scored as the user.

## What this note does not claim

It does not claim the Anatomy view *looks* right — the cell geometry is sound and the names are
mostly absent, which is a legibility trade a reader should judge on screen. Max's "I don't like the
file box in the back of the system" report is about that seat-read, and 96% of the nodes here are
files. Screenshots, not numbers.

---

## 8. THE CONCENTRATION FIGURE, AND WHY THE ANSWERING VIEW CANNOT BE OPENED

**Written 2026-09-10.** Two separate things, and the first is an error of mine that this note
propagated.

### 8.1 83% was 86.5%

130,881 + 107,845 = 238,726, and 238,726 / 275,837 = **86.5%**. This note's headline said 83% from
the moment it was written. 83% of this repository would be 228,945 loc — the true figure is 9,781
lines above it. I computed it once, put it in a heading, and a peer lane quoted it back in five
separate messages before anyone divided again. **A number written once and quoted thereafter has
stopped being a measurement.** The arithmetic is shown here so the next reader can disagree with it
in one line rather than inherit it.

### 8.2 The answering view is computed, correct, and has no entry point

Asked directly of the model, on a real scan of this monorepo:

```
anatomyIsEmpty(repo)  ->  false
anatomyPanel('repo')  ->  10 cells, 275,837 loc, 1,059 files
   1. analyzer   130,881  47.4%   rect 71x112
   2. web2       107,845  39.1%   rect 58x112    <- 86.5% cumulative, two rectangles
   3. schema      18,339   6.6%   rect 64x17
   4. export       6,377   2.3%   rect 22x17
   5. mcp          4,131   1.5%   rect 14x17
   6. api-types    3,352   1.2%   rect 12x17
   7. gateway      1,815   0.7%   rect 10x11
   8. acp          1,377   0.5%   rect  7x11
   9. desktop      1,157   0.4%   rect 11x6
  10. ink            563   0.2%   rect  6x6
```

The rectangles are already laid out. The picture that answers *"an engineer hands it a repo and sees
the whole thing broken down visually"* is **not missing and not unbuilt — it is computed, correct,
and unreachable.** Anatomy opens from a card's own menu; the board draws services, datastores and
topics and never draws the repo node (measured on the running app: 11 cards, `repo` among them
false). The gesture cannot reach the one node whose anatomy is the answer.

**THE BLOCKER, NAMED FOR ROUTING:** an entry point to `anatomyPanel(graph, <repo node id>)`. Not a
view, not a layout, not a scanner change.

**Why this lane names it instead of building it.** The board's containment was cut deliberately —
opening REPLACES the view, one level at a time — and a crumb trail was built and **reverted** for
violating that ruling (`docs/COMPETITIVE-GAPS-2026-08-22.md` §33). A repo *card* may therefore be
the wrong shape, and the honest options are narrower than they look. That is a product call with an
incident attached.

### 8.3 The guard that hid 8.1 and 8.2 for one commit

The first attempt appended nothing. Its idempotence check asked whether the string
`CORRECTION, 2026-09-10` was already in the file — and it was, belonging to §1b, a **different**
correction written earlier the same day about the connector count. So the guard reported "already
done" about work that had never been done, and the commit message described a section the diff did
not contain. **A uniqueness check keyed on a date is not keyed on anything**, which is the same
fault as a count that does not say how deep it looked.

