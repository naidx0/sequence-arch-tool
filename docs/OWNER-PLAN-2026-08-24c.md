# Owner plan — shell, board, inline (2026-08-24c)

**Status: LANDED 2026-08-25.** All five waves + three adversarial review rounds merged to main
(`frame-board-inline`, fast-forward at `858d6cb2`). Final gate: build green · web2 1588/1588 ·
e2e 94 checks / 11 suites · analyzer 1604/1604 · mutation 34 killed / 0 survived / 0 inconclusive.
One item UNVERIFIED AT THE SEAT: whether the post-attach fit zoom lands at a LOD rung where card
English (subtitle/annotation) is visible on a large repo — check at http://127.0.0.1:4173.

Original brief below.

Companion artifacts already on main:
`docs/design-refs/tool-trail-detached-vs-inline.html` (the comparison the owner ruled from),
`docs/HANDOFF-2026-08-24.md` (state before this program).

Housekeeping already done on branch `housekeeping/lora-docs-and-local-tooling`
(730b8c40, **unmerged — merge first**): LoRa docs deleted (owner: "I don't need them"),
`.codex/` gitignored (local-only tooling), `.agents/skills/*` tracked.

---

## §1 The rulings (to be recorded as Decisions 5–8 in GRAPHITE-DECISIONS.md)

Latest decision on record is **Decision 4**. These land in the same commit as the work they
bind — a ruling without its implementation commit is a wish.

### Decision 5 — the shell frame: chat centre, board right, sessions left, settings bottom-left
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

### Decision 6 — the board goes back to the dark-blue direction (amends Decision 2)
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

### Decision 7 — the tool trail folds inline, and work-in-progress is alive
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

### Decision 8 — the missing glyphs are authored, and the vocabulary is transcribed
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

## §2 Gap analysis — Sequence vs Codex / OpenCode / Cursor (UI polish, cleanliness, function)

Evidence: live inventory of `packages/web2` (2026-08-24), Codex and OpenCode public issue
trackers and UI PRs. Ranked by what a first-time user feels.

