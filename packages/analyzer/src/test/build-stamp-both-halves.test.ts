import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildStamp } from '../server/buildStamp.js';

/**
 * THE STALE CHECK MUST KNOW ABOUT BOTH HALVES.
 *
 * Built from the reported shape, not a convenient one. On 2026-09-06 the server
 * ran a build made minutes earlier while the browser was served a bundle from
 * the previous night. `/api/build` reported `stale: false`, `pnpm restart:app`
 * saw nothing to do, and half of one commit — the client half of `a180b036` —
 * was simply absent from the product while every test stayed green. A
 * subject-less teach ask then reached a model instead of being refused.
 *
 * A stale check that knows about one half of a two-half product answers a
 * question nobody asked.
 */
function tree(): { root: string; touch: (rel: string, at: Date) => string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halves-'));
  const touch = (rel: string, at: Date): string => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '/* x */');
    fs.utimesSync(abs, at, at);
    return abs;
  };
  return { root, touch };
}

const LAST_NIGHT = new Date('2026-09-05T23:23:53.000Z');
const THIS_MORNING = new Date('2026-09-06T12:11:47.000Z');
const NOON = new Date('2026-09-06T12:12:31.000Z');

test("tonight's shape: server current, client bundle from the previous night — STALE", () => {
  /*
   * The exact configuration that hid the defect. Everything about the server is
   * fine; the bundle is older than the source it is built from, so the browser
   * is running code that no longer exists in the tree.
   */
  const { root, touch } = tree();
  try {
    const serverDist = touch('analyzer/dist/cli.js', THIS_MORNING);
    touch('analyzer/src/server/repoServer.ts', THIS_MORNING);
    const clientBundle = touch('web2/dist/index.html', LAST_NIGHT);
    touch('web2/src/state/connect.tsx', THIS_MORNING);

    const stamp = buildStamp(serverDist, {
      serverDist,
      serverSrc: path.join(root, 'analyzer/src'),
      clientBundle,
      clientSrc: path.join(root, 'web2/src'),
    });

    assert.strictEqual(stamp.server?.stale, false, 'the server half is current');
    assert.strictEqual(stamp.client?.stale, true, 'the client bundle is older than its source');
    assert.strictEqual(stamp.stale, true, 'so the PRODUCT is stale — this is the line that was false');
    /* And it says which half, so the reader is not left guessing at a boolean. */
    assert.strictEqual(stamp.client?.builtAt, LAST_NIGHT.toISOString());
    assert.strictEqual(stamp.client?.sourceAt, THIS_MORNING.toISOString());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('both halves current is not stale — the check is not merely pessimistic', () => {
  const { root, touch } = tree();
  try {
    const serverDist = touch('analyzer/dist/cli.js', NOON);
    touch('analyzer/src/a.ts', THIS_MORNING);
    const clientBundle = touch('web2/dist/index.html', NOON);
    touch('web2/src/a.tsx', THIS_MORNING);
    const stamp = buildStamp(serverDist, {
      serverDist,
      serverSrc: path.join(root, 'analyzer/src'),
      clientBundle,
      clientSrc: path.join(root, 'web2/src'),
    });
    assert.strictEqual(stamp.client?.stale, false);
    assert.strictEqual(stamp.server?.stale, false);
    assert.strictEqual(stamp.stale, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the OTHER half stale is caught too — server behind its source', () => {
  /* The mirror of tonight's case. Neither half is privileged. */
  const { root, touch } = tree();
  try {
    const serverDist = touch('analyzer/dist/cli.js', LAST_NIGHT);
    touch('analyzer/src/a.ts', THIS_MORNING);
    const clientBundle = touch('web2/dist/index.html', NOON);
    touch('web2/src/a.tsx', THIS_MORNING);
    const stamp = buildStamp(serverDist, {
      serverDist,
      serverSrc: path.join(root, 'analyzer/src'),
      clientBundle,
      clientSrc: path.join(root, 'web2/src'),
    });
    assert.strictEqual(stamp.server?.stale, true);
    assert.strictEqual(stamp.stale, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unreadable half reports false with nulls beside it, never a guessed freshness', () => {
  /*
   * CANNOT BE DECIDED IS NOT FRESH, and it is not stale either. The nulls say so
   * out loud rather than the boolean asserting something nothing measured — the
   * same rule as the card lock that must not guess a holder alive.
   */
  const { root, touch } = tree();
  try {
    const serverDist = touch('analyzer/dist/cli.js', NOON);
    const stamp = buildStamp(serverDist, {
      serverDist,
      serverSrc: path.join(root, 'analyzer/src'),
      clientBundle: path.join(root, 'web2/dist/index.html'),
      clientSrc: path.join(root, 'web2/src'),
    });
    assert.strictEqual(stamp.client?.builtAt, null, 'no bundle to read');
    assert.strictEqual(stamp.client?.sourceAt, null, 'no source to read');
    assert.strictEqual(stamp.client?.stale, false, 'and no claim made about it');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('with no halves named the stamp is exactly what it always was', () => {
  /* Older callers — and the test runner — must see no change. */
  const stamp = buildStamp();
  assert.strictEqual(stamp.server, undefined);
  assert.strictEqual(stamp.client, undefined);
  assert.ok(typeof stamp.startedAt === 'string');
});
