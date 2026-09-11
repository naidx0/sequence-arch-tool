/**
 * HOW A SEAT TRANSCRIPT IS READ FOR MECHANISM B.
 *
 * Stage four asks whether carrying the previous answer's referents lets turn 2
 * answer a question about them. The reading is registered in
 * `docs/research/carry-redesign-registration.md` and is NOT re-decided here —
 * this module implements it so it can be applied identically to every arm and
 * made to fire before any card is spent.
 *
 * ── WHY THREE NAMES AND NOT EIGHT ────────────────────────────────────────
 *
 * `who_calls scan.ts` returns 84 distinct callers; the carry cap takes the
 * first 8. FIVE of those eight are what turn 1's answer said aloud, and the
 * product carries prior chat prose independently of any carry slot — so a turn
 * 2 naming one of those five proves nothing at all. It is not weak evidence for
 * the carry; the carry is not the only path to those names, so it is no
 * evidence for it.
 *
 * THREE are reachable only through the new slot: `eval/grade.ts`,
 * `functions/repoFunctionGraph.ts`, `harness/designDrawBaseline.ts`. Those are
 * the measurement. Nothing was built to place them there — the repository
 * supplied them — so no part of the arm serves its own result.
 *
 * ── A NOTE ON MATCHING ───────────────────────────────────────────────────
 *
 * The three are distinctive basenames and can be matched as words. The five are
 * not — `index.ts` occurs in any answer about any repository — but the five only
 * ever produce INCONCLUSIVE, so a false positive among them cannot manufacture
 * a pass. The asymmetry is deliberate: the names that can produce a PASS are the
 * ones that are safe to match.
 */

/** Carried, and reachable ONLY through the fourth slot. A pass requires one. */
export const DISCRIMINATING = [
  'packages/analyzer/src/eval/grade.ts',
  'packages/analyzer/src/functions/repoFunctionGraph.ts',
  'packages/analyzer/src/harness/designDrawBaseline.ts',
];

/** Carried, but also spoken aloud by turn 1, so naming one explains nothing. */
export const PROSE_EXPLAINED = [
  'packages/analyzer/src/cli.ts',
  'packages/analyzer/src/diagramCli.ts',
  'packages/analyzer/src/doctor.ts',
  'packages/analyzer/src/index.ts',
  'packages/analyzer/src/moat/collectEnvReads.ts',
];

const basename = (p) => p.split('/').pop();

/** Which of `paths` the text names, by full path or by distinctive basename. */
export function namedIn(text, paths) {
  const hay = String(text ?? '');
  return paths.filter((p) => {
    if (hay.includes(p)) return true;
    const b = basename(p);
    /* Word-ish boundary: `grade.ts` must not match inside `upgrade.ts`. */
    return new RegExp(`(^|[^\\w/.-])${b.replace(/\./g, '\\.')}([^\\w]|$)`).test(hay);
  });
}

/**
 * The registered reading of one arm's turn 2.
 *
 * PASS          — names at least one of the three. The carry is the only path.
 * INCONCLUSIVE  — names only prose-explained items. Recorded as inconclusive in
 *                 the first line of the result, and banked in NEITHER direction:
 *                 a turn with two sources that used the older one says nothing
 *                 about whether the newer one worked.
 * NULL          — names none of the carried items.
 */
export function readTurnTwo(text) {
  const discriminating = namedIn(text, DISCRIMINATING);
  const proseOnly = namedIn(text, PROSE_EXPLAINED);
  if (discriminating.length > 0) return { verdict: 'PASS', discriminating, proseOnly };
  if (proseOnly.length > 0) return { verdict: 'INCONCLUSIVE', discriminating, proseOnly };
  return { verdict: 'NULL', discriminating, proseOnly };
}

/**
 * ATTRIBUTION, which is what replaced the positional plant.
 *
 * The plant could not be run faithfully on a real repository — with a fixed repo
 * and a fixed turn-1 question the order is fixed, so every way of varying an
 * item's position varies something else too.
 *
 * ── WHY THIS TAKES TOOL NAMES AND NOT TOOL CONTENT ───────────────────────
 *
 * The first version asked whether a name appeared in the turn's tool RESULTS.
 * Building the runner showed that is not observable: `tool:done` carries only a
 * short evidence label ("who_calls scan.ts — 84 in, 33 out") and the result body
 * goes into the PROMPT, never to the client. A rule that needs the content
 * would have to be evaluated inside the server, and adding a client-visible
 * copy of tool output to make a measurement easier is the instrument writing
 * its own result.
 *
 * What IS observable is which tools ran. That is enough, because it composes
 * with the three-versus-five split:
 *
 *   turn 2 ran NO tool, and named one of the three
 *     → the carry is the only possible source. Prior prose never spoke those
 *       three, and nothing was fetched this turn.
 *
 *   turn 2 ran ANY tool
 *     → attribution REFUSED, whatever it named. We cannot see what the tool
 *       returned, so any tool is a possible source.
 *
 * Refusing on any tool at all is deliberately blunt. A `read_file` on an
 * unrelated path almost certainly did not produce these names — but "almost
 * certainly" is how a flattering attribution gets made, and a flattering error
 * is the one nobody re-examines. The blunt version can only understate.
 */
export function attribute({ text, carried, toolsRan }) {
  const named = namedIn(text, carried);
  const ran = (toolsRan ?? []).filter((t) => typeof t === 'string' && t !== '');
  if (ran.length > 0) {
    return {
      named,
      fromCarryOnly: [],
      alsoInPriorProse: named.filter((p) => PROSE_EXPLAINED.includes(p)),
      refusedBecause: `tools ran this turn: ${ran.join(', ')}`,
    };
  }
  /*
   * PRIOR PROSE IS THE OTHER SOURCE, AND IT WAS MISSING FROM THIS RULE.
   *
   * The first treatment arm named cli.ts, diagramCli.ts and doctor.ts with no
   * tool call, and this reported "3 items the carry alone could have supplied".
   * That is false: turn 1's answer SPOKE those three, and the product carries
   * prior chat prose independently of any carry slot. The verdict above already
   * called it INCONCLUSIVE for exactly that reason, and the attribution line
   * underneath it contradicted the verdict.
   *
   * A flattering attribution is the error this rule exists to prevent, and it
   * arrived through a door the rule did not model. Only the three the carry
   * ALONE can reach are ever attributable.
   */
  const attributable = named.filter((p) => !PROSE_EXPLAINED.includes(p));
  return {
    named,
    fromCarryOnly: attributable,
    alsoInPriorProse: named.filter((p) => PROSE_EXPLAINED.includes(p)),
    refusedBecause: null,
  };
}
