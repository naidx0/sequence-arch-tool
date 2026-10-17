/**
 * WHAT MAKES AN ARM AN ARM, AND WHAT A RUN MUST HAVE PRODUCED.
 *
 * Both of these were inline in `teach-eval.mjs` and both are refusals, so both
 * had to become callable: a refusal nobody can make fire is not a refusal. The
 * bench CALLS these — it does not restate them — because a rule in two handlers
 * is one rule until measured.
 *
 * They exist because of one incident. On 2026-09-07 a four-arm measurement
 * costing 8,797 seconds of card ended with four exit codes of zero, four
 * printed scoreboards, and three of its four registered clauses holding no data
 * at all: every arm wrote to the same path, so each overwrote the last, and the
 * per-turn fields those clauses read survived only for the final arm.
 */

/**
 * The filename for one arm.
 *
 * DERIVED, not remembered. The first fix for the overwrite was an env var
 * naming the run, which put the arm's identity in a variable somebody has to
 * remember to set — and forgetting is exactly the failure it was meant to
 * prevent. So the name comes from what actually distinguishes one arm from
 * another: the repository under test, the flags in force, and the instant the
 * run began. Two arms of the same configuration still differ by instant.
 *
 * `override` is for a human who wants a readable name; it is never required.
 */
export function armFileName({ repo, wire, refs, trim, startedAt, override }) {
  /*
   * SANITISED, because this is the only place an operator-supplied name becomes
   * a PATH. `TEACH_EVAL_REPO=../../etc` would otherwise write an arm outside
   * the out directory. Found by the case below rather than by thinking of it,
   * which is the argument for writing the case.
   */
  const safe = (v, fallback) => {
    const cleaned = String(v ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '');
    return cleaned === '' ? fallback : cleaned;
  };
  if (typeof override === 'string' && override.trim() !== '') return safe(override, 'arm');
  const flagSig = [wire ? 'wire' : 'nowire', refs ? 'refs' : 'norefs', trim ? 'trim' : 'notrim'].join(
    '-',
  );
  const stamp = safe(startedAt, 'unstamped');
  return `teach-eval-${safe(repo, 'all')}-${flagSig}-${stamp}`;
}

/**
 * Which per-turn artefacts a registered clause needs are missing.
 *
 * A scoreboard reports what it can compute from whatever survived; it has no
 * idea what the registration asked for, which is why a run can print one over
 * three quarters of nothing. This is the check that knows.
 *
 * `claims` is named first and checked hardest: it is the fabrication clause's
 * only evidence, and it has now failed to measure THREE times for three
 * unrelated reasons — absent from the bench entirely for the belt run, deleted
 * by an overwrite for the wiring run, and then indistinguishable from a clean
 * answer, because the product sets the field only when there are findings and
 * the flags saying whether the check could run live inside it.
 *
 * The bench now always records a claims object carrying `ran`. So this gate
 * demands the object, and `claimsRan` reports how many turns the check could
 * actually have found something on — the denominator a fabrication zero needs
 * before it means anything.
 *
 * ERRORED TURNS ARE EXEMPT. A turn that never reached the provider has nothing
 * to record, and demanding fields of it would make the gate fire on the one
 * case it should not — which would teach everyone to disbelieve it.
 */
export function artefactGaps(results) {
  const missing = { claims: 0, stub: 0, conceptGiven: 0 };
  let checked = 0;
  let claimsRan = 0;
  for (const r of results ?? []) {
    if (r?.score?.errored) continue;
    for (const t of r?.turns ?? []) {
      if (t?.error) continue;
      checked += 1;
      if (t?.claims === undefined || t?.claims === null) missing.claims += 1;
      else if (t.claims.ran === true) claimsRan += 1;
      if (typeof t?.stub !== 'boolean') missing.stub += 1;
      if (t?.conceptGiven === undefined) missing.conceptGiven += 1;
    }
  }
  const broken = Object.entries(missing).filter(([, n]) => n > 0);
  return { checked, claimsRan, missing, broken };
}

/**
 * Should this run refuse to write over the file already at its arm path?
 *
 * The overwrite guard's first version refused ANY existing file, and it killed
 * all four arms of a re-run within four minutes each. The writer is
 * INCREMENTAL on purpose — it rewrites the report after every conversation so a
 * crashed run keeps what it had — so the second conversation of every arm hit a
 * file its own run had written a moment earlier.
 *
 * A guard that cannot tell a run's own rewrite from another run's file is not
 * protecting the measurement, it is preventing it. The run instant is already
 * in the payload, so the distinction is free.
 *
 * An unreadable or unstamped file refuses. It is either a foreign artefact or a
 * corrupted one, and neither is something to write through on the strength of a
 * guess.
 */
export function wouldClobberAnotherRun({ exists, priorWhen, runStartedAt }) {
  if (!exists) return false;
  if (typeof priorWhen !== 'string' || priorWhen === '') return true;
  return priorWhen !== runStartedAt;
}
