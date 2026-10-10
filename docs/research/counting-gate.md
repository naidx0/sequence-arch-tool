# The counting gate — refuted on my metric, CONFIRMED on the page's, and three defects found

**Run 2026-09-05T23:35Z at `a76efd1f`, CPU only.**

> **AMENDED 2026-09-05T23:55Z, after reading the design page.** The refutation below used a
> **file-level** metric — files a glob matched against files that ran. The page's §3 specifies
> **declarations counted on disk** against tests run, and its planted case 3 is *the file no glob
> reaches*. Under the page's own metric the prediction is **CONFIRMED, not refuted**:
> `packages/schema/src/programs/catalogue.test.ts` compiles to `dist/programs/`, which schema's glob
> did not cover. **It had never run, and two of its three tests were red** — see the section at the
> end. My metric could not see it, because both of its sides came from the same glob.

## The registered prediction, and its outcome

> *the first counting run finds at least one package where ran is fewer than declared, the way the
> harness's first run found import placeholders; refuted if all nine agree.*

**Refuted.** All eight packages that declare a `node --test` script agree:

| | |
|---|---|
| packages with a `node --test` script | **8** (not nine — `api-types` has no tests, `web2` uses vitest) |
| discovered files | **331** |
| files that ran | **331** |
| packages where ran < discovered | **0** |
| packages discovering nothing | **0** |

The count is honest. Nothing is being silently skipped.

## But the run was not empty — two defects, both outside the standing gate

The three gates name `schema`, `acp`, `analyzer` and the web suite. `mcp` and `desktop` are in
neither, so nothing had run them.

**1. `@sequence/mcp` — a cap that my own scan change pushed a caller past.**
`graphQuery.ts`'s `DEFAULT_MAX_HITS_PER_DIRECTION` was measured, not guessed: 250, sized when the
hottest target in this repository had 202 importers. `ecceb7a4` made `export { x } from './y'`
produce an edge, which lifted every barrel index's in-degree — and
`packages/schema/src/index.ts` went to **251 importers, exactly one over the cap**. The busiest real
target in the repo was being answered with one caller silently omitted.

Fixed by re-measuring the cap (**250 → 320**, roughly the headroom 250 had over 202), not by
relaxing the test: `graphQueryRepo.test.ts` encodes the policy that no real target is silently
capped, and that policy is *why* the constant is measured.

A second gate then fired on the fix: a test scans `graphQuery.ts` for numbers followed by "edges"
and requires them within 5% of the live graph. My new comment said "added 251 edges", which reads as
a claim about this repo's edge count. Reworded. The gate was right.

**2. `@sequence/desktop` — every spawn test failing, for a correct reason.**
`node --test` sets `NODE_TEST_CONTEXT`; `ServerController` spawns the CLI with `{...process.env}`;
the child inherits it; and the analyzer's `userStoreDir()` guard then **refuses to resolve the real
`~/.sequence` and exits**. The health probe reported `ECONNREFUSED` at ~460 ms and the test read as
"the server would not start", which is the one thing that was not wrong.

The guard is correct — the child really would have written to a live user store, and it exists
because a hand-rolled `node --test` once did exactly that. Fixed the way the guard's own message
instructs: the test gives the child a temp `SEQUENCE_USER_DIR`. Nothing about the guard is relaxed.

After both: **331 of 331 files ran, 2,999 tests, 0 failures, exit 0.**

## The gate could not fail, until it was made to

The first version counted any pass/fail event's `file`. Node emits a **wrapper** event per file —
`name` is the file path — so a file containing no tests reported as *ran*, and so did one that threw
on import. Proved by dropping a test-less `zz-empty.test.js` into a package: **"discovered 18, ran
18", exit 0.**

A counting gate that cannot count to less than its input is not a gate. `ran` now means *emitted at
least one real test*, the wrapper is excluded, and files that produce only a wrapper are reported by
name. Re-proved: with the same empty file, **"discovered 18, ran 17 · discovered but contributed NO
test: zz-empty.test.js", exit 2**; without it, exit 0.

## The interface is the exit code

`pnpm gate:count`. **0** every discovered file ran and passed · **1** a test failed · **2** a file
was discovered and contributed no test. The numbers are for a person; the exit code is for a script.
A caller that greps this output is asking a question the exit code already answered, and greppable
output is how a red run gets pushed.

One discovery drives both the count and the run — the array that is counted *is* the array handed to
the runner, so there is no path where the two are computed from different sources. That is the shape
every fake gate in this repository has had.


---

# What the page's metric found that mine could not

**Amended after reading `design-the-counting-gate-for-sequence.md` §3 and its planted case 3.**

`ran === discovered` holds **by construction** for any file the glob does not reach: both sides come
from the glob. That is not a gate, it is a tautology with a denominator. Walking the built tree
independently found one file in 333:

**`packages/schema/dist/programs/catalogue.test.js` — built, never run.** Schema's script globbed
`dist/*.test.js dist/moat/*.test.js`; the file compiles to `dist/programs/`. The old gate reported
37 of 37 green over 38 files.

Run for the first time, **2 of its 3 tests failed**, and one is a real product defect:

1. **`BUILTIN_PROGRAMS` has 7 templates; the test asserted 5.** The catalogue grew twice with
   nothing to notice. Updated to assert the full list in order rather than a count, so the next
   template has to come past that line deliberately.
2. **`build-architecture-full` emitted `duplicate node id: check; duplicate edge id: e-check-back`**
   — a **shipped built-in template that `validateProgram` rejects.** Both halves of the composite
   (`councilAgainstRisks`, `buildArchitecture`) define a `check` node and an `e-check-back` edge, and
   the composite concatenated the bodies without namespacing. The file's own docstring called the
   result a "validateProgram-clean composite". It was not, and had not been since it was written.

   Fixed by computing the rename rather than hardcoding `check`: the two programs will keep sharing
   vocabulary, and a fix that names today's collision leaves tomorrow's. The template now validates.

The gate now walks each package's built test tree independently of its glob and exits 2 naming any
`.test.js` no glob reaches. Schema's glob was widened, so the file runs: **333 of 333, 3,007 tests,
0 failures, 0 unreached.**

## The kill number, both halves

> *Not worth it if **both**: all ten agree on the first run **and** the gate adds more than 60
> seconds to CI wall.*

**The first half is now false** — they did not all agree under the page's metric — so the clause
cannot fire whatever the wall is. Reported anyway: the gate runs in **83 s**, and CI already runs the
same suites in its "Green package tests" and "analyzer tests" steps, so as a replacement its
marginal add is near zero rather than 83 s. I did not measure CI's current wall, so that comparison
is reasoned from what it runs, not timed.
