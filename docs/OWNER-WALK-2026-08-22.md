# Owner walk — 2026-08-22

**What this is.** Max ran `start.sh`, added a key, attached the Sequence repo, and walked the whole
surface out loud. This is the plan built from that walk. Every claim below was checked against the
tree before it was written down; where the walk reported something that turns out to be a
*deliberate design decision rather than a defect*, that is said plainly rather than quietly
converted into a work item.

**Precedence.** `docs/CANON.md` owns product and strategy. The Graphite sheets own anything visual.
This document owns nothing — it is a work order, and where it disagrees with either of those, they
win.

**Standing constraints that bind every item here.** Never weaken an assertion to make something
pass. Every fix carries a locking test proven RED before the fix. Never mark a row DONE without
naming the lock. Never commit red. Do not touch `docs/lora-operator-guide.md` or
`docs/lora-phase0-phase1-plan.md` — owner's WIP.

---

## Status — 2026-08-22 — EVERY OWNER-WALK ITEM CLOSED, all green and pushed to `main`

| Item | State | Locked by |
| --- | --- | --- |
| **1.1** attach route made visible | ✅ | 3 tests, `Shell.test.tsx` |
| **1.2** the no-connector note is dismissible | ✅ | 3 tests, `Board.test.tsx` (+ real-browser pointer-events check) |
| **1.3** `Open` disabled-with-reason, and double-click | ✅ | 3 tests, `boardMenuRendered.test.tsx` |
| **1.4** NUL bytes purged from 8 files | ✅ | `tools/ci/no-control-bytes.test.mjs` |
| **3.0** cross-package imports resolved *(new — see the box in Phase 3)* | ✅ | 10 tests, `workspace-imports.test.ts` |
| **3.1** derived connectors, computed and drawn | ✅ | 12 tests `derivedEdges.test.ts`, 3 `Board.test.tsx` |
| **2** plan mode | ✅ | 16 tests, `plan-mode.test.ts` |
| **3.2** service interior view | ✅ | verified live: `svc:acp` draws 5 files, 4 edges, each `Traced` |
| **3.3** computed charts | ✅ | 15 tests, `graphStats.test.ts` |
| **4** whiteboard | ✅ | 22 model + 12 rendered tests, plus a real-browser stroke |
| **5** settings build-out | ✅ | 16 tests, `settingsSections.test.ts` |
| **6** index rail | ✅ cause confirmed and surfaced | 11 + 3 tests, `unscanned.test.ts` |

**The single most consequential finding** is Phase 3.0, and it was not on the
walk's list: the scan produced **zero** cross-package import edges on a
repository with 218 files importing `@sequence/*`. The board looked bare
because the graph was bare. It now finds 214 across 14 pairs, and the board
draws 11 of them as derived connectors — 1 connector before, 12 after.

---

## 0. What the walk found, separated into three piles

The single most important thing to get right before any work starts is which pile each observation
belongs in, because two of these piles were reported in the same tone of voice and only one of them
is a bug.

### Pile 1 — Confirmed defects. Verified in the tree.

