/**
 * THE ASK DEFAULT USED TO FAIL OPEN, AND THAT WAS THE WHOLE BILL.
 *
 * `scopeDigestToAsk` cuts the digest to the subgraph a question NAMES; when a
 * question names nothing it returned the digest whole. MEASURED on this
 * monorepo by building the real prompt: six of eight realistic questions found
 * no seed and shipped 93,047 characters (~23,262 tokens), 87,440 of which was
 * digest JSON — "thanks" cost the same as "explain the auth flow".
 *
 * Every fixture in this repository is far too small for that to show up: the
 * shopfront digest is under 10,000 characters, so an index and a full digest
 * are the same object there and no fixture test could ever have caught it. The
 * fixture in this file is therefore built to the PRODUCTION SHAPE — a digest
 * over `ASK_INDEX_MIN_DIGEST_CHARS` — and the assertions are about the bytes
 * that reach the model, not about the shape of a helper.
 */
import assert from 'node:assert';
import { test } from 'node:test';

import {
  ASK_INDEX_MIN_DIGEST_CHARS,
  askIndexOmissionLines,
  buildAskPrompt,
  indexDigestForAsk,
  shouldIndexDigestForAsk,
  type Digest,
} from '../explain/explain.js';

/**
 * A digest the size of a real scan: ten services, fifty files each, and edges
 * that mostly stay INSIDE one service — which is the real shape (measured on
 * this repo: 174 of 300 digest edges have both endpoints in one component).
 */
function productionShapedDigest(): Digest {
  const services = Array.from({ length: 10 }, (_, s) => ({
    id: `svc:pkg${s}`,
    name: `pkg${s}`,
    dir: `packages/pkg${s}`,
    framework: 'node',
    modules: [
      {
        id: `mod:pkg${s}:core`,
        label: 'core',
        fileIds: Array.from({ length: 50 }, (_, f) => `file:packages/pkg${s}/src/module/handler-${f}.ts`),
      },
    ],
    files: Array.from({ length: 50 }, (_, f) => ({
      id: `file:packages/pkg${s}/src/module/handler-${f}.ts`,
      path: `packages/pkg${s}/src/module/handler-${f}.ts`,
    })),
  }));
  const edges: Digest['edges'] = [];
  for (let s = 0; s < 10; s++) {
    // 25 intra-service imports…
    for (let f = 0; f < 25; f++) {
      edges.push({
        id: `in${s}_${f}`,
        from: `file:packages/pkg${s}/src/module/handler-${f}.ts`,
        to: `file:packages/pkg${s}/src/module/handler-${f + 1}.ts`,
        kind: 'import',
      });
    }
    /*
     * …and 5 that cross into the next package.
     *
     * `http`, NOT `import`, since 2026-09-05. An import relates two FILES, and
     * the index no longer presents one as a connection between services -- the
     * board, impact and risks all held that rule and the prompt was the one
     * consumer that did not, rolling imports up into 162 service-to-service
     * edges the rest of the product refused to draw.
     *
     * The fixture therefore has to carry a real service-level edge to test that
     * cross-component edges survive, because with every edge an import the only
     * honest answer is that none of them do.
     */
    for (let f = 0; f < 5; f++) {
      edges.push({
        id: `x${s}_${f}`,
        from: `file:packages/pkg${s}/src/module/handler-${f}.ts`,
        to: `file:packages/pkg${(s + 1) % 10}/src/module/handler-${f}.ts`,
        kind: 'http',
      });
    }
    /* And 25 intra-service NON-import edges, so `omittedInternalEdges` still
       measures what its name says: both endpoints inside one component. */
    for (let f = 0; f < 25; f++) {
      edges.push({
        id: `inh${s}_${f}`,
        from: `file:packages/pkg${s}/src/module/handler-${f}.ts`,
        to: `file:packages/pkg${s}/src/module/handler-${f + 2}.ts`,
        kind: 'http',
      });
    }
  }
  return {
    repo: { id: 'repo', name: 'monorepo' },
    folders: ['packages'],
    services,
    datastores: [{ id: 'ds:postgres', name: 'postgres', tech: 'postgres' }],
    topics: [],
    edges,
    risks: { spofs: [{ node: 'pkg0', kind: 'service', breaks: 4, of: 10 }], cycles: [], total: 10 },
  };
}

test('the production-shaped digest really is over the indexing threshold', () => {
  /* If this ever stops being true the rest of this file is testing nothing. */
  const digest = productionShapedDigest();
  assert.ok(
    JSON.stringify(digest).length > ASK_INDEX_MIN_DIGEST_CHARS,
    'the fixture must reproduce the production shape, not fixture scale',
  );
  assert.ok(shouldIndexDigestForAsk(digest, false), 'an unscoped ask on it must index');
});

