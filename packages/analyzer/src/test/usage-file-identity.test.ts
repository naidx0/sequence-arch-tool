import assert from 'node:assert';
import { test } from 'node:test';
import { usageFileForIdentity, USAGE_FILE } from '../server/store.js';

/**
 * v10 FIX 5 regression lock — usageFileForIdentity must be collision-resistant.
 *
 * The sanitizer is lossy, so distinct DEPLOYED identities could otherwise map to
 * the SAME usage file and read/charge each other's quota. The fix keeps the
 * single-user `'local'` mapping BYTE-IDENTICAL to `usage.json` (the six CLI gates
 * and the usage tests depend on it) while giving every OTHER identity a stable
 * hash-suffixed file so distinct ids never collide and a non-'local' id can never
 * produce `usage.json`.
 */

test("'local' maps to usage.json byte-identically (unchanged)", () => {
  assert.strictEqual(usageFileForIdentity('local'), USAGE_FILE);
  assert.strictEqual(usageFileForIdentity('local'), 'usage.json');
});

test('two distinct ids that sanitize to the SAME stem get DIFFERENT files', () => {
  // Both collapse to the sanitized stem `a-x.com` (@ → -), so a stem-only scheme
  // would collide them onto one file. The raw-id hash suffix must separate them.
  const a = usageFileForIdentity('a@x.com');
  const b = usageFileForIdentity('a-x.com');
  assert.notStrictEqual(a, b, 'distinct raw ids sharing a sanitized stem must not collide');
  // Sanity: they really do share the stem (the collision the hash defends against).
  assert.ok(a.startsWith('usage.a-x.com.'), `unexpected file for a@x.com: ${a}`);
  assert.ok(b.startsWith('usage.a-x.com.'), `unexpected file for a-x.com: ${b}`);
});

test('a non-local id can NEVER produce usage.json', () => {
  for (const id of [
    'local ', // trailing space — a DIFFERENT id than the sentinel 'local'
    'Local', // different case
    'usage', // tries to look like the reserved stem
    'json',
    '', // empty → 'anon' stem, still hash-suffixed
    '...', // all-dots → empty stem after leading-dot strip → 'anon'
    'alice',
    '../../etc/passwd', // traversal attempt — sanitized AND hashed
  ]) {
    const f = usageFileForIdentity(id);
    assert.notStrictEqual(f, USAGE_FILE, `id ${JSON.stringify(id)} must not map to ${USAGE_FILE}`);
    assert.notStrictEqual(f, 'usage.json', `id ${JSON.stringify(id)} must not map to usage.json`);
    // The result is always a plain filename under the store dir — no separators can
    // survive the sanitizer, so it can never traverse out.
    assert.ok(!f.includes('/') && !f.includes('\\'), `no path separators in ${f}`);
    assert.ok(f.startsWith('usage.') && f.endsWith('.json'), `well-formed usage file: ${f}`);
  }
});

test('the mapping is STABLE for a given identity (deterministic hash)', () => {
  assert.strictEqual(usageFileForIdentity('alice'), usageFileForIdentity('alice'));
  assert.strictEqual(usageFileForIdentity('a@x.com'), usageFileForIdentity('a@x.com'));
});
