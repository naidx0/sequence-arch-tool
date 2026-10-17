# Owner feedback log — what we like, what we don't, what's decided

> **Reading note (2026-08-20).** Every quote in this file is verbatim owner history and is never
> edited. Only the *supersession stamps* around them are maintained. The brand book named in an old
> row is almost never the current one — the active book is the frozen Graphite at
> `docs/brand/graphite/` (`docs/brand/GRAPHITE-DECISIONS.md`), and any row describing a v1 UI
> surface is describing `packages/web`, deleted at Wave 7 (`docs/PIVOT-V2.md`).

Verbatim owner reactions, in date order, with what each turned into. This exists
because the same feedback was being re-litigated across rounds and preferences
already stated were being re-asked. **Read this before changing a surface.**

Rules for this file:
- Quote the owner **verbatim**. A paraphrase is where the meaning gets lost.
- Record LIKES as firmly as dislikes — a liked thing must not be redesigned away.
- Anything settled here is not re-opened without the owner saying so.

---

## LIKED — do not undo these

| what | owner's words | round |
|---|---|---|
| **The Structural Engineering brand book** (`docs/archive/brand-v1/sequence-brand-structural.html`) | "It is literally gold. That is the best thing I've ever seen… Any type of design, anything should be redone with this exact format in mind. This is it for the website, for the actual everything." — SETTLED 2026-08-03; **superseded** — v2 brief (`docs/archive/brand-v2-samples/v2-product-brief.md`, 2026-08-07) → Ledger v2 → Console v3.1 (2026-08-18) → **Graphite, active and frozen at `docs/brand/graphite/` since 2026-08-19**. The quote stands as owner history; the book it praises is not canon. | 2026-08-03 |
| The list + graph toggle on the component breakout | "which I see shows the list and the graphing view, which I like" | r89 |
| The `+` composer menu's actions | "trace of the flow, break it down, find the pairs, plan tasks, what breaks — good, good" | r89 — **partially superseded 2026-08-01 (E1)**, see below |
| The service inventory on the Architecture board | "Export service, Ink service, MCP service, Schema service, Web, Analyzer… This is actually a good, proper system" | r89 |
| The frontend/backend pairing being drawn as one component | "one backend literally outputs the frontend. That can be a very clear connection, an animated arrow" | r84 |
| Sunken nodes, poppy buttons | "nodes should be a little more sunk into the program… buttons more poppy in macOS native" | r92 |
| Small, icon-native chrome | "Everything should shrink a bit, and everything should be icon-native" | r85 |
| Draggable/resizable rails | "It should honestly be customizable because you can drag it and make it bigger" | r85 |

## DISLIKED — settled, do not reintroduce

| anti-pattern | owner's words | fixed in |
|---|---|---|
| Big fluffy node cards for interior parts | "too difficult to see and get lost because of their size and limited scrolling" | r89 |
| Any "+N more" that cannot be reached | (breakout showed 6 of 36) | r89 |
| A massive text sidebar next to a graph | "too mushy and should prio graph sizing… not a full massive sidebar with infinite text" | r89 |
| Generic one-word buckets covering unrelated things | "It shouldn't just be like frontend marketing, frontend, this, this, this, unless all of those frontends directly are related" | r88 |
| A rail row that just repeats its own name | ("Orders — 1 part" containing "Orders") | r88 |
| Silent failure in the scanner | (three rounds lost to `copied.size > 1` returning undefined) | r89 |
| Claiming done without opening the app | "handed back to me as if the final product was finished" | r89 gate |

## r93 — SHIPPED from the big pass

| ask | what landed |
|---|---|
| "Move to Polarity for everything" | Polarity became the DEFAULT skin; Lumen stayed selectable — **superseded in r94**, see below |
| "canvases keeping the back too black… more like cream" | ~~light+Polarity canvas is cream/paper, sunken nodes re-lit for a light room~~ — **this was reported SHIPPED and was FALSE. Actually fixed in r96; see the correction below.** |
| "super, super hard to see the squares" | a near-transparent GRID (1.6% dark / 2.2% light) replaces the dot texture |
| "these little blue things at the top of the cards" | kind dot removed from card heads; the kind BADGE keeps the colour coding |
| "some of these nodes in the graph are also massive" | board node capped at 190px, its sub-list scrolls |
| "infinite scroll through everything" (2034 parts) | sections over 12 rows open CLOSED with their count; searching opens them |
| "I switched to advanced mode… the architecture diagram disappeared" | **Detail level / Advanced REMOVED**, store pinned to `regular`, locked by a test |
| "plus sign centered at the bottom" | composer `+` menu is centre-anchored |

### r93 correction (r96) — the "cream canvas" claim was wrong for two rounds

