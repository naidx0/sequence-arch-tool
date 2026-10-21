# The lesson checkpoint — built, planted cases first, kill number kept

**2026-09-06, card-free.** Built from `design-the-loop-we-own.md` §4.

## What it adds

`lesson.json` and `canvas.json` gain three fields — a **schema version**, the **build that wrote
it**, and the **turn it belongs to** — and one reader assembles them into a checkpoint. With them,
**stale becomes a property of a saved lesson** rather than only of a running process: the move
`/api/build` made for the server, one layer down.

The migration rule: on open, when the build differs, every derived thing is re-derived from the
graph and **the stored derivation is discarded**. Not shown with a warning, not greyed — replaced,
or refused. A chart that disagrees with the current scan is a false claim about the repository.

## The planted cases, run

| # | case | result |
|---|---|---|
| 1 | a lesson from an older build | **re-derived** from the graph, reason names both builds |
| 2 | same build in | **`migrated 0`**, stored charts served unchanged |
| 3 | no version field | read as **version 0** and migrated — never guessed current |
| 4 | corrupt checkpoint | **refused** naming `lesson.json`, file untouched byte for byte |
| 5 | fork at turn 1 | **two branches, same first turn**, neither overwriting, source unchanged |
| — | no graph to re-derive from | **nothing served** rather than the stale chart |
| — | fork past the end | **refused**, not clamped |

7 of 7, no card: every derivation is a pure function of a scanned graph.

One design point worth naming: a fork **rewinds** rather than truncates. Concepts taught after the
fork point go back on the front of the queue in their original order, so the branch has the same
lesson ahead of it that the original had at that turn. A fork that dropped them would be a different
lesson wearing the same name.

## The kill number — kept, and both halves measured

> *Not worth it if re-derivation on open costs more than 200 ms per lesson (then the migration must
> be lazy), or if any of the 13 same-build charts changes under re-derivation.*

| | measured |
|---|---|
| re-derivation per lesson | **2.92 ms** — 68× under the 200 ms line |
| charts changing on a second derivation from the same graph | **0 of 13** |

Neither half fires. **One caveat the number does not carry:** 2.92 ms is the re-derivation alone,
with the graph already in hand — which is the case on open in a running app. If a caller had to scan
first, the cost would be the scan (~5 s here), not 2.92 ms, and the laziness question would be about
the scan rather than about this.

## Where I disagreed with the page, and what I did not build

- **The two files are not merged into one.** The page says they "become one checkpoint"; I added the
  three fields to the lesson and made one reader that presents both as a checkpoint. Merging two
  live shapes that have independent writers, validators and readers is a much larger change than
  §4's ~250-line estimate, and every existing reader of `canvas.json` would have to move with it.
  The property the page wants — one thing, stamped, migrated together — holds either way.
- **Case 6 is not built.** The 15:56 defect replayed from *state alone* needs a lesson on disk
  written by the pre-fix build, and there isn't one; `seat-replay.mjs` already covers that defect as
  the positive control, by code.
- **Case 1's specific expectation is not the one tested.** The page expects the journey lesson's
  four-inbound picture replaced by five arrows on open. That lesson is the persisted journey session
  and re-deriving it would overwrite the screens the page ships; my case 1 uses a synthetic
  older-build stamp instead, which tests the rule and not that artefact.
- **`migrated N of N` is not in the seat transcript yet.** The module returns `migrated`; nothing
  wires it into the seat's ledger.
- **The registered prediction cannot run as written.** It names "the 13 sequence-condition lessons",
  and those live in the bench's memory, not as sessions on disk — the bench builds a lesson per
  conversation and never writes one. Running it needs 13 sessions written first, which is a
  different (and cheap) piece of work, not a card run.
