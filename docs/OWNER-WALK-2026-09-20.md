# Owner walk, 2026-09-20 — diagnosis and plan

Max walked the installed 0.1.2 build and filed eighteen observations in one
message. This file is the diagnosis: what each one actually is, what the root
cause is where there is one, and which of them is a design judgement rather
than a defect. It is ordered by what it costs to be wrong about, not by the
order he said them.

Every FOUND line below is something read out of the code or off his disk, not
something inferred from the symptom. Two of the eighteen turned out to have a
different cause from the one the symptom suggests, and one of those two is his
strongest complaint.

---

## 1. THE BIG ONE: a chat and a repository are not bound together

> "every time you switch on the session rail it should switch to that folder
> ... each chat has a different path ... if it doesn't match the path then
> there's no point of showing it in the session rail. That's a big problem"

**He is right, and it is worse than the symptom he saw.**

FOUND. There are two ways to open a chat from the rail and they do different
things:

| | what it does |
| --- | --- |
| `activateSession` | the active root's chats. `PUT /api/sessions/active`. |
| `browseCatalogSession` | another repo's chats. Reads the transcript with a `repoPath` query and dispatches `session/browse`. **It never attaches the repo.** |

So clicking a chat under ML-HARNESS paints ML-Harness's transcript while the
ENGINE is still attached to `sequence`. That explains the cosmetic half he
reported: the path under the composer reads `groundedRepoRoot(state)`, which is
the attached root, so it does not move.

The half he did not see is the one that matters. `/api/ask/stream` carries no
`repoPath` — checked; the field does not exist on the route. The attached root
is the only root an ask can run against. **A question typed into a foreign chat
is answered about the wrong repository, and nothing on screen says so.** The
transcript is ML-Harness's, the answer is about `sequence`, and the two are
stacked in one column.

FIX. Clicking any chat in the rail attaches its repository. One root, one
truth: the path under the bar, the graph, the anatomy, the tools and the ask
all read the same attached root because there is only one. Soft-browse stops
being the default; it does not survive as a second way to open a chat, because
a second way is exactly what produced two answers to "which repo is this".

## 2. The section holding the attached repo is labelled "Workspace"

> "it doesn't import the workspace, it shows on my session workspace still as
> default"

FOUND. `V3SessionsRail` renders the general section with a hard-coded label,
Workspace, whatever is attached — and `sectionsToRender` filters the attached
repo OUT of the catalogue list, so its chats fall into that section. Attach
`sequence` and its chats appear under a heading reading Workspace, beside
sections that DO name their repo.

That heading is the only thing on screen claiming which root a chat belongs to,
and for the attached root it says the wrong word.

FIX. The section names the attached repository and carries its path. The word
Workspace is kept for the case it is true of: the local scratch root, when
nothing is attached.

## 3. The plus menu shows everything at once

> "it doesn't show too many at the same time, maximum three ... and then show
> more for break it down, blast radius ... there should be a button to take you
> to settings and skills and MCPs"

FOUND. The slash menu already caps each shelf at three and puts the rest behind
a "Show N more" row — `sectionShelves`, `SLASH_SECTION_PREVIEW = 3`. The plus
menu renders every row of every shelf unconditionally. Two menus, one rule,
applied in one of them.

FIX. Not a second cap: the SAME rule, lifted out of `sectionShelves` into one
function both menus call, so it cannot be three in one menu and four in the
other six weeks from now. Do is re-ordered to the three he named and the rest
go behind the count. A Customize row at the foot is the door to Settings, where
skills and MCP servers are configured.

## 4. "It also automatically made a goal"

**The symptom is real. The cause is not what it looks like, and the feature he
is objecting to was removed three days ago.**

FOUND, on his own disk, in the session index:

    session-0130-jp4q   goal set, plan of 3 steps, titleEdited: true

and in that session's `goal-run.json`:

    startedAt   2026-09-19T01:08:54Z
    finishedAt  2026-09-19T01:09:23Z
    stopped_by_hand, 0 of 3 steps

That run finished on the 19th. He opened the app on the 20th, landed on that
session, and the goalbar rendered a two-day-old settled run as if it were the
state of the thread he had just opened.

FOUND, second: nothing in the engine sets `goal`. `sessionsStore.ts` records
the removal in its own words — "NO TURN EVER SETS THIS ... owner, walking the
installed app 2026-09-17: I don't like that it sets the goal automatically" —
and a search for a `goal` write across the whole analyzer returns the PUT route
and the tests, nothing else. The two client callers are the slash command and
the New goal form, both explicit.

So the app did not make him a goal. It showed him one that had been sitting
there, with no date on it, in the present tense.

