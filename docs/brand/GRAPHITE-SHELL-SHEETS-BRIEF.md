# The eleven unsheeted surfaces — design brief

**Status:** scope, not sheets. Nothing here is canon yet. This document says what each missing
sheet must specify, what it adapts, and what is genuinely new — so the design time can be budgeted
before it is spent. Approve the shape, then the sheets get written.

**Why this exists.** `docs/research/v2-architecture-and-gaps.md` §5.6 records that the Graphite
book covers the *graph domain* thoroughly and the *shell* not at all, and closes with: *"Budget the
design time or write the sheets. The dangerous state is thinking the book covers them."* §1.4's
trace-to-sheet requirement says every v2 surface names the sheet it implements or names itself
unsheeted. Eleven surfaces currently have no answer.

---

## 0. ~~First, a duplication to resolve~~ — DONE 2026-08-21

> **Executed.** The owner ruled one copy; `docs/brand/graphite/v1/` is deleted, 78 files were
> repointed, and the no-silent-edit guarantee moved onto a decisions-entry rule. Recorded as
> **Decision 3** in `GRAPHITE-DECISIONS.md`. The analysis below is kept as the reasoning.


There are **two complete copies of the book** in the repo today:

| Path | Sheets |
|---|---|
| `docs/brand/graphite/pages/` | 12 |
| `docs/brand/graphite/pages/` | 12, byte-identical |

`tools/ci/graphite-freeze.test.mjs` asserts they stay identical, and that the frozen copy carries
every live sheet. So adding a sheet to one and not the other fails CI by design.

The freeze was protecting something real: a mid-wave edit to a live sheet silently retargeting work
already built against it. But it buys that protection by duplicating every byte of the book, and
the owner's instruction is **one copy of the sheets, nothing from the past**.

**Recommendation (taken): collapse to one copy, and get the guarantee from a decisions rule.**

- Delete `docs/brand/graphite/`; the book lives at `docs/brand/graphite/`.
- Replace byte-comparison with what the freeze was actually for: sheets are immutable unless a
  numbered decision in `GRAPHITE-DECISIONS.md` says otherwise. A test can assert that any change
  to `pages/*.html` in a commit is accompanied by a new decision entry.
- Work that needs an exact target cites a **commit or tag** (`graphite-v1` on the current sheet
  content), which is what git is for and cannot drift.
- `CLAUDE.md` currently says *"cite `graphite/`, never the live path"* — that rule inverts:
  there is one path, and it is the live one.

Cost, stated plainly: every doc that cites `graphite/` needs repointing (`canon-paths.test.mjs`
now covers four more entry-point docs, so it will catch them), and `graphite-freeze.test.mjs` is
rewritten rather than deleted. This is a numbered-decision change to brand governance, which is why
it is item 0 and not something I did quietly.

---

## 1. What is actually missing

Two different jobs are hiding under one heading, and they cost very different amounts.

**Built, shipping, undocumented** — the sheet *records* a surface that already made its decisions.
Cheaper: the specimen is the running component, and the work is measuring it and writing the rules
it already follows.

| # | Surface | Where it lives now |
|---|---|---|
| 1 | Three-pane geometry, resizers, collapse, breakpoints | `shell/{Shell,PaneResizer,shellModel,shellTokens}.tsx` |
| 2 | The attach dialog | `boot/AttachDialog.tsx` + `boot/attachFailure.ts` |
| 3 | The diff inspector | `review/{DiffView,diffModel,syntax}.tsx` |
| 4 | Permission control | `chat/PermissionControl.tsx` |

**Neither built nor sheeted** — the sheet *designs* the surface before it exists. Costlier, and the
sheet is the gate: build without it and the surface invents its own rules, which is the failure
§5.6 is warning about.

| # | Surface | Nearest existing anchor |
|---|---|---|
| 5 | Settings | routed (`dialog: 'settings'`), no component |
| 6 | The session list | no component |
| 7 | Export | no component |
| 8 | The coverage chip | no component |
| 9 | The staleness bar | no component |
| 10 | Notifications | no component |
| 11 | ~~Topology-proposal Accept/Deny gate on the canvas~~ **WRITTEN — sheet 13** | `review/ReviewPane.tsx` gates a *diff*, not a canvas ghost |

`shell/shellModel.ts` already documents its own gap in code comments, citing §5.6 and the grep that
found zero hits for "three-pane" and "breakpoint" across all twelve sheets. The builders knew. The
book is what is missing, not the awareness.

---

## 2. Per-sheet brief

Each entry says what the sheet must fix, what it adapts, and what is genuinely new. "Adapts" means
an existing sheet's vocabulary carries over; it does not mean copy.

### 1 · Three-pane geometry, resizers, collapse, breakpoints
Adapts sheet 10 (spacing and the control ladder) for the ladder; everything else is new.
Must specify: the three column roles and their min/max/default widths; the breakpoint set and what
changes at each; when a pane is a column and when it becomes an overlay `role="dialog"`; resizer
hit-area, rest/hover/active treatment, and keyboard affordance; what persists across reloads and
what is derived. **New:** the collapse *rule* — which pane yields first when width runs out, and
why. Today that is decided in `paneModeFor()` and nowhere else.

