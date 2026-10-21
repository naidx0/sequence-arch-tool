# Sequence — canon

**One page.** Written 2026-08-20, at the owner's instruction: *"you have the product final idea,
what it's supposed to be, agentic platforms similar, competitors, our advantage. then our whole
design and ux (the brandbook) — clear all excess fluff, make sure agents make NO mistakes."*

**Precedence, stated exactly, because an unqualified claim here is itself a source of confusion:**

| Question | Authority |
| --- | --- |
| Anything **visual** — a colour, a radius, a size, a spacing, a component's shape | **The Graphite sheet** in `docs/brand/graphite/`. It wins over this page. |
| A **ruling the owner has made** | `docs/brand/GRAPHITE-DECISIONS.md`, as a numbered decision. |
| **Product, strategy, competitors, our advantage, process** | **This page.** If another document disagrees on these, it is stale. |

This page never restates a sheet's values, so the first two rows should never fire. If they ever
do, the sheet is right and this page is wrong — fix this page.

Every number below was measured on this repository during the v2 research, not estimated. Where a
claim did not survive measurement it is marked **✗ NOT TRUE** rather than softened, because an
agent that believes a false advantage builds the wrong thing.

---

## 1. What Sequence is

# Sequence keeps your architecture honest as the code changes.

That is the job. **Owner ruling, 2026-08-21** — it replaces "a local-first, visual-first AI code
editor" as the headline, which described the SHAPE of the thing rather than what it does for
anyone. Visual-first is still true and is now the *how*, not the *what*.

The line is lifted from a public thread asking why nobody is building an architect agent (recorded
in [`OWNER-REFERENCES.md`](OWNER-REFERENCES.md)). The thread's own strongest objection is worth
carrying next to it, because it is correct and it is what this framing survives:

> *"Infrastructure decisions require knowing what the product will become, not just what it is now.
> A coding agent can be right about today. An architect agent has to be right about six months from
> now."*

**That objection dissolves the moment you stop predicting.** "Right about six months from now" is a
forecast, and we would lose that bet like everyone else. *Keeping architecture honest* is a
**measurement**: the graph either holds the edge the model just claimed, or it does not. It is the
one thing a parsed graph with `file:line` can do that an LLM-authored map — Codemaps, DeepWiki —
structurally cannot, because a generated map cannot be a lie detector for a generator.

So Sequence does not tell you what to build. It tells you what you have, what changed, and when a
claim about it is false. The nearest thing to advice it earns is the thread's other line, and only
where the numbers are real: **an AI willing to tell you no.**

Mechanically: it reads a repository into a live, grounded architecture graph you can read, edit,
draw and reason about, local-first, with a grounded assistant and runnable agent workflows.

**The workspace is ONE live canvas.** Chat on the left drives it. An Obsidian-style file/functions
rail on the right drills into it — functions-first: click a function and the canvas re-sorts and
plays the service-to-service flow. Understanding and editing are the same page.

There is **no inspector column**. One canvas, chat left, Files right. If you find yourself
building a fourth column, stop.

**The three non-negotiables** (`docs/vision.md`, unaffected by any UI change):

1. **Grounded, not guessed.** Every edge and every claim traces to real evidence with `file:line`.
   A tool that asserts a false edge with a citation is worse than no tool — this is not rhetoric,
   it happened: `svc:gateway`'s only two inbound edges were nginx confs inside test fixtures,
   both carrying `origin: 'deterministic'`. Fixed in `2e1e0299`.
2. **Local-first.** The app boots and delivers its core with no network and no key. No fonts over
   the wire, no fabricated graph when a scan fails.
3. **Honest errors.** A turn always ends in words. Silence is the one outcome a user cannot act on.

---

## 2. The field — who we are actually against

Everything here is sourced from `docs/research/v2-architecture-and-gaps.md` §5, which measured it.
Where a row says we have nothing, that is the current state of `packages/web2`, not a slight.

### What each one is, and what it does that we do not

