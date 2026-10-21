/**
 * A REFUSAL NAMES THE ADDRESS IT COULD NOT REACH.
 *
 * `provider request failed: fetch failed` tells a reader nothing they can act
 * on: not which host, not which port, and — the part that bit me — not whether
 * the address they think they configured is the one that was used.
 *
 * Config precedence puts `.sequence/ai.json` ahead of the environment, so the
 * endpoint actually called is often NOT the one the reader just set. I spent
 * three runs concluding `sequence ask` hung against a dead port when it had
 * never used that port at all; a message naming the endpoint would have ended
 * that in one.
 *
 * The query string is dropped: some providers carry credentials there, and this
 * string reaches logs and screens.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { generateText } from '../server/provider.js';

import type { AiConfig } from '../server/provider.js';

const deadPort = (baseUrl: string): AiConfig => ({
  provider: 'openai-compatible',
  model: 'nope',
  apiKey: 'k',
  baseUrl,
  params: { maxRetries: 0, temperature: 0 },
});

test('a refused connection names the host and port it tried', async () => {
  await assert.rejects(
    () => generateText(deadPort('http://127.0.0.1:9/v1'), 'hi'),
    (e: Error) => {
      assert.match(e.message, /provider request failed/);
      assert.match(e.message, /127\.0\.0\.1:9/, 'the reader must be able to see WHICH address');
      return true;
    },
  );
});

test('the path is kept and the query is not', async () => {
  await assert.rejects(
    () => generateText(deadPort('http://127.0.0.1:9/v1?key=SECRETVALUE'), 'hi'),
    (e: Error) => {
      assert.match(e.message, /\/v1/, 'the path says which API was called');
      assert.doesNotMatch(e.message, /SECRETVALUE/, 'a query may carry a credential');
      return true;
    },
  );
});

test('the failure is fast — a closed port is not a hang', async () => {
  /*
   * Recorded because I reported the opposite. `sequence ask` against a closed
   * port returns in about a second; the two-minute runs I saw were the CLI
   * answering for real against a busy GPU, using an endpoint my environment
   * variables never overrode.
   */
  const t = Date.now();
  await assert.rejects(() => generateText(deadPort('http://127.0.0.1:9/v1'), 'hi'));
  assert.ok(Date.now() - t < 1000, `took ${Date.now() - t}ms — a refused connection must be immediate`);
});
