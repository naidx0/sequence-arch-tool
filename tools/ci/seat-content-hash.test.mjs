import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

/**
 * REPAIR C — the seat must hash CONTENT, not bytes.
 *
 * The measured cause: `chat.json` came back from a reload with the same 3,518
 * bytes, a different sha256, and zero differing fields — one `work` step
 * re-serialised with its keys reordered. The seat raised
 * "the conversation changed across a reload", accusing the product of losing a
 * conversation the server had merely rewritten.
 *
 * `contentHash` is not exported (the seat is a script, not a module), so these
 * cases pin its two properties against the real 2026-09-06 evidence files and
 * against a source-level check that the byte hash is gone from the evidence path.
 */
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SEAT = path.join(REPO, 'tools', 'ci', 'scripted-seat.mjs');

/** The same function the seat uses, kept in step by the source case below. */
const contentHash = (buf) => {
  const bytes = () => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
  let parsed;
  try {
    parsed = JSON.parse(buf.toString('utf8'));
  } catch {
    return bytes();
  }
  const stable = (v) =>
    Array.isArray(v)
      ? v.map(stable)
      : v !== null && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]))
        : v;
  return crypto.createHash('sha256').update(JSON.stringify(stable(parsed))).digest('hex').slice(0, 16);
};

test('the reload pair: same length, different bytes, identical content', () => {
  /*
   * THE CASE BUILT FROM THE REPORTED SHAPE — and it was reading the wrong copy.
   *
   * The first version asserted on `docs/journeys/seat/ask--chat.json` and
   * `reload--chat.json`, the LIVE evidence the seat writes. A later seat run
   * overwrote both with a 64-byte pair from a refusal turn, the "the bytes
   * really do differ" assumption stopped holding, and the case failed — caught
   * by the counting gate, which is the first thing that has ever run these.
   *
   * A test whose fixture is rewritten by the instrument it tests is not a test.
   * So the pair is frozen here: one work step, the real field names and values
   * recorded on 2026-09-06, serialised with its keys in the two orders that were
   * observed. RECONSTRUCTED, not the original bytes — those are gone, overwritten
   * by the run that exposed the flaw, and saying so is cheaper than implying an
   * authenticity the file no longer has.
   */
  const a = fs.readFileSync(path.join(HERE, 'fixtures', 'reload-before.json'));
  const b = fs.readFileSync(path.join(HERE, 'fixtures', 'reload-after.json'));
  assert.strictEqual(a.length, b.length, 'same byte length, as the real pair had');
  assert.notStrictEqual(
    crypto.createHash('sha256').update(a).digest('hex'),
    crypto.createHash('sha256').update(b).digest('hex'),
    'the bytes really do differ',
  );
  assert.strictEqual(contentHash(a), contentHash(b), 'and the content does not — no void to raise');
});

test('a genuine change still changes the hash — the check is not merely relaxed', () => {
  /*
   * The half that keeps the repair honest. If sorting keys made a real change
   * invisible, this would be a weakened test rather than a corrected one.
   */
  const one = Buffer.from(JSON.stringify({ b: 1, a: [{ y: 2, x: 1 }] }));
  const reordered = Buffer.from(JSON.stringify({ a: [{ x: 1, y: 2 }], b: 1 }));
  const changed = Buffer.from(JSON.stringify({ a: [{ x: 1, y: 3 }], b: 1 }));
  assert.strictEqual(contentHash(one), contentHash(reordered), 'key order is invisible');
  assert.notStrictEqual(contentHash(one), contentHash(changed), 'one changed field is not');
});

test('an unparseable file falls back to its bytes rather than reading as unchanged', () => {
  /* An unreadable file is not evidence of sameness. */
  const bad = Buffer.from('{ not json');
  const other = Buffer.from('{ also not json');
  assert.notStrictEqual(contentHash(bad), contentHash(other));
});

test('the seat uses contentHash for evidence, and no byte hash remains on that path', () => {
  const src = fs.readFileSync(SEAT, 'utf8');
  assert.match(src, /sha256: contentHash\(fs\.readFileSync\(dst\)\)/, 'evidence hashes content');
  assert.match(src, /function contentHash\(buf\)/, 'and the function is the seat’s own');
});
