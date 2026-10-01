/**
 * Prompt assembly is the seam where training and inference must agree, so it is
 * tested for determinism and for the properties the contract depends on.
 *
 * `buildAskPrompt` is the SHIPPED function out of packages/analyzer/dist — the
 * same one `POST /api/ask` calls. If that build is missing, this file says so
 * plainly rather than testing a stand-in.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { REPO_ROOT } from '../lib/paths.mjs';
import { PROPOSAL_CONTRACT_LINES, PROPOSAL_CONTRACT_VERSION, buildProposalPrompt } from '../lib/prompt.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const graph = JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', 'graph.json'), 'utf8'));

const explainDist = path.join(REPO_ROOT, 'packages/analyzer/dist/explain/explain.js');
const built = fs.existsSync(explainDist);
const { buildAskPrompt, buildDigest } = built ? await import(pathToFileURL(explainDist).href) : {};

test('the contract names every field the validator actually enforces', () => {
  const text = PROPOSAL_CONTRACT_LINES.join('\n');
  for (const field of ['summary', 'addCards', 'addEdges', 'removeCardIds', 'anchorId', 'srcId', 'dstId', 'entranceIndex']) {
    assert.ok(text.includes(field), `the contract never mentions ${field}`);
  }
  assert.match(text, /prop:/, 'the contract must say new ids are prop:-prefixed');
  assert.match(text, /verbatim/, 'the contract must demand ids be copied verbatim from the digest');
  assert.equal(PROPOSAL_CONTRACT_VERSION, 'phase0/v1');
});

test('buildProposalPrompt refuses an empty request or a missing shipped builder', () => {
  assert.throws(() => buildProposalPrompt({ digest: {}, request: '', buildAskPrompt: () => '' }), /non-empty/);
  assert.throws(() => buildProposalPrompt({ digest: {}, request: 'x' }), /buildAskPrompt/);
});

test('prompt assembly is deterministic and carries the contract + the request', { skip: built ? false : 'run `pnpm -r build` first' }, () => {
  const digest = buildDigest(graph);
  const a = buildProposalPrompt({ digest, request: 'Add a read cache in front of `svc:catalog`.', buildAskPrompt });
  const b = buildProposalPrompt({ digest, request: 'Add a read cache in front of `svc:catalog`.', buildAskPrompt });
  assert.equal(a, b, 'the same digest + request must produce a byte-identical prompt');
  assert.ok(a.includes('--- REQUESTED ACTIONS ---'), 'the contract rides on the production composition seam');
  assert.ok(a.includes('svc:catalog'), 'the cited node id must reach the model');
  assert.ok(a.includes('```proposal') || a.includes('the word'), 'the fence instruction must be present');
  // The user's words are the ONLY thing under --- QUESTION ---; the contract is
  // a separate labelled section, exactly as the server composes an intent turn.
  const q = a.indexOf('--- QUESTION ---');
  assert.ok(q > a.indexOf('--- REQUESTED ACTIONS ---'), 'the contract must precede the question section');
  assert.ok(!a.slice(q).includes('--- REQUESTED ACTIONS ---'));
});

test('a different request changes only the question, not the digest half', { skip: built ? false : 'run `pnpm -r build` first' }, () => {
  const digest = buildDigest(graph);
  const a = buildProposalPrompt({ digest, request: 'Add a cache in front of `svc:catalog`.', buildAskPrompt });
  const b = buildProposalPrompt({ digest, request: 'Split `svc:checkout` in two.', buildAskPrompt });
  const cut = (s) => s.slice(0, s.indexOf('--- QUESTION ---'));
  assert.equal(cut(a), cut(b), 'the digest half must be identical across requests for the same repo');
  assert.notEqual(a, b);
});
