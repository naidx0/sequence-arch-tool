# A lesson request with no subject

**Written 2026-09-06, before anything is built. Nothing here is implemented.**

## The case

Four of the thirteen bench conversations ask to be taught something and name no file:

| | ask |
|---|---|
| `harness-03` | "Teach me the verify contract: what it demands and when." |
| `harness-05` | "Teach me what the round budget is and how the loop spends it." |
| `harness-06` | "Teach me how tool calls are parsed from fenced blocks here." |
| `harness-08` | "Teach me what the architecture digest is and how it is budgeted." |

They name no file and carry no repository reference, so `buildQueue` returns an **empty queue** —
before `bb1d7f16` and after it. The walk cannot reach them; there is nothing to walk from. These are
the four that were given no concept in *every* arm of the sequence condition, which I read as noise
for a week.

## What the product gives them today

Nothing, and **the nothing is not visible to the learner.** From `seq-new-2`, the turns are not
stubs — 87 to 242 words each — and every one has `concept: none` and `visual: false`. What the model
produces instead is a paraphrase of the architecture digest:

> "I'll explain the repository structure clearly. The digest shows this is a software system with
> multiple services, datastores, and modules, **but the full file list wasn't scanned.** I can
> describe what's…"  — `harness-03` turn 1 and `harness-08` turn 1, the same text in both

> "I'll focus on one clear concept per turn, grounded in the real repository structure…"
> — `harness-05` turn 1, the model narrating its instructions instead of teaching

In other arms the same asks come back as a stub instead (`harness-03` turn 0 in `seq-old-1`: 34
words). So the failure has two shapes — a canned digest paraphrase, or nothing at all — and **the
first shape is the dangerous one**, because it reads as an answer. A learner sees prose, no picture,
and no sign that the system never found a subject. That is the failure mode this repository's first
law exists to prevent: it is a guess wearing the clothes of a grounded answer.

## What the scan already knows

Measured, both fixtures, today:

| | shopfront (24 files, 40 edges) | sequence (1,030 files, 2,873 edges) |
|---|---|---|
| most depended on | `http.ts` (3), `routes.py` (3), `index.js` (3) | **`index.ts` (253)**, `types.ts` (90), `scan.ts` (83) |
| zero-inbound "entry points" | `index.ts` (4→), `main.py`, `worker.py` | **`visualBoard.test.tsx` (15→)**, `App.test.tsx` (13→) |

**Both obvious seeds are wrong, and the measurement is why this page exists rather than a commit.**

- **Zero-inbound does not mean "entry point". It means "nothing imports it", and on a repository
  with tests that is every test.** The top six roots here are all `.test.tsx`. A lesson seeded this
  way opens with "let me teach you `App.test.tsx`".
- **Most-depended-on gives a barrel.** `index.ts` at 253 inbound is a re-export file. The four arms
  already established that the concept picker never names a barrel and that barrels appear only as
  neighbours — a barrel is a list of names, and a lesson about one teaches nothing about the system.

A filtered ranking (exclude tests, exclude re-export files) does give plausible subjects here —
`types.ts`, `scan.ts`, `repoServer.ts`, `store.ts`. That is an argument that a seeder is *possible*,
not that it is right: every one of those exclusions is a rule invented to make the output look good
on one repository, which is how a heuristic becomes untestable.

## The two honest options

### A. Seed the queue from the scan

Pick subjects by graph rank with the exclusions above, and teach them as an ordinary lesson.

- **For:** the learner gets a lesson instead of a non-answer; the machinery already exists; nothing
  new appears in the UI.
- **Against:** the seed is **not grounded in the ask**. The learner asked about "the verify
  contract" and would be taught `scan.ts` because it ranks highly — a subject change with no sign
  that it happened, which is the same defect as the digest paraphrase in a better costume. And the
  exclusion list is unfalsifiable: every repository that produces a silly first concept adds a rule.

### B. Refuse, and name what is missing

The lesson is not started. The turn says it could not find a subject in the repository for this ask,
and names the two things that would fix it: a file (`"teach me jail.ts"`) or a reference to the
repository (`"…in this repo"`), which is the signal `buildQueue` already uses.

- **For:** honest, and it is what the model is already trying to say when it volunteers "the full
  file list wasn't scanned". It converts a silent failure into a legible one. It is cheap, it is
  testable without a model, and **it is reversible** — a seeder can be added behind it later, and the
  refusal becomes the fallback when the seeder also finds nothing.
