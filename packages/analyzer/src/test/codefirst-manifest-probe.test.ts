import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { discoverCodeFirst } from '../discovery/codefirst.js';

/**
 * THE MANIFEST PROBE MUST NOT ASK THE FILESYSTEM FIFTEEN TIMES PER DIRECTORY.
 *
 * The code-first walk visits every directory of the tree, and for each one it
 * asked "is there a package.json here?" by STATing fifteen candidate names.
 * MEASURED on a folder of 219 real projects (the `Projects` parent) that
 * probe spent 28.6 s of `fs.existsSync` — 54% of the whole discovery — and
 * the walk then read the same directory a second time for its own listing.
 *
 * The answer is in the listing the walk already takes. This test locks that:
 * the work the probe does must not grow with the number of directories, and
 * the ecosystem of every directory must be the same answer as before.
 */

/** Count the filesystem calls a function makes. */
function counted<T>(fn: () => T): { value: T; exists: number; reads: number } {
  const realExists = fs.existsSync;
  const realReaddir = fs.readdirSync;
  let exists = 0;
  let reads = 0;
  fs.existsSync = ((p: fs.PathLike) => {
    exists += 1;
    return realExists(p);
  }) as typeof fs.existsSync;
  fs.readdirSync = ((...args: Parameters<typeof fs.readdirSync>) => {
    reads += 1;
    return (realReaddir as (...a: unknown[]) => unknown)(...args);
  }) as typeof fs.readdirSync;
  try {
    return { value: fn(), exists, reads };
  } finally {
    fs.existsSync = realExists;
    fs.readdirSync = realReaddir;
  }
}

/** A repo with one JavaScript root and `empty` directories that hold no manifest. */
function repoWithEmptyDirs(empty: number): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-probe-')));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'root', dependencies: { react: '^18' } }));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'index.ts'), 'export const x = 1;\n');
  for (let i = 0; i < empty; i++) {
    const sub = path.join(dir, 'vendor-pkg', `p${i}`);
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'index.js'), 'module.exports = 1;\n');
  }
  return dir;
}

test('the manifest probe does not stat each candidate name per directory', () => {
  const few = repoWithEmptyDirs(4);
  const many = repoWithEmptyDirs(40);
  try {
    const a = counted(() => discoverCodeFirst(few));
    const b = counted(() => discoverCodeFirst(many));
    // 36 more directories, one per `vendor-pkg/pN`.
    const moreDirs = 36;
    assert.ok(
      (b.exists - a.exists) < moreDirs,
      `36 more directories cost ${b.exists - a.exists} existence checks; the manifest question must be answered from the listing, not by stating every candidate name`,
    );
    assert.ok(
      (b.reads - a.reads) <= moreDirs,
      `36 more directories cost ${b.reads - a.reads} directory listings; a directory must be read once, not once per question about it`,
    );
  } finally {
    fs.rmSync(few, { recursive: true, force: true });
    fs.rmSync(many, { recursive: true, force: true });
  }
});

test('the ecosystem of every directory is the same answer as before', () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-eco-')));
  try {
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'root' }));
    fs.mkdirSync(path.join(repo, 'svc'));
    fs.writeFileSync(path.join(repo, 'svc', 'pyproject.toml'), '[project]\nname="svc"\n');
    fs.writeFileSync(path.join(repo, 'svc', 'main.py'), 'import os\n');
    fs.mkdirSync(path.join(repo, 'infra'));
    fs.writeFileSync(path.join(repo, 'infra', 'main.tf'), 'resource "x" "y" {}\n');
    fs.mkdirSync(path.join(repo, 'apple'));
    fs.mkdirSync(path.join(repo, 'apple', 'Thing.xcodeproj'));

    const cf = discoverCodeFirst(repo);
    const dirs = (cf?.discovery.services ?? []).map((s) => s.dir).sort();
    assert.deepEqual(dirs, ['.', 'apple', 'infra', 'svc'], `the roots are ${JSON.stringify(dirs)}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
