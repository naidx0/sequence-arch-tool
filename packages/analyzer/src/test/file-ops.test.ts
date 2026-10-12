import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyFileOp, duplicateName } from '../server/fileOps.js';
import { createRepoServer } from '../server/repoServer.js';

/** Files rail operations (round 9, ask 20): every op stays inside the project root. */

function tmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-fileops-'));
  const root = fs.realpathSync(dir);
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'a');
  fs.writeFileSync(path.join(root, 'README.md'), 'hi');
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, '.git', 'config'), 'secret');
  return root;
}
const deps = { isReserved: (abs: string) => abs.split(path.sep).includes('.git') };

test('rename and move work, and refuse to overwrite', () => {
  const root = tmpProject();
  assert.strictEqual(applyFileOp(root, { op: 'rename', path: 'src/a.ts', to: 'src/b.ts' }, deps).status, 200);
  assert.ok(fs.existsSync(path.join(root, 'src', 'b.ts')));
  assert.strictEqual(applyFileOp(root, { op: 'move', path: 'src/b.ts', to: 'lib/deep/b.ts' }, deps).status, 200);
  assert.ok(fs.existsSync(path.join(root, 'lib', 'deep', 'b.ts')));
  assert.strictEqual(applyFileOp(root, { op: 'move', path: 'README.md', to: 'lib/deep/b.ts' }, deps).status, 409);
  assert.strictEqual(fs.readFileSync(path.join(root, 'lib', 'deep', 'b.ts'), 'utf8'), 'a');
});

test('a folder cannot move into itself; delete removes folders', () => {
  const root = tmpProject();
  assert.strictEqual(applyFileOp(root, { op: 'move', path: 'src', to: 'src/inner' }, deps).status, 400);
  assert.strictEqual(applyFileOp(root, { op: 'delete', path: 'src' }, deps).status, 200);
  assert.ok(!fs.existsSync(path.join(root, 'src')));
});

test('duplicate picks a free name; create and mkdir refuse existing', () => {
  const root = tmpProject();
  assert.strictEqual(duplicateName(root, 'src/a.ts'), 'src/a copy.ts');
  const r = applyFileOp(root, { op: 'duplicate', path: 'src/a.ts' }, deps);
  assert.strictEqual(r.status, 200);
  assert.ok(fs.existsSync(path.join(root, 'src', 'a copy.ts')));
  assert.strictEqual(duplicateName(root, 'src/a.ts'), 'src/a copy 2.ts');
  assert.strictEqual(applyFileOp(root, { op: 'create', path: 'src/a.ts' }, deps).status, 409);
  assert.strictEqual(applyFileOp(root, { op: 'mkdir', path: 'src' }, deps).status, 409);
  assert.strictEqual(applyFileOp(root, { op: 'mkdir', path: 'x/y' }, deps).status, 200);
  assert.strictEqual(applyFileOp(root, { op: 'create', path: 'x/y/z.txt' }, deps).status, 200);
});

test('the jail: traversal, absolute, root, reserved and symlink escapes are refused', () => {
  const root = tmpProject();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-outside-'));
  fs.writeFileSync(path.join(outside, 'x.txt'), 'x');
  fs.symlinkSync(outside, path.join(root, 'link'));
  const cases: Array<[string, string, string?]> = [
    ['delete', '../' + path.basename(outside)],
    ['delete', outside],
    ['delete', '.'],
    ['delete', '.git/config'],
    ['rename', 'README.md', '../escaped.md'],
    ['move', 'README.md', '.git/README.md'],
    ['move', 'README.md', 'link/README.md'],
    ['delete', 'link/x.txt'],
    ['mkdir', 'link/new'],
  ];
  for (const [op, p, to] of cases) {
    const r = applyFileOp(root, { op, path: p, to }, deps);
    assert.strictEqual(r.status, 403, `${op} ${p} ${to ?? ''}`);
  }
  assert.ok(fs.existsSync(path.join(outside, 'x.txt')));
  assert.ok(fs.existsSync(path.join(root, 'README.md')));
  assert.ok(fs.existsSync(path.join(root, '.git', 'config')));
  assert.ok(!fs.existsSync(path.join(outside, 'README.md')));
});

test('reveal calls the injected opener only for existing in-jail paths', () => {
  const root = tmpProject();
  const seen: string[] = [];
  const d = { ...deps, reveal: (abs: string) => void seen.push(abs) };
  assert.strictEqual(applyFileOp(root, { op: 'reveal', path: 'README.md' }, d).status, 200);
  assert.strictEqual(applyFileOp(root, { op: 'reveal', path: 'nope' }, d).status, 404);
  assert.strictEqual(applyFileOp(root, { op: 'reveal', path: '../x' }, d).status, 403);
  assert.deepStrictEqual(seen, [path.join(root, 'README.md')]);
});

test('POST /api/file/op over HTTP renames inside the repo and 403s outside', async () => {
  const root = tmpProject();
  const server = await createRepoServer(root, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const post = (body: unknown) =>
    fetch(`${base}/api/file/op`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.strictEqual((await post({ op: 'rename', path: 'README.md', to: 'docs/README.md' })).status, 200);
    assert.ok(fs.existsSync(path.join(root, 'docs', 'README.md')));
    assert.strictEqual((await post({ op: 'delete', path: '../../etc/passwd' })).status, 403);
    assert.strictEqual((await post({ op: 'bogus', path: 'x' })).status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
