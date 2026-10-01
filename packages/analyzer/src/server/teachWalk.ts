/**
 * THE WALK — one real input moved through the picture, one beat at a time.
 *
 * THE OWNER'S SHAPE for a lesson, recorded in `GRAPHITE-DECISIONS.md`:
 *
 *     ask what the learner knows → DRAW the thing → "have you seen this
 *     before?" → walk one real input through the picture, side by side, in
 *     real time
 *
 * Three of those four shipped. `TeachKnownCards` asks what they know,
 * `propose_chart` + `drawTeachingVisual` draw it, `checkIn.ts` closes the turn
 * with the question. The fourth — the one that turns a diagram into an
 * explanation — did not exist, and it is the beat the other three are for: a
 * box-and-arrow chart shows you the PARTS, and only a worked example shows you
 * what actually happens.
 *
 * ── THE TWO QUESTIONS THE DECISION LEFT OPEN, AND WHAT ANSWERED THEM ───────
 *
 * The decision said this could not be scoped until two things were settled.
 * Both were settled by machinery that already exists, which is why this is a
 * small file rather than a program:
 *
 *  1. *"whether the picture lives INLINE in the transcript or stays a canvas
 *     pane the chat drives"* — it is already a canvas pane. `chart:proposal`
 *     paints into `canvasDoc.charts`, and a lesson has drawn there since the
 *     teach contract shipped. Moving it inline would be a different feature
 *     and would abandon a working one.
 *
 *  2. *"whether a step is the model re-drawing each beat or one diagram with a
 *     moving highlight"* — one diagram with a moving highlight, because
 *     `teach:step`'s `litNodeIds` ALREADY does exactly that against the board,
 *     and the client already resolves those ids against what it actually
 *     draws. Re-drawing per beat would also make every beat cost a provider
 *     round, which is the thing that killed the seven-minute design draws.
 *
 * ── THE GROUNDING RULE, WHICH IS THE WHOLE DESIGN ─────────────────────────
 *
 * A walk may only name parts of the picture that WAS ACTUALLY DRAWN this turn.
 * `validateWalk` takes the chart's own item ids and refuses any step citing
 * anything else — whole, not by dropping the bad step, because a walk with a
 * silent hole in it is a walk the reader cannot tell is incomplete. This is
 * `propose_chart` refusing an invented `nodeId`, applied one level up: there,
 * a picture may not claim a part of the repository that does not exist; here,
 * a story may not claim a part of the picture that was not drawn.
 *
 * And it means a walk cannot be emitted BEFORE a chart. That is not a
 * limitation, it is the order of the lesson.
 */

/** One beat: the part of the picture the input is passing through, and what happens there. */
export interface WalkStep {
  /** An item id from the chart drawn this turn. Refused if it is not one. */
  partId: string;
  /** What happens to the input at this part, in one clause. */
  says: string;
}

export interface TeachWalk {
  /** The concrete thing being traced — "the sentence 'the cat sat'", "a 404 from /orders". */
  input: string;
  steps: WalkStep[];
}

/**
 * Fewer than two beats is not a walk, it is a caption on one box.
 * More than twelve is a lesson that has stopped being one beat at a time.
 */
export const MIN_WALK_STEPS = 2;
export const MAX_WALK_STEPS = 12;
const MAX_INPUT_CHARS = 200;
const MAX_SAYS_CHARS = 240;

export type WalkResult = { ok: true; walk: TeachWalk } | { ok: false; reason: string };