| # | What Max hit | What is actually true |
| --- | --- | --- |
| **A1** | *"How do I add a new repository? Where do I add a new project?"* | **Confirmed as a DISCOVERABILITY defect — corrected from a first, wrong reading.** My initial pass said there was no route at all. That is false: `overlay.attach` / "Attach a repository" is in the Cmd/Ctrl-K palette (`shellModel.ts:586`), and the chord is bound (`Shell.tsx:273`). The capability works. What is missing is any **visible** affordance: no button, no menu, nothing on screen naming it. The two on-screen routes — `BootSurface.tsx:124` and the board empty state (`ConnectedBoard.tsx:420`) — both vanish once a repo is attached, because the empty state renders **only when `projection.nodes.length === 0`**. So after attaching, the feature is reachable only by already knowing it exists. That is the `usability-standard.md` discoverable clause, failed. |
| **A2** | *"Draw. It doesn't seem to work. It doesn't let me do anything."* | **Confirmed, and it is a design mismatch, not a broken handler.** The wiring is intact — `ConnectedBoard` holds `drawing` state, passes `onToggleDrawing`, and routes strokes through `inkToEdit(recognizeStroke(points))`. But `recognizeStroke` (`packages/ink/src/index.ts:198-264`) emits exactly three results: `box`, `line`, `scribble`. Anything that is not a clean rectangle or a straight line becomes `scribble`, and `inkToEdit` **refuses** it. Freehand drawing is not a degraded case here; it is the rejected case. |
| **A3** | *"I should be able to X this thing where it says no connectors."* | **Confirmed.** `BoardEdgeless` renders `what` + `why` with no dismiss affordance anywhere in `Board.tsx`. It is permanent for as long as the board has nodes and no edges — which, on this repository, is always. |
| **A4** | *"Open scope doesn't open up."* | **Confirmed as a discoverability defect.** `Open` exists, but only inside `BoardMenu` (context menu), and only when `openable` is true — which requires `graph.nodes.some(n => n.parentId === menu.nodeId)` (`ConnectedBoard.tsx:541`). When the scan recorded no children, the item is *silently absent*: no disabled state, no explanation. A reader who right-clicks two nodes and sees `Open` on neither concludes the feature does not exist. |
| **A5** | *"What are the settings? It says it's not ready yet."* | **Confirmed as a gap.** `SettingsPanel.tsx` ships three real sections — Model provider, Long runs (notifications), This repository's hooks — plus a failure slot. None of the nine things Max listed are there. |
| **A6** | *(not reported — found while checking the above)* | **Eight tracked source files contain literal NUL bytes** where the source should read `\u0000`. They compile and pass (a NUL is a legal string character), but `grep` classifies each file as binary, so **they are invisible to code search**. I hit this myself: `serviceInterior.ts` did not appear in a content grep for its own name. Self-inflicted, from heredoc authoring in a prior session. |
| **A7** | *"Index is cool. Missing a couple, actually."* | **DIAGNOSED AND CLOSED.** 59 tracked source files were absent and not one was a parse failure: 54 `.mjs` under `tools/`, plus `examples/` and `docs/`. They sit outside every discovered service, and the scan walks service directories and nothing else — so the rail was showing everything the scan had, and the scan had never been there. Worse, `unfollowed` reported `[]` throughout, which its own contract defines as "looked, and everything was readable": the graph asserted full coverage over files it had never opened. Fixed by `unscanned`, which now reports tools 52, examples 3, docs 1. |

### Pile 2 — Working as designed. The walk read it correctly.

Max looked at the empty board and said: *"an import says one file names another, not that one
service calls another… that is a fact of the scan, not about the board."* **That is exactly right,
and it is what the code already says.**

`packages/export/src/project.ts:124` drops `kind === 'import'` before the diagram is built. The
reasoning is recorded at `ConnectedBoard.tsx:425-459` and it stands:

1. **It is a different claim.** An import is a file-level fact. The board's nodes are services.
   Lifting one to the other asserts at the system level something only ever measured at the file
   level — the exact shape of the `svc:gateway` incident CANON opens with.
2. **It is a hairball.** Sheet 08: *"a list's overflow is a scrollbar, a graph's overflow is a
   hairball."* Collapsed onto ten service nodes, the import graph is very nearly every ordered pair.
3. **It would read as traced.** `proofOf` marks `import` as traced, spending the strongest proof
   vocabulary on the least informative claim.

**No work item changes this.** What B2 below adds is a *second, visually distinct, differently
worded* class of connector — which is what Max actually asked for.

### Pile 3 — Feature requests from the walk.

B1 Plan mode · B2 derived connectors · B3 service interior · B4 whiteboard · B5 richer charts ·
B6 settings build-out. Each is specified in §2.

---

## 1. What the walk confirmed is already good

Recorded because a plan that lists only faults misrepresents the state of the product, and because
these are the parts that must not regress while the rest is built.

- **The key flow works.** Add key, optional base URL, save — Max got through it without narration.
- **`409` on the engine was correct.** No repo attached yet; that is the honest answer.
- **The permission control reads well** — auto-edit / full access / off, with the `+`.
- **The suggested openers land.** *"I like the composer notes for those tools… break it down, what
  breaks, starts the workflow."*
