import assert from 'node:assert';
import { test } from 'node:test';
import crypto from 'node:crypto';
import {
  signSession,
  signToken,
  verifySession,
  verifyToken,
  readCookie,
  buildSetCookie,
  clearCookie,
  SESSION_COOKIE,
} from '../server/session.js';

/**
 * Signed sessions (v12 Phase 2). Locks: a valid session round-trips; a TAMPERED
 * token is rejected; an EXPIRED token is rejected; a wrong secret is rejected; the
 * check is via a constant-time HMAC compare. No external dependency — node crypto.
 */

const SECRET = 'test-session-secret-0123456789abcdef';

function cookieHeader(value: string): string {
  return `other=1; ${SESSION_COOKIE}=${encodeURIComponent(value)}; extra=2`;
}

test('signSession → verifySession round-trips the identity fields', () => {
  const token = signSession({ userId: 'google:12345', provider: 'google', name: 'Ada', email: 'ada@example.com' }, SECRET);
  const out = verifySession(cookieHeader(token), SECRET);
  assert.ok(out, 'a freshly-signed session verifies');
  assert.strictEqual(out!.userId, 'google:12345');
  assert.strictEqual(out!.provider, 'google');
  assert.strictEqual(out!.name, 'Ada');
  assert.strictEqual(out!.email, 'ada@example.com');
});

test('a TAMPERED session body is rejected (signature no longer matches)', () => {
  const token = signSession({ userId: 'github:1' }, SECRET);
  const [body, sig] = token.split('.');
  // Forge a different payload while keeping the original signature.
  const forgedBody = Buffer.from(JSON.stringify({ userId: 'github:999', exp: 9999999999 }), 'utf8').toString('base64url');
  const forged = `${forgedBody}.${sig}`;
  assert.strictEqual(verifyToken(forged, SECRET), null, 'forged body + old sig is rejected');
  // Flipping a signature byte is also rejected.
  const flipped = `${body}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`;
  assert.strictEqual(verifyToken(flipped, SECRET), null, 'flipped signature is rejected');
});

test('a session signed with a DIFFERENT secret is rejected', () => {
  const token = signSession({ userId: 'google:1' }, 'a-completely-different-secret');
  assert.strictEqual(verifySession(cookieHeader(token), SECRET), null);
});

test('an EXPIRED token is rejected', () => {
  // ttl of 1s, then fast-forward past it. signToken bakes exp into the payload.
  const token = signToken({ userId: 'google:1', state: 'x' }, SECRET, 1);
  // Immediately valid.
  assert.ok(verifyToken(token, SECRET), 'valid before expiry');
  // Decode + re-sign with an exp in the past to simulate elapsed time deterministically.
  const past = Buffer.from(JSON.stringify({ userId: 'google:1', exp: Math.floor(Date.now() / 1000) - 5 }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(past).digest('base64url');
  const expired = `${past}.${sig}`;
  assert.strictEqual(verifyToken(expired, SECRET), null, 'a token whose exp is in the past is rejected');
});

test('verifySession returns null when the cookie is absent, blank, or malformed', () => {
  assert.strictEqual(verifySession(undefined, SECRET), null);
  assert.strictEqual(verifySession('', SECRET), null);
  assert.strictEqual(verifySession('unrelated=1; foo=bar', SECRET), null);
  assert.strictEqual(verifySession(`${SESSION_COOKIE}=not-a-token`, SECRET), null);
  // A token with an empty userId is not a valid session.
  const emptyId = signSession({ userId: '' }, SECRET);
  assert.strictEqual(verifySession(cookieHeader(emptyId), SECRET), null);
});

test('readCookie extracts the named cookie value, URL-decoded', () => {
  assert.strictEqual(readCookie('a=1; b=hello%20world; c=3', 'b'), 'hello world');
  assert.strictEqual(readCookie('a=1', 'missing'), undefined);
  assert.strictEqual(readCookie(undefined, 'a'), undefined);
});

test('buildSetCookie carries the secure session flags; clearCookie expires it', () => {
  const sc = buildSetCookie(SESSION_COOKIE, 'v', { maxAge: 3600 });
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /Secure/);
  assert.match(sc, /SameSite=Lax/);
  assert.match(sc, /Path=\//);
  assert.match(sc, /Max-Age=3600/);
  assert.match(clearCookie(SESSION_COOKIE), /Max-Age=0/);
});