**OpenAI Codex** — the interface reference, by owner directive: questions about our UI are settled
by looking at it. Its review surface is the thing to beat. Five scopes as a segmented control
(Unstaged · Staged · Commit · Branch · **Last turn**), per-file accept and reject, selective
staging, revert, and **line-anchored `+` comments that feed the fix back to the agent** — which
turns review from a verdict into a steering instrument. Plus a cloud task list with change stats,
an activity view with Unread/Running/Waiting/Blocked and desktop notifications, three permission
modes in a control under the composer, and an auto-review agent that stops after three consecutive
denials.

**Claude Code** — terminal-first, and far deeper on agency than on UI. No default turn cap. Nested
subagents. 29 lifecycle events with handlers that can block. `/rewind` across 100 checkpoints,
restoring code, conversation, or both. Four memory scopes plus path-globbed rules. `claude -p` for
headless composition with Unix pipes. Its doc index runs to 139 pages across 26 groups.

**Cursor / Windsurf** — IDE-integrated agents: agent and composer modes, checkpoint-and-rewind by
clicking any checkpoint, and one sidebar unifying local, cloud, mobile, Slack and GitHub agents.

**Windsurf Codemaps** — **shipped our exact thesis on 2025-11-04**: a graph view, click-to-source,
and `@codemap` to pull the map into the agent's context. The difference is that theirs is
**LLM-generated**; ours comes from a parser with `file:line` on every edge.

### The graveyard, because it is the honest context

Visual code understanding has been tried and has not survived as a product. Sourcetrail archived
2021. CodeSee was acquired in 2024 and its domain now 404s. `repo-visualizer` archived. VS Code's
own Maps is Enterprise-only. Sourcegraph's founders left to build a **terminal** tool with no
graph. The pattern: visual understanding survives as a *free feature inside a tool that already
owns the workflow*, never as the thing you sell. Codemaps is that pattern again, inside Windsurf.

> **CORRECTED 2026-09-04 from primary sources**, via the research lane's canon proposal (named
> rather than linked: it lives in the research vault, not this repo). An earlier revision of this
> file flagged these as reported-but-unverified; the proposal cites sources and dates, so they are
> applied with that provenance rather than left in limbo.
>
> CodeSee's acquirer is **GitKraken** (2024-05-14, a capabilities acquihire). **Sourcegraph's
> founders did not leave** — the company split on 2025-12-02, both remain on the board, and
> Sourcegraph kept the graph and now sells it to agents over MCP (experimental 2025-09-18, GA
> 2026-02-25). **SCIP outlived every product built on it**, moving to a neutral `scip-code` org on
> 2026-01-09. Codemaps ships inside Windsurf under Cognition.
>
> **The lesson gets STRONGER, not weaker: the surfaces died and the index format lived.** That is
> the sequencing argument for shipping coverage-gated answering as an MCP verb before the canvas is
> finished — the durable artifact is the one other tools consume.

### The gap, ranked — what a user notices first

`docs/research/v2-architecture-and-gaps.md` §5.1 ranks fifteen. **Do not attempt breadth** — par
with Claude Code's surface is a company, not a rebuild. These seven are what a user meets in the
first session:

| | Gap | Where we are |
| --- | --- | --- |
| **P1** | Token streaming | **Shipped** (Wave 1). Both of them stream; we did not, so time-to-first-token was the whole generation |
| **P2** | Diff review as the primary surface | **Shipped** (Wave 5) — diff, per-file accept, line comments, five scopes |
| **P3** | Permission model | Control and three modes shipped (Wave 2); the rule algebra is not built |
| **P4** | Cancellation | **Shipped** (Wave 1). Stop was cosmetic on five of six AI paths, and the call was still metered after the user stopped it |
| **P5** | Node → agent context in one action | **Shipped** (Wave 3): click a grounded node, it becomes a composer chip |
| **P6** | Progress on long operations | **Shipped** (Wave 1) |
| **P7** | An agent loop that does not stop early | Partly — the round cap is still low, and the loop now always ends in words |

Still absent and honestly named, as of 2026-08-21: **lifecycle hooks** (Claude Code has 29 events
with exit-code-2 blocking on 15) and the low round cap on the agent loop. Everything else on this
list has shipped — server-side runs, an activity view, checkpoint-and-rewind, worktree handoff and
a headless entry point are all in the tree now. Breadth is still not the goal: par with Claude
Code's surface is a company, not a rebuild.

