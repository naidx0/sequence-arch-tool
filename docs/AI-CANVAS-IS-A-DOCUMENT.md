# The AI Canvas is a freeform plane (SeqDraw)

**Design of record — overturned 2026-09-16.**

Owner walk 2026-09-16: Obsidian was the reference for *rich content kinds* (math, boards, languages
inside one product). The **product shape** for AI Canvas is a **spatial infinite plane**
(TLDraw-class pan/zoom/move) — not a scrolling column of cards, and not a markdown document page.

Charts and blocks land as **movable artifact frames** on the native SeqDraw / Whiteboard model
(`sequence.seqdraw.*`). Architecture stays the grounded graph board; the Whiteboard tab stays the
sibling freehand pad. **No tldraw package.**

The earlier 2026-09-09 "document, not a shelf" ruling below is historical context for why card chrome
was wrong; the live product is the freeform plane.

## Freeform chrome (owner walk 2026-09-16, wave follow-up)

- Artifact frames on the AI Canvas plane are **transparent** (no filled card); selection halo only.
- MD / JSON / charts **size to content** and sit on the dot grid; board pan/zoom owns navigation.
- **Internal capability bar:** a prompt like “explain LLMs… with visuals” should land as a **2D**
  flow/hierarchy/node-link diagram on this plane without card clip.
- **UNFINISHED — true 3D:** there is no WebGL/Three path in `SeqChartView`. Exotic 3D teaching
  would need a dedicated `react`/`html` block wave; do not claim 3D as shipped.

---

# Historical: document ruling (2026-09-09)

**Superseded.** Kept so agents do not rediscover the wrong fork.

**Design of record. 2026-09-09.** Owner complaint, verbatim:

> "The AI canvas right now seems to open up little section cards within the canvas. I want that
> whole canvas to be like a whiteboard, as if you're in Obsidian. In the same way, in Obsidian, you
> open a Markdown file, and it's the main view where you can view so many things — really cool
> boards, math equations, and a lot of different language in that sense. Same thing for us in
> Sequence: it's local. We can kind of mimic Obsidian in that way as well."

And why it carries weight: *"Sequence was originally for visual and system design."*

---

## 1. What is actually there, measured before designing

Read on 2026-09-09 at `69588b9c`, because a design written against a remembered surface designs the
wrong thing.

| Claim | Verified |
| --- | --- |
| Block types exist | **Yes.** `markdown · mermaid · html · react · svg`, written by `canvas.write_*` tools (`aiCanvasBlockMeta.ts`) |
| Charts render too | **Yes.** `propose_chart` → `canvasDoc.charts`, drawn through the real renderer |
| Markdown renders headings | **Yes.** `#` → `<h2>`, `##` → `<h3>` (`AiCanvasBlockBody.tsx`) |
| Maths | **Absent.** 23 dependencies, no KaTeX, no MathJax, no markdown library — `renderMarkdown` is hand-rolled |
| Code languages | **Fence only.** `<pre data-lang>`; nothing highlights |
| Pan / zoom | **Absent**, despite the file header claiming "Human pan/zoom" |
| Spatial placement | **Not representable.** `CanvasDocBlock` is `{id, type, title, payload, status}` — no x, no y |

So the peer brief's framing — "what does not exist is the whiteboard the nodes should live on" — is
**half right**. The *blocks* exist. What does not exist is a surface that reads as one thing.

**The complaint is exact, and it is about chrome.** `.ai-canvas-block` is
`border + border-radius + background: var(--surface-1) + overflow: hidden`, with a header bar
carrying a bottom border and a `"Markdown · Plan"` kind label. That is a card, by construction, and
the canvas is `overflow: auto` — a scrolling column of them. A test even names the design:
*"renders ledger-style block headers"*.

---

## 2. The ruling: a document, not a spatial plane

"Whiteboard" has two readings and they build different products.

- **Obsidian Canvas** — a spatial plane, free x/y placement, pan and zoom.
- **Obsidian's markdown view** — one continuous document where headings, diagrams, maths and code
  all render inline as a single page.

Max's own clarifier settles it: *"in Obsidian, you open a Markdown file, and it's the main view
where you can view so many things."* He is describing the **document**. The nouns that follow —
boards, equations, languages — are things that appear *inside* a page, not tiles arranged on a
plane.

**So: one document surface, and blocks are passages in it.**

Recorded because a later reader will ask: this is a ruling made in Max's absence under the standing
delegation, and **what would overturn it** is him asking to drag a block somewhere. That is a real
feature, it is not this one, and it costs more than it looks: `CanvasDocBlock` has no position, so
every writer, the export, the story route and the persistence would have to grow one. Adding x/y
"just in case" would be inventing a requirement.

It also keeps CANON's line intact — *"The workspace is ONE live canvas… if you find yourself
building a fourth column, stop."* A document is one surface. A plane inside a pane is a second
canvas competing with the Architecture board, which already **is** the spatial surface, with real
kinds and real edges.

---

## 3. The rule this design turns on

> **Content that names itself is not labelled again.**

