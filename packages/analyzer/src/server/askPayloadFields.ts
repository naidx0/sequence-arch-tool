/**
 * THE TWO ASK RESPONSE SHAPES, WRITTEN DOWN SO THEY CANNOT DRIFT APART.
 *
 * `/api/ask` answers on two routes: the streaming one emits `resultPayload()` from
 * askPipeline.ts, the buffered one hand-builds a JSON object in repoServer.ts. Every
 * field the pipeline learns to produce must be added in BOTH places, and nothing in
 * the type system says so — an `AskPipelineResult` field is optional on the wire, so
 * forgetting one compiles cleanly and answers a reader with less than the product knows.
 *
 * It has happened twice. `coverage` was dropped from the buffered route and its fix
 * carries a comment saying it "was the one place it was dropped". `claims` — the
 * grounding check that runs the answer against the scanned graph — was dropped the
 * same way and stayed dropped, so the buffered route could return a fabricated answer
 * while the product had already noticed and had nowhere to put the finding.
 *
 * These lists are DECLARED rather than derived from the code, because a list inferred
 * from the implementation would agree with whatever the implementation does —
 * including with the omission it exists to catch. They are kept honest by
 * ask-claims-parity.test.ts, which reads the real payload off a live request.
 */

/** Fields `resultPayload()` puts on the streaming `result` event. */
export const RESULT_PAYLOAD_FIELDS = [
  'text',
  'diagram',
  'unsupportedIntents',
  'usage',
  'metrics',
  'contextBreakdown',
  'source',
  'advisor',
  'coverage',
  'claims',
  'premise',
  'contextFit',
  'verify',
] as const;

/**
 * Fields that never reach the wire at all — consumed in-process by the caller.
 *
 * THE THIRD CATEGORY, and its absence was the hole in this file. The two lists
 * above are DECLARED, which is what makes them honest — but it also means a
 * field the pipeline learns to produce and NOBODY declares is not checked by
 * anything. It is simply invisible, exactly like the omission this file exists
 * to catch, one level up.
 *
 * That is not hypothetical either: `premise` was added to `AskPipelineResult`,
 * attached to the result, and reached no route — the parity test passed because
 * an undeclared field is not a field it knows about. `verify` had been in the
 * same state for longer, on the streaming route and named nowhere.
 *
 * So every field on `AskPipelineResult` must now appear in one of these three
 * lists, and `ask-claims-parity.test.ts` reads the interface itself to prove it.
 * A field that is genuinely internal is declared internal; what is no longer
 * possible is a field that is nothing at all.
 */
export const INTERNAL_RESULT_FIELDS = [
  'filesWritten',
  'permissionSources',
  /*
   * The next-picture prediction, carried out of the pipeline so the ROUTE can
   * persist it on the lesson for the next turn to reveal. It never reaches the
   * wire: the learner reads the question in the answer's own text, and the
   * reveal is appended to the next turn's text the same way. Putting it on the
   * payload would give a client a second copy of a thing it already has.
   */
  'openPrediction',
  /*
   * WHICH GATE CLOSED ON THE DERIVED CHECK-IN, when one did.
   *
   * Internal for the same reason as `openPrediction`: the learner reads a
   * question or does not, and a client shown "no-chart-derived-this-turn" learns
   * nothing it can act on. It exists for the BENCH, which records it beside
   * `stopReason` — nine turns across two card runs drew a chart and asked
   * nothing, and the reason was guessed at twice and wrong twice because nothing
   * wrote it down.
   */
  'checkInSkipped',
  /*
   * WHAT THIS TURN FOUND, for the caller to hand the next one.
   *
   * Internal for the same reason as `openPrediction`: it is the CALLER's job to
   * persist it and pass it back, and a client shown the block would be shown a
   * second copy of material it already has in the answer. It exists so the next
   * turn does not re-read what this one read — measured at 5.4 provider calls a
   * turn, each carrying ~5,300 tokens of digest and rules rebuilt unchanged.
   */
  'carryOut',
] as const;

/**
 * Fields that describe HOW THE TURN RAN rather than what the answer is.
 *
 * The buffered route deliberately omits these: it has no transcript to hang them on,
 * and every one of them is a live-progress signal the streaming client renders as the
 * turn happens. This is the ONLY sanctioned difference between the two routes — a
 * field absent from the buffered payload and not named here is a bug, not a choice.
 */
export const STREAMING_ONLY_FIELDS = ['metrics', 'contextBreakdown', 'advisor'] as const;

/** What the buffered `/api/ask` JSON payload must carry: everything else. */
export const BUFFERED_PAYLOAD_FIELDS = RESULT_PAYLOAD_FIELDS.filter(
  (f) => !(STREAMING_ONLY_FIELDS as readonly string[]).includes(f),
);
