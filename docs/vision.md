# Sequence — Vision as Code (the bar the autonomous loop ratchets toward)

This document is the **eval bar**. The continuous R&D loop (see `autonomous-loop.md`)
judges every proposed change against it. A claim of "better" only counts if it moves a
checkable line below; no change ships that regresses one. This is the north star agents
read — keep it truthful.

## 1. What Sequence is

**VS Code, re-engineered for AI coding — visual-first.** Miro + tldraw + Cursor fused into
one platform. AI is already great at *writing* code; the hard, high-skill part now is
**system design** — making a system scale, handle load, stay usable, and knowing what
breaks what. Today's editors (an IDE plus a chat box that spits out files nobody wants to
read, remember, or scroll) don't help with that. Sequence does: you connect your AI / MCP /
API keys, edit code like an IDE, **and** see and shape your whole system visually — with
live dependency and compatibility ("this file fails → the whole system fails") — for an
existing repo or from scratch.

- **Who it's for.** Engineers and developers who use AI to code — which is nearly every
  engineer now: AI/ML engineers, platform engineers, indie devs, teams building anything
  from a mobile app to open source to full-scale company SaaS. Long-term: coders of all
  skill levels; **right now the focus is AI-assisted developers.**
- **The bridge.** Sequence is the bridge between *AI coding* and *system design*. You draw
  by hand and the AI converts your drawing into logic; you talk to the AI and it draws on
  the canvas with you; you keep track of every dependency and see the whole system live —
  instead of prompting architecture into existence blind, word by word.
- **The promise.** Empower one engineer to be a 100-person army — remove the Miro-then-
  ask-Claude-for-schemas-then-redraw friction, and make designing correct, scalable systems
  as easy as talking and sketching.

## 2. The moat (the north star the loop builds toward after hardening)

The differentiator is a **design-intelligence engine**: it understands correct system
design *at scale* and makes it visual and grounded. Three layers, built over time:

1. **Draw → logic + talk-to-draw** *(first slice to build).* Hand-drawn sketches and
   natural-language conversation become real, typed system logic on the canvas — and the AI
   draws back. This is the interaction moat: design by sketching and talking, not prompting.
2. **Dependency + failure-impact intelligence.** For any system, show what depends on what
   and "if this fails, these fail" — compatibility tracking that makes fragility visible
   before it ships.
3. **Industry-correct design + resilience patterns.** Knowledge of good design per domain,
   with baked-in fallbacks (e.g. real-estate infra: a failed query serves last-known data so
   the agents keep working). Correct-by-construction starters and a design advisor that
   flags weak or unscalable architecture.

## 3. The three-tier priority order (the loop obeys this)

Effort is spent **top-down**; the loop does not polish a low tier while a high one has an
open defect. **Current directive: harden tier-1 first, then build the moat (§2).**

1. **Correctness & features** — the product does what it claims, on real repos, without
   lying. A wrong edge, a silent overwrite, a crash, a dishonest error, or a *promised
   surface that misleads* is tier-1.
2. **UX & comparability** — a first-time user reaches value without a guide; surfaces are
   legible; the app holds up beside the tools it's compared to. Friction and dead ends are
   tier-2.
3. **The moat & breadth** — the design-intelligence engine (§2), depth, and reach, once 1
   and 2 hold.

## 4. Feature completeness bar (tier-1 — "the product does what it claims")

> **⚠ v2 pivot (2026-08-20):** bullets that name **Task Board**, Try chips on Architecture,
> pop-out panes, and the old ProductShell roster describe **v1 `packages/web` (deleted)**.
> Living surfaces are Chat · Architecture · Whiteboard · Sessions · Settings in
> `packages/web2` — see `docs/FINISH-OPEN-PHASE-PLAN.md` and `docs/PIVOT-V2.md`. Keep the
> bullets as the historical completeness bar; do not build them as a v2 backlog.

Each promised surface must work end-to-end on a real repo:

- **Architecture graph (unified, r45+)** — scan → **one grouped plain-English board** (no Edit/Structural
  depth toggles); evidence via compact **MADR (Markdown Architectural Decision Records)** pop-up (Context +
  rendered markdown; Components accordion with nested Evidence; Connections list) → **Open in editor**;
  Process sidebar = repo-analyzed English buckets with in-depth leaf view; **no system-flow strip** on
  Architecture (removed r68). Auto-fit never past 100%.
- **Proposal overlay (Lumen sketch-before-apply)** — ghost cards + Accept/Dismiss; **Accept** merges the
  plan to the design draft **and** (v1) queued linked Task Board cards (visible import, not clipboard/edit).