---

## 3. Our advantage — measured

> **THE ONE THING NOBODY ELSE DOES: a negative answer that knows whether it is entitled to be
> negative.**
>
> Every grounded tool can cite a line. Parsing with receipts is table stakes now, not a moat —
> a free Apache-licensed competitor ships tree-sitter parsing, `file:line` on every edge and a
> per-edge provenance tag (Graphify; reported with primary
> sources by the research lane's canon proposal, 2026-09-04, which this section is applied from —
> it lives in the research vault, not in this repo, so it is named rather than linked). What none of them
> does — and what two independent surveys, one over code tools and one over teaching tools,
> came back unable to find — is **record what the scan did not read and let that gate the
> answer.** CodeQL measures its own extraction failures and puts them on an ops dashboard;
> nothing carries that verdict into the answer path.
>
> Sequence does, and this half is checkable in this tree rather than taken from a survey:
> `scanCoverage` records the directories the walk never entered, the languages it opened and
> could not parse, and whether the file walk hit its cap; `canRefuteExtension` refuses to say
> "there is no Ruby here" unless the walk actually went everywhere Ruby could be; the premise
> check returns `unverifiable` rather than a confident no; the ask prompt tells the model what
> it must not claim; and `contextFit` says when the prompt itself will not fit the window.
>
> **That is the property every other advantage below depends on.** A blast radius over a
> truncated walk is a guess with a number on it; a diagram over an unparsed service is a lie
> drawn instead of typed. Coverage is what makes the rest of this section true — lead with it,
> demo it first, and ship it as an MCP verb before the canvas is finished, because the one
> structural artifact that outlived every Sourcegraph product was the index format other tools
> consumed, not any surface Sourcegraph built.

### Real, and structural

- **Coverage GATES the answer.** Codex and Claude Code *structurally cannot* tell you what they did
  not read. Sequence knows the digest cut at 300 of ~2,300 edges and which packages contributed
  zero.

  **The claim used to be "nothing else on the list is close", and that was too strong** — CodeQL
  reports unanalysed files, on an ops page. Reporting coverage is not unique. What no tool surveyed
  does is **let coverage decide what the answer is allowed to say**, and that is the sharper and
  truer sentence: `scanCoverage` refuses to refute a technology whose extensions sit in a directory
  the walk never entered; the premise check returns `unverifiable` — "I cannot rule this in or out,
  and here is the region I never read" — instead of a confident no; the ask prompt tells the model
  what it must not claim; and `contextFit` says when the prompt itself will not fit the window.
  Four places where a gap in our knowledge changes the output rather than sitting in a footnote.

  Two independent surveys — one over code tools, one over teaching formats — reached this same
  empty square without seeing each other's work. It is the sentence the product is organised
  around, and it is worth more than the per-edge-provenance claim beside it, which Graphify now
  ships for free.
- **Transitive blast radius in one call.** **Shipped** (`f59ff45f`). Re-measured 2026-08-21 on
  `packages/analyzer/src/scan.ts`: **113 unique files at depth 4, in ONE call** — 59 direct
  importers, 106 by depth 2. Reaching depth 2 with grep costs one lookup for the file plus one for
  each of its 59 importers: **60 round trips against 1.** **The currency is round trips, not
  tokens.**

  *(Re-measured 2026-09-18 with `tools/measure/importers-by-depth.py`, which walks every
  package's source with tests included: **97 direct importers, 167 by depth 2, 194 by depth 3,
  224 by depth 4; a grep needs 195 lookups before it can finish depth 4, Sequence one.** The
  site's charts draw these four rows. The 59/106/113 figures below were taken 2026-08-21 by a
  narrower walk and are kept for the record.)*

  *(This line used to measure `web/src/state/store.ts` at 146 files. That file was deleted with the
  v1 UI on 2026-08-20, so the claim named code that no longer exists — the exact failure this page
  exists to prevent. The advantage is structural and survived re-measurement on living code; the
  number did not, which is the point of writing numbers you can check.)*
