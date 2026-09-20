/**
 * The filter is the teacher. If it accepts something the product would reject —
 * or rejects something the product accepts — every downstream number is a lie.
 * So these tests run the REAL validator out of packages/web/src, never a copy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadValidator } from '../lib/engine.mjs';
import { REJECT_REASONS, filterCandidates, gradeCandidate } from '../lib/filter.mjs';
import * as C from '../fixtures/candidates.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const graph = JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', 'graph.json'), 'utf8'));

const validate = await loadValidator();

test('the accepted sample is the product\'s own parse, not a re-implementation', () => {
  const r = gradeCandidate({ text: C.GOOD, graph, validate });
  assert.equal(r.ok, true);
  assert.equal(r.proposal.summary, 'Add a Redis read cache in front of catalog');
  assert.equal(r.proposal.addCards[0].anchorId, 'svc:catalog');
  // The same object the product would hand to applyArchProposalToDraft.
  assert.deepEqual(validate(C.GOOD, graph), r.proposal);
});

test('the removal shape is accepted, so removeCardIds is not learned as always-empty', () => {
  const r = gradeCandidate({ text: C.GOOD_REMOVE, graph, validate });
  assert.equal(r.ok, true);
  assert.deepEqual(r.proposal.removeCardIds, ['svc:payments']);
});

const rejects = [
  ['a reply with no fenced block', C.NO_FENCE, REJECT_REASONS.NO_FENCE],
  ['malformed JSON inside the fence', C.MALFORMED, REJECT_REASONS.BAD_JSON],
  ['the wrong fence language', C.WRONG_FENCE, REJECT_REASONS.BAD_JSON],
  ['an anchor id that does not exist', C.UNREAL_ANCHOR, REJECT_REASONS.UNREAL_ANCHOR],
  ['an edge endpoint that does not exist', C.UNREAL_EDGE, REJECT_REASONS.UNREAL_EDGE_ENDPOINT],
  ['a removed id that does not exist', C.UNREAL_REMOVE, REJECT_REASONS.UNREAL_REMOVE_ID],
  ['a prop: endpoint nothing declared', C.UNDECLARED_PROP, REJECT_REASONS.UNDECLARED_PROP_ENDPOINT],
  ['a proposal that proposes nothing', C.EMPTY_DIFF, REJECT_REASONS.EMPTY_DIFF],
  ['a block with no summary', C.NO_SUMMARY, REJECT_REASONS.NO_SUMMARY],
];

for (const [name, text, reason] of rejects) {
  test(`rejects ${name} with reason ${reason}`, () => {
    const r = gradeCandidate({ text, graph, validate });
    assert.equal(r.ok, false, `expected a reject for: ${name}`);
    assert.equal(r.reason, reason);
  });
}

test('the two stricter-than-validator rules only ever REJECT — the validator is never overruled upward', () => {
  // Both of these parse under the product validator; our filter is the one
  // saying no. That asymmetry is the contract: stricter, never looser.
  assert.ok(validate(C.UNREAL_REMOVE, graph), 'the product validator does accept an ungrounded removeCardIds');
  assert.ok(validate(C.UNDECLARED_PROP, graph), 'the product validator does accept an undeclared prop: endpoint');
  assert.equal(gradeCandidate({ text: C.UNREAL_REMOVE, graph, validate }).ok, false);
  assert.equal(gradeCandidate({ text: C.UNDECLARED_PROP, graph, validate }).ok, false);
});

test('a batch reports why things failed, and keeps no rejected text', () => {
  const candidates = [
    { id: 'a', repoId: 'fx', request: 'r', text: C.GOOD, graph },
    { id: 'b', repoId: 'fx', request: 'r', text: C.NO_FENCE, graph },
    { id: 'c', repoId: 'fx', request: 'r', text: C.MALFORMED, graph },
    { id: 'd', repoId: 'fx', request: 'r', text: C.WRONG_FENCE, graph },
    { id: 'e', repoId: 'fx', request: 'r', text: C.UNREAL_ANCHOR, graph },
  ];
  const out = filterCandidates(candidates, validate);
  assert.equal(out.accepted.length, 1);
  assert.equal(out.total, 5);
  assert.equal(out.passRate, 0.2);
  assert.deepEqual(out.reasonCounts, {
    [REJECT_REASONS.NO_FENCE]: 1,
    [REJECT_REASONS.BAD_JSON]: 2,
    [REJECT_REASONS.UNREAL_ANCHOR]: 1,
  });
  // Rejects are discarded, never repaired: the raw text does not survive.
  for (const r of out.rejected) assert.equal(r.text, undefined);
});

test('a candidate that is not a string is a reject, not a crash', () => {
  assert.equal(gradeCandidate({ text: undefined, graph, validate }).ok, false);
  assert.equal(gradeCandidate({ text: null, graph, validate }).reason, REJECT_REASONS.NO_FENCE);
});