- **Agents (formerly Programs)** — compose agent graphs, **Talk to Assistant to Generate**, **Create Parallel
  workflow**, **Combine agent nodes**, drive local ACP agents against the map; inline workflow graph in Assistant.
- **Task Board (v1 — deleted)** — was a native React Flow board (r185; tldraw removed); runnable agent cards;
  multi-select **Import from Architecture**. **v2 substitute: Whiteboard** (freehand / generate), not a
  Task Board resurrection.
- **Domain model** — `validateDomain` signal; schema/store remain internal (no product UI tab).
- **Draw = design = code** — freehand/ink on Whiteboard / design paths; grows into the §2 moat.
- **Assistant** — grounded in the attached repo; BYO key or (when deployed) free tier;
  **Try chips** (v1 Architecture strip + idle peek; deleted with `packages/web`).
- **Learn tour + Docs**, **Export** (incl. grouped service-map SVG), **Settings**; v1 also had
  **pop-out panes** for Architecture / Task Board / Agents (`?popout=`).


A tier-1 feature gap = a promised surface that crashes, no-ops, or misleads on a real repo.

## 5. Correctness invariants (tier-1 — never regress; each is/becomes test-locked)

- **Analysis is grounded, not guessed.** Every edge traces to real evidence (import, call,
  manifest, proxy rule). No fabricated edges — including at the render/aggregation layer.
- **The reference fixtures keep their expected verdicts** (`pnpm grade` over `test/fixtures/*`);
  a shift must be justified in the round note, not silently moved.
  <!-- 2026-09-02: was `pnpm --filter @sequence/analyzer grade`, which does not exist and fails
       with ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT. The script is declared at the ROOT
       (`package.json:19` → `node packages/analyzer/dist/eval/grade.js`), not in the analyzer's
       own package.json. AGENTS.md forbids handing out a command that cannot run. -->

- **`validateGraph` / `validateDomain` are total** — never throw on partial or malformed
  input (incl. a `null`/non-object array element); they return their normal result reporting
  the bad input (`validateDomain` → `{ok,errors,warnings}`; `validateGraph` → errors
  `string[]`).
- **No silent data loss.** Picking a starter never overwrites a non-empty domain model or
  board. Destructive actions are guarded.
- **AI errors are honest.** The free tier, when undeployed, refuses *before* any fetch with a
  plain message; BYO-key failures keep their raw diagnostic; **no user key ever leaks.**
- **Agent nodes can always be stopped**; a disconnect force-disposes the subprocess (no
  orphans); parallel runs don't race on session state.
- **Local-first holds.** The app boots and delivers its core (scan → graph → explore → edit
  → export) with no network and no key.

## 6. UX & comparability bar (tier-2)

> **⚠ PARTLY RETIRED by the v2 pivot (2026-08-20).** The **bars** in this section — zero-to-value
> < 60s, no dead ends, one mental model per surface, legible by default, the comparability claims,
> drawing as a first-class problem — still bind. Two things in it do not:
>
> 1. **The "Look & feel" bullet below is superseded by Graphite.** "Fun, bubbly… warm rounded
>    shapes… Kodak-ish playful palette" contradicts Graphite law 1 (*never more hues than there are
>    claims*) and law 3 (*compact is the only density; airy is a defect*). It also cites
>    `docs/design-direction.md`, **which does not exist**. The visual identity is
>    `docs/brand/graphite/` plus `docs/brand/GRAPHITE-DECISIONS.md`, and nothing else.
> 2. **The r68 rows name v1 surfaces** (process rail buckets, MADR pop-up shape, Task Board import
>    picker, marketing hero) that live in `packages/web`, deleted at Wave 7. Read them as *defects
>    that must not recur*, never as a spec for where a control goes.

- **Zero-to-value < 60s:** clone → `./start.sh` → pick a folder → a legible graph, no manual.
- **No dead ends / blank panes.** Every empty surface explains the next step.
- **One mental model per surface** — no duplicated concepts (the v18 "board vs view" fix must
  not creep back).
- **Process rail readability (r68):** buckets categorized from repo analysis into plain-English product
  areas (e.g. API service → brain ace learning platform, marketing website, prompts on schwai_com);
  leaf click → in-depth Codex/Lumen-style detail, not sparse one-word rows.
- **MADR pop-up (r68):** service/Process click → immediate pop-up; Context = summary + rendered MADR
  (diagram/markdown like Lumen); Components accordion with Evidence nested inside; Connections as list —
  not a flat four-equal-sections modal.
- **Task Board import (r68):** picker includes all services **and functions** from scan; imported cards
  fit-to-fill in grid without overlapping controls.
- **Marketing site honesty (r68):** hero and screenshots match current product — unified Architecture,
  MADR, Agents workflow; no shopfront-era depth toggles or "Add your key" hero CTA.
