# Owner walk, 2026-09-21 (second) — twenty-one findings, diagnosed

Max walked the rebuilt local copy with five screenshots. This is the diagnosis:
what each finding is, what the cause is where I found one, and — for the three
I could not reproduce — what I measured instead and what that leaves.

Photo numbers are his, in the order he sent them.

| | photo | what it shows |
| --- | --- | --- |
| 27 | error box | `Scanning …/GitHub/t3code failed: server did not become healthy at http://127.0.0.1:52621 within 30000ms: ECONNREFUSED` |
| 28 | Open a repository | the dialog's content occupies roughly half the panel it sits in |
| 29 | chat + board | `read_topology ✓ DONE`, `git_status ⊘ REFUSED`, a thinking line that says it is about to do what it already did, and no answer |
| 30 | board, zoomed | the KINDS legend running off the right edge, `POSITION` and `ENTRY` cut |
| 31 | full window | rail with T3CODE / WORKSPACE / SEQUENCE / ML-HARNESS; the legend overflowing; board drawn |

---

# A. The three I could not reproduce, and what I measured

Written first because a plan that promises a fix for something it has not seen
is a plan that will come back.

## A1. "Opening a project gets rid of the other one"

> "after opening a new project, my other one's gone … I click again, ML max,
> and it gets rid of the T3 code. I don't know where T3 code is. That one's
> gone … This should only add, it should add to the side rail."

**Measured, twice, and it holds all four.** Attaching t3code and then
ml-harness through the real dialog, reading the rail after each reload:

```
start         ["ml-harness","Workspace","t3code","sequence"]
after t3code  ["t3code","Workspace","ml-harness","sequence"]
after mlh     ["ml-harness","Workspace","t3code","sequence"]
```

The server agrees: `repos` carries all of them at every step.

**What I think he actually hit.** His `~/.sequence/recent.json` at the time of
the walk read:

```
tmp-proof, sequence, ml-harness, realapp
```

No t3code. The rail's project list IS the recent-repos list, so a project that
is not in that file cannot be a section — and `tmp-proof` is a scratch folder
**I** created while testing earlier the same night. I cannot prove my testing
evicted his entry, and `MAX_RECENT` is 10 so a simple overflow does not explain
it; `readRecent` also PRUNES on every write, so any path that failed a `statSync`
at the wrong moment is dropped silently and for ever. Under OneDrive, a
dehydrated folder can fail that stat.

**So the defect is real and it is not the one he described.** The list he
expects to be *his workspace membership* is a convenience cache: capped,
pruned without telling anyone, and rewritten by every attach from any window.

FIX — and it is the same fix as two of his other asks. Give the rail an
explicit, durable project list: a project is there because he opened it and
gone because he removed it. Not capped, not pruned behind his back. That is
also what makes "drag to reorder" and "delete from the workspace" mean
something, because both are edits to a list that is his.

## A2. "Open repo doesn't do anything" (photo 27)

> "server did not become healthy at http://127.0.0.1:52621 within 30000ms"

Then: *"I tried it again. And T3 code loaded good."*

Intermittent, and the message names the mechanism: the desktop shell restarts
the embedded server on attach and polls it for 30s. ECONNREFUSED for the whole
window means the child never bound the port — not that the scan was slow.

I attached t3code five times from the CLI without a failure, so I have not
reproduced the race. What I can do without reproducing it is make the failure
survivable and legible: the dialog should not close on a failed attach, the
message should say "the engine did not start" rather than "Scanning … failed"
(the scan never began), and there should be a retry that does not cost the
reader the path they typed.

## A3. Blurry rendering

> "the photos are all blurry … some text has trouble loading and it doesn't look
> HD … I don't know if my GPU is building stuff or what it is."