function text(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

/**
 * Validate one `walk_example` payload against the picture that was drawn.
 *
 * `drawnPartIds` is the chart's own `items[].id` list, taken from the chart
 * this turn actually emitted — never from the model's second telling of it.
 * Passing an empty list is how "no picture was drawn yet" refuses, and the
 * reason says so rather than blaming the step.
 */
export function validateWalk(raw: unknown, drawnPartIds: readonly string[]): WalkResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'expected an object with "input" and "steps"' };
  }
  const o = raw as Record<string, unknown>;
  const input = text(o.input, MAX_INPUT_CHARS);
  if (input === '') {
    return {
      ok: false,
      reason:
        'name the CONCRETE input you are tracing in "input" — a walk with no specific thing ' +
        'moving through it is just the diagram again',
    };
  }
  if (drawnPartIds.length === 0) {
    return {
      ok: false,
      reason:
        'no picture has been drawn in this turn yet. Draw it first (propose_chart), then walk ' +
        'an input through the parts you drew',
    };
  }
  const rawSteps = o.steps;
  if (!Array.isArray(rawSteps)) return { ok: false, reason: '"steps" must be an array' };
  if (rawSteps.length < MIN_WALK_STEPS) {
    return {
      ok: false,
      reason: `a walk needs at least ${MIN_WALK_STEPS} steps — one beat is a caption, not a walk`,
    };
  }
  if (rawSteps.length > MAX_WALK_STEPS) {
    return { ok: false, reason: `at most ${MAX_WALK_STEPS} steps (got ${rawSteps.length})` };
  }
  const known = new Set(drawnPartIds);
  const steps: WalkStep[] = [];
  for (const entry of rawSteps) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, reason: 'every step must be an object with "partId" and "says"' };
    }
    const e = entry as Record<string, unknown>;
    const partId = text(e.partId, 80);
    if (partId === '') return { ok: false, reason: 'every step needs a "partId"' };
    if (!known.has(partId)) {
      /*
       * REFUSED WHOLE, not repaired. Dropping the bad step would leave a walk
       * with a silent hole the reader cannot see — the same argument
       * `drawFromGeneralKnowledge` makes about a claimed nodeId voiding the
       * whole chart rather than being stripped.
       */
      return {
        ok: false,
        reason:
          `step names partId "${partId}", which is not a part of the picture you drew. ` +
          `The parts are: ${drawnPartIds.join(', ')}`,
      };
    }
    const says = text(e.says, MAX_SAYS_CHARS);
    if (says === '') {
      return { ok: false, reason: `step "${partId}" needs "says" — what happens to the input here` };
    }
    steps.push({ partId, says });
  }
  return { ok: true, walk: { input, steps } };
}

/** The line the work row shows, and what goes back to the model. */
export function walkEvidence(walk: TeachWalk): string {
  return `walked "${walk.input}" through ${walk.steps.length} part(s) of the picture`;
}

/**
 * THE BELT LINE, and the sentence that decides whether the beat is any good.
 *
 * "ONE CONCRETE INPUT" is the whole instruction. A walk whose input is "some
 * data" is the diagram with extra words, which is precisely the failure the
 * owner reported about the three-box LLM chart — a picture that names the
 * parts and shows nothing happening.
 */
export function renderWalkToolHintSection(): string {
  return [
    '--- WALK AN EXAMPLE THROUGH THE PICTURE ---',
    'After you have drawn the picture, trace ONE concrete example through it so the learner sees ' +
      'the thing happen rather than only its parts:',
    '```sequence-tool',
    '{"id":"w1","name":"walk_example","args":{"input":"the sentence \\"the cat sat\\"",' +
      '"steps":[{"partId":"a","says":"split into 4 tokens: the / cat / sat"},' +
      '{"partId":"b","says":"each token becomes a 768-number vector"}]}}',
    '```',
    'Rules: `input` must be a SPECIFIC thing — "the sentence \\"the cat sat\\"", "a 404 from ' +
      '/orders" — never "some data" or "a request". Every `partId` must be an item id from the ' +
      'chart you just drew; any other id is refused and the whole walk is lost. 2 to ' +
      `${MAX_WALK_STEPS} steps, in the order the input actually moves. Each \`says\` is ONE clause ` +
      'about what happens to THAT input at THAT part — with its real values where you know them.',
  ].join('\n');
}
