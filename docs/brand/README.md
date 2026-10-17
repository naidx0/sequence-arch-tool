# Sequence brand — Graphite (active), one copy at `graphite/`

**Active canon: the book [`graphite/`](graphite/), and the rulings that bind it are
[`GRAPHITE-DECISIONS.md`](GRAPHITE-DECISIONS.md).** The owner adopted Graphite on 2026-08-19 and
ordered the v2 UI rebuild against it ([`../PIVOT-V2.md`](../PIVOT-V2.md)).

**There is one copy** (Decision 3, 2026-08-21). It is what you cite, and it is where a numbered
decision is applied. The rule that new rulings are numbered decisions rather than silent sheet
edits is stated in `GRAPHITE-DECISIONS.md` and enforced by
`tools/ci/graphite-freeze.test.mjs`, which fails any commit that edits a sheet without one.

| Path | Role |
|------|------|
| [`marks/`](marks/) | **Sequence mark (Decision 25)** — monochrome SoT glyph + white-on-charcoal 1024 app icon |
| [`graphite/`](graphite/) | **Frozen book — cite this.** Substrate + 12 sheets + its own assembler. Byte-identical to `graphite/` under CI |
| [`graphite/`](graphite/) | The live book. Edited only as part of a numbered decision, and re-cut into `v1/` in the same change |
| [`GRAPHITE-DECISIONS.md`](GRAPHITE-DECISIONS.md) | Owner decisions of record: the freeze, light deferred (1), node kinds without hue (2), gold V3 SoT (22–23), mark monochrome (26) |
| [`marks/`](marks/) | **Identity mark SoT** — `sequence-mark.svg` (Decision 26) + `sequence-mark-small.svg` for 20px and below (Decision 28 addendum); app icon + specimen |
| [`MACOS-GRAPHITE-MEDIUM.md`](MACOS-GRAPHITE-MEDIUM.md) | **UI CONTEXT DIET** — macOS liquid glass on Graphite; Decision 23 gold V3 book SoT |
| [`GRAPHITE-MIGRATION-PLAN.md`](GRAPHITE-MIGRATION-PLAN.md) | How the tree moves onto Graphite |

## Every superseded book has been DELETED — this folder holds Graphite and nothing else

**There is no second book to find, here or under any other path.** On 2026-08-20 the owner ruled
that a retired book anywhere in the tree is how an agent picks the wrong one — which had already
happened — and that an archive folder is just a slower version of the same mistake. So they were
deleted outright rather than moved.

The lineage, newest first, all of it gone from the working tree:

| Book | Decided | Superseded |
|------|---------|------------|
| **Console v3.1** — 40 sheets, low-contrast dark, token dump on sheet 39 | owner-picked from the v3 samples 2026-08-18 | by Graphite, 2026-08-19 |
| **Ledger v2** — dual theme (paper `#F7F7F3` / navy `#0B1220`), 30 sheets, token dump on sheet 28, plus thirteen shipped gate docs | owner-picked from the v2 samples 2026-08-07 | by Console, 2026-08-18 |
| **Structural Engineering** (v1 mother book) and **Observatory** (v1 runner-up), plus the Cursor × Polarity brief, screenshot-acceptance matrices, goal-flash ledgers and B—17 sheets | 2026-08-03 | by Ledger, then by everything after it |

The sample competitions that produced them — the v2 product brief and its three direction samples
(Graphite / Ledger / Trace), the four v3 sample books (Cursor / Agent window / Kodak / Design
Arena), and the 2026-08-17 owner-walk symptom table — are gone too. The owner-walk photos were
captures of the v1 UI being deleted: evidence, never a spec.

**Nothing is lost.** Git history is complete — `git log --diff-filter=D --name-only -- docs/brand/`
finds any of the above. Use git, not a path, and do not re-introduce a copy into the tree.
