import assert from 'node:assert';
import { test } from 'node:test';
import {
  signSession,
  signState,
  verifySession,
  verifyState,
  SESSION_COOKIE,
} from '../server/session.js';

/**
 * v13 P1 — the `typ` claim on signed tokens. A session token and an OAuth state
 * token are both signed with the SAME secret, so without a kind tag one could be
 * replayed as the other. Locks: each kind verifies only as its own kind, and a
 * cross-kind presentation is rejected even though the signature is otherwise valid.
 */

const SECRET = 'typ-test-secret-0123456789abcdef';

test('a SESSION token cannot be used as a STATE token', () => {
  const sessionToken = signSession({ userId: 'google:1' }, SECRET);
  // Presented to the state verifier → rejected (typ is 'session', not 'state').
  assert.strictEqual(verifyState(sessionToken, SECRET), null);
});

test('a STATE token cannot be used as a SESSION', () => {
  const stateToken = signState({ state: 'nonce', provider: 'google' }, SECRET, 600);
  // Presented in the session cookie → rejected (typ is 'state', not 'session').
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(stateToken)}`;
  assert.strictEqual(verifySession(cookie, SECRET), null);
});

test('each kind still verifies as itself (positive round-trips)', () => {
  const sessionToken = signSession({ userId: 'google:42', provider: 'google' }, SECRET);
  const out = verifySession(`${SESSION_COOKIE}=${encodeURIComponent(sessionToken)}`, SECRET);
  assert.ok(out && out.userId === 'google:42', 'a real session verifies');

  const stateToken = signState({ state: 'abc', provider: 'github' }, SECRET, 600);
  const st = verifyState(stateToken, SECRET);
  assert.ok(st && st.state === 'abc' && st.provider === 'github', 'a real state token verifies');
});