- **Against:** a refusal is a worse turn than a good lesson, if a good lesson was available. This
  option bets that it usually was not.

## Build B first

Because A's seed is a subject substitution the learner cannot see, and this repository has already
shipped that mistake twice — the stale chart served after a rebuild, and the coverage chip reading
191 on a turn whose picture used four edges. **A wrong subject delivered confidently is worse than no
subject delivered honestly**, and B is the only one of the two that can be wrong *visibly*.

B is also the smaller change: no ranking, no exclusions, no new tuning surface. It is one branch at
the point where `buildQueue` returns an empty array for an ask that `TEACH_ASK` matched.

### Planted cases, on the shopfront fixture

Card-free, all of them — `buildQueue` is a pure function of a scanned graph. **Every input below was
run against the fixture before this page was written**, so the cases are grounded rather than
plausible:

| ask on shopfront | `TEACH_ASK` | queue today | the case expects |
|---|---|---|---|
| "Teach me what the retry policy is." | yes | **0** | refuse |
| "Teach me what orders.ts does here." | yes | 6 | no refusal |
| "Teach me what this repo does." | yes | 6 | no refusal |
| "Why does the retry flag exist?" | **no** | **0** | no refusal — see the gap below |

1. **A lesson ask with no subject refuses, and the refusal names both remedies.** `"Teach me what the
   retry policy is."` on shopfront → refusal; its text contains a file-naming example and the
   repository-reference form.
2. **A lesson ask that names a file does not refuse.** `"Teach me what orders.ts does here."` →
   queue of 6, no refusal. The boundary from the other side.
3. **A lesson ask that references the repository does not refuse.** `"Teach me what this repo
   does."` → seeded from the repo's files as today, no refusal.
4. **A pointed question with no subject is not turned into a refusal about lessons.**
   `"Why does the retry flag exist?"` → the existing behaviour, unchanged. `TEACH_ASK` gates the
   refusal, so a question that was never a lesson request does not get lesson-shaped machinery.
5. **The refusal is not a lesson.** No concept is recorded as taught, no chart is derived, and the
   queue stays empty — so a refused turn cannot be counted as a lesson turn by the corrected
   statistic, and cannot inflate it the way a stub inflated the old one.
6. **The four bench asks refuse and the other nine do not** — a source-level case over the bank, so
   the blast radius is measured rather than assumed.

### The kill number

**The refusal must fire on exactly 4 of the 13 bank conversations.** Five or more is a false
positive reaching real lessons and the change comes out; three or fewer means it is not doing the
job it was built for. That number is checkable card-free by case 6 and must be re-checked on any
change to `TEACH_ASK`.

A second number, for later and only if A is ever built: **a seeded first concept that is a test file
or a re-export file is a defect, not a tuning matter.** Both are measurable from the graph, and both
are what the naive rankings produce today.

## The gap this leaves open, named rather than hidden

`"Why does the retry flag exist?"` also returns an **empty queue** on shopfront, and `TEACH_ASK` does
not match it. So the refusal will not fire, and that ask keeps the behaviour this page calls
dangerous: a confident paragraph with no subject behind it.

That is deliberate — case 4 asserts it — because a refusal written for lessons should not be handed
to a question that never asked for one, and because the right answer for a pointed question about
something the graph does not contain is a different sentence than the right answer for a lesson.
**But it means B fixes the four bench conversations and does not fix the class.** Anyone reading this
page as "silent subject-less answers are solved" is reading it wrong.

## What this page does not claim

- **Not that a refusal teaches better.** It does not teach at all. The claim is that it fails
  legibly where the current behaviour fails silently, and that a subject the learner did not ask for
  is not a fix.
- **Not that the four asks are unanswerable.** "The verify contract" plainly *is* in this repository.
  What is absent is a way to get from those words to a node — that is a retrieval problem, and this
  page does not solve it or pretend the refusal is a substitute for solving it.
- **Not measured on a person.** Every number here comes from the scan and from the bench transcripts.
  Whether a learner prefers an honest refusal to a confident digest paraphrase is exactly the
  question a seat read answers and this page does not.
- **Not a claim about the bench score.** Building B will *lower* the bench's visual and concept
  counts on those four conversations, because a refusal is honestly not a lesson. **That is the
  intended direction, and it must not be read as a regression** — the same trap as the statistic
  that counted a stub's inherited concept as coverage.