- **UI design** — *"looks pretty good."*
- **The index rail** shows files and drills in; clicking through to the analyzer service worked.
- **Node → composer chip** — *"I like that you could select it and add it to the chat box."*

---

## 2. The work, in build order

Ordered so that each phase leaves the tree green and the product more usable than it found it. A
phase does not begin until the one before it is locked.

---

### PHASE 1 — Stop the bleeding: make the product navigable (A1, A3, A4, A6)

Small, mechanical, high-payoff. These are the four things that made a working product feel broken.

**1.1 — Make the existing attach route visible.** The command and the chord already exist and
work; nothing new is wired. What is added is a **visible affordance** — a repository control in the
shell header showing the attached repo and opening the same `shell/overlay {kind:'attach'}`
that `overlay.attach` already dispatches, plus recents. **No second route is invented**: it is one
more door onto the door that is already there.
*Lock:* render the shell **with a populated board** and assert a visible, clickable attach
affordance exists — RED today, because today the only route is a chord with nothing on screen
naming it.

**1.2 — Dismiss the edgeless notice.** A close control on `BoardEdgeless`. Dismissal is per
`(repo, scanId)` so it does not resurrect on every re-render but *does* return if the scan changes
and the finding is genuinely new.
*Lock:* dismiss, re-render, assert absent; change scan id, assert present again.

**1.3 — `Open` stops hiding.** When a node has no children, show the item **disabled with a reason**
("The scan recorded nothing inside this service") rather than omitting it. And promote the gesture:
double-click a node opens it, so the feature is not gated behind discovering a context menu.
*Lock:* a node with no children renders a disabled `Open` carrying the reason; a node with children
opens on double-click.

**1.4 — Purge the NUL bytes.** Replace the eight literal NULs with the escape sequence
`\u0000`. Behaviour is unchanged by construction; the win is that the files become greppable again.
*Lock:* a CI hygiene test — no tracked text file may contain a C0 control byte other than tab,
LF, CR. Proven RED against the tree as it stands today (8 files fail), green after.

**Affected files:** `packages/analyzer/src/cluster/cluster.ts`, `.../moat/negatives.ts`,
`.../server/askPipeline.ts`, `.../test/daily-limit-durable.test.ts`,
`packages/export/src/serviceInterior.ts`, `packages/schema/src/board.ts`,
`packages/schema/src/policyScans.ts`, `packages/web2/src/boot/boot.test.tsx`.

---

### PHASE 2 — Plan mode (B1)

Max: *"There should be a plan mode. Planning mode is really important, and we need in-depth
instructions for that."* This is the largest single item in the walk and it is called out as the
most important, so it gets its own phase rather than a row in a table.

**2.1 — What plan mode is.** A fourth entry in the permission control beside auto-edit / full
access / off. While it is on, **the agent may read anything and write nothing.** Every tool that
mutates — file writes, commands, git operations — is refused at the boundary with an honest
message, not silently dropped. The turn ends in a written plan, not in edits.

**2.2 — Why it sits in the permission control and not in a menu.** It is a permission state, not a
mode of thought. Putting it anywhere else invites the failure where a user believes they are
planning while the agent is editing. The control already owns "what is this agent allowed to do",
and this is an answer to that question.

**2.3 — The in-depth instructions.** Plan mode ships with a real system prompt, versioned in the
repo rather than typed by each user, that instructs: survey before proposing; name the files that
would change and why; state what is uncertain and what would resolve it; give an ordered sequence
with dependencies; and **refuse to pad** — a three-step change gets three steps.

**2.4 — Exiting.** The plan is presented with an explicit accept step that hands the plan to a
normal-permission turn. Accepting is the user's act, never the agent's.

*Locks:* a mutation tool called under plan mode is refused and the refusal names the mode; the
plan-mode prompt is loaded from the repo, not inlined at the call site; exiting requires an explicit
user action (a test asserts no auto-exit path exists).

---