- **Impact beside the diff.** A diff shows the change; nothing shows the change's *consequences on
  the system*. `computeImpact` and `computeRisks` already exist in `packages/schema`.
- **Diagrams that are derived, not written.** Codemaps and DeepWiki are LLM-generated. Ours come
  from a parser with `file:line` per edge. Only true while every fact reaching the model is real.
- **Degree-ranked centrality and named ambiguity.** Grep cannot rank by importance, and cannot tell
  you *which* file you meant — this repo has **17 files called `index.ts`**, and 22 filenames in all
  borne by more than one file (80 files between them). `alsoNamed` / `didYouMean` / `omitted`
  already exist in `GraphQueryAnswer` and never go silent.

  *(Measured 2026-08-21. This line has now drifted twice: "47 filenames borne by 124 files" from the
  research doc, then "32 borne by 85" after Wave 0 deleted 58 test files, now 22 borne by 80 after
  the v1 UI went. It also used to cite "7 called `App.tsx`" — there is exactly **one** today,
  because the other six lived in `packages/web`. Re-measure before you quote any of it.)*

### ✗ NOT TRUE — do not put these in a deck

- **✗ "Fewer tokens because we read a graph."** Measured **1.15×–2.9× WORSE** than a well-formed
  grep on one-hop lookups, **1.47× worse** than `rg -l` on a symbol, **10.4× worse** for
  orientation. True only for *closure*, which is why depth shipped. Never claim the shallow case.
- **✗ "We're better visually."** Sourcetrail archived 2021. CodeSee acquired, domain 404s.
  `repo-visualizer` archived. Sourcegraph's founders left to build a *terminal* tool. Visual
  understanding has only ever survived as a free feature inside a tool that already owns the
  workflow — never as the product.
- **◐ "We're better at agent workflows."** Was ✗; the reason it was false is now fixed, so this is
  the one claim on this page that moved. `runProgram` used to execute **in the browser** — closing
  the tab killed a run. Server-side runs shipped 2026-08-20 and were proven by killing the client
  as a separate OS process with `SIGKILL`: the provider was called five more times with nobody
  watching, and reconnecting resumed at exactly `lastSeq+1` off a durable log.

  It is **◐ and not ✓** because parity is more than survival. Four of the five gaps this section
  named have since shipped (2026-08-21, commit `d7bdc30e`): an activity view, checkpoint-and-rewind
  proven by restoring a real file's contents, worktree handoff against a real `git branch`, and a
  headless entry point piping 22 bytes into a second process with distinct honest exit codes.

  **It stays ◐**, because the rule this section set was "not ✓ until those exist" and one does not:
  **lifecycle hooks** — 29 events with exit-code-2 blocking on 15 of them — which is breadth, and
  breadth is deliberately out of scope. Desktop notifications are also still absent, and "Waiting on
  you" is structurally always 0: `shouldPause` exists in `packages/schema` but `programRunner` never
  passes it. **Do not upgrade this to ✓ until those exist** — "we have runs now" is not the same
  claim as "we are better at this than they are."

### The strategic note

Sequence's strongest position may be as the **MCP server Codex and Claude Code consume**, not their
replacement. `sequence-mcp` already ships **15 tools** (counted by name in `packages/mcp/src/index.ts`,
2026-09-04: architecture_changed, classify_repo, coverage, design_suggest, explain_repo,
export_diagram, find_negatives, impact, path_between, plain_tree, risks, scan_repo,
validate_diagram, whiteboard, who_calls — the doc said 8). That is not a reason to skip the rebuild — a
grounded visual client is still the product — but know which strategy a piece of work serves.

---

## 4. The design — Graphite

**The source of truth is the book at `docs/brand/graphite/`** — the substrate `_core.html`
plus 12 sheets in `pages/`, one copy. **Cite `graphite/`.** A test fails the build
otherwise. Never edit a sheet to encode a ruling.

**Owner rulings are `docs/brand/GRAPHITE-DECISIONS.md`**, as numbered decisions. Two bind today:
light is **deferred** (do not tune light values), and node kinds differentiate **without hue**.

