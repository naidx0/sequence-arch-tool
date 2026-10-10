// node --test port.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PORT = new URL('./port.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function repo(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'port-'));
  for (const [p, s] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, p)), { recursive: true });
    fs.writeFileSync(path.join(d, p), s);
  }
  return d;
}
function run(d, patch, ...flags) {
  fs.writeFileSync(path.join(d, '0001-t.patch'), patch);
  let code = 0;
  try { execFileSync('node', [PORT, ...flags, '--root', d, '--out', 'out', path.join(d, '0001-t.patch')], { encoding: 'utf8' }); }
  catch (e) { code = e.status; }
  return { code, report: JSON.parse(fs.readFileSync(path.join(d, 'out', 'report.json'), 'utf8'))[0] };
}
const read = (d, p) => fs.readFileSync(path.join(d, p), 'utf8');

const base = ['function a() {', '  const x = 1;', '  return x;', '}', '', 'function b() {', '  return 2;', '}', ''].join('\n');
const patch = `diff --git a/src/f.ts b/src/f.ts
--- a/src/f.ts
+++ b/src/f.ts
@@ -1,4 +1,4 @@
 function a() {
-  const x = 1;
+  const x = 42;
   return x;
 }
`;

test('clean apply, then already applied', () => {
  const d = repo({ 'src/f.ts': base });
  let r = run(d, patch, '--write', '--force');
  assert.equal(r.report.kind, 'clean');
  assert.match(read(d, 'src/f.ts'), /const x = 42;/);
  r = run(d, patch, '--write', '--force');
  assert.equal(r.report.kind, 'already');
  assert.equal(read(d, 'src/f.ts').match(/42/g).length, 1);
});

test('keeps CRLF and survives drifted context', () => {
  const drifted = ('// new header\n\nfunction a() {\n  // a new comment\n  const x = 1;\n  return x;\n}\n').replace(/\n/g, '\r\n');
  const d = repo({ 'src/f.ts': drifted });
  const r = run(d, patch, '--write', '--force');
  assert.equal(r.report.kind, 'ported');
  const out = read(d, 'src/f.ts');
  assert.match(out, /const x = 42;\r\n/);
  assert.ok(!/[^\r]\n/.test(out), 'no bare LF');
});

test('finds a moved file by name', () => {
  const d = repo({ 'lib/deep/f.ts': base });
  const r = run(d, patch, '--write', '--force');
  assert.equal(r.report.kind, 'ported');
  assert.match(read(d, 'lib/deep/f.ts'), /42/);
});

test('refuses to guess between two equal places', () => {
  const twice = 'function a() {\n  const x = 1;\n  return x;\n}\nfunction a() {\n  const x = 1;\n  return x;\n}\n';
  const d = repo({ 'src/f.ts': twice });
  const r = run(d, patch.replace('@@ -1,4 +1,4 @@', '@@ -30,4 +30,4 @@'), '--write', '--force');
  assert.equal(r.code, 1);
  assert.equal(r.report.kind, 'FAILED');
  assert.equal(read(d, 'src/f.ts'), twice);
});

test('does not overwrite a different file at a new-file path', () => {
  const d = repo({ 'src/g.ts': 'mine\n' });
  const add = `diff --git a/src/g.ts b/src/g.ts
new file mode 100644
--- /dev/null
+++ b/src/g.ts
@@ -0,0 +1 @@
+theirs
`;
  const r = run(d, add, '--write', '--force');
  assert.equal(r.report.kind, 'FAILED');
  assert.equal(read(d, 'src/g.ts'), 'mine\n');
  assert.ok(fs.existsSync(path.join(d, 'out', '0001-t.rej')));
});

test('a patch is all or nothing unless --partial', () => {
  const two = patch + `diff --git a/src/h.ts b/src/h.ts
--- a/src/h.ts
+++ b/src/h.ts
@@ -1,1 +1,1 @@
-old line that is gone
+new line
`;
  const d = repo({ 'src/f.ts': base, 'src/h.ts': 'something else entirely\n' });
  const r = run(d, two, '--write', '--force');
  assert.equal(r.report.kind, 'PARTIAL');
  assert.doesNotMatch(read(d, 'src/f.ts'), /42/);
});

test('dry run writes nothing', () => {
  const d = repo({ 'src/f.ts': base });
  run(d, patch);
  assert.equal(read(d, 'src/f.ts'), base);
});