- **Legible by default:** sane zoom, hairline structure, one accent, the LRU expansion budget
  keeping big graphs readable.
- **Comparability — the one thing we do that they don't:**
  - **vs Cursor / AI IDEs:** visual-first — you *see and shape the whole system as a graph*,
    not just chat + code files.
  - **vs Miro / tldraw / whiteboards:** the drawing becomes real typed logic, grounded in
    actual code, with AI draw→logic — not inert boxes.
  - **vs VS Code / classic editors:** re-engineered for AI coding — dependency- and
    compatibility-aware, design-first, not a file tree with a chat bolted on.
  If a surface can't *show* that difference, that's a tier-2 gap to close.
- **Look & feel — SUPERSEDED BY GRAPHITE (2026-08-20); kept as the record of what was asked for
  before the brand book existed. Do not build from this bullet.** ~~playful, not austere.~~ The identity is **fun, bubbly, hands-on** on a
  **dark** base — warm rounded shapes, friendly motion, a Kodak-ish playful palette — paired
  with an **Obsidian-style left file/graph structure**. Clean and premium stays, but the app
  should feel inviting and designer-friendly, never sterile. Evolves the v11/v19 Codex-dark
  base toward warmth + play (this cited `docs/design-direction.md`, a file that does not exist —
  the real design source is `docs/brand/graphite/`).
- **Accessible drawing is a first-class problem.** A developer opening the canvas for the
  first time with "no idea what's happening" must be able to draw, view, and edit the system
  immediately — obvious affordances, gentle coaching, ready templates, and talk-to-draw. The
  drawing surface being instantly learnable ranks with the design-logic engine, not below it.

## 7. The standing gate (authoritative — green or it does not ship)

> **Binding detail:** [`docs/release-gate.md`](release-gate.md). v1 `@sequence/web` is
> **gone** (`20d1424`); gates run against **`@sequence/web2`**. Do not invent script names
> web2 does not ship (no `test:e2e:bindings` / `test:e2e:legibility` yet).

Run by the orchestrator after every round; a round commits **only** if all pass:

```
pnpm -r build
node --test                      # per node package: schema · analyzer · acp · export · ink · mcp · desktop
pnpm --filter @sequence/web2 test
node --test tools/ci/*.test.mjs
pnpm --filter @sequence/web2 test:e2e         # when Chromium is available; else skip cleanly
pnpm --filter @sequence/web2 test:e2e:shell
```

Plus: the reference-fixture verdicts unchanged (or justified), and **no weakened
assertions** — every fix carries a *new* locking test, never a loosened one.
Legibility until a web2 harness exists: open the app and look (Seat Gates in
[`FINISH-OPEN-PHASE-PLAN.md`](FINISH-OPEN-PHASE-PLAN.md)).


## 8. Definition of "highest standard" (when the loop can rest)

Never "done," but a **stable ratchet** holds when, for a full round: the critic swarm
surfaces **no tier-1 finding**, the adversarial reviewer returns RELEASABLE with zero new
findings, tier-2 findings are all fixed or logged as deliberate scope, and the gate is
green. Then rounds shift to the moat (§2) and breadth. Regression at any tier re-opens
tier-1 priority.

**TWO GATES — correctness is necessary, not sufficient.** The gate in §7 proves the product
*runs*; it does NOT prove a human can *use* it. The loop may declare a stable ratchet only when
**both** hold: the §7 correctness gate is green, AND the **Human-Usability Standard**
(`usability-standard.md`) floor holds — a fresh vision "confused first-timer" judge + persona
runs surface no tier-1 usability finding, every shipped surface scores ≥ 4 on every rubric
dimension (Discoverability · Legibility · Learnability · Fluidity · Adaptivity · Non-confusion)
or the gap is logged as dated scope, and the task-success journeys pass. "The program runs" is
never a finish line — **the person has to succeed.**

## 9. Anti-goals (the loop must not do these)

- **Not a prompt-only box.** The point is hands + drawing + conversation + code together —
  never collapse it back into "type a prompt, get files."
- **No reward-hacking.** Never delete/skip a test, weaken an assertion, or narrow a fixture
  to make the gate pass. The gate measures the product, not the reverse.
- **Don't drift into a generic whiteboard or a generic IDE.** Sequence is the *bridge*:
  code + system-design intelligence, grounded and visual-first. Miro without the code
  grounding, or VS Code without the visual design layer, is not the product.
- **Keep it simple.** Simplicity for the engineer is a feature; complexity that doesn't earn
  its keep is a regression (see the whole v18 pass).
- **No unhonest reporting.** A round that found nothing worth shipping says so and stops —
  no manufactured churn.