FIX. A settled run does not render as live status. The strip says when the run
ended, and a run that ended on another day is not the first thing the thread
says about itself.

ALSO FOUND, while reading that path: `runSlash`'s dispatch ends in a bare
`else if (rest) startGoalCommand(rest)`. Correct today only because
`SlashSource` happens to have four members and the other three are handled
above it. A fifth kind added next month starts a goal run instead. Made
explicit.

## 5. The goal run's turn lands in the transcript with nobody speaking

FOUND. `chat.json` for that session holds exactly one entry: an assistant turn.
The scaffold that produced it is deliberately not written — `repoServer.ts`
argues the case and is right, a transcript that can contain words nobody typed
is not evidence of anything. But the assistant turn IS written, so the thread
opens on a model talking to no one. That is the bare message at the top of his
screenshot.

FIX. The turn is marked as a goal-run turn where it is rendered, so a reader
can see why there is an answer with no question.

## 6. The system page

> "some of the design is just completely off ... it doesn't match any styles
> and it takes up the whole screen. And this page doesn't really provide enough
> information."

FOUND. `.board-scope.repoanatomy` is `position: absolute; inset: 0` over the
board — whole screen by construction. Its rows are a bespoke flex list with a
hairline under every row, not the control ladder every other list in the
product uses (row height 30, sheet 10). Its only facts per part are name, lines
and share; the file count it already holds is not drawn, and the rows are not a
way in to anything.

FOUND, and this part is a defect rather than a judgement:
`src/canvas/anatomyLocks.test.ts` is RED on "expected undefined to be defined",
and `src/canvas/boardInteractCss.test.ts` is red asserting a `.board-scope
.node` rule that no longer exists. Both sit in the blast radius of the sixteen
stylesheets `fe6f644e` emptied. The page is not merely unfashionable; part of
its styling is measurably missing and a test has been saying so.

## 7. Nothing says the model is still working

> "descriptions are popping up one by one which is awesome, but I don't know if
> when or if it's working"

Real, and the most valuable small fix in the list. The board fills in during a
turn and has no working state, so a slow turn and a finished turn look the
same.

## 8–12. Judgements, not defects

Carried with reasons rather than fixed blind:

- the gateway glyph, and legibility at low zoom
- the MCP drill-in journey ("the mapping is actually amazing ... but some of
  the views are hard to follow")
- the first-chat-in-a-new-project prompt (import, or build an architecture)
- Settings and Workspace label typography
- Build mode's buttons corresponding to the goal

The first two need him looking at the same screen; the third is a new
interaction and wants his ruling on when it fires before it is built.

---

## Order of work

| | | |
| --- | --- | --- |
| A | bind the chat to its repository, and name the section | defect |
| B | one shelf rule for both menus, plus the Customize door | defect |
| C | goal honesty: a settled run is dated, dispatch made explicit | defect |
| D | the system page: ladder, facts, and its two red locks | defect |
| E | a working state on the board | defect |
| F | the fourteen red test files | debt |

E is last of the defects because it is the one that needs the least code and
the most care about where the state comes from: a spinner driven by anything
other than the turn's own phase is a spinner that lies.

---

# What the walk turned up that was not on the list

A–C and E landed as planned. D landed as its two red locks and not as a
redesign — the page's chrome is still yours to judge. F is closed: **web2 is
3071/3071**.

Walking F is where most of the rest of this came from. The fourteen were
supposed to be v2-selector churn. Six were not (`465d165f`), and of the eight
left, the churn kept opening onto **capabilities that are complete, tested and
have no surface in V3** — the Wave 2 defect `App.test.tsx` was written to
police, one layer up. Built, green, unreachable.

## Four things V3 built and never drew

**The `@` picker.** `mentionModel.ts` resolves a token against the attached
graph, `composerPropsFrom` ranks it and turns a pick into the same chip a board
card click makes, the reducer holds the picker's state, `chat.css` styles the
list. Its only mount was `chat/Composer.tsx`, which V3 replaced — so sheet
12.4's whole design has been unreachable. **Mounted.** Verified in the running
app: `@analy` offers `analyzer` as a NODE and five anatomy files, each with its
path.

**The context chips, and this one is worse than a missing affordance.** A chip
is a grounded reference that TRAVELS WITH THE ASK — `onSend` puts every one of
them in the next message's scope. Two doors produce them (a board card click,
the picker) and V3 drew neither. A reference could be attached to a question,
sent with it, and never appear on screen: no way to see what the question
carries, no way to take one off, and a stray chip from a card clicked ten
minutes ago riding along and changing the answer. **Mounted, with a remove.**