### The five laws

1. **Every hue on screen is a claim about the world, and there are never more hues than claims.**
   Dividers, headings, rules, borders and chrome are NEVER coloured.
2. **Indigo is the accent and can never be mistaken for a verdict.**
3. **Compact is the only density.** Working type 10/11/12px. Thread rows 28px, tool rows 26px,
   controls 28px, icon buttons 26px. **Airy is a defect.**
4. **Never invent a number.** Any value the engine computes is a marked placeholder.
5. **Both themes ship at equal quality** — deferred for Sequence by Decision 1.

Plus: the Codex app is the interface reference; icons liberally, thin outline, one 1.5px stroke, no
emoji; Apple-like rounding with the circular filled send button as the signature element.

### Kind without hue — the invariant

> **Every architecture node kind must remain distinguishable with all colour removed, at every size
> the silhouette is drawn, from the radii that actually paint.**

Six kinds, six outlines: service = rounded rect · module = folder tab, dashed · datastore =
cylinder · topic = stadium · agent = chamfered corner · entry = flag. Shapes a `border-radius`
cannot express are drawn as SVG or `clip-path`, never faked with a radius that will not render.

**Why the last clause is in the invariant:** CSS scales every corner radius by
`min(side ÷ sum of radii on that side)`. On a small swatch `--r-14`, `--r-18` and `--r-full` all
paint at 9px and three kinds collapse into one shape. The book's first draft proved this invariant
against *declared* token values and passed while being wrong.

---

## 5. The rebuild — where the work is

`packages/web` is **GONE** — deleted 2026-08-20, along with the marketing site and the nine v1-UI
docs. There is no path to it and nothing to copy from. The owner: *"I just don't want us to ever
refer back to the old product and get mistaken ever."*

If you find a doc or a comment that still points into it, that pointer is dead: repoint it at
living code or delete it. Three such references survived in `packages/mcp` until 2026-08-21 purely
because the test suite that would have caught them could not be run.

**Pure modules are inherited. Rendered chrome is not.** React-free logic carries forward verbatim;
every `.tsx` is authored fresh against a sheet.

- **Decision of record:** `docs/PIVOT-V2.md`
- **Executable plan:** `docs/research/v2-architecture-and-gaps.md` — engine contract, gap list,
  wave-by-wave build order. Each section is self-contained; a builder reads one.
- **Reference implementation:** `docs/research/ml-harness-adoption.md` — the owner named
  ml-harness as an app that already does tool calling, prompting and the chat box better. Port a
  proven approach rather than inventing one.
- **Salvaged constraints:** `docs/rebuild/inherited-constraints.md` — the "why" comments lifted
  out of v1 **so nobody has to open v1 to rediscover them.** Read this instead of the old tree.

---

## 6. How agents avoid the mistakes already made here

Every one of these has cost real time in this project. They are not hypotheticals.

- **A test proven RED before the fix, or it is not a lock.** A doc lock here asserted only that a
  citation *string* appeared and never resolved it — it silently pinned three wrong citations in
  place for a whole wave.
- **Assert the invariant, not the expression.** A fix asserted `code !== 'ENOENT'` and passed
  while running nothing, because the failure had become EINVAL.
- **Cite the invariant, not the line.** Every line pin into `server/repoServer.ts` was resolved on
  2026-08-21. Of the 15 carrying a checkable anchor, **13 were wrong**: `GET /api/git/status` was
  cited at 4209 and is served at 4666, `SENSITIVE_EXACT` cited at 287-311 and defined at 343. In a
  6,000-line file that sends an agent to the wrong code, which is worse than sending it nowhere.
  Name the route or the symbol — greppable, and it survives every edit above it.
  `tools/ci/repo-server-citations.test.mjs` now enforces this and checks the routes resolve.
- **Subscribe before you await.** `close` / `end` / `exit` fire once and are never replayed to a
  listener attached afterwards. Awaiting one promise and only then subscribing to the next event is
  a race the fast side wins often: it hung `ask-headless-cli.test.ts` 5 runs in 8, and hung the
  whole analyzer suite through `terminal.test.js`. **A hang is worse than a failure** — CI reads it
  as an infrastructure timeout, so a red test becomes invisible. Give every child-process and
  socket wait a timeout, and tear the socket down in `finally`, not on the happy path.
