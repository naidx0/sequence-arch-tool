# The scripted seat — registered before its first card run

**Registered 2026-09-05T23:25Z at `a76efd1f`. Built and dry-run; no turn has been taken.**

## Why

Every defect found today was found by opening the app and looking: the chart that reached the store
and never reached the file, the load path that read the chart and threw it away, the thirteen frozen
seconds a green log called fine. **None had a failing test, and all were visible in one screen.**
`tools/ci/scripted-seat.mjs` is that loop written down so it can be run rather than remembered.

The run: type an ask, wait the turn out, **reload**, reopen from the session list, ask the same
thing again. It writes four screens, the canvas file, the chat file, the build stamp, and a
transcript of numbered observations — each recording what was expected *before* it was looked at,
what was seen, and the verdict, because "the chart was there" is a memory and "expected a chart
after reload, saw `charts: 1` in canvas.json" is a record.

## The registered prediction

For the first card run:

| | expected |
|---|---|
| the ask | asked **twice**, with a reload and a reopen between |
| screens | **4** |
| `canvas.json` after the reload | **`charts: 1`** |
| transcript | written, with every observation carrying expected/seen/verdict |
| wall clock | **under 3 minutes** |
| model turns | **2** |
| against a stale process | **refused** |

## Two of those are already settled, card-free

- **Refused when the process is older than its code** — verified: `dist/cli.js` touched, the run
  exits **2** with the reason and the fix (`pnpm restart:app`), before opening a browser.
- **The dry path is clean** — `--dry` exits **0**, reaches the composer, takes a screen and writes
  the transcript without sending anything to a model.

The other five need the card.

## One thing the dry run changed about the instrument

`--dry` takes no turn, so a fresh conversation has no chart and no reply — and the disk observations
("a chart drawn this turn is persisted in `canvas.json`") reported **DIFFERS** and exited 1. That is
a check failing in a mode where it *cannot* pass, which teaches its reader to ignore a red line. The
disk assertions are now skipped in `--dry` and the files are printed unasserted instead.

## What it deliberately does not do

It does not sleep. It waits on the product's own signals — a new `chat-prose` that is no longer
`data-streaming` — because a fixed sleep passes when the model is fast and reports a missing answer
when it is slow, which would make the instrument's verdict a function of the weather.

And it is a **separate file** from `capture-journey.mjs` rather than a third mode on it. The capture
replays a lesson already on disk and calls no model; this one types into the composer and waits for
two real turns. The file boundary stops somebody reaching for the cheap tool and getting the
expensive one.

## Status

**Not run against the card.** Queued behind the check-in gate runs, the sequence condition, the
fresh lesson for the capture, the math kind run and the provider comparison.


---

# The planted cases, run

**2026-09-06T00:15Z at `87ddf513`, card-free.** Built from `design-the-scripted-seat.md` §6.

| # | case | result |
|---|---|---|
| 1 | **the stale app** | **refuses**, exit 2, before opening a browser — `dist` touched, verified |
| 2 | **the selector that matches nothing** | selectors read out of `AiCanvas.tsx` and **verified live** (`ai-canvas-chart` 1, `.ai-canvas-empty` 0, `chat-chart-pointer` 2) rather than guessed |
| 3 | **the fourth seat, replayed** | **reproduced** — see below |
| 4 | **the frozen beat** | void rule built: a beat is void unless its frame hash changes; `voided N of M` printed and a void beat exits 2 |
| 5 | **two seats** | **refuses**, exit 3, naming the holder; a dead holder is cleared |
| 6 | **no model** | **ran** — see below |
| 7 | **the chart row** | observation 3, asserted per run |

## Case 3 — the replay reproduces the defect

`tools/ci/seat-replay.mjs` checks out the two client files `43da3119` changed at its parent, rebuilds
web2, serves that dist from a second app on its own port, and asks the seat's question of the old
client. Card-free: the lesson is already on disk with `charts: 1`, and the bug is in the **load**
path, so reopen-and-reload is the whole reproduction.

| | on `43da3119^` | on `87ddf513` |
|---|---|---|
| chat chart rows | 2 | 2 |
| **canvas charts** | **0** | **1** |
| **canvas placeholder** | **1** | **0** |

That is the defect a person found by hand at 15:56, reproduced by the script: the file holds a
chart, the chat points at it, and the canvas shows the placeholder. **The seat looks where the
person looked.** The design page names the opposite result — a chart here — as one of three
conditions for the whole instrument not being worth building; it did not happen.

The replay refuses to start on a dirty tree, copies the session aside before a pre-fix client
(the one that wiped charts on landing) goes near it, and restores both files, the build and the
session in a `finally`. Verified after: tree clean, `charts: 1` intact.

## Case 6 — and the two defects it found in the instrument

An app pointed at a dead provider port. The seat ran all five beats, captured four screens, reported
**7 of 9 observations differing**, and exited in **50.6 s** — inside the five-minute run bound, which
is on the RUN and not the turn, because two turns at four minutes is eight.

Running it found two defects in the seat itself, both of which would have corrupted every card run:

1. **`beats 4 of 5 — MISSED: open` on every real run.** The `open` beat was marked only inside the
   `--dry` arm, so the instrument's own primary assert reported a phantom shortfall and exited 2 on
   every path that matters. **A gate that always fails is as useless as one that never does.**
2. **Duplicate observation numbers** — 6 and 7 each appeared twice, so two rows of the ledger
   collided.

