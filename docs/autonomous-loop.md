# The Autonomous Product-R&D Loop

A continuous, mostly-unattended loop that ratchets Sequence toward `vision.md`. The owner
hands off and lets it run; it stops when the owner says stop or when it reaches the stable
ratchet (vision §7). Commits land on `main`.

## The honest contract (read this first)

This loop does **not** guarantee the product improves every round. It guarantees a
**ratchet**: nothing that regresses the gate (vision §6) or an invariant (vision §3) ever
ships, and every commit is green-verified. Some rounds will correctly produce **no commit**
("swarm found nothing tier-1/2 worth shipping"). That is a success, not a failure — churn
for its own sake is an anti-goal (vision §8). **The verifier is the moat**: the loop is only
as trustworthy as its adversarial gate, so the gate is never weakened to make a round "land."

## Priority order (vision §2)

Every round works the **highest open tier**: correctness/features (1) before
UX/comparability (2) before breadth (3). A tier-1 finding anywhere preempts tier-2 work.

## One round (the unit of work)

1. **Discover (parallel, read-only — safe to fan out wide).** A critic swarm: several
   agents, each a distinct lens against `vision.md` — (a) correctness/invariant hunt on the
   diff-able core, (b) feature-gap hunt (promised surface that no-ops/misleads on a real
   repo), (c) test-coverage & edge-case gaps, (d) tier-2 UX/friction/comparability. Each
   returns structured findings with `tier`, `severity`, `file:line`, and a concrete failure
   scenario. Read-only ⇒ no file conflicts.
2. **Synthesize (orchestrator).** Dedup, rank by `tier` then `severity × value`, pick the
   single highest-value cluster this round. Discard the rest to the backlog note. Do **not**
   fan out edits across many findings at once — one coherent change per round keeps the
   ratchet auditable.
3. **Build (serialized on `main`'s tree).** One Opus builder (or a few with *disjoint* file
   ownership) implements the chosen cluster **with a locking regression test per fix**. No
   weakened assertions. Scope minimal.
4. **Adversarially verify (different lens / family where available).** Review the diff
   against intent: real bug? regression vs HEAD? guard gap? test that actually locks the
   behavior? Report-only, RELEASABLE/NOT verdict. Findings feed a fix pass; re-review until
   the round's diff is clean.
5. **Authoritative gate (orchestrator).** Run the full standing gate (vision §6) myself —
   agent self-reports are necessary, not sufficient. Confirm reference verdicts unchanged.
6. **Commit or discard.** Green ⇒ commit to `main` with a `loop(rN):` message naming the
   tier, the change, and the new tests. Not green, or the change proved not worth it ⇒
   discard the working tree, log why in the round note, move on.
7. **Log & schedule.** Append a one-paragraph round note to `docs/loop-log.md` (what the
   swarm found, what shipped or why nothing did, gate numbers). Schedule the next round.

## Cadence & control

- Rounds are paced with `ScheduleWakeup` so the loop survives a hung agent and the owner can
  interrupt between rounds. Discovery and review run as background agents; the orchestrator
  stays lean and does not poll.
- **Stop conditions:** the owner says stop (immediate — finish no in-flight commit that
  isn't already gated), or the stable ratchet (vision §7) holds for a full round ⇒ slow to
  tier-3 cadence and report.
- **Escalate, don't guess:** anything ambiguous and architecturally significant, anything
  that would change the product's identity (vision §8), or anything touching auth/secrets/
  billing/deploy → pause and ask the owner rather than commit autonomously.

## Safety rails (autonomous commits to `main`)

- Only the gated, adversarially-reviewed diff of the current round is ever committed. Never
  `git push --force`; never rewrite shared history; never touch `main`'s remote outside a
  clean fast-forward of loop commits.
- No secret, key, deploy credential, or billing change lands autonomously — those escalate.
- The gate is authoritative and un-gameable: if a round can't pass it honestly, it doesn't
  ship. Reward-hacking the gate (skipping/weakening tests, narrowing fixtures) is forbidden.
- Every round is auditable from `docs/loop-log.md` + the `loop(rN):` commit + its tests.

## Backlog

Findings not chosen in a round are parked in `docs/loop-log.md` under a running backlog so
later rounds (or the owner) can pick them up. The swarm re-derives fresh each round, so the
backlog is a hint, not a queue — genuinely-gone findings simply stop reappearing.

**Not Karpathy autoresearch.** This loop ratchets a product toward `vision.md` with a full
test gate — not a single-metric GPU experiment branch. For the three-layer strategy / agent /
harness vocabulary as an *optional* design pattern only, see
[`docs/autoresearch-vs-sequence.md`](autoresearch-vs-sequence.md).