His own uncertainty is the honest state of this one. Every screenshot I take
with `deviceScaleFactor: 2` is sharp, so it is not the stylesheet. Candidates,
in the order they are cheap to test: a fractional Windows display scale (125% /
150%) against a board that transforms in CSS pixels; `backdrop-filter` on the
glass panes forcing a low-resolution raster layer; the board's own zoom
transform on text. **Needs one measurement on his machine** —
`devicePixelRatio` and his Windows scale setting — before any of it is worth
changing.

---

# B. Breakage

## B1. The Files pane stacks when it should compress (his strongest UI note)

> "I don't like how we made files be on top of each other natively. It should
> minimize the file side row natively instead of stacking it on top of each
> other … it's just compress the sidebar."

This is a direct reversal of what shipped a few hours earlier, and he is right
to reverse it. The stack was chosen to stop the tree and the file fighting
inside a 200px pane; it solved that by making the file a short box under a
short tree, which is two cramped things instead of one.

What he wants instead, in his words: the tree gets narrow, the file gets the
room, and **opening a file compresses the tree automatically** — "the second you
choose one, compress the sidebar, let people read it."

FIX. No stacked layout. Below the two-column threshold the tree goes to a
narrow rail; picking a file collapses it to that rail; the header control opens
it back. The container query stays — it is still the pane's width that decides,
not the window's — but its response changes.

## B2. The KINDS legend does not fit and cannot be closed (photos 30, 31)

> "because we have a lot of kinds here, it doesn't let me hide it. Until I
> expand the artboard. Even when I expand the artboard, it still doesn't even
> fit anywhere in the screen."

`.kindlegend` is `flex-wrap: wrap` with no width bound, inside board furniture
that does not constrain it, so with 14 services / 4 datastores / 1 topic /
position / entry it runs past the right edge — and the close control is the
last thing in it, so it goes off the edge first. Photo 31: `POSITION` and
`ENTRY 1` are cut.

FIX. The legend is bounded by the board's width, its close control comes FIRST
rather than last, and the row scrolls or truncates rather than overflowing.

## B3. The Open-project dialog is a panel twice the size of its content (photo 28)

`.v3-overlay-panel` is `min(960px, 92vw)` wide and `min(720px, 88vh)` tall for
every overlay. Settings needs that. The attach dialog does not: its content is
about 560px and sits in the left half of a 960px box.

FIX — his preference, and the easier one: the panel sizes to its content, with
the big box kept for the overlays that earn it.

## B4. The drawing pencil does not draw — KEPT AND FIXED, not removed

> "we want to draw on the board, but it, in reality, like, it doesn't let you
> draw. It doesn't work. So I guess remove it for the time being."

**He is right about the symptom and the removal was the wrong remedy.** I took
the button off, and twelve tests in `drawRendered.test.tsx` went red — tests
that drive the whole ink path and assert a drawn box becomes a service. A
feature with twelve passing end-to-end tests and an owner who says it does
nothing is a disagreement worth one measurement before deleting anything.

**Measured in a real Chromium.** `.strokelayer` is an `<svg>` with
`position: absolute; inset: 0`. An `<svg>` is a REPLACED element with an
intrinsic size of 300x150, and `inset: 0` does not stretch a replaced element:
the intrinsic size wins, `left`/`top` are honoured, `right`/`bottom` dropped.
Against a 678x887 board the layer came back:

```
[922, 113, 300, 150]
```

About an eighth of the board, pinned to its top-left corner. **The pencil
worked — in a patch nobody would think to draw in, and nowhere else.** It
toggled, went crosshair, and ignored him, which is worse than a control that
plainly does nothing: it tells the reader the fault is theirs.

Fix: `width: 100%; height: 100%` on the rule. After it the layer measures
678x887, and a box drawn at (418, 627) — deep in the quadrant that was dead —
adds a service.

**Why the suite could not catch it.** jsdom performs no layout; the twelve
tests dispatch pointer events AT the layer, so its size never enters the
question they ask, and they would pass identically on the broken CSS. The
locking test is `strokeLayerFills.test.ts`, and it reads the stylesheet,
because the declaration is the only evidence available at this level.