Both fixed; a real run now reports **beats 5 of 5** and exits **1** (the product differed) rather
than 2 (the run did not describe a seat). Those two codes mean different things and a caller that
conflates them cannot act differently.

## Where I disagreed with the page

- **§4's `void_unless` names *scrolled* as its example**, and the seat has no scroll beat — the
  scroll lives in `capture-journey.mjs --video`, where the frozen-thirteen-seconds defect actually
  happened. I kept the rule and changed its subject: a beat is void unless its **frame hash
  changes**, plus the chart-shown rule as written. Reporting `voided N of M` on a rule that could
  never fire here would have been decoration.
- **§5 estimates ~300 new lines on ~530 owned.** The seat is **579 lines** and the replay **211**,
  on `capture-journey.mjs` 275 + `chromium.mjs` 154. So ~790 new, not ~300 — most of it the planted
  cases, the void rules, the evidence copies and the ledger block, which §5's estimate predates.
- **§6 case 2 as written** ("the beat fails by name, `beats 3 of 5`") is a fault-injection test I did
  not build. I did the thing it is for instead: read every selector out of the component and verify
  each matches on the live app. A test that plants a broken selector proves the harness notices;
  checking the real ones proves the harness is right today, and only one of those was affordable.

---

# The snapshot beside the pixels

**2026-09-06, card-free.** Built from `design-the-browser-we-own.md` §4: on every beat the seat takes
Playwright's `ariaSnapshot` of the app root, writes it beside the screen with a sha256, and adds a
second void rule — **a beat claiming a content change is void unless the snapshot changed**.

## The planted cases

| # | case | result |
|---|---|---|
| 1 | same build, two runs | **identical hashes** — after the instrument stopped perturbing itself |
| 2 | the replay at `43da3119^` | **the defect as a text diff** — see below |
| 3 | the chart row's sentence | **found by string** on both builds (2 occurrences each) |
| 4 | animation: pixels differ, text same | **not void** — by design, see the rule's scope |
| 5 | font change: pixels differ, text same | same as 4 |
| 6 | no snapshot on a beat | **cannot decide**, counted against declared beats, exit 2 |

**Case 2, the 15:56 defect as text:**

| | `43da3119^` | head |
|---|---|---|
| placeholder sentence *"Ask in chat to populate this surface"* | **present** | absent |
| chart node labels (`brief.ts`, `cli.ts`) | absent | **present** |
| canvas charts / chart rows | 0 / 2 | 1 / 2 |

A pixel diff says "these images differ". This says **which sentence**.

**Cases 4 and 5 are satisfied by the rule's scope rather than by a run.** The text rule applies only
to beats that *claim a content change* — `ask` and `ask-again`. A beat where pixels move and text
does not (an animation, a font change) is never subject to it, so it cannot be voided by it. Writing
a run to stage an animation would test the staging, not the rule.

## Case 1 was refuted, and the cause was my instrument

Two runs of one build hashed differently: 4,205 chars against 4,375. The page predicted
nondeterministic ids and prescribed stripping them; ids were not the cause. **Every `--dry` run was
clicking "New chat" and creating a session**, so the list grew by a row each time — the seat was
perturbing the thing it measures and then reporting the perturbation as instability in the product.

Fifteen contentless sessions had accumulated in this repository before anyone looked, and they were
visible to the user in the session list. `--dry` no longer starts a conversation, the fifteen were
removed after checking each had zero turns, zero charts and no lesson, and **case 1 then passed:
identical hashes on two runs.**

Removing them broke `index.json`, which still listed all fifteen — the app showed rows that opened
nothing. Repaired (22 entries → 7, all resolving), with a `.bak` kept.

## And a false pass the case exposed

The replay's verdict was `canvasCharts === 0`, which is **also true when no lesson was opened at
all** — and that is exactly what happened once the session list changed: the row locator
`has-text("Teach me how brief.ts works").first()` matched the topmost of five sessions sharing that
text, opened one with no chart, and the verdict printed *"EXPECTED: the placeholder"* over a run in
which nothing was tested.

Two fixes: the verdict now requires evidence that a lesson was open (a chart row or a placeholder)
and reports **CANNOT DECIDE, exit 2** otherwise; and both the replay and the seat select rows by
`data-id` rather than by a title substring.

## The kill number

> *Not worth it if any same-build beat's snapshot differs across runs after ids are stripped, or if
> the snapshot costs more than 200 ms a beat, or if the replay's text diff is empty where the pixels
> differ.*

| | measured |
|---|---|
| snapshot cost | **45 ms** a beat — 4.4× under the line |
| same-build hashes across two runs | **identical** (after the instrument was fixed) |
| replay's text diff where pixels differ | **not empty** — the placeholder sentence and the chart labels |

None of the three fires.

**Amendment to case 1, with its reason:** stability holds *for a snapshot of a page the instrument
has not changed*. It cannot hold across runs that each create a session, and the remedy the page
names — stripping ids — does not reach that, because the row **count** moves, not just the ids. The
rule as amended: an instrument that mutates its subject must stop, not redact.

## Where I disagreed with the page

- **§4 says "one call per beat on the page object the seat already holds", and that is what it is** —
  but ages are redacted before hashing (16–20 per snapshot) and the redaction is counted, not
  silent. The token count (`131.1k`) is deliberately **not** redacted: it is deterministic given the
  same state and moves when the conversation does, which is the content change the rule exists to
  see. Stripping it would buy a stable hash by blinding the check.
- **Cases 4 and 5 are not runs here**, as above.
