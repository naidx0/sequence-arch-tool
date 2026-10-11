# How to check everything actually works

The owner's question: *"what's the best way to test everything end-to-end — I plug
in my OpenRouter key and see if they can all connect properly? What's the best
workflow to see if everything is operational?"*

Three commands, in this order. Each one answers a different question, and the
first two need no key and no network.

---

## The 60-second version

```bash
./start.sh                                  # boots the app (rebuilds if stale)
node packages/analyzer/dist/cli.js doctor <your-repo>   # is it operational?
```

`doctor` is the answer to the question. It runs every subsystem and prints
pass / fail / skip **with the reason**, split into the two halves below.

---

## The two halves, and why the split matters

This distinction is the thing that was being confused, so it is worth stating
plainly:

### LOCAL-FIRST — no key, no network, no model

| what | where it comes from |
|---|---|
| which services exist, and their paths | `docker-compose` / k8s / Helm / package manifests |
| the edges (HTTP, DB, queues, imports) | the parsed source |
| modules and their clusters | import graph + directory affinity |
| **module descriptions** ("12 ts files in packages/analyzer/src/server, defining acpGate, activeRoot") | counted from the parse — `describeCluster` |
| the plain-English tree the board and rail read | `buildPlainTree`, `mode: "structural"` |

**If any of this is wrong, an AI key will not fix it.** The "one Api service
swallowed the whole repo" defect lived entirely here — it was compose parsing,
nothing else.

### AI-ASSISTED — needs a model

| what | what changes with a key |
|---|---|
| service and module **names** | `Backend`, `Core`, `Src Test` → the product names the model reads out of the code |
| their one-line descriptions | replaces the counted sentence with a written one |
| the assistant, explain, annotate, flows | works at all |

**The structure is identical either way.** A key buys better *words*, never
different *facts* — the labelling pass is only allowed to rename components that
were already computed deterministically, and a returned id that was never
requested is dropped.

---

## Connecting an OpenRouter key

Settings → Connect AI, or write the file directly:

```jsonc
// <your-repo>/.sequence/ai.json   (per repo)
// ~/.sequence/ai.json             (everything else)
{
  "provider": "openai-compatible",
  "baseUrl": "https://openrouter.ai/api/v1",
  "model": "deepseek/deepseek-v4-flash",
  "apiKey": "sk-or-..."
}
```

`.sequence/` is git-ignored. The key is written to that file and nowhere else,
and `doctor` never prints it.

### Env auto-fill (Connect AI)

If any of these are set when the analyzer starts, Connect AI prefills (and the
server will use the key without writing it into the UI):

| Variable | Role |
|---|---|
| `OPENROUTER_API_KEY` | BYO OpenRouter key (preferred) |
| `OPENROUTER_BASE_URL` | optional; default `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODEL` / `SEQUENCE_AI_MODEL` | optional model id |
| `SEQUENCE_AI_KEY` | generic BYO key |
| `SEQUENCE_AI_PROVIDER` | `anthropic` (default) or `openai-compatible` |
| `SEQUENCE_AI_BASE_URL` | required when provider is openai-compatible |

The key value is never returned to the browser — only a `••••last4` mask (or a
"from OPENROUTER_API_KEY" placeholder on the form).

Then:

```bash
node packages/analyzer/dist/cli.js doctor <your-repo>
```

`ai-reach` spends exactly one 1-token request to prove the **key + host + model
id** actually answer together. The status code is reported because it is the
actionable part — `401` is the key, `404` is usually the model id, `402` is
billing.

> **r90 fixed a real gap here.** The labelling pass used to read
> `ANTHROPIC_API_KEY` from the environment while the assistant read your
> configured provider. Connecting an OpenRouter key therefore improved the
> assistant and left every service still called "Backend", with nothing saying
> why. Both now use the model you connected. Press **Scan** after connecting one
> — the labels are applied at scan time, not at render time.

---

## The developer gate (before claiming a change is done)

See `docs/release-gate.md` — it is binding. Short form:

> **Package note (v2 pivot).** `@sequence/web` was **deleted** (`20d1424`). For v2 work run gates
> against **`@sequence/web2`**. See `docs/release-gate.md`. web2 has no `test:e2e:legibility`
> script yet — until it ships, open the app and judge legibility by eye.