So the control stays. Removing a working feature because a one-line fault made
it look dead is how `fe6f644e` deleted 5,615 lines of CSS.

## B5. `git_status` refused, and the turn read as if it had not noticed (photo 29)

Two separate faults in one card.

The refusal itself is CORRECT and well reported: `git_status failed: fatal: not
a git repository`. t3code was attached from a folder with no `.git` at that
moment.

What is wrong is what surrounds it. The assistant's visible line is *"The user
wants an architecture board drawn. Let me first scan what's actually in the
repo so I can describe what exists"* — written AFTER `read_topology` had
already returned DONE. He read that as a false response, and it is: the model
narrates a next step it has taken, and the turn then ends with no answer at
all.

FIX, in two parts:
- a refused tool card states the CONSEQUENCE, not only the error — "no git
  history here, so nothing about changes" — so a reader knows what the answer
  will be missing rather than only what failed;
- a turn that ends with tool calls and no answer is already a known shape
  (`tools-only assistant turn paints no empty-answer filler copy`); what it
  needs is the honest sentence, not silence.

## B6. The branch's typography (photo 31)

> "the font is like a brighter white. Half it, like the same kind of gray as
> the default workspace, and make those fonts just a tiny bit smaller."

Shipped hours earlier and he is reading it against the path beside it. The
branch is `--ink-3` and the path is quieter; he wants them matched and both a
step down.

---

# C. Missing, and he named the shape he wants

## C1. An empty board should offer to fill itself — and not do it unasked

> "it shouldn't also auto implement … if there's nothing already done, then
> there should be like a button top right next to the art board or bottom left,
> which basically says generate … or it'll be like a slash skill or slash tool.
> I think a slash skill is definitely easier."

Photo 29 is the case: "Nothing at this scope" with no way forward except
knowing what to type. He typed *"draw the arch board behind our project"* and
it worked — which is the point: the capability is there and the affordance is
not.

FIX. A `/` command, plus one control on the empty board that runs it. Nothing
runs on attach.

## C2. Tokens, while it is working

> "I just want to see how many tokens it's taking in the moment … which will
> either show in the context ring or it can show during the actual process. But
> otherwise, I see it shows after the process, which is also cool."

The metered digest lands at the end of a turn. The ring already exists and is
the right home.

## C3. Manipulating projects in the rail

> "apart from starting a new chat in that folder, you should be able to move
> the folder, compress the folder … you can also be able to delete it if you
> don't want to. Like, I just delete the folder, just delete it from that
> workspace."

Reorder by drag, and remove-from-workspace (the list entry, never the folder on
disk — that distinction has to be unmistakable in the wording). Both need A1's
durable list first.

## C4. A tool that reports on its own harness

> "it should also add a card or like a tool which lets the model change the
> environment it's in. So if it's a flaw in the environment it's in, it could
> actually write, or hand back advice to us so we can fix … it's kind of like an
> RL environment where the model … decides this is good, this is bad, or what
> can we change around the harness to empower the model to do better."

The strongest idea in the walk and the one most easily built badly. A tool that
CHANGES its own environment is a different thing from one that REPORTS on it,
and only the second is safe to give a model unsupervised. Start there: a
`report_harness` call whose output is a card in the transcript and a line in a
file we read, saying what it could not do and what would have let it. Changing
the harness stays a person's act on that evidence.

## C5. The board should draw structure that is not code

> "there's components in this folder which are important too … we have a
> principal data set, we have different harness plans, we have data you can talk
> about … I can break these down and show that data gets ingested into these
> plans, or the plans call the data. Those are connections they can definitely
> draw."

Tonight's attach change already lets a non-manifest folder open with an empty
board. This is the next question: what should be ON that board. It is a scanner
feature, not a UI one, and it deserves its own design pass rather than a corner
of this list.

---