**docs/feature-honesty.md failure, recorded plainly rather than reworded away.**
r93 marked "canvases keeping the back too black… more like cream" SHIPPED. It
was not. The token work it actually did — `--canvas`, `--bg-sunk`,
`--card-top/bottom`, `--grid-line` all re-tuned per light variant — was
correct and is still correct today. But nobody ever opened the app on
`porcelain` or `frost` and looked at the Architecture board, because if they
had, the canvas would have still read solid black, with the cards floating on
it as washed-out cards, on *every* light theme, through r93 and r94 both.

**Root cause:** `<ReactFlow colorMode="dark">` was hardcoded on every board
in `GroupedCanvas.tsx` and `Canvas.tsx` (the default Architecture board, the
Learn-tour view, and Design mode), regardless of the active theme. React Flow
ships its own light/dark stylesheet independent of anything this repo
defines; under `colorMode="dark"` its `<Background>` component paints a
solid, fully opaque `#141414` base rect from its own default — sitting on
top of `.canvas-wrap`'s correctly-cream ground and completely hiding it. The
CSS token work was never wrong; it was invisible under a foreign, hardcoded
black layer the whole time.

**Why the gate didn't catch it (twice).** `docs/loop-log.md` credits r91 with
closing exactly this class of loophole via a "geometry-free contrast rule"
that runs inside React Flow's transformed viewport, ignore-list included.
That rule is real and does run there — but it only checks elements that carry
their own text, comparing text colour against its immediate background. The
bare canvas ground between cards has no text sitting directly on it, so a
raw-ground-vs-theme mismatch was structurally invisible to it. Contrast
rules and geometry rules were both green; only the screenshot showed the
defect, and nobody had looked at one since r93 shipped.

**Actually fixed in r96:** `colorMode` now tracks the live `data-mode`
attribute (`GroupedCanvas.tsx#useCanvasColorMode`) instead of being
hardcoded, and `styles/board.css` additionally forces React Flow's own
`.react-flow__background` rect transparent — belt and suspenders, so the
canvas ground can only ever be what this repo's own tokens say it is, even if
`colorMode` is wrong again in some future surface. Verified by reverting the
fix, running the legibility sweep (it stayed green — this is the very
loophole being described), then looking at `tmp-shots/legibility/theme-
porcelain.png` and `theme-frost.png` directly: black canvas, confirmed with
the fix reverted; cream/paper canvas with a faint visible grid and legible
sunken cards, confirmed with the fix restored. The audit itself has an open,
unaddressed gap from this: it does not yet check "does the raw canvas ground
agree with `data-mode`" as its own rule, only text-on-background contrast.

## r94 — SHIPPED

| ask | owner's words | what landed |
|---|---|---|
| Polarity only, no skin switch | "Lumens: the selectable? No, no selectable, just straight polarity" | Lumen **deleted**. `data-skin` no longer exists anywhere; Polarity's values are the baseline `:root` contract. The Appearance menu is five colour rows and nothing else. |
| Kill the letter palette | "I want to kill ACB LPC. That should be exclusively done through our AI system… just straight buttons that they can click, like 'Add this feature'" | The Programs letter palette and the Nodes list are gone; the pane offers named intents that ask the assistant. |
| Composer tokens, not raw text | "There are tokens with a check mark, not raw prompt text, correct? Why did we stop this?" | Picking a `+` action now attaches a **chip with a ✓**; the raw prompt is composed at send time, not pasted into the box. |
| MADR left-to-right | "The MADR is left to right. That's how it's supposed to be… connection to connection" | The breakout opens on a left-to-right flow of the component's interior. |

**A note on the superseded like.** r92 recorded *"Don't get rid of the current
one, just make the new one, and then give me a toggle"* as a LIKE. r93 asked to
move to Polarity, and r94 removed the toggle outright. The like was about being
able to **compare** while Polarity was unproven — once it won, the toggle was
cost with no benefit. Recorded here so the removal reads as a decision, not as a
liked thing quietly redesigned away.

## r95 — SHIPPED