```bash
pnpm -r build
pnpm --filter @sequence/web2 test              # vitest
(cd packages/analyzer && pnpm test)            # node --test
pnpm --filter @sequence/web2 test:e2e          # when Chromium is present
pnpm --filter @sequence/web2 test:e2e:shell
```

Then **look at the running UI** (and `tmp-shots/` if you capture any) — do not invent a
legibility script name that does not exist.

### A green local run is not a green CI run — three ways it lied on 2026-09-02

All three cost a red `main` in one afternoon, and none of them was visible from a passing local
gate. If a change touches a test that reads the repository, or a card's geometry, or a process,
read this first.

**1. A "real repo" claim must name WHICH real repo.** `.sequence/graph.json` is **gitignored**.
`loadRealRepoScan` reads it when present — that is the *clustered* graph the running app built,
with ~30 module nodes. A clean checkout has no cache and falls back to a live scan with
`cluster: false`, and **module nodes ARE the clusters**, so the fallback graph has none and every
file hangs directly off its service. Seven anatomy locks therefore passed for anyone who had opened
the app and failed for everyone else. Pass `{ cluster: true }` when a test depends on modules, and
before pushing any real-repo test:

```bash
SEQUENCE_WEB2_FRESH_SCAN=1 pnpm --filter @sequence/web2 exec vitest run <path>
```

That flag already existed for exactly this and reproduces CI's environment locally — a nine-minute
round trip becomes thirty seconds.

**2. If a lock's precondition is a race, write the precondition.** `sessions-pin`'s "a real board
edit advances `updatedAt`" needed two writes inside one millisecond. It reproduced on the Linux
runner and passed on Windows *with the bug reverted* — a test that asserts nothing on the machine
the work is done on. The precondition was never speed; it was `updatedAt` sitting ahead of the wall
clock. Writing that state directly (stamp the row a minute ahead, then edit) is deterministic
everywhere. **This checkout lives in OneDrive**, which can produce that state on its own.

**3. A test that asserts the DECLARED box cannot see what the card PAINTS.** An open Anatomy card
painted outside its React Flow box; every card on the board under-declares by 18 units. No suite
catches this because the suite asserts the declaration. Measure the live DOM:

```js
const vp = document.querySelector('.react-flow__viewport');
const k  = new DOMMatrixReadOnly(getComputedStyle(vp).transform).a;   // viewport scale
const node = /* the .react-flow__node */;
parseFloat(node.style.height)                                        // what LAYOUT was told
node.querySelector('.node').getBoundingClientRect().height / k       // what the READER sees
```

> **Do not use the wrapper's `getBoundingClientRect()` for the declared height.** On this board it
> reads **19** while the inline style says **236** and the child paints **262** — the wrapper's rect
> does not reflect the box React Flow lays out with. Two of us independently reached a wrong
> conclusion from it on 2026-09-02, once panicking at a ~224 overflow that does not exist. The
> declared height lives in `node.style.height`; the painted height must be divided by the viewport
> scale before the two can be compared at all.

**A pattern behind all of these.** Four times in one day the *check* was wrong rather than the thing
it checked: a rect that measures a different box than the layout uses; a DOM scan filtering for
`attach|repo|open` that missed the control because its text is the repository's **name** and the
meaning is in the `aria-label`; a lock racing a millisecond; a fixture reading a gitignored cache.
Before reporting something broken or absent, confirm the instrument reads what you think it reads —
ideally by making it report a value you already know.

**Known suite hazards.** Two suites fail for reasons that are not the code. Both have cost a red
gate more than once; check here before diagnosing.

1. **`terminal.test.js` — "closing the socket kills the shell child"** can leave a shell alive when
   it fails; `node --test` then waits on it and the whole analyzer suite hangs until the 25-minute
   job timeout, reporting *cancelled* rather than *failed*. Its own comment records the same hang
   once before on Windows, where two lanes read "full suite" numbers off a run that had silently
   stopped at file 131 of 143. **A CI run cancelled at ~25 minutes with no failure line is this** —
   re-run the identical commit before believing it is a regression.

