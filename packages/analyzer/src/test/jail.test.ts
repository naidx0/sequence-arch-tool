import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveInRepo, canonicalRoot, realpathContained } from '../server/jail.js';

/**
 * Unit lock for the write-jail (jail.ts resolveInRepo). Round-1 review found a
 * NEW file addressed through a PRE-EXISTING symlinked directory that points
 * outside the repo escaped the jail: realpath'ing the not-yet-existing leaf threw
 * ENOENT, the catch swallowed it, and the lexical check (which can't see through
 * a symlink) passed. These tests pin the deepest-existing-ancestor fix.
 */

/** A repo root plus a sibling "outside" dir, both real, canonicalised. */
function makeRepo(): { repo: string; outside: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-jail-'));
  const repo = path.join(dir, 'repo');
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  return {
    repo: canonicalRoot(repo),
    outside: fs.realpathSync(outside),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test('write-jail: a NEW file under a pre-existing symlink-to-OUTSIDE dir is rejected', () => {
  const { repo, outside, cleanup } = makeRepo();
  try {
    // repo/link -> /outside (the symlinked dir already exists on disk)
    fs.symlinkSync(outside, path.join(repo, 'link'));
    // The reviewer's exact repro: model path link/pwned.txt (a NEW file).
    const resolved = resolveInRepo(repo, path.join('link', 'pwned.txt'));
    assert.strictEqual(resolved, null, 'new file through an escaping symlink dir must be rejected');
    // Prove nothing could have been written outside via this path.
    assert.ok(!fs.existsSync(path.join(outside, 'pwned.txt')), 'nothing written outside');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM') return; // symlinks not permitted here
    throw e;
  } finally {
    cleanup();
  }
});

test('write-jail: a legitimate new file in a legitimately new nested dir is allowed', () => {
  const { repo, cleanup } = makeRepo();
  try {
    const resolved = resolveInRepo(repo, path.join('newdir', 'newfile.ts'));
    assert.strictEqual(resolved, path.join(repo, 'newdir', 'newfile.ts'));
  } finally {
    cleanup();
  }
});

test('write-jail: a new file under a symlink pointing INSIDE the repo is allowed (containment holds)', () => {
  // Documented choice: a symlink whose target stays inside the canonical root
  // keeps containment, so a new file through it is safe and permitted.
  const { repo, cleanup } = makeRepo();
  try {
    fs.mkdirSync(path.join(repo, 'real'));
    fs.symlinkSync(path.join(repo, 'real'), path.join(repo, 'inlink'));
    const resolved = resolveInRepo(repo, path.join('inlink', 'newfile.ts'));
    assert.strictEqual(resolved, path.join(repo, 'inlink', 'newfile.ts'), 'inside-symlink new file allowed');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM') return;
    throw e;
  } finally {
    cleanup();
  }
});

test('write-jail: an EXISTING symlink file whose target escapes is still rejected (read-case unchanged)', () => {
  const { repo, outside, cleanup } = makeRepo();
  try {
    const secret = path.join(outside, 'secret.txt');
    fs.writeFileSync(secret, 'top secret');
    fs.symlinkSync(secret, path.join(repo, 'escape.txt'));
    assert.strictEqual(resolveInRepo(repo, 'escape.txt'), null, 'escaping symlink file rejected');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM') return;
    throw e;
  } finally {
    cleanup();
  }
});

test('realpathContained: follows an in-repo symlink for BOTH existing and new targets', () => {
  // Round-2: reserved-ness is now judged on the realpath, and this is the helper
  // that produces it — a symlink `docs` → `real` must canonicalise the target
  // into `real`, whether the leaf exists yet or not.
  const { repo, cleanup } = makeRepo();
  try {
    fs.mkdirSync(path.join(repo, 'real'));
    fs.writeFileSync(path.join(repo, 'real', 'here.txt'), 'x');
    fs.symlinkSync(path.join(repo, 'real'), path.join(repo, 'docs'));
    // Existing target through the symlink → canonicalises into real/.
    assert.strictEqual(
      realpathContained(path.join(repo, 'docs', 'here.txt')),
      path.join(repo, 'real', 'here.txt'),
      'existing symlinked target canonicalises to its real location'
    );
    // NOT-yet-existing target through the symlink → deepest-ancestor realpath + suffix.
    assert.strictEqual(
      realpathContained(path.join(repo, 'docs', 'new.txt')),
      path.join(repo, 'real', 'new.txt'),
      'new symlinked target canonicalises via the deepest existing ancestor'
    );
    // A plain (non-symlink) path is returned unchanged.
    assert.strictEqual(
      realpathContained(path.join(repo, 'real', 'here.txt')),
      path.join(repo, 'real', 'here.txt')
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM') return;
    throw e;
  } finally {
    cleanup();
  }
});

test('write-jail: lexical escapes and absolute paths remain rejected', () => {
  const { repo, cleanup } = makeRepo();
  try {
    assert.strictEqual(resolveInRepo(repo, path.join('..', 'escape.txt')), null);
    assert.strictEqual(resolveInRepo(repo, '/etc/passwd'), null);
    // an ordinary existing file still resolves
    fs.writeFileSync(path.join(repo, 'ok.txt'), 'hi');
    assert.strictEqual(resolveInRepo(repo, 'ok.txt'), path.join(repo, 'ok.txt'));
  } finally {
    cleanup();
  }
});
