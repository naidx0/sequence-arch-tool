import assert from 'node:assert';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { coverageTool } from '../index.js';

/**
 * THE CLAIM AN AGENT CONSUMING US COULD NOT CARRY.
 *
 * Every other tool on this server answers a question. None of them could say
 * how much of the repository the answer was built from — which is the claim
 * that separates a grounded tool from a confident one, and the one Sequence
 * exists to make.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.resolve(here, '..', '..', '..', 'analyzer', 'test', 'fixtures', 'shopfront');

function payload(res: Awaited<ReturnType<typeof coverageTool>>): Record<string, unknown> {
  return JSON.parse((res.content?.[0] as { text?: string } | undefined)?.text ?? '{}');
}

test('coverage: reports edges seen against the whole scanned graph', async () => {
  const body = payload(await coverageTool({ repoPath: SHOPFRONT }));

  const seen = body.edgesSeen as number;
  const total = body.edgesTotal as number;
  assert.ok(total > 0, 'shopfront has edges');
  /*
   * `edgesTotal` is the WHOLE graph and no cap can shrink it. That is the
   * property the number is for: a percentage computed against a capped
   * denominator would always look reassuring, which is the failure this claim
   * exists to prevent.
   */
  assert.ok(seen <= total, 'seen can never exceed the graph');
  assert.strictEqual(body.percentOfEdgesSeen, Math.round((seen / total) * 100));
});

test('coverage: the sentence says which components contributed nothing', async () => {
  const body = payload(await coverageTool({ repoPath: SHOPFRONT }));
  const missed = body.packagesMissed as string[];
  const answer = body.answer as string;

  if (missed.length > 0) {
    /* NAMED, not counted. "3 components contributed nothing" sends a reader
       looking; naming them ends the question. */
    for (const m of missed) assert.ok(answer.includes(m), `${m} is named in the sentence`);
  } else {
    assert.match(answer, /every component contributed/i);
  }
});

test('coverage: a bad path fails as a structured error, never a throw', async () => {
  const res = await coverageTool({ repoPath: path.join(SHOPFRONT, 'does-not-exist') });
  /* A thrown handler kills the MCP session; every tool here returns a
     structured error instead. */
  assert.strictEqual(res.isError, true);
});
