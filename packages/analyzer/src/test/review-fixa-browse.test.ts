/**
 * Review finding: the hosted no-probe check was lexical, so a link inside a tenant root answered "missing"
 * or "exists" for paths OUTSIDE it. And a relative target must never read as "missing".
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { canonicalBrowseRoot, isMissingPath } from '../server/browse.js';

function tree(): { root: string; other: string; cleanup: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-browse-oracle-'));
  const tenant = path.join(base, 'tenantB');
  const other = path.join(base, 'tenantA');
  fs.mkdirSync(tenant);
  fs.mkdirSync(path.join(other, 'secret-project'), { recursive: true });
  return { root: canonicalBrowseRoot(tenant), other, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test('isMissingPath: a link out of the root is never an existence oracle (onlyInside)', () => {
  const t = tree();
  try {
    try {
      fs.symlinkSync(path.join(t.other, 'secret-project'), path.join(t.root, 'l1'), 'junction');
      fs.symlinkSync(path.join(t.other, 'no-such-project'), path.join(t.root, 'l2'), 'junction');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EPERM') return; // symlinks not permitted here
      throw e;
    }
    // Existing target outside, reached through the link: not "missing".
    assert.strictEqual(isMissingPath(path.join(t.root, 'l1'), t.root), false);
    assert.strictEqual(isMissingPath(path.join(t.root, 'l1', 'nope'), t.root), false, 'child under a link to an outside tree');
    // Dangling link, and a child below it: answers like an outside path, not "missing".
    assert.strictEqual(isMissingPath(path.join(t.root, 'l2'), t.root), false);
    assert.strictEqual(isMissingPath(path.join(t.root, 'l2', 'x'), t.root), false);
  } finally {
    t.cleanup();
  }
});

test('isMissingPath: a genuinely missing path inside the root is still missing', () => {
  const t = tree();
  try {
    assert.strictEqual(isMissingPath(path.join(t.root, 'typo', 'deeper'), t.root), true);
  } finally {
    t.cleanup();
  }
});

test('isMissingPath: a non-absolute target is never missing', () => {
  const t = tree();
  try {
    assert.strictEqual(isMissingPath('no-such-folder', t.root), false);
    assert.strictEqual(isMissingPath('no-such-folder'), false);
    assert.strictEqual(isMissingPath('./a/b', t.root), false);
  } finally {
    t.cleanup();
  }
});