test('AN UNSCOPED ASK PAYS FOR A MAP, NOT THE TERRITORY', () => {
  const digest = productionShapedDigest();
  const full = buildAskPrompt(digest, 'hi');

  /* THE MEASUREMENT, not a shape assertion. The digest JSON alone is over
     44,000 characters; the whole assembled prompt must now come in under it. */
  assert.ok(
    full.length < JSON.stringify(digest).length,
    `the prompt (${full.length}) must be smaller than the digest it describes ` +
      `(${JSON.stringify(digest).length})`,
  );

  /* Every service is still NAMED — this is an index, not a truncation. */
  for (let s = 0; s < 10; s++) {
    assert.ok(full.includes(`svc:pkg${s}`), `service pkg${s} must still be named`);
    assert.ok(full.includes(`packages/pkg${s}`), `service pkg${s}'s directory must still be named`);
  }
  /* And the per-file detail is gone, which is the saving. */
  assert.ok(
    !full.includes('handler-30.ts'),
    'per-file paths must not be in an unscoped prompt any more',
  );
  /* Risks survive: they are precomputed, tiny, and the one thing the model is
     told never to recompute by hand. */
  assert.ok(full.includes('spofs'), 'the precomputed risk block stays');
});

test('THE INDEX SAYS WHAT IT LEFT OUT, AND HOW TO GET IT BACK', () => {
  const digest = productionShapedDigest();
  const result = indexDigestForAsk(digest);
  assert.strictEqual(result.omittedFiles, 500, 'ten services × fifty files');
  assert.strictEqual(result.omittedModuleFileIds, 500);
  assert.strictEqual(result.omittedInternalEdges, 250, '25 intra-service http edges × ten services');
  /* The imports -- 25 per service, all intra-service in this fixture -- none of
     them presented as a service connection. Their own counter, because "inside
     one component" and "is a file-level claim" are different reasons, and one
     number carrying both would tell the model a true total with a false cause. */
  assert.strictEqual(result.omittedFileLevelEdges, 250, '25 imports × ten services');

  const lines = askIndexOmissionLines(result).join('\n');
  assert.match(lines, /500 digest file paths omitted/);
  assert.match(lines, /read_topology/, 'the marker names the tool that gets them back');
  assert.match(lines, /250 digest edges omitted/);
  assert.match(lines, /250 file-level edges \(imports\) are NOT shown as service connections/);

  const prompt = buildAskPrompt(digest, 'hi');
  assert.ok(prompt.includes('500 digest file paths omitted'), 'the marker reaches the model');
  assert.match(
    prompt,
    /NEVER name a file or symbol you have not seen/,
    'and so does the instruction that makes the index safe to hand a weak model',
  );
});

test('THE CROSS-COMPONENT EDGES SURVIVE WHOLE — coverage still measures real edges', () => {
  const digest = productionShapedDigest();
  const result = indexDigestForAsk(digest);
  assert.strictEqual(result.digest.edges.length, 50, 'five cross edges × ten services');
  for (const e of result.digest.edges) {
    assert.ok(
      digest.edges.some((o) => o.id === e.id && o.from === e.from && o.to === e.to),
      'every surviving edge is a real digest edge with its real id — nothing synthesised',
    );
  }
  /* The rollup is a COUNT of those same edges, never an invented relationship. */
  const rollup = result.digest.serviceEdges ?? [];
  assert.strictEqual(
    rollup.reduce((n, r) => n + r.count, 0),
    50,
    'the rollup counts exactly the edges it summarises',
  );
  for (const r of rollup) {
    assert.notStrictEqual(r.from, r.to, 'a rollup entry is always between two components');
  }
});

test('A NAMED SUBJECT IS NEVER INDEXED — scoping already answered that question', () => {
  /*
   * Indexing a scoped ask would hide the very files the reader asked about.
   * The index exists for the case that used to fail OPEN, not for the one that
   * already worked.
   */
  const digest = productionShapedDigest();
  const scopedPrompt = buildAskPrompt(digest, 'what does pkg3 do?');
  assert.ok(scopedPrompt.includes('packages/pkg3/src/module/handler-30.ts'));
  assert.ok(
    !scopedPrompt.includes('NEVER name a file or symbol you have not seen'),
    'a scoped ask is not told it holds an index',
  );
});

test('FIXTURE SCALE IS BYTE-IDENTICAL — a small repo has nothing to hide', () => {
  const small: Digest = {
    repo: { id: 'repo', name: 'tiny' },
    folders: [],
    services: [
      {
        id: 'svc:api',
        name: 'api',
        dir: 'api',
        modules: [],
        files: [{ id: 'file:api/main.ts', path: 'api/main.ts' }],
      },
    ],
    datastores: [],
    topics: [],
    edges: [],
  };
  assert.ok(!shouldIndexDigestForAsk(small, false));
  const prompt = buildAskPrompt(small, 'hi');
  assert.ok(prompt.includes('api/main.ts'), 'the whole digest still ships at fixture scale');
  assert.ok(!prompt.includes('NEVER name a file or symbol you have not seen'));
});