### 2 · The attach dialog
Adapts sheet 12 (agentic surfaces) for the gate framing and ml-harness sheet 15 (dialogs/approval)
for dialog chrome. Must specify: the dialog's size and position rules; the browse-root guarantee as
a *visible* element, not prose; folder-row anatomy and the scannable/not-scannable distinction;
the refusal state ("you cannot attach your home directory") as a first-class layout, since it is
reachable on a first run and is the first thing many users will see. **New:** the whole refusal
register — the book has no failure-inside-a-dialog pattern.

### 3 · The diff inspector
Adapts ml-harness sheet 28, drawn for *training metrics*, into source review. Must specify: added
/removed/context row treatment without hue as the only signal (Graphite law 1); hunk header
anatomy; syntax-token colour budget against the one-accent rule; gutter, line-number and wrap
behaviour; how a long diff degrades. **New:** the reconciliation between syntax highlighting and a
palette that rations hue — the single hardest question in this list, and the one most likely to
break the brand if a builder answers it alone.

### 4 · Permission control
Adapts sheet 12's gate. Must specify: how a permission request appears in the transcript; the
allow/deny affordance and its irreversible-action treatment; how a *standing* grant is shown
differently from a one-shot; how scope is rendered so a person can read what they are agreeing to.
**New:** the standing-vs-one-shot distinction has no visual vocabulary anywhere in the book.

### 5 · Settings
Adapts sheet 10 for the control ladder; ml-harness sheet 15 for dialog chrome. Must specify:
section anatomy and ordering; the control set (toggle, select, text, key-entry) at Graphite's
density; how a secret is entered and confirmed without ever being displayed; the empty/unconfigured
state. **New:** key entry. The product is local-first and key-optional, so "not configured" is a
normal resting state, not an error — the sheet has to say what that looks like.

### 6 · The session list
Adapts sheet 11 (the functions rail) for rail-row anatomy and ml-harness sheet 17 (the left rail).
Must specify: row anatomy, the active row, pinned vs recent grouping, rename/delete affordances and
where they live, and the reserved-gutter rule so hovering never reflows the list. **New:** nothing
structural — this is the cheapest of the eleven, and the closest to an existing sheet.

### 7 · Export
Adapts sheet 12's gate for the confirm step. Must specify: format choice presentation
(`.seqd` / SVG / Mermaid); what is exported when a selection exists versus when it does not; the
success and failure receipts. **New:** the receipt. Sheet 35-style "loading is a receipt" thinking
exists in the Console book, not in Graphite — Graphite needs its own statement of it.

### 8 · The coverage chip
Adapts sheet 03 (node kinds without hue) and sheet 04 (edge kinds and proof). Must specify: what
number it reports and against what denominator; how it reads at a glance without hue as the only
carrier; its placement rule. **New:** very little — this is a small sheet, and it may reasonably
fold into sheet 04 rather than stand alone. Flagging that as a question for the writing pass.

### 9 · The staleness bar
Adapts sheet 04's proof vocabulary. Must specify: when the scan is considered stale; how that is
stated without alarm (Graphite has no red-alert register and should not gain one); the re-scan
affordance; the difference between "stale" and "never scanned". **New:** the honest-degradation
register. This is where a redesign most easily drifts into a warning banner the brand does not want.

### 10 · Notifications
Must specify: whether this product has transient notifications at all — and the sheet is allowed to
answer *no*. If yes: placement, dismissal, stacking limit, and what may never be a toast (anything
requiring a decision, which belongs to a gate). **New:** all of it. Recommend writing this sheet
early even if the answer is "no surface", because "no toasts" is itself a rule worth being able to
cite.

### 11 · Topology-proposal Accept/Deny gate on the canvas
Adapts sheet 12's "The gate", which is drawn for a *run*, plus sheet 06 (selection, focus, dimming)
for the ghost overlay. Must specify: how a proposed node/edge is drawn as not-yet-real against real
ones; how the proposal reads at board density; where accept/deny sit relative to the ghost; what
happens to the board on deny. **New:** the ghost register itself — proposed-but-not-real has no
representation in a book whose entire premise is that everything drawn is traced to evidence. This
is the most conceptually loaded sheet of the eleven and should not be written last.

---

## 3. Suggested order

1. **Item 0** — collapse to one copy. Blocks the rest; everything below writes into whatever
   structure this settles.
2. **11 ✔ (sheet 13), then 3, 2** — the three carrying genuinely new registers (ghost,
   syntax-vs-palette, refusal). Get the hard rulings while attention is on them.
3. **1, 4** — built and shipping; measure and record before the code drifts from an unwritten rule.
4. **5, 6, 7** — surfaces about to be built; the sheet lands ahead of the builder.
5. **8, 9, 10** — small, and 8 may fold into sheet 04 while 10 may resolve to "no surface".

## 4. What this brief is not

It does not decide anything. It does not write a sheet, move a file, or touch the freeze. Its only
claim is that the eleven are **not** eleven equivalent units of work: four are documentation of
shipped code, four introduce a visual register the book does not have, and at least one may not
need a sheet at all.