- **Declared values are not rendered values.** See the radius rule above.
- **A hidden browser pane measures nothing.** Front the tab and force
  `document.getAnimations().forEach(a => a.finish())` before reading a computed value, or you
  measure transition start-values and report them as final.
- **CRLF on read.** `core.autocrlf=true` here. Normalise `\r\n` in any test that reads source.
- **Never pin a number that moves.** Five stale figures were found in one package by measuring.
  The node count read 1207 and 1212 minutes apart because agents were writing files.
- **Absence assertions match the comment explaining the removal.** Strip comments before matching.
- **Backslashes die in shell heredocs.** Seven times here. Use Write/Edit, or avoid the escape.
- **Search for an existing implementation before building one.**
- **The whole suite is green, and it is the baseline now.** As of 2026-08-21:
  build 0 · `pnpm -r test` 0 · tools/ci 53/53 · e2e 70 checks. Per package —
  analyzer **1221/1221**, web2 704/704 (50 files), schema 339, export 90, mcp 46, ink 18,
  gateway 17, acp 15, desktop 11. **2,514 tests, zero failures.** Any red is a
  regression YOU introduced; do not file it as "known" or "environmental".

  It was not green a day earlier: the analyzer suite could not even be RUN
  (`terminal.test.js` printed all 8 results then hung the runner for ever, so two
  lanes reported "full suite" numbers off a run that stopped at file 131 of 143),
  and once it ran it showed 26 failures that had been filed as environmental
  Windows noise. **Twenty-four of the twenty-six were real bugs**, most of them in
  the product rather than the tests:

  - `scanRepo` emitted Windows separators into node ids (`file:gateway\src\index.ts`),
    so the same repo scanned on two platforms produced different identities.
  - `resolveImport` built candidates with `path.join` against a POSIX file set, so
    on Windows **every relative JS/TS import failed to resolve** and the import
    graph came out empty.
  - The browse jail rejected every path when the browse root was a filesystem
    root, because it appended a separator to one that already ended in it.
  - `neutralizeUntrusted` inserted its zero-width space after the first character
    of a match — which on a CRLF checkout is the CR — so the prompt-injection
    defence for role markers silently did nothing on Windows.
  - `sequence explain` crashed on exit with a libuv assertion, every run, after
    printing correct output: exit 127 on every Windows machine.
  - A policy filename carrying scope (`svc:orders.json`) cannot exist on Windows —
    the write lands in an NTFS alternate data stream and the rule vanishes with no
    error. `svc__orders.json` is the portable spelling.

  The rest were tests asserting the checkout convention (CRLF snapshots) or their
  own machine (`~/.sequence/ai.json` leaking into "no provider configured"), and
  two graph-cache versions that had to be bumped because the resolver fix changes
  cached CONTENT without changing its shape. **Attribute before you fix — but do
  not assume "environmental" means "not ours". Here it almost never did.**
- **The repo is its own test corpus, so adding files can fail a test that measures it.**
  `packages/mcp`'s honesty guard compares figures written in prose against a live scan, with a 5%
  tolerance. Wave 1 and Wave 2 together added enough files to push the edge count past it — the
  guard was right and the prose was stale. A figure that is HISTORY ("the graph went from 87 edges
  to 2307 on this date") belongs in double quotes, which that guard deliberately exempts; a figure
  claiming what the repo is today does not belong in a comment at all.
- **One agent per file.** Twelve agents editing twelve files with no coordination produced three
  specifications of one control and cost a full repair cycle.
- **Never touch** `docs/lora-*` (owner WIP) or `packages/analyzer/test/fixtures/`. The fixtures and
  the old `site/assets/` marketing shots were both silently regenerated once, rewriting the owner's
  macOS paths to Windows ones — and the consuming tests still passed, so CI would never have caught
  it. (The marketing site was deleted on 2026-08-20; the fixture rule still binds.)
