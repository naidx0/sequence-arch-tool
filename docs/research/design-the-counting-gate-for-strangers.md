# The counting gate as something another repository can adopt

**Written 2026-09-06, before anything is built. Nothing here is implemented.**

Max's direction is that people should be able to build their own harness tools. This page asks what
stands between `tools/ci/counting-gate.mjs` and a stranger's repository, measured rather than
estimated, and what the first thing to build is.

## What exists

`tools/ci/counting-gate.mjs`, **236 lines**, and it is already far more portable than the vault's
brief assumes:

- **Four imports, all node builtins** — `node:fs`, `node:path`, `node:test`, `node:url`. **No
  Sequence import of any kind.** Nothing to strip.
- **It does not hold a list of packages or globs.** Each package's declaration is read from that
  package's own `package.json` `test` script, "so a package that changes its globs is counted
  against its new declaration and not against a copy of the old one that lives in this file". A
  stranger's package.json works the same way.
- **One discovery drives both the count and the run**, so the two cannot disagree by construction.
- **The unreached-file walk**: each built test tree is walked independently of the glob, which is the
  half that catches a file no glob reaches — the shape that hid a shipped template in this repository
  for as long as it existed.
- **`ran` means emitted at least one real test**, not "the runner mentioned the file". Node emits a
  wrapper event per file, so a test-less file once reported as ran and the gate printed
  *discovered 18, ran 18, exit 0*.
- Exit **0 / 1 / 2**, with 2 meaning *this run does not describe the tree*, read before pass or fail.

Tonight it reported **3,025 tests over 335 files, 335 of 335 ran, 0 unreached**, in about 80 seconds.

## What a stranger gets today

They copy one file into a repository that is not this one, and **three literals decide whether it
works**:

| line | what it assumes | what a stranger sees |
|---|---|---|
| `ROOT = path.resolve(HERE, '..', '..')` | the script lives at `tools/ci/` | a repo root two levels up from wherever they put it — silently wrong, not an error |
| `fs.readdirSync(path.join(ROOT, 'packages'))` | a `packages/` workspace directory | **a throw** on any repo without one: a flat repo, a `src/` repo, a Cargo-style layout |
| `if (!segment.startsWith('node '))` | the test script invokes node's runner | vitest, jest, mocha and pytest packages are **skipped silently** |

The third is the one that matters most, and it is not a portability bug — it is the same defect the
gate exists to prevent, one layer up. A stranger with a vitest monorepo runs it, sees
`packages discovering NOTHING 0` and `every discovered file ran`, and concludes their run describes
their tree. **It counted nothing.** In this repository that is survivable because two packages are
vitest and we know it; in a stranger's repository the whole count can be zero and still print green.

**And the gate has no test of its own.** The empty-file proof — the case that made it able to fail —
lives in a commit message. A gate that cannot be shown to fail is the thing this repository's first
law was written about, and it applies to the instrument as readily as to the product.

## The first thing to build

**A single file, no package, no dependencies, no install step.** `counting-gate.mjs`, copied or
vendored, run as `node counting-gate.mjs [root]`. A package is the wrong first move: it puts a
registry, a version and a build between a person and a 236-line script they can read in ten minutes,
and reading it is most of what makes it trustworthy.

Three changes, in this order:

1. **Take the roots as input, and default to discovering them.** `node counting-gate.mjs` with no
   argument reads `workspaces` from the root `package.json`, then `pnpm-workspace.yaml`, then falls
   back to treating the root itself as one package. A path argument overrides all of it. No
   `packages/` literal anywhere.
2. **Refuse a zero count instead of printing green over it.** Zero packages counted, or zero tests,
   is exit 2 and a sentence naming what was searched. This is the anti-vacuity line the brief already
   names, and it is what makes the tool safe to hand to a stranger.
3. **Report the runners it cannot count, by name and package, as a number in the summary.**
   `not counted: 2 packages (vitest)` on its own line, never silent. A stranger must be able to see
   that a third of their tree was outside the count.

Everything else — pytest, a config file, `skipped N of M` with reasons, the four asserts — comes
after a stranger has run this one on a repository that is not ours.

## Planted cases

All card-free, and the first three are the ones the brief names. The gate has none today, so **every
one of these fails or cannot run before this is built.**

1. **The planted empty file.** A test file with no test in it, inside a package's declared glob.
   Expected: `ran N-1 of N`, the file named, **exit 2**. This is the case the gate was rebuilt around
   and it has never been a test; it exists as a sentence in a commit.
2. **The unreached file.** A test file in the built tree that no glob matches. Expected: named as
   unreached, exit 2 — and note this is the one case `ran === discovered` can never catch, which is
   why the walk exists beside the count rather than inside it.
3. **The ran-against-discovered line itself.** A healthy tree: `discovered N`, `ran N`, exit 0, and
   the printed line contains both numbers. A gate whose happy path is untested is a gate whose happy
   path can quietly stop printing.
4. **A repository with no `packages/`.** A flat fixture repo with one `package.json` and two test
   files. Expected: counted as one package, not a throw. **This is the case that decides whether a
   stranger can use it at all.**
5. **A package the gate cannot count.** A vitest test script. Expected: named in the summary as not
   counted, and — the half that matters — **a run where EVERY package is uncountable exits 2**, not
   0. Green over a count of nothing is the defect this whole tool exists to refuse.
6. **A lying runner.** A stub that prints totals and returns a non-zero code, and one that prints
   failure text and returns 0. Expected: the exit code decides both times, and the text is never
   read.

Cases 4 and 5 are the two worth the most, because they are the two a stranger meets first and
neither is exercised by this repository at all.

## The kill number

**Three consecutive outside repositories reporting 0 unreached, 0 uncounted and no disagreement on a
first count.** One clean repository is not a kill — plenty of repositories are tidy. Three in a row
would mean the finding these two repositories share is local to them, and that the gate is insurance
against a fault other people do not have.

A second, cheaper kill, from the brief and unchanged: **an existing tool that already reports ran
against declared and skips with reasons and exits its own code on a mismatch.** The survey found
none in 25 builders as of 2026-09-05; a repeated search before the build is part of the build.

## What this does not claim

- **Not that the tests are good.** It says whether the run described the tree. A tree of tests that
  assert nothing counts perfectly.
- **Not that it detects vacuity.** A test that ends without an assertion is a real defect — 80 of 560
  green while asserting nothing, seventeen of them security locks — and this gate does not see it.
  That is a different assert, and calling this one by that name would be the coverage chip's mistake
  again: a number wearing a label it does not earn.
- **Not that portability is proven by this repository.** Cases 4 and 5 use fixtures; a fixture is not
  a stranger. The claim "another repository can adopt it" is unproven until it has run on one, and
  the kill number is written against exactly that.
- **Not that a package is unnecessary later.** It is unnecessary *first*. If three strangers adopt
  the single file and ask for versioning, that is evidence a package earns its cost — which is a
  better reason than tidiness.
