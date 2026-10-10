import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { browseDir, isContainedInBrowseRoot, resolveInBrowseRoot } from '../server/browse.js';

/*
 * THE FILESYSTEM ROOT, AS THIS PLATFORM ACTUALLY SPELLS IT.
 *
 * These used to say `const root = path.sep`, which is `/` on POSIX and a bare
 * backslash on Windows — and a bare backslash is not a Windows root. The tests
 * were therefore asserting nothing on Windows except that an invalid root
 * rejects everything, and all three were red. `path.parse(os.tmpdir()).root`
 * gives the real thing on both: `/` and `C:\`.
 *
 * That distinction exposed a product bug rather than a test bug. A real root
 * already ENDS in the separator, so the containment check's `browseRoot + sep`
 * built `C:\\` and nothing could ever match it: pointing the browse root at a
 * drive root refused every path on the machine.
 */
const FS_ROOT = path.parse(os.tmpdir()).root;

test('isContainedInBrowseRoot: filesystem root lists and jails child paths', () => {
  const root = FS_ROOT;
  assert.equal(isContainedInBrowseRoot(root, root), true);
  assert.equal(isContainedInBrowseRoot(root, path.join(root, 'workspace')), true);
  assert.equal(isContainedInBrowseRoot(root, path.join(root, 'tmp', 'foo')), true);
  assert.equal(isContainedInBrowseRoot(root, 'relative'), false);
});

test('resolveInBrowseRoot: browse root / resolves absolute child dirs', () => {
  const root = FS_ROOT;
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-browse-root-')));
  try {
    const resolved = resolveInBrowseRoot(root, tmp);
    assert.equal(resolved, tmp);
    assert.equal(resolveInBrowseRoot(root, path.join(tmp, '..', path.basename(tmp))), tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('browseDir: browse root / lists immediate child directories', () => {
  const root = FS_ROOT;
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-browse-list-')));
  try {
    const outcome = browseDir(root, tmp);
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.result.path, tmp);
    assert.ok(Array.isArray(outcome.result.entries));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