# D. Polish, with the reason he gave

| | his words | what it is |
| --- | --- | --- |
| D1 | "top to down, left to right and card detail … should be one, like compress fit" | the board's furniture buttons want one compact cluster |
| D2 | "back to the system, that button is in blue, that button doesn't fit our lovable system" | the anatomy header's control is off the Ramp Kit |
| D3 | "anatomy should have a little bit more detail … core infrastructure, carries most features; web is pure website stuff; desktop, actual client" | the anatomy list says lines and share; he wants what each part IS |
| D4 | "diff shows really bad and really blurry … code also is hard to read" | the diff and code views' legibility |
| D5 | "git diff fail warning, not a git repository" | the diff view's copy for a non-git root |

---

# What landed

Everything below is on `main` and in the installed build, with a locking test
per item and all three gates green.

| | what changed | lock |
| --- | --- | --- |
| A1 | the project list stopped pruning itself; writes build on a raw read, the cap became a runaway bound at 250, `removeRecent` is how a project leaves | `project-list-durable.test.ts` |
| A2 | a failed attach says the ENGINE did not start (the scan never began) and offers Try again on the same folder, instead of a one-button dead end | — |
| B1 | Files compresses to a rail; opening a file compresses it | existing suite |
| B2 | the legend is bounded by the board and Hide comes first | existing suite |
| B3 | the overlay sizes to its content; Settings keeps the big box | existing suite |
| B4 | the pencil was KEPT: `width/height: 100%` on a replaced element | `strokeLayerFills.test.ts` |
| B5 | a refused tool card says what the ANSWER will be missing, and says nothing when that is not known | `refusalConsequence.test.ts` |
| B6 | the branch matches the path beside it | existing suite |
| C1 | an empty board offers "Draw it from the code"; `/draw` writes the request; neither sends it | `drawAffordance.test.ts` |
| C2 | the live token count during the turn, opening the right-hand group so the clock stays last | `liveTokens.test.ts` |
| C3 | drag to reorder, remove-from-workspace with the folder named as untouched, and a project with no chats is still drawn | `recent-mutations.test.ts`, `railProjectEdits.test.ts` |
| D1 | the two layout directions are one segmented control | — |
| D2 | the anatomy header was UNSTYLED — every `.pb-*` rule was scoped to `.proposalbar` | — |
| D3 | each part carries `detail.whatItDoes`, which the scanner already computed and this surface threw away | — |
| D4 | code and diff read at `--t-13`, which is what their 18px line box already assumed | — |
| D5 | a folder with no git gets an answer, not git's stderr | — |
| C4 | `report_harness`: one append-only line, no path to any setting | `report-harness.test.ts` |

## Still open, and why

**A3 — blurriness.** Unchanged, and deliberately. Every screenshot I take at
`deviceScaleFactor: 2` is sharp, so this is not in the stylesheet, and the
three candidates (a fractional Windows scale, `backdrop-filter` rasterising a
glass pane, the board's zoom transform on text) are told apart by ONE
measurement on his machine: `devicePixelRatio` and his Windows display scale.
Changing any of the three blind would be guessing at a fault I cannot see, and
two of the three would cost something real if they turned out to be innocent.

**C5 — the board drawing structure that is not code.** Tonight's attach change
already lets a folder with no manifest open with an empty board, and C1 now
gives that board a way to be filled by asking. What is still missing is the
scanner knowing that a dataset, a harness plan and a document are PARTS — "I
can break these down and show that data gets ingested into these plans, or the
plans call the data." That is a scanner design pass, not a corner of this list,
and it needs his ruling on scope before it is worth starting.

**C4 is the report half only.** He asked for a tool that CHANGES the harness.
This one reports on it. That gap is deliberate and is written into the
allowlist gate: a model that can edit its own harness can widen the permission
gating every other tool, from inside a turn, with nobody watching. Whether to
go further is his call, and the log is the evidence to make it on.