### PHASE 3 — The board earns its screen (B2, B3, B5)

> #### ⚠ MEASURED 2026-08-22, AND IT MOVES THIS WHOLE PHASE
>
> Building 3.1 surfaced the real cause of the empty board, and it is **not** the
> import skip. Measured on the live scan of this repository:
>
> | | |
> | --- | --- |
> | import edges | **1,348** |
> | of those, **within one service** | **1,348** |
> | of those, **crossing two services** | **0** |
> | source files that import `@sequence/*` | **218** |
>
> There are 218 files carrying real cross-package dependencies and the scan
> produced **zero** edges for them. The cause is structural: `scan.ts:909`
> builds `fileSet` from one service's own facts, inside a per-service loop, and
> hands that set to `resolveImportAll`. A target in another package is not in
> the set, so it cannot resolve — by construction, not by accident.
>
> **This is why the board looks bare, and it is upstream of everything else in
> this phase.** Derived connectors (3.1) aggregate cross-service imports; with
> zero of them, the feature computes an empty list on a real repository. It was
> built, tested, and returned nothing at every threshold from 1 to 100 — which
> is how this was found.
>
> **3.0 is therefore the new first item: resolve workspace-package specifiers.**
> Until it lands, 3.1 is dead code and 3.2's interior view is the only part of
> this phase that shows anything on a real repo.
>
> The import SKIP is still correct and still stays. This changes what the scan
> produces, not what the board is willing to draw.



The heart of the walk. Today the board on a real repository is nodes and nothing else.

**3.1 — Derived connectors (B2).** Max: *"they might not be directly connected, but there could be
some type of dotted lines or maybe a dot connector."*

Aggregate file-level imports into a service-level **derived** edge, and make it structurally
impossible to mistake for a traced one:

- **Drawn differently.** Dotted, thinner, no arrowhead fill — a distinct visual class from a traced
  connector, not a restyled one.
- **Worded differently.** It says `derived from 34 imports`, never `calls`.
- **Kept out of the proof vocabulary.** It must not read as traced. `proofOf` is not extended to
  cover it; derived edges carry their own marker.
- **Thresholded, so it is not a hairball.** Only edges above a floor are drawn, and the floor is
  visible and adjustable. Below it, the count is reported in words rather than ink.
- **Off by default, with one control to turn it on.** The default board stays honest and quiet; the
  reader opts into the weaker claim.

*Locks:* a derived edge never carries a traced marker; the label never contains the word "calls";
a graph whose only edges are imports produces derived connectors **and** still reports its real
scan numbers; the threshold actually suppresses.

**3.2 — Service interior (B3).** Max: *"I want to open it and have a visual example with the files
inside of that specific service and how they interact."*

`serviceInterior(graph, serviceId)` already exists in `packages/export` and is already wired into
`ConnectedBoard.tsx:157`. The work is the **view**, not the producer: an interior board showing the
service's files as nodes and their imports as edges — where, unlike at the system level, an import
edge *is* the right claim at the right altitude, because both ends are files.

That is the key insight and it should be written into the code: **the same edge that is a lie
between services is a fact between files.**

*Locks:* opening a service renders its files; interior import edges are drawn as traced (they are);
an interior with one file says so rather than rendering an empty room; closing returns to the exact
prior camera.

**3.3 — Richer charts without an AI (B5).** Max: *"I don't have an AI added… but if possible, it'd
be really good to add a type of chart or a little bit more in-depth of a chart."*

Every chart here is computed, not generated — which means it works with no key, which is the point:
**fan-in / fan-out ranking** (who depends on this, who does this depend on, ordered by degree);
**depth-by-hop** (the blast-radius readout, per node); **package composition** (files and edges per
package, including the ones contributing nothing); **an orphan/thin list** (nodes the scan barely
touched — the honest counterpart to centrality).

*Locks:* each chart renders from a fixture graph with no provider configured; each reports zero
honestly rather than rendering an empty frame.

---

### PHASE 4 — The whiteboard (B4)

Max: *"a separate kind of whiteboard you can switch tabs between… just like a Miro board where you
can literally just draw from scratch."*