2. **`program-server-runs.test.js` — "the concurrency ceiling refuses with a number"** fails on
   Windows under `pnpm -r test` with `EPERM, Permission denied` on its `seq-prun-*` temp directory.
   It is a file-lock race between the recursive runner's concurrent packages, not a defect: the same
   test passes 19/19 run alone, and the whole analyzer suite passes 2012/2012 run alone. **Confirm
   by re-running the file by itself** before touching anything:

```bash
cd packages/analyzer && node --import ./dist/test/isolate-user-store.js --test dist/test/program-server-runs.test.js
```

Neither is a reason to weaken a test. If either starts failing *alone*, that is a real regression
and this note does not apply.

**A THIRD, and it is the one that lets a red gate be reported as green.** `pnpm … test | tail -25`
reports **tail's** exit status, not the test runner's. A session ran exactly that, read a clean tail,
and told the owner every gate was green while a failure sat in output it never printed. The same
trap catches `| head`, `| grep`, and any other pipe.

```bash
pnpm --filter @sequence/web2 test; echo "exit=$?"     # the status you care about
pnpm --filter @sequence/web2 test > /tmp/w.log 2>&1 && echo ok || tail -40 /tmp/w.log
```

Capture to a file and branch on the exit code. If you must pipe, `set -o pipefail` first. And chain
a push with `&&`, never `;` — a `;` runs the push regardless, which is how a red `tools/ci` reached
origin earlier the same day.

**Also worth knowing:** `test:e2e` exits 2 with *"dist/index.html is missing"* on a stale build —
rebuild before believing it; and `@sequence/analyzer`'s *"terminal WS spawns a repo-scoped shell and
round-trips a marker"* is a ~5s shell-spawn test that flakes under load and passes on a rerun.

### The in-app Browser pane does not restyle on script mutation

