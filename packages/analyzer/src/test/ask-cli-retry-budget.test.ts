/**
 * A TRANSIENT PROVIDER FAILURE MUST NOT END A TURN THAT HAS ALREADY WORKED.
 *
 * Practical ML's stream-json replay, 2026-09-05: a teach turn taught its concept,
 * then its third provider call died with "provider request failed: fetch failed"
 * on an UNCONTENDED card with the model resident. The turn ended with "the model
 * provider failed after 2 completed round(s)" — an honest sentence that was
 * masking a retryable condition.
 *
 * `isTransientProviderFailure` already classifies that message as transient. The
 * retry was never taken because `maxRetries` defaults to 0, and provider.ts says
 * deliberately that retrying is only ever taken under the CALLER'S explicit
 * budget. The CLI is a caller and had never decided.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const askCliSource = (): string => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(path.resolve(here, '..', '..', 'src', 'askCli.ts'), 'utf8');
};

test('RED WITHOUT THE FIX: the ask CLI states a retry budget', () => {
  assert.match(askCliSource(), /maxRetries:\s*2/);
});

test("a config's own params win — a reader who set 0 gets 0", () => {
  /* The spread puts the resolved config's params AFTER the default, so an
     explicit choice is never overridden by ours. */
  const src = askCliSource();
  const i = src.indexOf('maxRetries: 2');
  assert.ok(i > 0);
  assert.match(src.slice(i, i + 120), /\.\.\.\(resolvedCfg\.params \?\? \{\}\)/);
});

test('the reason is recorded where the number is', () => {
  /* A bare 2 is a magic number; the failure it answers is what makes it
     reviewable. */
  const src = askCliSource();
  const i = src.indexOf('maxRetries: 2');
  assert.match(src.slice(Math.max(0, i - 1500), i), /transient/i);
});