| ask | owner's words | what landed |
|---|---|---|
| Functions as mini-services in the breakout | "each little function is its own mini service, and the file within that mini service is the function file" | A function opens as a small service — file as body, callers in, callees out. Boundary edges aggregated at component level; panel says so rather than guessing. |
| Directional start→end flow on the Architecture board | "needs a bit more directional flow from where the whole thing starts and where it ends" | Tiers by real call depth with visible lane headers, wrapped to fill the canvas. Trailing lane reads "No calls detected". |
| Process rail: explore dropdown + `⋯` for files | "instead of an infinite mass dropdown, there should be an explore mini dropdown… if they want to explore specific files, they can do that by clicking on an extra three dots" | Logic moved into tested pure functions (shipped in r90; r95 locked it). |
| Install shadcn and rebuild on it | "Use the shadcn library… do whatever you have to to get it in" | **Partial** — Radix primitives skinned with our tokens, adopted on the composer `+` menu only. Migration order in `docs/archive/v1-ui/ui-primitives.md`. |
| Design skill → general web/app design | "not just sequence design" | Split into general `interface-design` + repo-specific `sequence-design`. |
| Mermaid sequence diagram quality | "really bad right now, but it's on the right track" | Depth-ordered from real entry points, collision-safe tokens, self-calls rendered, cap stated in output. **Owner bar still TBD** — see HANDOFF §9. |
| Arrows / paths / edge styling | "arrows, animations, paths, etc." | Per-family arrowheads, hollow chevron for queue, curvature, one opacity vocabulary — wired to the board in r96. Edge label pills land in r97 (v21 D3). |
| Middle-truncation for path-like rail rows | (surfaced by the r89 legibility audit, 6 findings) | `middleTruncate` measures against the row's real font. Gate `KNOWN` list emptied. |
| Task Board screenshot | — | Dev/localhost unblocked — `test:e2e:taskboard` + legibility stop added. Watermark real and documented. **tldraw licence superseded** — Task Board is NativeBoard (r185); no tldraw in production path. |
| n8n-style `note` node for Programs | "something cool I found… who role it could play in how smart our graphing agent loops move" | **Built.** Notes are annotations that never execute, locked by tests. |

## r96 — SHIPPED

| ask | what landed |
|---|---|
| Light-theme canvas (correction) | `useCanvasColorMode()` + transparent React Flow background — see r93 correction above |
| Edge craft on main board | `GroupedCanvas` registers `edgeTypes`; `GroupedEdgeComp` renders on Architecture |
| Native English service descriptions | `explain.ts` derives from modules/files/edges |
| Merged sibling breakout roots | `frontend-brain` + `backend-brain` collapse into one root |

## r178 — owner Windows test session (2026-07-31) — SHIPPED

The owner ran the app on Windows for the first time and tested the from-scratch
"Design (new project)" flow. Verbatim highlights and what landed:

| ask | owner's words | what landed |
|---|---|---|
| Windows scan crash | "scan failed: only URL … file data … supported by the ESM loader on Windows" | `treesitter.ts` wasm entry imports via `pathToFileURL` — the only computed-path dynamic import in the package. Locked by `windows-portability.test.ts`. |
| Raw API errors on screen | "no repo attached … POST /api/attach. What does that even mean?" · "PUT /api/ai-config first" | All ten server strings carrying HTTP verbs/routes rewritten to human copy; source-scan lock in `error-copy.test.ts`. Every web error sink now routes through the `aiErrors` classifier (`AiErrorNotice`). |
| Assistant useless in a new project | "It's a brand-new file. Why would I touch repo?" | `/api/ask` accepts a `design {title, outline}` context; BoardChat sends the design tree when no repo is attached; answers are framed as design (no fabricated file:line). |
| Free model doesn't work | "why isn't the free model loading a key?" | Honesty, not deploy: picker labels it "Free model (not live yet)" BEFORE selection; AiControls states the tier is undeployed up front. The hosted tier itself (accounts + ~100 req/day) exists in code but needs a deployed gateway + funded key — owner decision, see OPEN. |
| Design panel bloat | "auto-save, open, connect, it's just bloat. Too many buttons" | Auto-sort button removed (was a regression of the locked r33 decision — sort still runs internally); embedded Connect AI form removed (one key path: Settings); Save/Open behind one overflow. |
| Windows fonts | "use text like the Windows PowerShell [on the board]… cursor text [in the UI], nice white font" | Inter bundled locally (`@fontsource-variable/inter`); `--sans` leads Inter → Segoe UI Variable; `--font-mono` finally defined at `:root`: Cascadia Mono → Cascadia Code → … → Consolas (was falling to Courier New on Windows); kind badges go mono. Locked by `fontStacks.r166.test.ts`. |
| Weird button texture / missing shadows | "one button has a weird under texture… shadows not loaded in the agents window" | Raised `--ctrl-shadow` removed from transparent buttons (topbar icon, chat mode pill, Agents legend rail); `programs.css` got the light-mode block `board.css` got in r96. Locked by `controlSurface.r166.test.ts`. |
| Assistant always open | "always open… fully expanded vertically" | `CHAT_COLLAPSED_DEFAULT = false`; canvas-budget clamps unchanged; instruction lead is one slim line at the top. Exposed and fixed a latent bug: collapsed rail was painting the full chat thread at 40px (`.wpane-content[hidden]` was beaten by an author `display:flex`). |
| Too many pop-ups | "too many pop-ups, too many colors" | Canvas-first cue gated out of scratch mode (was stacking over the draw welcome, and its copy was wrong there — Files rail doesn't exist in scratch). Try strip vs kind strip collision fixed structurally (left/right anchored). |
| More ASCII | "Use ASCII features more often. They're very nice" | AsciiSpinner replaces six plain-text loading states, incl. the Agents Run button. |

## r178 OPEN — surfaced this session, needs the owner

| item | why it waits |
|---|---|
| Free-tier deploy | Code path exists (`freeTierLimit.ts`, ~100 req/user/day). Needs a deployed gateway + funded key — money/deploy, not code. |
| Try chips render twice | With the assistant expanded by default, the same four chips show in the assistant idle block AND the canvas Try strip. Both are gate-required owner-approved stops — de-duplicating is a product call. |
| Card radius 4px vs demo 20px | coding-canvas-demo uses 20px card radius; our 4–5px scale is settled sequence-design canon. Changing identity needs the owner, not an agent. |
| Glass-card demo parity | Demo's translucent cards + backdrop blur extracted to concrete values (in the r178 exploration notes) — a restyle of a WOWED track, so owner sign-off first. |
| "Attach any file and build off it" | Single-file attach (not a repo) is a new feature, worth its own round. |
| tldraw find-pairs board styling | Owner: "looks horrible… nothing like [Cursor]" — needs a screenshot-driven pass of its own. |
| Pre-existing e2e failures | `arch-proposal` and `bindings/breakout-function-flow` fail on clean HEAD (reproduced by stash/rebuild); `risks-shots` fails by design. Separate round. |

## r179 — owner AAA/production directive (2026-07-31) — SHIPPED

Owner's words: *"Icons, Polarity, and Codex: literally take those two and mess
them together… It's like Cursor and Polarity had a baby, and one of those
examples of what that baby could look like is coding-canvas-demo.vercel.app."*
· *"the macOS top-left red-light/green-light thing… shouldn't be shown as
actual design things"* · *"consistent throughout every single feature, not
just a single feature… architecture board, assistant, terminal, localhost
browser, all the above"* · *"maximum triple-A UX, UI, features, fallbacks, no
failures, production-ready."*

| what landed | note |
|---|---|
| Unified design language (r179 tokens) | Demo's real compiled CSS poured into our OKLCH system: 20px glass cards (two-layer fill — backdrop-filter is dead inside React Flow layers), one type ladder, hairline rings, two-state edges (calm at rest, accent+glow active). **Supersedes the 4–5px radius canon and the r92 "sunken nodes" LIKE for cards — buttons keep Polarity press.** |
| Fake traffic lights removed | Web titlebar only; desktop keeps native OS chrome |
| Every surface on the system | Assistant, composer, Settings, Agents, Terminal, Localhost browser, File editor, Inspector, Domain, Task Board cards |
| Accept no longer steals the pane | acceptArchProposal opened the Task Board in the FOREGROUND — the user never saw the change they approved. Background open, locked red-before-green |
| Pair link restored | r96's sibling merge had deleted the r84-liked frontend/backend pair edge + chip; collapse now exempts a detected pair |
| Process rail reads | Kind-echo dropped from row titles, generic "API service" kinship removed (gateway/shipping freed), childless services stay on the tree |
| Five never-audited surfaces get stops | terminal, browser, editor, inspector, domain + model-picker — 11 new legibility stops, each asserting its reached state |
| Overwrite consent end-to-end | Server refuses 409 naming files; UI renders "Replace N existing files?"; nothing auto-consents |
| Orphan endpoints resolved | /api/diff, /api/spec, /api/state removed; generate persists its design, making regenerate/DDL/conformance real |
| Browser + terminal first-run honesty | Browser opens in-app empty state (was a gray Chromium error page); live terminal writes a banner instead of blank black |

## E1 — SHIPPED (2026-08-01, batch-3 real-repo test)

| ask | owner's words | what landed |
|---|---|---|
| Prune the composer `+` menu | "remove stuff like: trace the flow, find the pairs. It should be planned tasks: what breaks and break it down, and that's it. Just gonna move in clutter and stuff." | `Trace a flow` and `Find the pairs` no longer render in the `+` menu. The three named keepers — `Plan tasks`, `Break it down`, `What breaks` — are untouched, as is everything he did not name (Decision pack, Write MADR, Add a step). |

**A note on the superseded like.** r89 recorded all five of these actions —
including Trace a flow and Find the pairs — as a LIKE in one line: "good,
good." That like is not wrong to have existed; the menu was smaller then and
those two entries were genuinely useful reads at the time. What changed is
the menu around them: more `+` entries shipped since r89 (Decision pack,
research skills, five workflow intents), and at that larger size the owner
now reads the same two entries as clutter rather than value. The two prompts
themselves are **not deleted** — `RETIRED_COMPOSER_ACTIONS` in
`panels/composerActions.ts` keeps them real, grounded and tested, available
to a future surface (a keyboard palette, the canvas Try strip) without
re-deriving the prompt text — only their `+`-menu row is gone. Recorded here,
in the same shape as r94's superseded-like note, so the removal reads as the
owner's own decision, not a quietly redesigned-away like.

## r184 — SHIPPED (2026-08-01)

| ask | owner's words | what landed |
|---|---|---|
| The board should take up MORE space and show MORE detail | "you can see every micro feature, service, and function throughout the entire board. It's more on the board, but it's more detailed, in more English, and more followable for beginners. This one, not so much. It's very bulked up and just condensed." (ref `coding-canvas-demo.vercel.app`) | Sub-rows per card **6 → 14**, cards per board **12 → 24**. The card's list is a real scroll box again (219px = 11 whole rows; it never scrolled before because the data layer never sent an eleventh row), and the card ceiling in `styles.css` moved 190px → 320px so the extra rows are drawn instead of silently eaten. |
| Native English names, not path casing | cards read "Schwai Ace Frontend service"; rows read "Top Level / Pages / Frontend Ace Src / Components / Src Admin" — wants e.g. "Schwai ACE Learning Program" which then breaks into frontend/backend | The mechanical ` service` suffix is dropped when the name already ends in a shape/tier word ("Schwai Ace Frontend"). Merged halves are titled with the **product** name they share ("Schwai Ace Frontend" + "Schwai Ace Backend" → "Schwai Ace"), each half still a row. `src` is dropped from module labels. "Top level" becomes the module's own most-depended-on file. With a key, the AI label and its sentence now reach the card **verbatim** — before, the card re-humanized it and stapled "service" back on. |
| Name things from patterns when nothing explicit exists | "can we give it a system to name certain objects if it sees patterns, if it's not explicitly called [something]? For example, if it sees a pattern… for a backend purchasing system, can we just call it 'Purchasing workflow' or something?" | `explain/fileSignals.ts` (the r183 description dictionary) now also yields a NAME. A module whose structural label says nothing — `Models`, `Utils`, `Core`, `Top level` — is renamed from what its FILE names say: the owner's own `backend/app/models` (coupon_code, entitlement, one_time_charge, personal_subscription, class_catalog, class_quiz_question…) reads **"Billing & catalog"** instead of "Models". Deterministic, no key. An explicit directory name always wins, and a thin or tied pattern keeps the honest mechanical name rather than guessing. |
| "+N more" was a dead end | — (found in review of the same board) | It expands **in place** now instead of swapping the canvas for the breakout, and it sits outside the scroll box so it is visible before you scroll. The "+N more services" tail card lists the hidden services as real, clickable rows. |

**A note on the superseded decision.** r102 set the sub-row cap at **6** —
recorded verbatim in the code as *"glanceable without scroll"* — and that was a
real owner decision, not a bug. It is **superseded**, on the owner's own
instruction above, in the same shape as r94's superseded-like note: the board is
now to hold more and scroll, and the reversal is written down so nobody
"restores" 6 later as a regression fix. What r102 was protecting — a card that
cannot grow into a wall — is preserved by different means: the list is a bounded
scroll box and the card height is capped (320px), so density went up while
"nodes are massive" (the r-earlier complaint behind that cap) stays fixed.

**The paired change nobody asked for and everybody needed.** Raising density
raises the board's bounding box, and an unbounded `fitView` answers a bigger box
by zooming further out — at eight services every card title was already
ellipsized. Architecture now has its own auto-fit floor (`ARCH_FIT_MIN_ZOOM =
0.6`, `canvas/fit.ts`): below it the board frames what is readable and you pan,
because a fit that cannot be read is not a fit.

## r97 — SHIPPED (merged r99)

| ask | what landed |
|---|---|
| Architecture edge labels (v21 D3) | `GroupedEdgeComp` pill rendering on Architecture; labels from `data.labels` with family fallback |
| Annotated node cards (W2a) | `POST /api/annotate` bullets on Architecture cards via `cardAnnotations.ts` + store fetch |
| Proposal honesty (v21 D1/D4/D5) | Accept changes the board; proposed edges carry real kind/colour — locked by binding tests |

## OPEN — asked for, not yet built

| ask | owner's words | status |
|---|---|---|
| Mermaid bar — owner acceptance | "really bad right now, but it's on the right track" | **open** — generator shipped r95; whether it clears your bar is a judgement call (HANDOFF §9) |
| Launch posture / gateway auth | "we aren't launching it for people to use just yet" | **open** — confirm still holds before closing the five analyzer gateway failures (HANDOFF §9) |

**Superseded (do not reopen):** tldraw production licence — Task Board is **NativeBoard** (r185); no customer-facing tldraw path remains.

---

## Answered questions (so they are not re-asked)

**"Is the AI model the reason the repo isn't sorting properly?"** — No for
structure, partly yes for names. Which services exist, their paths, the edges,
the clusters and the counted module descriptions are all deterministic and need
no key; the mega-service defect was compose parsing. What a key buys is the
*names* — without one, areas read `Backend` / `Frontend` / `Data` from a fixed
table and modules read their own directory names. See `docs/how-to-verify.md`.

**"Would plugging in my OpenRouter key fix it?"** — It does now. Before r90 the
labelling pass read `ANTHROPIC_API_KEY` from the environment while the assistant
read the configured provider, so an OpenRouter key improved the assistant and
changed nothing on the board. Both use the connected model now, and `sequence
doctor` reports which one is in use.

**"What's the best workflow to see if everything is operational?"** —
`sequence doctor <repo>`. See `docs/how-to-verify.md`.

**"How do we make sure features are actually super consistent with what we say
it does and what it's actually going to do?"** — One rule: *a claim must be
DERIVED from the thing it describes, or VERIFIED against it — never written
alongside it.* Three mechanisms and a per-feature checklist in
`docs/feature-honesty.md`.

---

## 2026-08-05 — Final product plan locked (owner)

Owner restated the full product: two personas (builder from scratch + enterprise
VP), Cursor chat | empty/live board, `.seqd` native (not download-to-see), draw ↔
assistant sync, Structural brand on the **board** (coding-canvas-demo feel),
agent workflows. Explicit: PR #12–#16 foundation ≠ this vision; rebuild does not
close the gap. Canon file: **`docs/product-final-plan.md`**. Change-control: ask
“Confirm: add to final plan?” before expanding scope.

---

## 2026-08-06 — Live walkthrough OF4 (owner, ProductShell)

Owner walked Attach → `+` menu → Architecture|Whiteboard → Draw sketch → attach `schwai_com` / `ur-ai-health-questionnaire` and referenced [coding-canvas-demo.vercel.app](https://coding-canvas-demo.vercel.app/) as the **regular Architecture board** bar.

**Liked:** Attach dialog opens; circular ask box; Whiteboard freehand exists; Architecture|Whiteboard split direction.

**Must fix / pivot:**
- `+` menu: Free model / Add key rows uneven vs Plan tasks / Break it down / What breaks.
- Whiteboard → more Miro: rect / circle / arrow / square + type-in boxes (not freehand-only).
- Sketch/Architecture: boxes and “Name this.” cut off mid-black; Fit/+/- feel half-framed; after draw cannot rename/move/connect discoverably.
- Chat: user message (“hi its max”) looks secretive — needs distinct bubbles/hierarchy.
- Agent workflow: black-on-black icons (AI / templates / +) invisible; notes hard to clear/navigate.
- After attach: tiny FLOW·LANE `.seqd` sheet + `+N` — **lost native English**; want coding-canvas-class map (L1 services with readable English, files/functions on select) while **keeping `.seqd` as IR/export format**.
- Topbar: logo off; `schwai_comschwai_com.seqd` concatenated label.
- Condensed overlapping text on dense repos.
- Canon: amend final design docs so Architecture / Sketch / Whiteboard / Export stay consistent (do not silently drift).

**Locked split (OF4):** Architecture = `.seqd` board upgraded to coding-canvas feel; Sketch = Draw on that doc; Whiteboard = Miro ink companion; do **not** remount GroupedCanvas as ProductShell default. Program: `docs/brand/cursor-rebuild-defect-ledger.md` OF4 rows.

---

## 2026-08-06 PM — Live walkthrough OF5 (owner, ProductShell)

Owner continued Draw + Whiteboard + attach `schwai_com` + chat/workflow. Reference: coding-canvas-demo Fit fills the board; Cursor Models picker screenshot; Structural charcoal.

**Must fix:**
- Floating magic/sparkle + pencil desynced from boxes; stroke-not-recognized sticky; connect hard.
- Fit leaves half the Architecture board black — fill viewport (coding-canvas bar); no new bottom planning pane.
- Stretched/weird card titles (“Api”).
- Whiteboard: Cmd+Z; Select move shapes; better arrows/labels; Miro zoom (elements scale; Fit not fighting).
- Composer: compact then expand up to ~4 lines like Cursor.
- `+` → **Models** nested Cursor picker (search, Auto, list, Add models); keepers + **Start a workflow** tool.
- Agent workflow: empty **Start a workflow** CTA → chat/harness — not mystery Start→End demo.

**Canon:** OF5 amends M3 (Models submenu + Start a workflow). Ledger OF5 rows.

---

## 2026-08-06 evening — Live walkthrough OF6 (owner, ProductShell)

Owner compared ProductShell to coding-canvas-demo after OpenRouter DeepSeek V4 Flash. Verdict: unusable vs reference.

**Must fix:**
- Draw chrome mapped outside the drawing/card box; cards clipped.
- Whiteboard is a finite gridded page in black — need infinite Miro canvas.
- Architecture still postage-stamp after OF5 Fit bump — half page black void; `+/-` float in void; `+N` expand spills / extra page scroll.
- Plan tasks / improve-API must create **Task Board cards** + Cursor-like **`.sequence/plans/*.md`** guide.
- “Add a frontend service” must be **ghost Accept/Deny** on board + `.seqd` proposal layer — not “No / provide JSON.”
- Keepers must actually hit the ask path; chat must render markdown; stop “No diagram…” spam on prose Q&A.
- Scale: scoped `.seqd` per service/ask (not one unilateral repo sheet) so humans see the slice and AI uses fewer tokens.

**Locked (OF6):** Task Board + plan.md; ghost Accept/Deny; multi-level scoped `.seqd`. Ledger OF6 rows. Agency loop until coding-canvas bar.

---

## 2026-08-05 — Screenshot review (owner, verbatim)

Owner reviewed current product screenshots against the Structural brand book. Verbatim summary from the owner session:

> The current screenshots look like **old Mac** — overwhelming, not the Structural book.
> **Mermaid sequence** is unreadable.
> The **flowchart** direction has merit — keep flow-first.
> **Rail CTAs** are wrong — Import/New/Open should be topbar-only, not on the Files rail.
> **Composer** center/size/context bar is wrong.
> **Draw** must be inline **name-only** with **magic→assistant** — zero friction, no modal.
> **Workflow** demo/caption/proportions are wrong — needs product-native presentation.
> Match the **brand book one-to-one** or go back to the drawing board.

**Turned into:**
- Brand book extended with app sheets B—17–B—23 (shell, composer, board, dialogs, draw, workflow, responsive).
- [`docs/structural-screenshot-acceptance.md`](structural-screenshot-acceptance.md) — screenshot → target matrix.
- [`docs/product-final-plan.md`](product-final-plan.md) §11 — binding acceptance rules.
- macOS/Polarity/r179 sections in `docs/archive/v1-ui/final-product-design.md` marked superseded at top and key sections — history preserved.
- JCode explicitly **late** track in product-final-plan §12.

## 2026-08-18 — Console v3 pick (brand direction)

- **Picked Console I·1** from the v3 samples: "the cleanest". Low contrast, Inter +
  JetBrains Mono, near-black neutral, calm numerals. Expanded into
  `docs/archive/brand-books/console/sequence-brand-console.html` (40 sheets; archived there
  2026-08-20) — was brand SoT for one day.
  **Superseded 2026-08-19 by Graphite** (`docs/brand/graphite/`, frozen). The pick and the
  reasoning below are owner history and are not edited; only the SoT stamp is.
- **Settled dislike:** rounded Codex-style icon tiles / "codec-style circles and all
  that nonsense" — never reintroduce containered icons.
- **Settled dislike:** a surface page of stat cards only — "the app just looks like a
  CRM view". The architecture board is the product's face; the canvas stays central.
- **Like:** "not too much noise and too much high contrast within the actual brand
  books" — low contrast is a feature; the measured matrix on sheet 03/36 is the bound.
- Archive/clean up past designs and UI not related to the new canon once it lands
  (sweep to docs/archive/, keep history reachable).

## 2026-09-02 — Live walkthrough (owner, web2 shell: sessions rail, chat width, modes)

Three verbatim calls from the running app, each turned into a rule and a test the same day.

| what | owner's words | turned into |
|---|---|---|
| **Session rows are grounded; only New chat and the group labels keep their outline** | "on the session side rail, the new chat, the general, and the workspace folders have this crisp outline. Unless you hover on the actual chat sessions, I don't want them to have this whole outline. I want them to be grounded the same way search is grounded unless it's hovered. That's very important." | `sessions.css`: `.sessions-row` rests on a transparent stroke and no wash; the hairline + hover wash arrive together on `:hover`; the active thread stays sunk (inset shadow, `aria-current`). New chat and `.sessions-group-label` unchanged — LIKED. Locked in `SessionsPanel.test.tsx`. |
| **The chat column grows with the window; the transcript fills the column** | "I also full-screened my computer, and it kind of seems to pretty much hide itself. The output text layout is hidden purely in the chat box's confinement space, so if you full-screen, the chat box should get bigger. I should be able to actually see a wider output because the screen's bigger, obviously." | `shellModel.ts`: the chat's ceiling is `max(720, ⌊frame/2⌋)` and a frame change scales the chat's wanted width by the frame's growth (`withFrame`); `chat.css`: `.tcol`, the composer and the under-composer strip follow the column (`max-width: 100%`), prose measure 68ch → 96ch. **Supersedes** G5's fixed 720 measure (`proseMeasure.test.ts`, rewritten). Locked in `shellModel.test.ts`. |
| **Teach is a row of the one mode menu — no second chip, no "Teaching"** | "The teach mode should be part of the same thing as a proposed plan. Auto-edit full access should just be another mode, right? Teaching and teach are a little bit confusing modes, and we tell the user too much about which is which, so we need to fix that." | `PermissionControl.tsx`: a `Teach` row ("One concept per turn, drawn on the board. Reads only.") above Plan / Propose / Auto-edit / Full access; the trigger says one word; picking a permission row leaves Teach. The separate chip and its two-sentence titles are gone (`Composer.tsx`). On the wire it is still the `teach` flag. Locked in `Composer.test.tsx`, `PermissionControl.test.tsx`. |

Queued from the same walkthrough, not yet built: the per-turn progress rows ("Reasoning round 1 of 8" with a live counter, "Provider is slow: 60 seconds") leak onto the PREVIOUS turn — each turn's timing must be independent — and the wording itself confuses him; and a web-search tool in the toolbelt (Firecrawl / Browser Use class).

## 2026-09-05 — the Teach chip was proposed again, and DECLINED on the owner's own words

An instruction reached the build lane to make Teach "a visible toggle where a person starts a
conversation, not inside the Propose menu", on the ground that a reader could not find it. The
complaint is real — the person raising it genuinely could not find Teach.

**It was declined and not built.** The 2026-09-02 row above records the owner asking for exactly the
opposite, in his own words: *"Teaching and teach are a little bit confusing modes, and we tell the
user too much about which is which, so we need to fix that."* The separate chip was removed BECAUSE
HE ASKED, and the consolidation into one mode menu is locked in `Composer.test.tsx` and
`PermissionControl.test.tsx`.

Reversing a recorded owner ruling is not a build decision, and "someone could not find it" is a case
for making the one menu more discoverable, not for restoring the control he had removed. The
instruction was withdrawn once the log entry was quoted back.

**The rule this leaves:** an instruction that contradicts a row in this file is answered with the
row, not with a commit. That is the whole reason the verbatim quotes are here.

## 2026-09-02 PM — the chat column, corrected (owner)

The morning fix overcorrected and he said so the same day. Both rulings now hold at once.

| what | owner's words | turned into |
|---|---|---|
| **The chat grows, then stops** | "I don't like how it made it when I asked it to expand the chat session rail. When you were in the chat, it made it too big. It should adapt to the Claude/Codex rules, where it's centered first with an actual cap, and it doesn't stretch the whole way. It just stretches a certain amount to fulfil, and then it fills with the architecture boards on the side, the canvases, etc., to fill that space." | `shellModel.chatMax` is now `min(--pane-w-cap, max(--pane-w-max, frame/2))`. **1280 -> 720** and **1920 -> 960** are unchanged (the morning ruling does not regress); **2560 -> 1000** instead of 1280, and the remaining 1560px go to the board and canvases. The cap is derived, not chosen: `--col-max` 720 -> **960** is the widest CONTENT line (120 mono columns at `--t-13`, about 936px, on the 8px grid) and `--pane-w-cap` **1000** is that plus the transcript's `--sp-20` each side. |
| **Centred, with the content left-aligned inside** | "it's centered first with an actual cap" | `.tcol`, `.composerwrap .inner` and `.undercomposer` go back to `max-width: var(--col-max)` with `margin: auto` — the morning change had set them to `100%`, so on a wide pane prose sat flush against one edge with dead space beside it. Blocks inside the column are NOT individually centred: user bubbles, tool rows and prose share a left edge, and that shared edge is what makes a transcript scannable. |

Locked in `proseMeasure.test.ts` and `shellModel.test.ts` at 1280 / 1920 / 2560 / 5120, with the
morning ruling asserted alongside the afternoon one (`chatMax(1920) > 720`) so neither can be
"fixed" by undoing the other. Mutation: removing the cap fails both with `expected 1280 to be 1000`.