Measuring the running app through the Browser pane is the right instinct, and **reads after a page
load are trustworthy** — a rebuild plus `navigate` produced correct, changed geometry every time
(244 treemap cells becoming 8, a card's declared height moving 190 → 236 → 45).

**What is NOT trustworthy is any measurement taken after script changes the DOM.** Proven with a
control, not inferred:

```js
wb.style.setProperty('padding-top', '77px');
wb.getAttribute('style')            // "padding-top: 77px;"   ← the write landed
wb.style.paddingTop                 // "77px"                 ← and reads back
getComputedStyle(wb).paddingTop     // "6px"                  ← but nothing recalculated
```

The same probe on a second element returned its own stale value, so this is the pane, not the
element. **An entire line of investigation — perturbing `--sp-2`/`--sp-4`/`--sp-6` to see which one
a padding followed — returned "none of them" for every card, which is what a style engine that is
not recalculating always returns.** Two hours of a hunt rested on it.

**PRECISELY WHAT DOES AND DOES NOT WORK** — the first version of this note said "frozen style
engine", which is too strong and was corrected the same day by a counter-example:

| | works? |
| --- | --- |
| read after `navigate` / reload | **yes** |
| read after a real user interaction (a click that makes React restyle) | **yes** — a board zoom from 1.0 to 0.619 recomputed a pseudo-element's width from 26 to 38.75 |
| read after `element.style.setProperty(...)` in the same call | **NO** — the write lands, `getComputedStyle` ignores it |

So the rule is narrower and more useful than "the pane is broken": **drive the app, don't poke the
DOM.** Click the control, reload the page, rebuild and navigate — then read. A synchronous
script write followed by an immediate read is the one shape that lies. If a question genuinely
needs direct mutation, take it to the real-Chromium harness
(`packages/web2/src/canvas/boardRendered.test.ts` runs Playwright at
`--force-device-scale-factor=1` over the real components) and assert there.

Related, same pane: `requestAnimationFrame` never fires while the pane is hidden, so a double-rAF
settle hangs until the 45-second tool timeout. Read synchronously.

### A floor computed in a transform is quantised, and can land under itself

Counter-scaling a hit target against the board zoom — `calc(var(--target-min) / var(--board-cam-z))`
— is exact on paper and wrong in the browser. Measured at 0.619 zoom: the exact answer is **38.7722**
board units, Chrome quantised the computed length to **38.75**, and 38.75 × 0.619178 = **23.9931** —
under a 24px floor by seven thousandths of a pixel.

No reviewer catches that by reading the arithmetic, because the arithmetic is right. **A floor has
to absorb its own rounding**: carry a `--w-hair` of headroom in the numerator and assert the
measured product, not the formula. And assert the **unit** before the magnitude —
`Number.parseFloat('100%')` is `100`, which sails past any `>= 24` check, so a bare numeric floor
silently accepts a percentage. Both mistakes were made here on the way to the fix.

---

### Running `node --test` yourself skips the package's own harness setup

A package's `test` script is not just a file list. `@sequence/analyzer` runs

```
node --import ./dist/test/isolate-user-store.js --test dist/test/*.test.js dist/moat/*.test.js
```

and the `--import` is load-bearing: it redirects the user store so a test run cannot read or write
the developer's real `~/.sequence`. Hand-rolling `node --test dist/test/*.test.js` — to exclude a
slow file, or to run a subset — silently drops that hook **and** the `dist/moat` half of the suite.

Measured 2026-09-03: a hand-rolled sweep over 232 files reported **10 failures**, which read exactly
like regressions from the change under test. They were not. One assertion said so in as many words —
*"the test run is pointed at the real user store — is the isolate --import still in the test
script?"* — which is a test doing precisely its job. Re-run with the hook and the same tree is
**2000/2000**.

**Read the package's `test` script before running a subset, and keep every flag it carries.** The
same applies to `node --test <dir>`, which resolves the directory as a module and dies with
`MODULE_NOT_FOUND` before running anything — a red exit code that says nothing about the code. Both
mistakes were made on the same day, and both produce a confident red that is entirely about the
invocation.

**Two files are excluded from a full local run on purpose**, and excluding them is what tempts the
hand-rolled command in the first place: `terminal.test.js` can hang the suite to a 25-minute timeout
reporting *cancelled*, and `program-server-runs.test.js` fails with `EPERM` under `pnpm -r test`
concurrency while passing 19/19 alone. Exclude them by name from the real script's argument list —
do not rewrite the command.

---

### THE FIRST LAW: a gate you cannot make fail is not a gate

Four separate checks were found on 2026-09-02/03 that had been **written down, believed, and never
enforced**. None of them could have failed if the thing it guarded broke, and every one read as
green protection:

1. **Three anatomy locks pinned numbers instead of properties** — "all analyzer modules share one
   path", a ratio `> 0.28`. They went red because the codebase *grew*, not because anything broke,
   which is worse than no lock: it trains everyone to expect that suite red and push past it.
2. **The teach contract's "EXACTLY ONE check-in question" lived only in the prompt.** The grader
   checked that a reply *ends* with a question and never counted them, so the rule the wording
   existed to enforce was unenforced the whole time.
3. **The teach bench called a four-argument grader with two arguments.** `readBasenames` and
   `visualThisTurn` were `undefined`, and both rules that use them are guarded against exactly
   that, so the visual bounce and the cite-without-reading bounce had never fired in a single
   benchmarked turn. JS arity is silent; the grader is TypeScript and would have caught it.
4. **That same bench re-implemented the rule it was benchmarking**, and the copy drifted — it
   counted a ```mermaid fence the product refuses and any fence holding `-->`, so a lesson showing
   one arrow function scored a visual. It measured a laxer contract that nothing enforces.

**So: when you add a gate, prove it fails.** Break the thing it guards on purpose, watch the gate go
red, then fix it and watch it go green. A gate only ever observed passing is indistinguishable from
a gate that cannot fail — and the four above are what that looks like in practice. This is already
the repo's habit for bug fixes ("a test built from the reported shape that fails before the fix");
the rule is the same one, applied to the check itself rather than to the bug.

Two corollaries these four earned:

- **Pin the property, not the number.** A lock that reads `> 0.28` or `=== 1` fails on growth. "Some
  path is shared by more than one module" and "a path key draws fewer cells than an id key" say the
  same thing and survive a repo that gets bigger.
- **One definition, in one place.** Two copies of a rule — a grader and a bench, a TS constant and a
  CSS token — do not stay equal. Have the second ask the first and read its answer back.

---

### THE SECOND LAW: absence of a signal is not evidence of absence

The first law is about a check that does nothing. This one is about a check that says something
**false**, which is worse, and it is a different failure: every instance turns a gap in **our**
knowledge into a confident claim about the **world**.

Five instances, all independent, and in four of them the honest signal existed and was one field
away:

1. **The datastore gate** — "found no engine" against "could not check". The original, written down
   before anyone named the pattern: `joinAll` mints datastores that deliberately claim no engine, so
   gating on `datastores.length` reported SQLite as unsupported on a SQLite repo.
2. **The file-walk cap** — "zero `.py` nodes" against "the walk stopped at 20,000 files". Without the
   gate, a 25,000-file monorepo is told its Python backend does not exist.
3. **`unfollowed` returning `[]`** — "looked, and everything was readable" against "never opened it".
   Measured on this repository 2026-08-22: 59 tracked source files absent from the graph, none of
   them parse failures, while `unfollowed` reported `[]` throughout. The graph asserted full coverage
   over files it had never opened.
4. **Absent coverage fields** — "not recorded" read as "full coverage". An older persisted graph has
   neither `unfollowed` nor `unscanned`; `undefined` and `[]` are different answers and must not
   share a boolean.
5. **The one that shipped, briefly, on 2026-09-03.** The question-premise check reasoned "no `.py`
   file node, therefore no Python" while gating on the cap alone. This repository's own live scan
   records `unscanned` holding `tools` (68 files, `.mjs` `.py`) and `examples` (6 files, `.py`
   `.ts`) — **there is Python here, in directories the walk never entered.** The check would have
   told a user their repository has no Python, about code the scanner never opened. Found by reading
   `.sequence/graph.json` rather than the types.

**So before reasoning from something missing, ask whether the instrument was in a position to see
it.** `scanCoverage(graph)` in `@sequence/schema` is that question asked once, over all three
signals — the cap warning, `unfollowed`, and `unscanned` — returning `complete` / `partial` /
`unknown`. `canRefuteExtension(coverage, ext)` answers it per extension, because partial coverage
does not disqualify every question: a scan that never entered a directory full of Ruby still knows
whether it saw Python in what it did walk.

It is one function for the same reason the bench stopped re-implementing `hasVisual`: **two features
had already derived this separately in one night** — the premise check and W3's `graph-gap` verdict
— and the third derivation is the one that gets it subtly wrong.

**The corollary for anything user-facing:** a tool that can tell *"you are wrong"* from *"my model
does not cover that"* is telling the truth about its own limits. A grader without that distinction
marks a correct answer wrong and blames the person, which is worse than not grading at all.

---

### THE THIRD LAW: denominators travel with the number

The first law is about a check that cannot fail. The second is about a gap read as a fact. This one
is about a number that was **true when it was measured** and is quoted after the thing it measured
changed underneath it. Nobody lied, nothing was guessed, and the sentence is still wrong.

It is not a corollary of either. A stale measurement passes every gate — it is a real number from a
real run — and it asserts nothing about an absence. It is the third way a careful person publishes
something false.

**Instances already in this repository:**

1. **The anatomy lock pinned at `> 0.28`.** Correct the day it was written. The denominator grew,
   the ratio fell to 0.262, and a lock that red-lines because the codebase got bigger is worse than
   no lock: it teaches everyone to expect that suite red and push past it.
2. **`visual present 13.8%`** in `docs/teach-mode.md`. A true measurement — of a bench calling a
   four-argument grader with two arguments and carrying its own laxer definition of "visual". True
   of that pipeline, quoted as a fact about the contract.
3. **`conversations clean 52 / 54`.** Also a true count: `54 − 2`, the runs that did not crash. The
   number was never wrong; the label was. The contract-clean figure is 27/54 and *even that* is an
   upper bound, because two rules were off when it was taken.
4. **`sequence-mcp already ships 8 tools`** in `docs/CANON.md`. True once. Fifteen when counted on
   2026-09-04.
5. **From the ML Harness lane:** 3 of 47 judge confabulations, measured — then a new extractor
   changed what reaches the judge, and only 1 of the 3 still does. A rerun is bounded at 1 of 20,
   so "3 of 47" describes a pipeline that no longer exists.

**The rule, made mechanical:** *a number in a doc carries its denominator and the commit it was
measured at, or it is a claim rather than a measurement.* Two questions answer it — what was
counted, and over what, under which pipeline. A figure that cannot answer both is prose wearing a
decimal point.

**It is the sibling of "pin the property, not the number", not a repeat of it.** That corollary
governs *tests*: a lock should assert the property the number stood in for, so growth cannot redden
it. This governs *published numbers*, which cannot be rewritten as properties — "13.7%" has no
property form. The fix there is provenance, not paraphrase: say what pipeline produced it, and mark
it void when that pipeline changes. The MCP entry above now lists all fifteen tool names for exactly
this reason, so the next count is a diff rather than another recount.

**And the laws apply to the people writing them**, which is worth stating because all three were
written by people who had just broken them. The tripwire for W3 was red on arrival — it tripped over
its own prose about the identifier it was watching for. The bench that measures the teaching
contract did not measure it, twice. The research lane's own summariser hallucinated *during a search
about hallucination* (`specs/judge-hallucination-search.md`): the instrument measuring the defect
exhibited it. None of that is irony to enjoy; it is the reason the laws are written as checks rather
than as intentions.

---

## What each command is for

| command | question it answers | needs a key |
|---|---|---|
| `./start.sh [repo]` | "does it run for a user?" | no |
| `sequence doctor [repo]` | "is every subsystem operational?" | optional |
| `pnpm -r build` + suites | "did I break the model?" | no |
| open the app / visual look | "can a person read the screen?" (until web2 legibility e2e ships) | no |

If `doctor` is green and the screens look readable, the remaining risk is taste — which is
what screenshots and your own eyes are for.

## The fourth law: a rule that lives in two handlers is ONE rule until it is measured

Earned three times in one session (2026-09-05), each time the same shape and each time invisible
until something outside the code was measured:

1. **`teachContext`** was assembled twice — the ask handler from `lesson.json`, the bench from
   memory. The product passed `lessonDone: {}` where the bench passed neighbours, so the belt took
   its other branch on the turn shape of 10 of 20 bench conversations.
2. **`reasoningEffort: 'none'`** was landed on `/api/ask` and not `/api/ask/stream`. Every seat test
   drives the stream route, so the run that "refuted" it was measured on a path that never had it —
   and the Ollama log showed those turns generating 8,000 to 14,700 tokens a call.
3. **The entire lesson** — thread resolution, read, create, write — existed only on `/api/ask`,
   while the web client drives `/api/ask/stream`. No `lesson.json` was ever written for a real user
   turn, and every lesson-state number on record described a path nobody takes.

**The rule.** Two handlers that implement one behaviour are two behaviours. Believing otherwise is
what let all three ship. So:

- **Unify the assembly** where the code allows it — one exported function both call, so the second
  route gets the behaviour BY CONSTRUCTION rather than by copy (`server/teachTurn.ts`).
- **Gate it per route** where it does not — a source scan that slices the file per handler and
  asserts each slice, so a neighbouring handler's copy cannot satisfy the check for its neighbour
  (`test/ask-teach-context-equivalence.test.ts`).
- **A gate on half the behaviour is not a gate.** The reasoning-only version of that scan passed
  while the stream route had no lesson at all: it narrowed a turn it never gave a concept to. A
  route must BUILD the turn and FINISH it.

And the corollary that cost the most time: **a bench that calls the pipeline directly measures the
pipeline, not the product.** Every number it produces is a claim about the handler only insofar as
the handler assembles the same input — which is a thing to be tested, not assumed.

## The fifth law: a clause comparing rates across arms of different lengths measures composition, not quality

Registered before the ceiling condition ran: *the teach contract does not move — the check-in rate,
the chart rate and the stub rate stay within the control's own range.* The condition under test was a
**longer conversation**. So the clause compared per-turn rates across arms whose number of turns the
condition itself had changed, and a per-turn rate is an average over whatever turns are in the arm.

It duly refuted: check-in 4–6% against a control of 11–14%. And the contract had not moved at all.

| | stub | chart | check-in |
|---|---|---|---|
| control, all turns | 11–14% | 64–68% | **11–14%** |
| treatment, all turns | 6–17% | 69% | **4–6%** |
| treatment, **first two turns only** | 0–8% | 69% | **8–12%** |
| treatment, **the added turns alone** | 12–27% | 69% | **0%** |

On the turns the control actually has, every rate holds. The whole fall is the added turns, which ask
nothing while still drawing at the same 69% — a real finding, and the opposite of the one the clause
reported.

**The rule.** When a condition changes how many turns, files, rows or calls an arm contains, a rate
over all of them is not comparable to the control's. Compare **absolute counts on matched positions**
(the first N turns of every arm), or state the rate over a denominator the condition does not touch.
A clause that fails this way fails *loudly and wrongly*, which is worse than one that cannot decide:
it produces a refutation the data does not support, and a reader who trusts the registration inherits
it.

**And the registration is the place to catch it.** The bands were written before the run, which is
what made the flaw visible afterwards — the clause was on record, so it could be checked against what
it actually measured rather than quietly reinterpreted. A band written after the numbers would have
been adjusted instead of refuted.

## The sixth law: a kill number must be a quantity the change can move

Twice in one day a registration set a threshold on a number the build it governed could not touch.

- **The ceiling condition's clause 4** required the teach contract's per-turn rates to hold — while
  the condition under test lengthened the arms, changing what a per-turn rate averages over. It
  refuted, and the contract had not moved.
- **The carry's kill number** required repeated prompt content to fall from 99% to under 40% — while
  the repeated content *is* the digest and the instruction belt, which a carry does not touch. The
  carry adds tokens. Measured after wiring: 100% → 97%.

Both failed the same way: **a number chosen for the finding rather than for the build.** The finding
was real in each case; the threshold belonged to a different change.

**The rule.** A registration states **which quantity the build touches** before it states a threshold
on it, and a threshold on any other quantity is a watch-line, not a kill. Writing them in that order
makes the mismatch visible while it is still cheap: "the carry touches the tokens a turn *adds*, and
does not touch the digest" is a sentence that cannot then carry a 40% kill on the digest's share.

**Its corollary is the fifth law's neighbour.** The fifth says a clause must not compare rates across
arms the condition reshaped; the sixth says a clause must not name a quantity the change never
reaches. Together they cover the two ways a band can refute something nobody built.

## Two rules from 2026-09-07, both bought with a defect

**A kill number stated against a constant assumes a value it should derive.** The belt re-run's
clause read *"3 or more in both treatment runs, against a control maximum of **1**"* — and the
observed control maximum was **0**. Moot at a treatment of 0, but the form is wrong: the threshold
should be a function of the control the run actually produced, not of the one the registration
expected. **State the kill as a function of the observed control maximum**, and the
under-determination disappears.

**A check's can-fail case is not a formality — it is the only part of the check that has been
tested.** Two lanes wrote a table-arithmetic gate within an hour of each other and both gates were
quietly broken: one treated the header as a body row so every column looked uncountable and the
corpus test passed while checking nothing; the other skipped any column holding one unparseable cell
and printed a green. Neither was caught by review. Both were caught by a planted failure.

**The corollary, which is the part that is easy to lose:** the plant must be built from the failure
itself, not from a description of it. The plant that caught the vacuous checker was the published
table reproduced verbatim, rows and total. A plant written from *"a table that does not add up"*
would have used a clean two-column example and passed.

## A check has two scopes: WHAT it examines and WHEN

Both must match the claim, and 2026-09-08 produced one failure of each on the same blocker.

**Half the subject.** A build-staleness guard reads two halves — the server's `dist` and the client
bundle — and the pre-flight check written to anticipate it compared `analyzer/dist` against
`analyzer/src` and reported *"build current: yes"*. The client bundle was behind, because a test file
edited after the last web2 build counts as a source. **The guard was right and the check that was
supposed to anticipate it was half-blind.**

**Half the timeline.** A second reader compared *both* dists against *both* sources, found nothing
stale, and concluded a rebuild would not clear the refusal — **measuring after the rebuild had
already landed.** That is not a stale observation, which is a true statement about an old state. It
is **an observation of a state that had already changed, offered as evidence about the earlier one**,
and the repair had erased the evidence for its own necessity.

**The rule both give:** a measurement's *scope* and its *instant* are separate claims, and a check
that gets either wrong reports confidently. Timestamp what you measured, and say which state you
measured it in — especially when the thing you are checking is whether a repair was needed, because a
successful repair destroys the evidence that it was.

**The corollary for a log:** this is why `intent=` had to exist on the arm log. Four lines written by
deliberate exit-proving runs read exactly like four failures, and the file could not say which state
of the world it was recording.