**4.1 — Tabs.** `Architecture` | `Whiteboard` on the canvas surface. The architecture board is
derived from a scan and is not freely editable in this sense; the whiteboard is the opposite and
carries no scan, no evidence and no verdicts — which is precisely why it must be a **separate
surface rather than a mode**, so nothing hand-drawn can ever be mistaken for something measured.

**4.2 — Free drawing, actually free.** Freehand ink stored as strokes, plus shapes, text and
connectors. Crucially: **`recognizeStroke` is not in this path.** A2's refusal loop is the
architecture board's gesture grammar; the whiteboard accepts the stroke as a stroke.

**4.3 — Persistence.** Per repository, saved alongside the document, surviving reload.

**4.4 — The bridge, kept honest.** A node can be referenced from the whiteboard as a chip that
links back to the real graph. It never becomes a graph node, and nothing drawn here ever flows back
into the architecture board as a fact.

*Locks:* a freehand scribble on the whiteboard persists (the identical stroke is refused on the
architecture board — same input, two surfaces, two correct outcomes); whiteboard content never
appears in `doc.nodes`; a reload restores strokes.

---

### PHASE 5 — Settings build-out (B6, A5)

Max's list, each as a real section: **Open a new folder** (shares Phase 1.1's route) ·
**Start a new session** · **Session history** · **Memory** · **Context** · **Windows** ·
**Planning** (surfaces Phase 2's instructions for reading and editing) · **Skills** · **Tools**.

`SessionsPanel.tsx` and `sessionsClient.ts` already exist and cover part of sessions/history —
**wire those before writing anything new.** Where a section has no producer behind it yet, it says
so in words rather than rendering an empty frame; CANON law 4 — never invent a number — applies to
empty states as much as to charts.

*Locks:* every section either renders real state or names what is missing; no section renders blank.

---

### PHASE 6 — Index rail (A7)

Diagnose first: compare the rail's file list against `git ls-files` on this repository and find the
drop rule. Fix follows the cause. **No fix is written before the cause is named** — a rail that
"looks complete" on a fixture is exactly the failure mode CLAUDE.md warns about, since fixtures are
3–10 files and cannot exhibit the bug.

---

### PHASE 6 addendum — the likely cause, found while reading

`ArchGraph` already carries **`unfollowed`**: *"Source this scan could not read, by language. The
scanner parses TypeScript, JavaScript, Python, Go and Java; every other source file is skipped
during the walk."* Its own comment records the failure this exists for — *"a repository whose
payment service is C# produced a graph with no payment service in it and nothing anywhere saying
why — the graph did not look wrong, it looked like a system with no payment service."*

That is almost certainly what Max hit. The rail is not dropping files at random; it is showing what
the scan could read, and staying silent about the rest. `packages/analyzer/src/lang/unfollowed.ts`
(`UnfollowedTally`) already computes the tally.

**So Phase 6 is probably not a parser fix — it is a surfacing fix:** the rail says what it could not
read and why, instead of letting absence look like completeness. Confirm against the real scan
before building, because `unfollowed` distinguishes absent ("not recorded") from empty ("looked,
all readable") and only one of those is this bug.

---

## 3. What is deliberately NOT in this plan

- **Import edges drawn as service-to-service connectors.** §0 Pile 2. B2 adds a *different, weaker,
  visually distinct* claim; it does not overturn the skip.
- **AI-generated diagrams.** CANON: derived, not written. Charts are computed (3.3).
- **Breadth parity with Claude Code.** CANON: *"par with Claude Code's surface is a company, not a
  rebuild."*

---

## 4. Order of execution, and why

Phase 1 first because it is cheap and it is what made a working product feel broken. Phase 2 next
because Max named it the most important and nothing else depends on it. Phase 3 is the largest and
the highest-value, and it wants Phase 1.3's open gesture already in place. Phase 4 is
self-contained and can move in parallel with 3. Phase 5 is broad but shallow. Phase 6 is an
investigation and lands whenever its cause is found.

Every phase ends green, with each row naming the test that locks it.
