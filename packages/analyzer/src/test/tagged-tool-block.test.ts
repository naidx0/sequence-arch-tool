/**
 * LOCKS the `<sequence-tool>` tagged form, built from the shape a model emitted.
 *
 * MEASURED 2026-09-08. minicpm5-hermes, 2.6B, answering a design ask through
 * `sequence ask --mode design`, produced a `propose_topology` call with real
 * nodes and edges — and wrapped it in `<sequence-tool>` TAGS instead of a
 * ```sequence-tool FENCE. The instruction says the word "fence" and shows one;
 * a small model read that as a tag name.
 *
 * The parser matched neither form, so the whole call was dropped as prose and
 * the board never saw a proposal that was otherwise correct. That is the defect
 * these lock: a model that did the work and reached for the wrong bracket.
 *
 * WHAT IS DELIBERATELY NOT WIDENED. The body must still parse as JSON, still
 * carry a string `name`, and that name must still be on the allowlist. Those
 * three checks run on the same bodies through the same code path, because the
 * tagged form is rewritten into the fenced form before anything parses. Tests 3
 * and 4 exist to prove the widening did not become a hole.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFencedToolRequests } from '../server/askTools.js';

const CALL = JSON.stringify({
  id: 'd1',
  name: 'propose_topology',
  args: {
    title: 'URL shortener',
    nodes: [{ id: 'proposal:api', label: 'Shortener API', kind: 'service' }],
    edges: [],
  },
});

test('a tagged block is executed, not dropped as prose', () => {
  const text = 'Here is the design.\n\n<sequence-tool>\n' + CALL + '\n</sequence-tool>\n';
  const out = parseFencedToolRequests(text);
  assert.equal(out.requests.length, 1, 'the tagged call must reach the board');
  assert.equal(out.requests[0].name, 'propose_topology');
  assert.deepEqual(out.malformed, [], 'a well-formed tagged block is not a complaint');
  assert.ok(!out.stripped.includes('propose_topology'), 'the block is stripped from the prose');
  assert.ok(out.stripped.includes('Here is the design.'), 'the prose around it survives');
});

test('the fenced form still works — this widened a delimiter, it did not move one', () => {
  const text = '```sequence-tool\n' + CALL + '\n```';
  const out = parseFencedToolRequests(text);
  assert.equal(out.requests.length, 1);
  assert.equal(out.requests[0].name, 'propose_topology');
});

test('a tagged block that is not JSON is refused, and says so', () => {
  const text = '<sequence-tool>\nnot json at all\n</sequence-tool>';
  const out = parseFencedToolRequests(text);
  assert.equal(out.requests.length, 0, 'rubbish in a tag is still rubbish');
  assert.equal(out.malformed.length, 1, 'and it is reported rather than silently dropped');
});

test('a tagged block naming a tool that does not exist is refused', () => {
  const text =
    '<sequence-tool>\n' + JSON.stringify({ id: 'x', name: 'delete_everything' }) + '\n</sequence-tool>';
  const out = parseFencedToolRequests(text);
  assert.equal(out.requests.length, 0, 'the allowlist still holds through the new door');
  assert.ok(
    out.malformed.some((m) => m.includes('delete_everything')),
    'and the refusal names what was asked for',
  );
});

test('both forms in one answer are both executed', () => {
  const second = JSON.stringify({ id: 'd2', name: 'propose_topology', args: { title: 'B' } });
  const text = '<sequence-tool>\n' + CALL + '\n</sequence-tool>\n\n```sequence-tool\n' + second + '\n```';
  const out = parseFencedToolRequests(text);
  assert.equal(out.requests.length, 2, 'a model may mix delimiters within one answer');
  assert.deepEqual(
    out.requests.map((r) => r.id),
    ['d1', 'd2'],
  );
});

/* Photo 3, 2026-09-22 — the exact tail of Bastion turn 17. The label sat on
   the line after the backticks, so the block opened as plain code and the
   reader saw "sequence-tool )". */
test('a fence whose label is on the next line is a tool fence, and never reaches the reader', () => {
  const text =
    'Proposing a new service with a db edge.' + String.fromCharCode(10, 10) +
    '```' + String.fromCharCode(10) + 'sequence-tool' + String.fromCharCode(10) + ')' +
    String.fromCharCode(10) + '```';
  const out = parseFencedToolRequests(text);
  assert.doesNotMatch(out.stripped, /sequence-tool|```/);
  assert.equal(out.stripped, 'Proposing a new service with a db edge.');
  assert.equal(out.malformed.length, 1, 'the failed call is reported, not silent');
});

test('a misplaced label with a real call still runs the call', () => {
  const nl = String.fromCharCode(10);
  const text = '```' + nl + 'sequence-tool' + nl + '{"id":"r1","name":"read_file","args":{"path":"a.ts"}}' + nl + '```';
  const out = parseFencedToolRequests(text);
  assert.equal(out.requests.length, 1);
  assert.equal(out.requests[0]?.name, 'read_file');
  assert.equal(out.stripped, '');
});

test('a fence cut off by the output cap is stripped, not printed', () => {
  const nl = String.fromCharCode(10);
  const text = 'Drawing it now.' + nl + nl + '```sequence-tool' + nl + '{"id":"d1","name":"propose_topology","args":{"nodes":[';
  const out = parseFencedToolRequests(text);
  assert.equal(out.stripped, 'Drawing it now.');
  assert.equal(out.malformed.length, 1);
});

test('an ordinary code block is left alone', () => {
  const nl = String.fromCharCode(10);
  const text = 'Run:' + nl + '```' + nl + 'npm test' + nl + '```';
  const out = parseFencedToolRequests(text);
  assert.equal(out.stripped, text);
  assert.equal(out.malformed.length, 0);
});
