# Sequence — Human-Usability Standard (the SECOND gate)

> **Read `docs/release-gate.md` first.** It is the binding definition of "done"
> and it supersedes any looser reading of this document. In particular: this
> standard describes how to *judge* a surface; the release gate adds the
> mechanical checks that must run before a round may claim to be finished —
> including the rendered-layout e2e, which is what would have caught the three
> rounds that were reported as done and came back with the same defects on
> screen. (2026-09-02: this named `test:e2e:legibility`, which does not exist —
> `grep test:e2e:legibility packages/web2/package.json` returns nothing. The
> shipped command is `pnpm --filter @sequence/web2 test:e2e`, whose thirteen
> suites include the layout audits; see `docs/release-gate.md` §3. The v1
> harness that owned that script name went with `packages/web`.)
> The rubric below is the second gate's *judgement*; the release gate is
> its *floor*. Scoring a surface 5/5 while the legibility sweep fails is not a
> pass, it is a scoring error.

The correctness gate (`vision.md` §7) proves the product **runs** — builds, tests, e2e, no
fabricated data, wires connected. It does **not** prove a human can **use** it. This document is
the second gate: it measures whether a real, first-time developer can **discover, understand,
and actually accomplish work** with Sequence — and the loop may **not** declare "done"/"stable
ratchet" on the correctness gate alone. It must also clear the usability floor here.

## The core principle

**"It runs" ≠ "a human can use it."** An agent that sees green tests and declares victory has
verified the machine is happy, not that the person is. The features can all *exist and be
correct* and the product still fail — because they're undiscoverable, the graph reads as an
unlabeled hairball, the drawing is clunky, or the AI answers every request in one voice. The
job is not done until **a confused first-timer stops being confused.**

## The bar (what "usable" means here)

A developer who has never seen Sequence should, with **no manual and no hand-holding**:
- open it and understand *what this screen is for* within seconds;
- reach a **legible** view of their system — labeled, sensibly colored, hierarchy obvious — not
  "a pyramid of lines I can't read";
- **find and use the drawing tools** without being told they exist, and have the drawing feel
  **fluid** (natural strokes, snapping, color that maps to meaning);
- ask the assistant for something in *their own way* and get a response that **adapts** to the
  request/voice — not one canned writing style;
- accomplish a real task (edit the architecture, draw a framework and get it built, wire two
  services) without getting lost.
The tool must **help, not confuse.** One screen, an assistant better than what they left, and
they never need another code editor.

## The four mechanisms (run every usability round)

