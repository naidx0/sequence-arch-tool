/**
 * G1 — subject-subgraph digest for named/selected services.
 *
 * Shopfront “Explain how orders reaches payments and postgres” must not pay
 * the whole 8-service digest. Needles (orders→payments http, orders→postgres db)
 * stay; the gateway→redis trap stays absent; dropped services are marked.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import {
  askScopeOmissionLines,
  buildAskPrompt,
  buildDigest,
  scopeDigestToAsk,
} from '../explain/explain.js';
import { approxTokens } from '../llm/tokenBudget.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');
const SHOPFRONT_ASK = 'Explain how orders reaches payments and postgres.';

function hasEdge(
  edges: { from: string; to: string; kind: string }[],
  fromNeedle: string,
  toNeedle: string,
): boolean {
  return edges.some(
    (e) =>
      e.from.toLowerCase().includes(fromNeedle) && e.to.toLowerCase().includes(toNeedle),
  );
}

test('scopeDigestToAsk: shopfront reaches-ask is smaller than the full digest and keeps needles', async () => {
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  const full = buildDigest(graph);
  const fullJson = JSON.stringify(full);
  const fullTokens = approxTokens(fullJson);
  assert.ok(fullTokens >= 2000, `full shopfront digest should be ~2159 tok, got ${fullTokens}`);

  const scoped = scopeDigestToAsk(full, SHOPFRONT_ASK);
  assert.ok(scoped.scoped, 'named services must cut the digest');
  const scopedJson = JSON.stringify(scoped.digest);
  const scopedTokens = approxTokens(scopedJson);
  assert.ok(
    scopedTokens < fullTokens,
    `scoped digest (${scopedTokens}) must be below full (${fullTokens})`,
  );
  assert.ok(scoped.omittedServices > 0, 'at least one service dropped from the 8-service fixture');

  assert.ok(hasEdge(scoped.digest.edges, 'orders', 'payments'), 'orders→payments stays');
  assert.ok(
    hasEdge(scoped.digest.edges, 'orders', 'postgres') ||
      hasEdge(scoped.digest.edges, 'orders', 'db'),
    'orders→postgres stays',
  );
  assert.ok(
    !hasEdge(scoped.digest.edges, 'gateway', 'redis'),
    'must not invent gateway→redis',
  );
  assert.ok(scoped.digest.services.some((s) => /orders/i.test(s.name) || /orders/i.test(s.id)));
  assert.ok(scoped.digest.services.some((s) => /payments/i.test(s.name) || /payments/i.test(s.id)));
  assert.ok(
    scoped.digest.datastores.some((d) => /postgres/i.test(d.name) || /postgres/i.test(d.id)),
  );

  const markers = askScopeOmissionLines(scoped).join('\n');
  assert.match(markers, /omitted \(not in the asked subgraph\)/);
  assert.ok(!/omitted to fit the model budget/.test(markers));
});

test('buildAskPrompt: shopfront reaches-ask carries the subgraph, not the whole fixture', async () => {
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  const digest = buildDigest(graph);
  const fullPrompt = buildAskPrompt(digest, 'what is fragile?');
  const scopedPrompt = buildAskPrompt(digest, SHOPFRONT_ASK);

  assert.ok(!/not in the asked subgraph/.test(fullPrompt), 'fragility ask is unscoped');

  assert.match(scopedPrompt, /omitted \(not in the asked subgraph\)/);
  assert.ok(scopedPrompt.includes('orders'));
  assert.ok(scopedPrompt.includes('payments'));
  assert.ok(scopedPrompt.includes('postgres'));
  assert.ok(
    /orders[\s\S]{0,80}payments|payments[\s\S]{0,80}orders/.test(scopedPrompt),
    'orders–payments edge present in prompt digest',
  );
  assert.ok(
    !/"from"\s*:\s*"[^"]*gateway[^"]*"\s*,\s*"to"\s*:\s*"[^"]*redis/.test(scopedPrompt),
    'prompt must not invent gateway→redis',
  );
  // Grounding stack stays — do not “win” tokens by deleting honesty clauses.
  assert.match(scopedPrompt, /Do NOT invent/);
  assert.match(scopedPrompt, /STRUCTURE DIGEST/);
});

test('scopeDigestToAsk: board selection scopes even when the question is generic', async () => {
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  const digest = buildDigest(graph);
  const orders = digest.services.find((s) => /orders/i.test(s.id) || /orders/i.test(s.name));
  assert.ok(orders);
  const generic = scopeDigestToAsk(digest, 'what is fragile?');
  assert.ok(!generic.scoped);
  const selected = scopeDigestToAsk(digest, 'what is fragile?', { subjectNodeId: orders.id });
  assert.ok(selected.scoped);
  assert.ok(selected.digest.services.some((s) => s.id === orders.id));
  assert.ok(selected.digest.services.length < digest.services.length);
});
