# Every exit, produced alone — an audit of this lane's gates

**2026-09-07. Prompted by a bug in the orchestrator lane's citation gate: a probe that tripped two
branches at once proved neither in isolation, and the branch that never executed alone was the one
that silently passed.**

## The rule being applied

**For each gate with more than two exits: is there a case that produces that exit and no other?**

Narrower than *test every branch*, and the narrowness is the point. A probe that trips two branches
at once proves neither. Where no isolating case exists, that is a finding worth recording even if
nothing is wrong behind it.

## `tools/ci/carry-referents-arm.mjs` — five distinct exits, and every carry result rests on one

| exit | meaning | isolating case | result |
|---|---|---|---|
| 2 | unknown `--place` | `--place nonsense` | **fires alone** |
| 2 | unknown `--voice` | `--voice nonsense` | **fires alone** |
| 2 | unknown `--variant` | `--variant nonsense` | **fires alone** |
| 2 | port already in use | a listener on the port, then run | **fires alone** |
| 3 | the arm file already exists | — | **UNREACHABLE — see below** |
| 4 | a build half is older than its source | `touch` a source, then run | **fires alone**, before any model call |
| 5 | the written file holds fewer turns than the run produced | — | **unproved — see below** |
| 6 | turn 1 produced no referent list (void) | — | **fired in three real runs** |

### Exit 3 cannot fire, and that is a finding rather than a gap in the audit

The arm's filename embeds `RUN_STARTED_AT` to the millisecond
(`carry-referents-…-2026-09-07T18-19-02-180Z.json`). **Two runs would have to begin in the same
millisecond to collide**, so the overwrite refusal at line 120 cannot be reached in practice.

**A guard that cannot fire is not a guard.** It is harmless here — the uniqueness it was protecting
is supplied by the filename itself — but it reads as protection that is actually redundancy, and a
reader auditing the runner would count it as a defence. It is recorded, not deleted: the bench's
equivalent guard (`wouldClobberAnotherRun`) *is* reachable and load-bearing, because that filename
can be overridden by hand.

### Exit 5 is unproved and I did not manufacture a proof

It fires when the arm re-reads its own written file and finds fewer turns than the run produced.
Reaching it needs the write to succeed and the read-back to disagree — a torn write, a full disk, or
tampering between two adjacent statements. **No honest isolating case exists at this level**, and
faking one by stubbing the filesystem would prove the stub rather than the gate.

**Recorded as unproved.** It is the assert-the-write rule that came out of the mutation harness's
failed restore, and it has never executed.

### Exit 6 fired in three real runs, which is better than a plant

`Exit 6: re-run it` appears once in the instruct batch and twice in the slot-completion batch — the
`tail/registered` slot needed three attempts, two of them void. **Those are production firings on
arms that would otherwise have been graded**, not constructed cases. It is the best-evidenced exit in
the lane.

## The finding worth acting on: exit 2 carries four causes

All four fire in isolation, so the audit's own question passes. But **one code for four causes is the
ambiguity the orchestrator lane's split was written to remove**, and here it has a concrete cost:

`/tmp/complete.sh` and the instruct batch both retry on 6 and **give up on any other non-zero** —

```sh
if [ $code -eq 0 ]; then break; fi
if [ $code -ne 6 ]; then echo "FAILED exit $code"; break; fi
```

**A busy port is transient and retryable. A bad flag never is.** Under one code the batch treats them
identically and abandons a slot that would have succeeded on the next port. That did not happen
tonight — the ports were free — but the batch could not have told the difference if it had.

**Not fixed here.** Splitting an exit code changes a contract every batch script reads, and doing it
while a result page depends on those scripts is the wrong order. Recorded for the next change to that
runner.

## The other gates

| gate | exits | status |
|---|---|---|
| `gpu-lock.mjs` | 0, 1, 2, 3 | 2 and 3 fire alone (unset `SEQUENCE_GPU_LOCK`; another lane holding). 0 and 1 are the `run` wrapper's pass-through of a child's code — **not this gate's own verdicts** |
| `pre-push.mjs` | 0, 1, 2, 3 | 1 (red gate), 2 (run artifact) and 3 (dirty tree) each fired alone in real use today; 3 was proven by planting a dirty tree with a commit pending |
| `counting-gate.mjs` | 1, 2 | two exits — below the rule's threshold, and both have fired in real use |
| `teach-eval.mjs` | 1, 2, 3, 4, 5 | 3 and 5 fired alone in real use (overwrite refusal, artefact gate). **2 and 4 unproved** |

## What this audit does not claim

- **Not that the unproved exits are broken.** Two of them have no honest isolating case at this level,
  and one is unreachable. Unproved is a state, not a verdict.
- **Not that every gate needs this.** The rule applies above two exits, because below that a failure
  is unambiguous.
