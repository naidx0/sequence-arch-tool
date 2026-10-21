/**
 * LOCK - a scan must not depend on the order the filesystem lists a directory in.
 *
 * `fs.readdirSync` is NTFS-sorted on Windows and hash or creation order on ext4 and overlayfs, so the scan's file order, fact
 * order and edge ids (and the scan-oracle golden) moved with the machine. `fsOrder.ts` gives one order; the scan paths use it.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sortedDirents, sortedNames } from '../fsOrder.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..', 'src');

test('sortedNames and sortedDirents list in NTFS order whatever order the files were created in', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-fsorder-'));
  try {
    /* Created back to front, with the cases where byte order and NTFS order disagree: `_` sorts after letters once case is folded. */
    for (const n of ['svc-b', 'b.ts', 'a_b.ts', 'ab.ts', 'Zeta.ts', 'alpha.ts', 'A.ts']) fs.writeFileSync(path.join(dir, n), '');
    const want = ['A.ts', 'ab.ts', 'alpha.ts', 'a_b.ts', 'b.ts', 'svc-b', 'Zeta.ts'];
    assert.deepStrictEqual(sortedNames(dir), want);
    assert.deepStrictEqual(sortedDirents(dir).map((e) => e.name), want);
    assert.ok(sortedDirents(dir).every((e) => e.isFile()), 'entries keep their file types');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the scan path never lists a directory raw (the order is the filesystem’s, not the repo’s)', () => {
  const files = ['scan.ts', 'discovery/codefirst.ts', 'discovery/shared.ts', 'discovery/kubernetes.ts', 'detectors/nginx.ts', 'functions/repoFunctionGraph.ts'];
  for (const rel of files) {
    const code = fs
      .readFileSync(path.join(SRC, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/\breaddirSync\(/.test(code), `${rel} lists a directory with fs.readdirSync; use sortedDirents or sortedNames from fsOrder.ts`);
  }
});
