# Build a v2 surface — the only reading list

You are building one surface of the Sequence v2 UI. Read the six items below, in that order, and
nothing else. Everything not on this list is either irrelevant to your surface or retired. If you
feel you need a thirtieth document, you have found a bug in this page — say so instead of reading it.

**1. The decision of record — [`../PIVOT-V2.md`](../PIVOT-V2.md).** Owner, 2026-08-20. The v1 UI is
deleted, not deprecated. Nothing is inherited: no layout, no component, no class name, no colour,
no output format.

**2. The rulings that bind — [`../brand/GRAPHITE-DECISIONS.md`](../brand/GRAPHITE-DECISIONS.md).**
The inherited laws plus the owner's numbered decisions. Two bind every surface: **light is deferred**
(build dark only), and **node kinds differentiate WITHOUT hue**. A new ruling arrives here as the
next numbered decision — never as a silent sheet edit. You extend Graphite; you do not redesign it.

**3. The frozen book — [`../brand/graphite/`](../brand/graphite/).** This is the brand source
of truth; no other book is. `_core.html` (the
substrate and its tokens) plus **the one or two sheets in `pages/` your surface actually touches** —
not all twelve:

`01-graphite-in-sequence` · `02-the-architecture-node` · `03-node-kinds-without-hue` ·
`04-edge-kinds-and-proof` · `05-the-canvas` · `06-selection-focus-and-dimming` ·
`07-modules-and-containment` · `08-board-density-and-overflow` · `09-the-icon-vocabulary` ·
`10-spacing-and-the-control-ladder` · `11-the-functions-rail` · `12-the-agentic-surfaces`

Canvas and board read 02–08; the rail reads 11; chat, composer and tool calls read 12; anything with
controls or spacing reads 10. **Cite `graphite/` — never `brand/graphite/`**, so a sheet cannot
move underneath work already finished against it. **Never edit a sheet**; a freeze test asserts the
two copies are byte-identical.

**4. The plan, your section only —
[`../research/v2-architecture-and-gaps.md`](../research/v2-architecture-and-gaps.md).** Each section
is handed to one agent without the rest — §3 engine, §4 architecture, §6 build order, §5/§7 scope.
This list is only short because that promise holds.

**5. The v1 knowledge, so you never open v1 —
[`inherited-constraints.md`](inherited-constraints.md).** Constraints, measurements and incidents
quoted out of the v1 tree before it is deleted, each with its original `file:line`. **Read this
instead of `packages/web`.** Evidence, not precedent: why a number is that number, never what to build.

**6. The reference implementation — `C:/Users/<user>/OneDrive/Documents/GitHub/ml-harness`.** A working
app already wearing Graphite, with better tool calling, prompting and composer; port from it rather than
invent. [`../research/ml-harness-adoption.md`](../research/ml-harness-adoption.md) — chat/composer only.

## Retired — do not build from these, do not cite them as precedent

- **`packages/web/**`** — deleted 2026-08-20 (`20d1424`); do not restore it. v2 surfaces are built in `packages/web2`.
- **Console v3.1** and **Ledger v2** — retired brand books, **deleted from the tree** on
  2026-08-20 along with the `owner-walk-*` defect registers written against the deleted v1 UI.
  There is no path to any of them. Any doc naming either book as "active canon" is stale, index
  pages included.
- **`final-product-design.md`**, **`arch-board-chrome-plan.md`** and **`product-final.md`** —
  v1 UI docs, **deleted 2026-08-20**. **`docs/macos-ui.md`** is the same class but still present:
  it has live call sites in `packages/`, and goes when the last one does.
- **The brand, token and layout sections of `docs/product-final-plan.md`** — the `--steel-*`
  byte-identical token contract and the ProductShell layout are dead. Its product intent (§2
  personas, §4 journeys, §5 moat, §6 bloat vs core, §7 QA bar) still binds.
- **`docs/vision.md` §6 "look & feel"** — playful, bubbly, Kodak-ish palette. It contradicts Graphite
  laws 1 and 3 and cites a file that does not exist. §5's correctness invariants still bind.

**The conflict rule:** when any document disagrees with a Graphite sheet, **the sheet is right and
the doc is stale.** Report the stale doc. Never edit a sheet to settle the argument.