1. **Usability rubric — scored per surface, floor to pass.** Each surface (the one canvas — view
   + Draw toggle · functions navigation · Programs · assistant · onboarding / first-run) is scored 1–5 on each dimension
   below. **Floor: every dimension ≥ 4 on every shipped surface.** A score < 4 is a usability
   finding (tier-1 if it blocks the core job, tier-2 if it's friction).
2. **Vision "confused first-timer" judge.** A different agent looks at **screenshots of the real
   rendered app** (not the code) as a lost developer and answers the standing questions below,
   scoring against the rubric. It reports what a human would say, verbatim ("I have no idea what
   these lines mean", "I can't find how to draw", "every AI reply sounds the same").
3. **Task-success journeys.** e2e that assert a **naive path reaches the goal** — measured by
   *did the user get there*, not *is the handler wired*. E.g. "attach repo → a legible labeled
   graph in < 60s / < N clicks"; "open the draw board → create + connect + label two boxes with
   no instruction"; "ask the assistant to "explain like I'm five" vs "be terse and technical" →
   the two answers actually differ in register."
4. **Adversarial persona runs.** An agent role-plays a real developer with a real goal ("make
   the auth service talk to billing"; "draw a landing-page framework — line 1 text, line 2 image
   — describe it, get code") and must complete it. If it gets lost, mislabeled, or confused,
   that's a finding — the anti-"yay it runs" check.

## The rubric dimensions (1–5, floor 4)

- **Discoverability** — can a newcomer *find* this feature/affordance without being told? (drawing
  tools, depth control, impact/risk, Programs, talk-to-draw).
- **Legibility** — labels present and clear; colors *mean* something and are consistent; visual
  hierarchy obvious; no unexplained symbols or "hairball" graph. A dev can *read* the output.
- **Learnability** — the obvious first step is obvious; empty states teach; no manual required.
- **Fluidity** — interaction feels natural and responsive; drawing picks up human strokes, snaps
  cleanly, supports meaningful color; no clunk, no fighting the tool.
- **Adaptivity** — the AI adapts to the user's *request and voice* (length, tone, technical
  level, format) rather than one fixed writing style; it reads intent, not just keywords.
- **Non-confusion** — no dead-ends, no surprise, no "what just happened"; every action's result
  is understandable; the tool never makes the user feel dumb.

## Standing questions the judge asks (every round)

1. Landing on each surface cold: *what is this screen for?* Could I tell in 5 seconds?
2. The arch graph: do the **nodes and lines have labels I understand**? Do the colors tell me
   something (and are they consistent)? Or is it an intimidating pyramid of lines?
3. Drawing: **can I tell I can draw here, and how?** Does it feel good — or clunky and unclear?
   Does color do anything meaningful?
4. Assistant: if I ask two different ways (casual vs precise, "explain simply" vs "just the
   code"), do I get **genuinely different, adapted** answers — or the same voice every time?
5. The promised flows (edit my real system, draw→describe→code, drive an agent): can I actually
   *do* them, or do I get lost?
6. Anywhere I felt **confused, lost, or dumb** — name it. That is the finding.

## Output economy & the assistant as an agent window (a hard rule, not a preference)

**Minimal textual noise.** Every word on screen must earn its place. The prompt box, the outputs,
the panels — no decorative preamble ("this is how to prompt", "you can act", "eventually you'll get
pictures"), no button-soup, no explanatory fluff that a prompt could have produced. If it doesn't
help the user do the next thing, it's noise — cut it.

**The assistant is an agent window, like Cursor** — not a designed panel. Prompt in → it acts. One
clean composer, the conversation/result, nothing else competing for attention.

**Outputs = concise, structured "job notes."** After the assistant does something, it reports like a
sharp engineer's status note, not an essay:
- **What happened** (1–2 lines),
- **What it does / found** (the substance, structured — short bullets, not prose walls),
- **Next steps** (a short list).
No restating the request, no filler, no "Certainly! Here's…". Adapt length/format to the ask
(§Adaptivity), but default to terse.

**Executable next steps run on ONE CLICK — no re-prompting.** When a next step is something the tool
can do (run this, generate that, wire these, open this file), it renders as an **action the user
clicks to execute** — not an instruction the user has to re-type into the prompt. This is the
propose→act loop: the assistant proposes the next move *and* can perform it, so the user stops
telling it what to do. (Destructive/large actions still confirm; everything else is one click.)

This is a rubric line under **Non-confusion + Adaptivity + Fluidity**: an assistant that buries the
answer in fluff, or makes the user re-prompt to run an obvious next step, scores < 4.

## Per-surface application — SURFACE ROSTER RETIRED (v2 pivot, 2026-08-20)

> **The rubric above binds unchanged. This section does not.** It scores the *v1* surface roster in
> `packages/web`, which is deleted at Wave 7 — and `docs/research/v2-architecture-and-gaps.md` §1.2
> puts the Draw toggle, Programs, Work mode, the whiteboard and the workflows surface on the **CUT**
> list outright. Read the rows below as **the shapes of failure this rubric caught**, not as an
> inventory of screens that exist. When the v2 surfaces land, re-score them against the same rubric
> and replace this list.

- **The one canvas (arch graph, view mode)** — Legibility is the make-or-break: node labels, edge
  labels, a legend the user actually sees, hierarchy, and the "why is this here" (evidence) one
  click away. The impact/risk overlays must *explain themselves*, not add more unexplained color.
- **The one canvas (Draw toggle)** — Fluidity + Discoverability: the toggle must be findable, the
  strokes must feel natural, snap, and carry meaningful color, and editing happens on the *same
  page* the user was just reading — no separate scratch surface to hunt for. This is the weakest
  surface vs the bar.
- **Functions navigation** — Discoverability + Non-confusion: the rail's functions breakdown must
  read as the obvious drill path (file → functions → click → the canvas re-sorts and the animated
  service-to-service flow plays); the animation must explain itself, and a function must lead back
  to its file and line without a dead end.
- **Assistant** — Adaptivity: prove it changes register/length/format to the request; one voice
  is a finding.
- **Programs** — Legibility + Learnability of the compose experience.
- **Onboarding / first-run** — Learnability + Non-confusion across the *whole* first session, not
  one surface at a time (the surfaces are partitioned by depth today — is that discoverable?).

## Definition of done — UPGRADED

The loop may declare a stable ratchet / "at the bar" only when **both** gates hold:
- the correctness gate (`vision.md` §7) is green, **and**
- the usability floor holds: a fresh vision-judge pass + persona runs surface **no tier-1
  usability finding**, every shipped surface scores ≥ 4 on every rubric dimension (or the gap is
  logged as deliberate, dated scope), and the task-success journeys pass.
"The program runs" is never sufficient. **The person has to succeed.**

## Anti-goals

- **No self-congratulation on green.** "It builds / tests pass / it runs" is table stakes, not a
  finish line. An agent that reports "done" without the usability floor is reporting falsely.
- **No gaming the judge.** Don't tune screenshots or cherry-pick surfaces; judge the real app as
  a real newcomer would meet it.
- **No confusing the user to look powerful.** A dense pyramid of unlabeled lines is a bug, not a
  flex. Legibility and calm beat impressive-looking complexity.
