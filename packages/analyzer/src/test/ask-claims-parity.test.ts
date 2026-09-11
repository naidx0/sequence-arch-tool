/**
 * THE BUFFERED ROUTE MUST SAY EVERYTHING THE STREAMING ROUTE SAYS, minus the
 * live-progress fields it has nowhere to put.
 *
 * `/api/ask` hand-builds its JSON payload field by field while the SSE route emits
 * `resultPayload()`. Every field added to the pipeline has to be added twice, and the
 * one that is forgotten is invisible until someone diffs the two by hand. `coverage`
 * was forgotten once; `claims` was forgotten the same way and for longer.
 *
 * `claims` is the moat on the PROSE side: checkAnswerClaims runs the answer against
 * the scanned graph and attaches a report only when it has something to say. Dropping
 * it meant the buffered route could return a fabricated answer while the product had
 * already noticed and had nowhere to put the finding.
 *
 * THE LISTS ARE NOT THE TEST. A declared list agrees with itself; this reads the
 * REAL payload the route builds, so a field that is listed but not sent still fails.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RESULT_PAYLOAD_FIELDS,
  BUFFERED_PAYLOAD_FIELDS,
  STREAMING_ONLY_FIELDS,
  INTERNAL_RESULT_FIELDS,
} from '../server/askPayloadFields.js';

/* The COMPILED test lives in dist/, so a URL relative to import.meta.url points at a
   .ts file that was never emitted there. Walk up to the package root and read the
   real source instead — this test is ABOUT the source, not about the build. */
function serverSource(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(dir, 'src', 'server', 'repoServer.ts');
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('could not find src/server/repoServer.ts from ' + import.meta.url);
}


/** Same walk, for the file that DECLARES the result shape. */
function pipelineSource(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(dir, 'src', 'server', 'askPipeline.ts');
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('could not find src/server/askPipeline.ts from ' + import.meta.url);
}

test('every non-streaming result field is assigned onto the buffered payload', () => {
  /*
   * Read the route's own source: the buffered payload is built by a run of
   * `payload.<field> = result.<field>` assignments, so the source is the ground
   * truth for what it sends. A list that claims a field the route never assigns
   * fails here, which is what stops these constants from becoming decoration.
   */
  const src = fs.readFileSync(serverSource(), 'utf8');
  const assigned = new Set<string>();
  for (const m of src.matchAll(/payload\.([A-Za-z]+)\s*=/g)) assigned.add(m[1]!);
  assigned.add('text'); // seeded in the object literal, not assigned

  const missing = BUFFERED_PAYLOAD_FIELDS.filter((f) => !assigned.has(f));
  assert.deepStrictEqual(
    missing,
    [],
    `the buffered /api/ask payload never assigns ${missing.join(', ')} — a reader on ` +
      'that route cannot see something the streaming route shows. Add it in repoServer.ts.',
  );
});

test('the streaming-only exemption is explicit and minimal', () => {
  for (const f of STREAMING_ONLY_FIELDS) {
    assert.ok(
      (RESULT_PAYLOAD_FIELDS as readonly string[]).includes(f),
      `${f} is exempted from a contract it is not part of`,
    );
  }
  assert.ok(!BUFFERED_PAYLOAD_FIELDS.includes('metrics'), 'how the turn ran is not the answer');
  assert.ok(BUFFERED_PAYLOAD_FIELDS.includes('claims'), 'the grounding check IS part of the answer');
  assert.ok(BUFFERED_PAYLOAD_FIELDS.includes('coverage'));
});

test('every AskPipelineResult field is CLASSIFIED — a field nobody declared is invisible', () => {
  /*
   * THE HOLE IN THE MECHANISM ABOVE, found the night `premise` was written.
   *
   * The lists are declared rather than derived, and that is what makes them
   * honest — a list inferred from the implementation agrees with whatever the
   * implementation does, including with the omission it exists to catch. But it
   * cuts the other way too: a field the pipeline learns to produce and NOBODY
   * declares is not checked by anything here. It is invisible, which is the same
   * defect this file is about, one level up.
   *
   * Two fields were in exactly that state. `premise` — the mirror of `claims`,
   * checking the premise in the QUESTION rather than the claims in the answer —
   * was added to the result, attached, and reached no route; every test passed,
   * because an undeclared field is not one this file knows to look for. `verify`,
   * the done-when receipt, had been on the streaming route and named nowhere for
   * longer.
   *
   * So the interface itself is now the ground truth: every field on
   * `AskPipelineResult` must be declared on the wire or declared internal. A
   * field that is genuinely in-process is fine; a field that is nothing at all is
   * not possible any more.
   */
  const src = fs.readFileSync(pipelineSource(), 'utf8');
  const block = /export interface AskPipelineResult\s*\{([\s\S]*?)\n\}/.exec(src);
  assert.ok(block, 'could not find the AskPipelineResult interface in askPipeline.ts');

  /* Field lines only: two-space indent, a name, then `?:` or `:`. Nested object
     members sit deeper and comment bodies never match this shape. */
  const declared = new Set<string>();
  for (const m of block[1]!.matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*)\??:/gm)) declared.add(m[1]!);
  assert.ok(declared.size > 5, `parsed too few fields (${declared.size}) — did the shape change?`);

  const classified = new Set<string>([
    ...(RESULT_PAYLOAD_FIELDS as readonly string[]),
    ...(INTERNAL_RESULT_FIELDS as readonly string[]),
  ]);
  const unclassified = [...declared].filter((f) => !classified.has(f)).sort();
  assert.deepStrictEqual(
    unclassified,
    [],
    `AskPipelineResult fields declared nowhere: ${unclassified.join(', ')}. Add each to ` +
      'RESULT_PAYLOAD_FIELDS (and to BOTH routes), or to INTERNAL_RESULT_FIELDS if it never ' +
      'reaches the wire. A field in neither list is one no test can see.',
  );

  /* And the reverse: a list naming a field the interface does not have is stale. */
  const phantom = [...classified].filter((f) => !declared.has(f)).sort();
  assert.deepStrictEqual(phantom, [], `declared fields that no longer exist: ${phantom.join(', ')}`);
});
