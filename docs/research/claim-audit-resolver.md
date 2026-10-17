# The claim-audit resolver as a verb — design, and the kill criterion it has to survive

**Status:** design, then a first build of the core. **Prior art:** the research lane's Stage A audit
(vault, not in this repo — named rather than linked, per `tools/ci/canon-paths.test.mjs`), which ran
a preregistered audit over 28 transcripts and 301 cited paths and found **0 fabricated of 296
resolvable**. Its most useful output was not the score: **each of its three runs found a resolver
defect before it found an agent defect.**

## What the verb answers

Given a session record, resolve every path the assistant cited **at the commit that record was
opened at**, and return the residual — what did not resolve, and *why*, by class — with the
denominator and the commit stated in the answer.

The commit is the whole reason this is possible now: `SessionIndexEntry.commit` pins a SHA rather
than a branch name, so a resolution run later resolves against the tree the agent was looking at.

## The mistake not to repeat — rule 4

The v1 instrument excluded 19 citations from its denominator as "unknowable" or "coverage-unknown",
because they sat under a directory the scan never visited or in a repository with no scan. **That
imports the scan's coverage into a question the scan does not answer.**

Whether a cited path exists is decided by **the filesystem and git**. Coverage governs *edge* claims
— "A calls B" — where absence in the graph is only evidence inside scanned regions. For path
existence it removed 19 rows for no reason, and on a repository with no scan it would have removed
every row.

This is worth stating precisely because this repository has spent a week building coverage-gating
and would reach for it by reflex: **the discipline is knowing which claims coverage governs.** Using
it where git already has the answer is not extra rigour, it is a wrong denominator.

So: coverage is not consulted. A citation is excluded only when it names a **repository not present
on this machine**, and that exclusion is reported by name rather than silently subtracted.

## The verdict classes

Ordered, because order is the design — each is tried before the next, and the last one is the
accusation.

| verdict | test | in the denominator |
|---|---|---|
| `resolves` | on disk at the pinned commit, as written | yes |
| `package-root` | resolves once a package prefix is restored (`acp/src/index.ts` → `packages/acp/…`) | yes |
| `created-in-session` | an **exact** full-path match against the record's own writes | yes |
| `history` | existed at some commit reachable from any ref | yes |
| `ambiguous` | resolves in more than one repository on the machine | yes |
| `off-machine` | names a repository not present here | **no — reported by name** |
| `quotation` | the sentence says the path is fabricated, missing, or a fixture | **no — routed to adjudication** |
| `fabricated` | none of the above | yes |

Three refinements the prior art's three runs earned, all of them resolver bugs rather than agent
ones, and each is a rule here:

- **Repository attribution is the resolver's job.** Run 1 called a vault file fabricated because it
  searched only the transcript's own repository.
- **Created-in-session is an exact match.** Run 2's suffix match invented a verdict for a quoted
  bare path.
- **History is checked at any commit before `fabricated` is reached.** Run 2 called a file deleted
  after the span "coverage-unknown".
- And a fourth from the hand labels: **a citation inside a sentence that calls it fabricated is a
  quotation**, not a claim. Not decidable in general, so a small negation-phrase list routes the row
  to adjudication rather than to a verdict.

**A bare filename is not a claim of location** and is never counted. `one.ts` asserts nothing about
where it lives.

## The kill criterion

**A record with one planted fabricated path must come back `fabricated`.** If the resolver cannot
separate "never existed anywhere" from the seven benign classes above, it measures nothing — it is
an elaborate way of confirming that most cited paths exist, which was never in doubt.

That is the smallest test, and it is the one that decides whether the design is worth building. It
requires the `history` check to be real: without it, every renamed file reads as fabricated and the
verdict is noise; with it, only a path that exists at no commit on any ref reaches the accusation.

**A second test kills a subtler failure:** a path that exists *only in history* must come back
`history`, never `fabricated`. Those two together are what separate a resolver from a `test -f`.

## What is built first

The resolver core: classify a citation against a repo root and a commit. Pure over its inputs apart
from git and the filesystem, so it is testable with a scratch repository and no session record.

Wiring it to a session record and exposing it as an MCP verb comes after the core survives its kill
criterion — building the verb first would be shipping the shape of an instrument whose measurement
nobody had checked.