**The empty-thread strip.** `sessionHomeContextFrom` builds repo, BRANCH and
model, and nothing in V3 read it. This is your complaint about the path, one
row down: you could see the path was wrong, and the branch was not on screen at
all. A question answered against `main` and one answered against a feature
branch are different answers. **Mounted, at the end of the path row.**

**The index rail — NOT repaired, and it needs your ruling.**
`ConnectedIndexRail` has no importer outside tests and `board-index-toggle` is
not in the product at all. The component is alive and its own locks still pass
against a real scan; it is the MOUNT that is missing. The functions-first rail
is in CLAUDE.md's own description of the product ("click a function → the
canvas re-sorts and plays the animated service-to-service flow") and it is not
on screen anywhere.

Where does it go in V3? Its own pane in the bar? Inside the Architecture pane,
the way v2 had it behind an Index toggle? A second tab of the Files pane? That
is a design decision and I have not made it.

## Four defects the tests were already pointing at

| | |
| --- | --- |
| **Escape did not close an overlay** | Settings, Search, Help, Review, Activity, Rewind and Open-project all open in one panel and the only ways out were the × and the scrim. Two cases have asserted "closes on Escape" since the v2 shell. The host claims the key in the capture phase now: it is modal, and letting Escape through closes something behind it you cannot see. |
| **Send was never disabled** | `deriveSendState` has computed disabled/ready/running since item 2.7 and the V3 button ignored it. On an empty draft, Send looked exactly as pressable as on a full one. It was safe — `onSend` returns early — which is the bad kind of safe: a control that can be pressed and does nothing, in the most-looked-at strip in the product. |
| **A pane could be open and invisible** | `.v3-live-stack` was `overflow: hidden` and every pane carries a 240px floor. Flex items do not shrink below their floor, so past two or three panes the surplus was clipped with the pills still reading open. That is the 2026-08-29 audit's finding, rebuilt with the workspace. Reachable on a 1280 laptop at three panes. **The stack scrolls now** rather than refusing a pill the way v2 did — V3's shape is "open what you want and drag the splitters", and it has no notice surface to refuse into. Say if you would rather it refused. |
| **The splitter was a 13px drag target** | 1px element, hit area `inset: 0 -6px`. WCAG 2.2 AA 2.5.8's floor is 24. v2 shipped an 8px resizer, the audit measured it, it was widened with the measurement written down — and V3 rebuilt the splitter and rebuilt the defect. 25px now; the drawn seam is still a hairline. |

And one accessibility failure in the dialog you asked about: the **Open project
dialog drew its legends and its recent PATHS at 4.07:1** against a 4.5 floor —
the least readable text in the dialog was the thing you open it to read.

## One I broke, and the suite caught it

The auto-open effect (a topology proposal opens the board; a canvas block opens
the canvas) first watched `canvasDoc.blocks`. `canvasPaneFocus.test.tsx` went
red, correctly: from the document, a block the model just wrote and a block an
opened thread brought with it look identical — and that is your report of
2026-09-17, "when I click on another chat, the canvas plotting kind of takes
priority ... I never told it to."

The signal is a field now, `session.surfaceFocus`, mirroring `filesFocus`: set
only where a turn PRODUCES, cleared by navigation. Worth recording because the
test earned its keep in the one way a test can.

---

# Still open, and why

| | |
| --- | --- |
| **The index rail's mount** | Above. Yours. |
| **The board at low zoom** | Confirmed and photographed: at 53% the labels collide — `Database data…` runs into `Api Types`, `Analyzer` into its neighbour. It is a layout problem (ELK spacing at LOD) rather than a style one, and worth its own pass. |
| **The gateway glyph** | `roleIconFor` sends `gateway`/`router`/`ingress` to `kindGlyph(present.kind)` — the generic service silhouette — so every gateway looks like every service. A glyph of its own is a Decision-2 question (which channel carries it) and wants your eye. |
| **The kind accent bar** | Removed by "Board Option A" on 2026-08-27, and two tests have disagreed about it ever since; that is settled. It was ADDED five days earlier for far-zoom legibility, which is your complaint today. Decision 2 gives a kind three hueless channels and only two are drawn. Putting the third back is your call, not a restore. |
| **The first-chat prompt** | "Import, or build an architecture around it." A new interaction; it wants your ruling on when it fires (first chat in a repo with no `.sequence/graph.json`? every empty board?) before it is built. |
| **The MCP drill-in journey** | "The mapping is actually amazing ... but some of the views are hard to follow." Needs us looking at the same screen. |
| **Build mode's buttons matching the goal** | Not yet diagnosed. |
| **The Settings/Workspace label typography** | Not yet diagnosed; the MCP add-form labels are the ones you named. |
| **macOS notarization** | Apple Developer Program, 99 USD/year. The workflow is wired and dormant. |
