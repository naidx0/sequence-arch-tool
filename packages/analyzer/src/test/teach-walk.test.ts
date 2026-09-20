import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_WALK_STEPS, validateWalk, walkEvidence } from '../server/teachWalk.js';
import { askToolsForJobMode, executeAskTool } from '../server/askTools.js';

/*
 * THE FOURTH BEAT OF THE TEACHING JOURNEY.
 *
 * The owner's shape: ask what the learner knows → DRAW the thing → "have you
 * seen this before?" → WALK ONE REAL INPUT THROUGH THE PICTURE. The first
 * three shipped (`TeachKnownCards`, `propose_chart`, `checkIn.ts`); this is
 * the one that turns a diagram into an explanation, because a box-and-arrow
 * chart shows you the PARTS and only a worked example shows what happens.
 */

/** The item ids of a chart that was actually drawn. */
const DRAWN = ['tok', 'emb', 'attn'];

const GOOD = {
  input: 'the sentence "the cat sat"',
  steps: [
    { partId: 'tok', says: 'split into 3 tokens: the / cat / sat' },
    { partId: 'emb', says: 'each token becomes a 768-number vector' },
    { partId: 'attn', says: '"sat" attends most strongly to "cat"' },
  ],
};

describe('a walk may only name parts of the picture that was drawn', () => {
  it('accepts a walk over real parts', () => {
    const r = validateWalk(GOOD, DRAWN);
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.walk.steps.length, 3);
    assert.equal(r.ok && walkEvidence(r.walk), 'walked "the sentence "the cat sat"" through 3 part(s) of the picture');
  });

  it('REFUSES THE WHOLE WALK for one invented partId, and names the real ones', () => {
    // Dropping the bad step would leave a silent hole the reader cannot see —
    // the same argument `drawFromGeneralKnowledge` makes about a claimed
    // nodeId voiding the whole chart rather than being stripped.
    const r = validateWalk(
      { ...GOOD, steps: [...GOOD.steps, { partId: 'softmax', says: 'normalise' }] },
      DRAWN,
    );
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.reason, /not a part of the picture you drew/);
    assert.match(r.ok ? '' : r.reason, /The parts are: tok, emb, attn/);
  });

  it('refuses when NOTHING has been drawn, and says to draw first', () => {
    // A walk cannot come before a picture. That is not a limitation, it is the
    // order of the lesson.
    const r = validateWalk(GOOD, []);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.reason, /Draw it first/);
  });

  it('refuses a vague input — the whole point is ONE concrete thing', () => {
    const r = validateWalk({ ...GOOD, input: '   ' }, DRAWN);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.reason, /name the CONCRETE input/);
  });

  it('one beat is a caption, not a walk', () => {
    const r = validateWalk({ ...GOOD, steps: [GOOD.steps[0]!] }, DRAWN);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.reason, /at least 2 steps/);
  });

  it('caps the length — a lesson that is thirty beats has stopped being one', () => {
    const many = Array.from({ length: MAX_WALK_STEPS + 1 }, () => ({
      partId: 'tok',
      says: 'x',
    }));
    const r = validateWalk({ ...GOOD, steps: many }, DRAWN);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.reason, /at most 12 steps/);
  });

  it('a step with no "says" is refused — a lit box that explains nothing', () => {
    const r = validateWalk(
      { ...GOOD, steps: [{ partId: 'tok', says: '' }, { partId: 'emb', says: 'y' }] },
      DRAWN,
    );
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.reason, /needs "says"/);
  });
});

describe('the tool, through the real executor', () => {
  it('runs against the parts the pipeline recorded from the drawn chart', async () => {
    const r = await executeAskTool('walk_example', GOOD, {
      repoRoot: null,
      designMode: true,
      drawnPartIds: DRAWN,
    } as never);
    assert.equal(r.ok, true, r.evidence);
    assert.equal(r.walk?.steps.length, 3);
    assert.match(r.content ?? '', /1\. \[tok\] split into 3 tokens/);
    // And it tells the model not to say it all twice.
    assert.match(r.content ?? '', /Do not repeat the walk in prose/);
  });

  it('a refusal names the rule so the next round can fix it', async () => {
    const r = await executeAskTool('walk_example', GOOD, {
      repoRoot: null,
      designMode: true,
      drawnPartIds: [],
    } as never);
    assert.equal(r.ok, false);
    assert.match(r.evidence, /^refused: walk_example — /);
  });
});

describe('who is offered the walk', () => {
  it('a TEACH turn is — it is teach\'s own tool', () => {
    assert.ok(askToolsForJobMode('code', 'build', { teach: true }).includes('walk_example'));
  });

  it('NO other belt carries it, at any mode', () => {
    // An engineer asking what breaks if a service changes is not owed a guided
    // tour of the answer, and a tool offered where it has no job is a round the
    // model may spend finding that out.
    for (const permission of ['plan', 'build', undefined]) {
      for (const job of ['code', 'work'] as const) {
        assert.ok(
          !askToolsForJobMode(job, permission).includes('walk_example'),
          `${job}/${permission}`,
        );
      }
    }
  });
});