| # | Expectation set by Codex/OpenCode/Cursor | Sequence today | Gap action |
|---|---|---|---|
| G1 | **Persistent session sidebar** with history you can scan, rename, and return to (OpenCode session tree; Codex users revolted at flat/modal chat lists — codex#17182) | Sessions are a **modal overlay** only (`SessionsPanel.tsx` via OverlayHost); no persistent surface | Decision 5's left sidebar; carry pin/rename/delete from v1 rulings (#105) |
| G2 | **Chat-first shell** — the conversation is the home surface; canvas/files are the adjunct (OpenCode desktop view-mode toggle, floating chat panel — sst/opencode#3436) | Chat is a 392px **left column** capped at 640px; canvas owns centre and ≥ half the frame by test | Decision 5 + absorbed half-page |
| G3 | **Living status while the agent works** — named, animated in-progress lines (Cursor/OpenCode shimmer "Searching… Reading…"); a static pulse reads dead | Only a pulsing glyph (`.toolrow.running`) and a streaming cursor; no named in-progress verbs | Decision 7's animated present-progressive row |
| G4 | **Tool calls rendered as rich, scannable evidence** (OpenCode ChatUI: diffs, grouped grep, file viewers; Codex role-styling request — codex#23008: user messages must be visually distinct from agent output) | Work rows exist but sit **detached** from the prose they justify; user/agent blocks differ only subtly | Decision 7 inline fold + user-message accent review in the polish pass |
| G5 | **Readable width on wide screens** (Codex fixed-column complaints — codex#25010) | Composer/answer width bound by `--pane-w-max: 640` | Decision 5 raises the bound; keep a comfortable reading measure |
| G6 | **Board speaks English** — nodes carry name + plain-language subtitle + a way to ask "how does this work" (the owner's v1 board; `/api/annotate` already serves per-node English) | Cards have title + optional kind tag; annotation endpoint unwired; no per-node ask affordance | Decision 6 card English + annotate wiring |
| G7 | **Stable, predictable chrome** (Codex users burned by elements moving weekly — codex#18218). Lesson: place things once, decisively | Chrome is stable but sparse; the frame moves it **once, by decision, all at once** | Decision 5's one-commit rule is also a stability guarantee — no incremental shuffling |
| G8 | **Icon-clean toolbars** (owner: "I don't like the text, but I like the icon toolbar, which is clean") | Four whiteboard tools render as bare words; 37 book glyphs unexposed | Decision 8 |
| G9 | Context usage always visible (OpenCode status bar) | `ContextRing` exists on the composer | Keep; re-home gracefully in the frame |

Not adopted, deliberately: Codex/OpenCode's per-tool expandable dumps and full-screen tool
modals (the graphite book's quiet-transcript ruling stands); folder/project chat taxonomies
(one local-first repo = one workspace; sessions sidebar is enough).

---

## §3 Build plan

Claude-native chain per `docs/orchestration-protocol.md` §1: parent plans and verifies;
Explore agents map; Opus builds in phase-gated waves; Sonnet panel reviews adversarially.
**One mega branch** off main: `frame-board-inline`. The housekeeping branch merges to main
first and the mega branch cuts from the updated tip.

### Wave 0 — Record and transcribe (no behavior change)
**May touch:** `docs/brand/GRAPHITE-DECISIONS.md`, `docs/brand/graphite/_core.html`,
`docs/brand/graphite/pages/09*`, `docs/brand/graphite/pages/12*`,
`packages/web2/src/chat/Icon.tsx` + its test.
**Must not touch:** any component behavior.
- Write Decisions 5–8 (text above) into GRAPHITE-DECISIONS.md.
- Amend sheets: 12.2/12.3/12.7 (inline placement + living row), 06.x board sheets
  (state dot, selection dimming, blue flow accent), 09 (four new symbols, 70 → 74).
- Transcribe the 37 missing book glyphs into `Icon.tsx`.
- **Gate:** glyph-count test (74 in book = 74 exposed); all suites green; zero visual diffs
  in e2e screenshots.

### Wave 1 — The frame (Decision 5, ONE commit)
**May touch:** `shell/Shell.tsx`, `shell/shell.css`, `shell/shellModel.ts`,
`shell/shellTokens.ts`, `shell/shellStorage.ts`, `app/App.tsx`, `sessions/*`,
`settings/SettingsPanel.tsx` (entry point only), `tokens/graphite.css`,
`e2e/shell-boot.mjs`, `e2e/shell-overlay.mjs`, `shellModel.test.ts`, `Shell.test.tsx`.
**Must not touch:** board internals, chat transcript internals, analyzer.
- Sessions sidebar LEFT (promote `SessionsPanel` content into a persistent pane; overlay
  stays for narrow breakpoints).
- Chat CENTRE with raised width bound; board RIGHT (canvas tab switcher moves with it).
- Settings entry bottom-left; appbar slims to repo + palette + More.
- No-board boot: chat-only shell; attach opens board with the breakdown.
- Rewrite `shellModel.ts` geometry: new board-floor invariant replaces canvas-is-half;
  breakpoints recomputed; `e2e/shell-boot.mjs` asserts the NEW arrangement at
  1280/1000/760 in the same commit.
- **Gate:** full e2e suite green; `composer-over-board` + `board-furniture` still pass
  (z-order and furniture rules carry over); no console errors; owner-seat look at all three
  breakpoints.

### Wave 2 — The board speaks (Decision 6)
**May touch:** `canvas/NodeCard.tsx`, `canvas/ElbowEdge.tsx`, `canvas/flowFocus.ts`,
`canvas/canvasReduce.ts`, `canvas/lod.ts`, `Board.tsx`, `whiteboard/Whiteboard.tsx`
(toolbar only), board CSS, `rail/NodeDetailPanel.tsx`, annotate client (new),
`e2e/board-*.mjs`, board unit tests.
- Status dot channel (light hues, path/selection state) + hue-ledger amendment applied.
- Selection dims off-path (reuse `DimSpec`/`flowFocus`).
- Wire `/api/annotate`: per-node English line on the card (LOD-gated) and in
  NodeDetailPanel; locking test: annotate renders from the real endpoint shape, hides calm
  on absence.
- Toolbar: all ten tools glyph-first (Oval/Text/Link/Erase land in Wave 4 — until then they
  keep words; the map is the same file).
- **Gate:** `board-furniture`, `board-fit`, `board-lod`, `flow-plays` (contrast 4.5:1 on
  dimmed+dot states), `board-grounded` all green.

### Wave 3 — Inline trail + living rows (Decision 7)
**May touch:** `chat/Transcript.tsx`, `chat/WorkRowLine.tsx`, `chat/workRowModel.ts`,
`chat/transcriptModel.ts`, `chat/chat.css`, `state/store.ts` (in-flight verb events),
`askClient.ts`, `e2e/whiteboard-to-ask.mjs` (if row testids move), chat tests.
- Fold rows inline into the answer flow (artifact B): indented, left-rule, quieter ink.
- Live row: present-progressive verb + shimmer, driven by real in-flight events (no fake
  verbs — grounded naming from the actual tool call); replaced on landing, never appended.
- **Gate:** a locking test proves a running call renders the named live row and the landed
  row replaces it; transcript folding tests updated; contrast on shimmer ≥ 4.5:1.

### Wave 4 — Author the four glyphs (Decision 8, tail)
**May touch:** `_core.html`, `Icon.tsx`, `Whiteboard.tsx` `TOOL_ICON`, whiteboard tests.
- Oval, Text, Link, Erase authored per §09.8; `TOOL_ICON` complete; words demote to
  tooltips.
- **Gate:** whiteboard toolbar test asserts every tool renders a glyph + accessible name.

### Wave 5 — Competitive polish pass (from §2)
User-message visual distinctness (G4), context ring re-homed (G9), comfortable measure on
wide frames (G5), session rename/pin in the sidebar (G1 tail). Small, separate commits.
**Explicitly parked:** `propose_topology` deterministic lever (its own program — see
HANDOFF-2026-08-24), DEAD-route deletion, file-to-file edges (separate rows, not this
program).

### Rules that hold across every wave
- Every fix carries a locking test proven RED first, or a mutant added to
  `tools/ci/mutants.json` that re-creates the defect.
- Never weaken an assertion — redirect it and say which.
- No invented topology; board renders only what the scan produced (`board-grounded`).
- Empty+narrow layout check at every new surface; owner quote → user-seat Done when.
- `pnpm -r build && pnpm --filter @sequence/web2 test && pnpm --filter @sequence/web2
  test:e2e` before any wave is called done; `node tools/ci/mutate.mjs` at program end
  (currently 34 killed / 0 survived — must not regress).

## §4 Launch

Run the orchestrated build with this file as the plan:

```
/orchestrated-build docs/OWNER-PLAN-2026-08-24c.md
```

Merge `housekeeping/lora-docs-and-local-tooling` to main before Wave 0 cuts its branch.