This is not new here, and that is the strongest argument for it: **the chart block already obeys
it**, in this very file, with the reason written in place —

> *"NO BLOCK HEADER, and that is deliberate. `ChartFrame` already draws the chart's own
> `<figcaption>` with its title and caption, so an [added header would duplicate it]."*

A markdown block opening with `# Plan` renders an `<h2>Plan</h2>` and is then wrapped in a bar
reading `Markdown · Plan`. The title is drawn twice, and the second one is chrome. Extending the
chart's rule to every block is not a new opinion — it is applying one already accepted here.

**The corollary, and it is the load-bearing half:** a block that does *not* name itself still needs
identity. An `html`, `react` or `svg` payload can render anything at all; without a label the reader
cannot tell what they are looking at or that it came from a tool. Those keep their header. Dropping
it everywhere would trade "too much chrome" for "unreadable", which is the failure this repo
already has a name for — a fix that guts the feature.

---

## 4. What ships first

**The card chrome goes, and the redundant label with it.** Blocks become passages: no border, no
panel background, no boxed header — separated by rhythm, the way a document separates sections.

Chosen over shipping maths first, deliberately. **Maths inside a little section card is still a
little section card**; the complaint is the surface, and the surface is what the first slice has to
answer. Maths is next, and it is named in §5 with its one real decision.

What must survive it, or the slice is a regression:

- **"Ask about this" stays reachable** — point-to-ask is how the canvas talks to the chat, and it is
  keyboard-reachable, not hover-only.
- **Pending and live states stay legible.** "Agent is drawing…" is how the reader knows a tool is
  mid-write.
- **Blocks that cannot name themselves keep their header.**

---

## 5. After that, in order

1. ~~**Maths, inline in markdown**~~ — **SHIPPED 2026-09-09.** `$…$` and `$$…$$`, KaTeX bundled;
   59 font assets land in `dist`, so nothing is fetched over the wire. The tight inline rule (a `$`
   opens only on non-whitespace and closes only on non-whitespace) exists because the first version
   swallowed `"it cost $5 to run and $PATH was set"` whole — its unit tests had only ever tried
   prose with a *single* dollar and passed vacuously. A formula KaTeX refuses renders its own
   source rather than blanking the document.
   **The one decision, ruled here rather than parked:** KaTeX may be added as a bundled dependency.
   Local-first forbids fetching over the wire, not depending on a package — the fonts ship in
   `dist` like every other asset. A hand-rolled typesetter would be a lie about capability, and
   partial maths is worse than none.
2. ~~**Code that shows its language.**~~ — **SHIPPED 2026-09-09** (`573dcbd6`). `data-lang` had
   carried it since this renderer was written and nothing drew it. Rendered in the DOM rather than
   a CSS `::before`, because generated content is not reliably in the accessibility tree and jsdom
   computes none — that lock would have asserted nothing. An unfenced block says nothing rather
   than guessing "text".
