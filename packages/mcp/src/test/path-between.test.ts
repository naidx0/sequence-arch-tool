import assert from 'node:assert';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { pathBetweenTool } from '../index.js';

/**
 * THE ROUTE, ANSWERED ON A REAL REPOSITORY.
 *
 * `paths.test.ts` in the schema package locks the algorithm on hand-built link
 * lists. This is the other half: that the tool resolves real names off a real
 * scan and comes back with a route a person could follow. A pure function
 * nothing calls answers nobody's question — the lesson this repo has now paid
 * for twice, where the state was right and no surface read it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.resolve(
  here,
  '..',
  '..',
  '..',
  'analyzer',
  'test',
  'fixtures',
  'shopfront',
);

function payload(res: Awaited<ReturnType<typeof pathBetweenTool>>): Record<string, unknown> {
  const text = (res.content?.[0] as { text?: string } | undefined)?.text ?? '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

test('path_between: finds a real route across the shopfront services', async () => {
  const res = await pathBetweenTool({
    repoPath: SHOPFRONT,
    from: 'gateway',
    to: 'postgres',
    includeImports: false,
  });
  const body = payload(res);

  assert.ok((body.count as number) > 0, `expected a route, got: ${JSON.stringify(body).slice(0, 300)}`);
  const paths = body.paths as string[][];
  for (const p of paths) {
    /* Every route starts where asked and ends where asked — the property that
       fails first if the adjacency is ever transposed. */
    assert.match(p[0]!, /gateway/);
    assert.match(p[p.length - 1]!, /postgres/);
  }
  /* And it reads as a route, not as a set. */
  assert.match(body.answer as string, /->/);

  /*
   * THE LIFT IS THE REASON THIS ANSWERS AT ALL, so it is asserted rather than
   * left implicit. A db edge is recorded FILE-level — `gateway/src/db.ts ->
   * ds:postgres` — while the gateway SERVICE reaches its files through
   * `parentId`, and containment is not an edge. Without lifting, this walk
   * starts at a node with no outgoing edges and returns "no route" for two
   * things connected on the line below.
   */
  assert.strictEqual(body.level, 'systems');
});

test('path_between: an unresolved name is reported as unresolved, not as "no route"', async () => {
  const res = await pathBetweenTool({
    repoPath: SHOPFRONT,
    from: 'gateway',
    to: 'not-a-real-service-xyz',
  });
  const body = payload(res);
  assert.deepStrictEqual(body.unresolved, ['not-a-real-service-xyz']);
  /*
   * The distinction the whole result shape exists for. Rendering "no route" for
   * a name that never resolved tells someone their architecture is
   * disconnected when they actually made a typo.
   */
  assert.match(body.answer as string, /did not resolve|Could not find/i);
});

test('path_between: the cross-service lens excludes imports when asked', async () => {
  const withImports = payload(
    await pathBetweenTool({ repoPath: SHOPFRONT, from: 'gateway', to: 'postgres' }),
  );
  const without = payload(
    await pathBetweenTool({
      repoPath: SHOPFRONT,
      from: 'gateway',
      to: 'postgres',
      includeImports: false,
    }),
  );
  assert.strictEqual(withImports.includeImports, true, 'imports are in by default, like who_calls');
  assert.strictEqual(without.includeImports, false);
});

test('path_between: a bound that bites is reported', async () => {
  const body = payload(
    await pathBetweenTool({
      repoPath: SHOPFRONT,
      from: 'gateway',
      to: 'postgres',
      includeImports: false,
      maxDepth: 2,
    }),
  );
  /* Two nodes cannot hold gateway → something → postgres. The answer must say
     the depth stopped it rather than report a disconnected architecture. */
  assert.strictEqual(body.count, 0);
  assert.strictEqual(body.truncated, true);
  assert.match(String(body.note), /route within 2 nodes/i);
});
