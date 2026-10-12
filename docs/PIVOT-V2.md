# The v2 pivot — rebuild the surface, keep the engine

**Owner decision, 2026-08-20.** Max ordered a ground-up rebuild of Sequence's entire UI. His words:

> "Nuke the entire actual UX/UI, everything. Keep only the logic that we have on the background,
> and remake the entire program from scratch. The only thing I like right now is the architecture
> board. Graphite is the source of truth for everything. Graphite is just truth. Forget how it used
> to look... Make sure it can rival and defeat Codex and Claude Code... then after you find the
> gaps, create a plan based off those gaps... not only on par with the competition, but better.
> Maybe better on token use because we have graphs to read, and we're better visually and so on.
> We're better at agent workflows."

This file is the decision of record. The executable plan is
[the v2 architecture and gap plan](research/v2-architecture-and-gaps.md), written from the
research run that this decision kicked off.

---

## What is being thrown away

Everything in `packages/web` that is chrome: shells, panels, layout, components, and the
9,658-line `product.css`. 377 non-test source files across 20 directories were in scope. Nothing is
inherited — no layout, no component, no class name, no colour. "Forget how it used to look" is
taken literally.

**Done: `packages/web` was deleted on 2026-08-20**, with the marketing site and the nine v1-UI
docs. This section is the record of the decision, not a plan still outstanding. The tree now holds
`acp analyzer api-types desktop export gateway ink mcp schema web2`.

## What is kept

1. **The engine, untouched.** `packages/analyzer`, `schema`, `acp`, `mcp`, `export`, `gateway`.
   The rebuild is a new client against an existing contract. Four load-bearing harness defects were
   fixed the day before this decision (commits `3f08a003`, `0c932928`) and that work stands: the
   verify gate can now spawn on Windows, the ask digest sees the whole graph instead of 2 of 9
   packages, the agent loop carries its own evidence forward, and `who_calls` answers symbol
   questions.
2. **The architecture board.** The one surface the owner named as worth keeping.
3. **Graphite.** [The book at `graphite/`](brand/graphite/), one copy, is the source of truth for
   every visual decision, and [the owner rulings](brand/GRAPHITE-DECISIONS.md) bind: light is
   deferred, and node kinds differentiate without hue. **Cite `brand/graphite/`** — there is one
   copy (Decision 3). A sheet changes only through a numbered decision, so work built against a
   sheet cannot be silently retargeted by a later edit to that sheet.
4. **Pure logic with no React in it** — graph maths, layout, models, transforms. Code that a
   rewrite would reproduce identically is salvage, not chrome.

## Demolition is literal — the owner overruled the cautious reading

An earlier draft of this file proposed keeping the old UI alive until its replacement ran, so that
an absent owner would not return to a dead app. **He overruled it, with a better reason:**

> "It's better to just nuke it and get rid of it completely… I'm running a really detailed loop, so
> I'm not only concerned about the app failing, because that loop is just going to bring it back
> after enough iterations. I just don't want us to ever refer back to the old product and get
> mistaken ever… Even any output style, output layouts, anything from the old app: I don't want any
> of it at all, only the pure logic sections."

The risk he is managing is **contamination, not downtime**. A broken app gets rebuilt by the next
loop iteration; a surviving old surface gets referred to, copied from, and quietly reproduced. So
the old UI is deleted outright rather than deprecated, and no v2 work may cite it as precedent —
not a layout, not a component, not a class name, not an output format.

## ml-harness is the reference implementation, not just the brand source

The owner's second correction, and it changes where the rebuild takes its cues from:

> "You look at my machine learning harness app. That one has better tool calling. That one has
> better prompting. That chat box works better. It's text better locally. Everything there is
> already better, and it's also the same graphite brand book idea."

`C:/Users/<user>/OneDrive/Documents/GitHub/ml-harness` is therefore studied as a **working
implementation** of the target, not merely as where Graphite came from. Its frontend, its tool-call
loop, its prompt construction, and its composer are the reference for the equivalent surfaces here.
Where its approach is better than Sequence's, Sequence adopts it rather than reinventing.

That extends to the engine. The owner's own assessment is that even the retained logic is "a little
iffy" and "doesn't have important stuff" — so "keep the backend" means keep it as a starting point
to be measured against ml-harness, not as something exempt from replacement.

---

## The bar

Par with Codex and Claude Code on the things they do well, and better on the three the owner
believes are ours. **All three have since been measured.** Two did not survive, and they are
recorded here as they came out rather than softened — the verdicts and their numbers live in
[`docs/CANON.md` §3](CANON.md), which is the authority on our advantage:

| Claim | Verdict, measured |
| --- | --- |
| Fewer tokens, because we read a graph instead of files | **✗ NOT TRUE.** 1.15×–2.9× WORSE than a well-formed grep on one-hop lookups, 1.47× worse than `rg -l` on a symbol, 10.4× worse for orientation. True only for CLOSURE — 113 files at depth 4 in one call against 60 grep round trips to reach depth 2. Claim the closure case; never the shallow one. |
| Better visually | **✗ NOT TRUE as a differentiator.** Sourcetrail archived, CodeSee acquired and 404ing, `repo-visualizer` archived, Sourcegraph's founders gone to build a terminal tool. Visual understanding has only ever survived as a free feature inside a tool that already owns the workflow. |
| Better at agent workflows | **◐ Partly.** Server-side runs, activity, checkpoint-and-rewind, worktree handoff and a headless entry point have all shipped. Lifecycle hooks have not, so this is not ✓ yet. |

**What actually is ours, and it is none of the three above:** coverage on every answer. Codex and
Claude Code structurally cannot tell you what they did *not* read; Sequence knows the digest cut at
300 of ~2,300 edges and which packages contributed zero. CANON §3 calls this "the single strongest
thing we have and nothing else on the list is close." A rebuild that optimises for the two ✗ rows
is building the wrong product.

A previous research pass established something the plan must keep in view: Sequence's strongest
position may be as an MCP **server** that Codex and Claude Code consume, rather than as their
replacement. `sequence-mcp` already ships eight tools. That is not a reason to skip the rebuild —
a grounded visual client is still the product — but "beat Codex" and "be the grounding layer every
agent calls" are different strategies and the plan says which one each piece of work serves.

## How this document is meant to be used

Sections of the plan are written to be handed to one agent at a time without reading the rest.
Anyone starting work reads this file, then their section, then the `graphite/` sheets their surface
touches. Nothing else is required, and nothing about the old UI is required at all.