3. ~~**A reading measure** for prose~~ — **SHIPPED 2026-09-09.** `68ch` on paragraphs and headings,
   and that number is the BOOK's: `docs/brand/graphite/_core.html:954` sets `.prose { … max-width:
   68ch }`. CANON forbids inventing one — "you extend Graphite, you do not redesign it" — and the
   book had it. Prose only: diagrams, charts, html/react blocks and code listings keep the width
   they are given, because capping them would cramp the content this canvas exists to show.
4. **Spatial placement — NOT OPEN WORK. Blocked on Max, deliberately.** §2 rules against it and
   says what it costs. It is listed here so the decision stays visible, **not** as a task to pick
   up: a cold read that treats this as the next item would build the thing §2 refuses. It becomes
   open only if Max asks to drag a block on the AI Canvas specifically — and four separate peer
   messages have asserted it without ever quoting him.

---

**BACKLOG STATE, 2026-09-09: items 1–3 are shipped and item 4 is blocked on Max, so §5 has NO OPEN
ITEM.** A session reading this as its backlog should say so and stop — Max's direction of
2026-09-08 is to close every loop to a full stop and stop when nothing is open. Inventing work to
look busy is the failure that direction names. The open questions that remain are in §7 and are
product calls, not tasks.

---

## 6. What this design refuses

- **Freeform stickies.** The file's header already refuses them and it is right: the Architecture
  board is the grounded surface, and an ungrounded sticky that looks like a node is the
  grounded-not-guessed violation this product exists to catch.
- **A second pan/zoom plane.** See §2.
- **Deleting the header everywhere.** See §3.


---

## 7. What actually fills it, measured — and why the empty state has two sentences

The sequence lane measured the drawing tools rather than assuming them, across 296 teach turns on
**granite42-hermes Q4_K_M**. The model called `propose_chart` on **5 of 296 turns — 1.7%**.
Product-derived charts carried about 97%, and on the 102 turns whose prose never named the concept
it was teaching, the model drew **zero** times while 99 still put a correct chart on the board,
because `buildConceptChart` derives one from the scan.

Their own correction is the important half, and it is worth repeating in their words: they had
described the derived chart as a *fallback*. On that data **it is the primary, and the model's own
drawing is the rounding error.**

**What that means here, and it is not comfortable.** Those numbers are for `propose_chart` on TEACH
turns. The AI Canvas is fed by `canvas.write_*` on ordinary asks — a different tool on a different
turn type, so the rate does not transfer. But teach mode has a product-derived source and **this
surface has none**: its only feed is a tool the model chooses to call. If `canvas.write_*` fires
anywhere near 1.7%, then for CANON's primary reader — *system engineers first* — this pane is
almost always empty.

**I did not measure it, and will not infer it.** A `canvas.write_*` rate needs the ask lane's
harness; targeting a second model here would mean editing `.sequence/ai.json`, which is shared
config another lane reads. My own attempt was inconclusive and is recorded as such: under the GPU
lock, a drawish ask on the configured default (**minicpm5-hermes Q8_0**) reached three steps, a
provider call and one `read_topology` call, then hit the deadline — `exit=6`, cancelled. Zero
`canvas.write_*` there means *cut off*, not *declined to draw*.

**What shipped on the strength of it.** Empty-before and empty-after are different states, and the
surface said the same thing in both. "Ask in chat to populate this surface" is right before a turn —
the writers are on whenever this pane is visible. After a turn that drew nothing it is advice the
reader has already followed, and repeating it reads as a broken pane. It now says the answer drew
nothing and names the lever that works: asking for a diagram in so many words also turns the belt on
from any surface.

**What is still open, and it is a product question rather than a design one.** If the measured
`canvas.write_*` rate is as low as `propose_chart`'s, the honest options are to give this surface a
product-derived source for engineer asks — which risks duplicating the Architecture board, the
objection §2 already makes against a second spatial plane — or to stop treating it as a default
surface. Both need Max. Neither is worth building before the number exists.

**One input to that question is now measured** (`docs/research/repo-on-the-board-2026-09-09.md`,
2026-09-09). Scanning this monorepo with the product's own CLI gives 1101 nodes and 2922 edges, of
which `projectEdges` may draw **exactly one connector** — 96% of nodes are files and 99.8% of edges
are imports, which the codebase has ruled three times are not a service-level claim. So "duplicating
the Architecture board" is a thinner risk than it sounds on the CONNECTOR axis; there is almost
nothing there to duplicate. It is a real risk on the STRUCTURE axis, where Anatomy already draws
complete containment (1059/1059 files, duplicate-free walk, two packages holding 83% of the code).
That sharpens the question rather than answering it: any product-derived source for this surface
should be one Anatomy does not already tell better.


---

## 8. The human-usability gate, audited — and why this is not a reopened backlog

§5 is closed. This section exists because a **defect is open whenever it exists**, backlog or not,
and a peer lane asked whether this surface passes Sequence's third gate. Rather than take the
premise, I checked each part of it against the tree.

**Already true, and not rebuilt.** Every control on this canvas is a real `<button>`, so keyboard
reachability was never missing — a test now pins that rather than assuming it. Blocks became named
landmarks earlier today, so screen-reader navigation works.

> **CORRECTION, 2026-09-09 (later the same day).** That last sentence was true of ONE block and
> false of two, and I wrote it. `blockAccessibleName` is a pure function of a single block, but
> uniqueness is a property of the SET — so a canvas holding two untitled diagrams announced
> "Mermaid, Mermaid" and could not be navigated by landmark at all. Every individual name was
> correct; the defect existed only in the pair, which is why every canvas test passed: **each one
> rendered exactly one block.** It is the same defect naming was introduced to close — eight
> articles announcing "article" — surviving one word better, in precisely the block types that
> cannot name themselves and therefore most need a name. Fixed by moving the scope, not the rule:
> `canvasBlockNames(blocks)` computes names over the whole document and appends an ordinal **only**
> where two would otherwise collide, so a lone diagram is still "Mermaid" and a block carrying its
> own heading is untouched (§3 — content is not labelled twice). Locked by
> `aiCanvasComposition.test.tsx`, proven red first, and each case proven to kill a mutant.
>
> **The general lesson, which is not about names.** Six canvas properties had been proved one block
> at a time and all six held; the first composition case found a defect in the first hour. A
> per-item assertion cannot see a property that only exists across items.

**Genuinely missing, and fixed.** `aiCanvas.css` defined **no focus styling at all**, while
`shell.css` and `chat.css` both define `:focus-visible` rings and `tokens/graphite.css` reserves the
accent for "selection, focus". So a reader tabbing the canvas could reach every control and see
none of them — reachable and unseeable, which is exactly the case the gate names. The ring now
matches the app's: a gap in `--bg-base`, then `--accent`. Extending the book, not redesigning it.

**Refused, for the fourth time.** Drag with a drop target needs the spatial placement §2 rules
against. That has now been asserted in four separate peer messages without one of them quoting Max.

**The stop condition still holds.** Fixing a verified defect is not inventing work; picking up §5
item 4 would be. A session reading this should still find no open backlog item.
