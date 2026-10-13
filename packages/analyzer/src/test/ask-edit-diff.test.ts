/**
 * edit_file shows its work (docs/research/pi-and-opencode-study.md, change 5).
 *
 * Every successful edit result carries a unified diff of what changed, so "done" is backed by a visible
 * diff. A refused edit names the reason and the nearest lines of the file, so the next call can be right.
 * The fuzzy fallback itself (wave A8, ask-edit-match.test.ts) already existed; these tests cover what the
 * study found missing around it.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { nearestLines, unifiedDiff } from '../server/askEditDiff.js';
import { executeAskTool, type AskToolContext } from '../server/askTools.js';

function repoWith(files: Record<string, string>): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-edit-diff-')));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

function ctxFor(root: string): AskToolContext {
  return {
    repoRoot: root,
    resolveReadable: (rel: string) => {
      const abs = path.resolve(root, rel);
      return abs.startsWith(root) ? abs : null;
    },
    designMode: false,
    permission: 'propose',
  } as AskToolContext;
}

const numbered = (n: number, f: (i: number) => string = (i) => `line ${i}`): string =>
  Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n';

/* ───────────────────────────── unifiedDiff ───────────────────────────── */

test('unifiedDiff: one changed line in the middle, three lines of context each side, correct hunk header', () => {
  const before = numbered(20);
  const after = before.replace('line 10\n', 'LINE TEN\n');
  const d = unifiedDiff('src/a.ts', before, after);
  assert.match(d, /^--- a\/src\/a\.ts\n\+\+\+ b\/src\/a\.ts\n@@ -7,7 \+7,7 @@\n/);
  assert.deepStrictEqual(
    d.split('\n').slice(3, 11),
    [' line 7', ' line 8', ' line 9', '-line 10', '+LINE TEN', ' line 11', ' line 12', ' line 13'],
  );
  assert.doesNotMatch(d, /line 6|line 14/);
});

test('unifiedDiff: identical text is the empty string', () => {
  assert.strictEqual(unifiedDiff('a.ts', 'same\n', 'same\n'), '');
});

test('unifiedDiff: pure insertion and pure deletion', () => {
  const ins = unifiedDiff('a.ts', 'a\nb\n', 'a\nNEW\nb\n');
  assert.match(ins, /@@ -1,2 \+1,3 @@/);
  assert.match(ins, /\n\+NEW\n/);
  const del = unifiedDiff('a.ts', 'a\nGONE\nb\n', 'a\nb\n');
  assert.match(del, /@@ -1,3 \+1,2 @@/);
  assert.match(del, /\n-GONE\n/);
});

test('unifiedDiff: two far-apart changes are two hunks, not one hunk of everything between', () => {
  const before = numbered(60);
  const after = before.replace('line 5\n', 'five\n').replace('line 55\n', 'fifty-five\n');
  const d = unifiedDiff('a.ts', before, after);
  assert.strictEqual(d.split('\n').filter((l) => l.startsWith('@@')).length, 2);
  assert.doesNotMatch(d, /line 30/);
});

test('unifiedDiff: CRLF files diff on their lines, and the carriage returns are not shown as edits', () => {
  const before = 'a\r\nb\r\nc\r\n';
  const after = 'a\r\nB\r\nc\r\n';
  const d = unifiedDiff('a.ts', before, after);
  assert.match(d, /\n-b\n\+B\n/);
  assert.doesNotMatch(d, /\r/);
});

test('unifiedDiff: a huge diff is cut with a note rather than flooding the prompt', () => {
  const d = unifiedDiff('a.ts', numbered(5000), numbered(5000, (i) => `changed ${i}`));
  assert.ok(d.split('\n').length < 400, `${d.split('\n').length} lines`);
  assert.match(d, /diff truncated/);
});

/* ───────────────────────────── the edit_file result ───────────────────────────── */

test('a successful edit_file result carries the unified diff of the change', async () => {
  const root = repoWith({ 'src/a.ts': numbered(20) });
  const r = await executeAskTool(
    'edit_file',
    { path: 'src/a.ts', oldString: 'line 10', newString: 'LINE TEN' },
    ctxFor(root),
  );
  assert.strictEqual(r.ok, true, r.evidence);
  assert.match(r.content!, /```diff\n--- a\/src\/a\.ts\n\+\+\+ b\/src\/a\.ts\n@@ -7,7 \+7,7 @@/);
  assert.match(r.content!, /\n-line 10\n\+LINE TEN\n/);
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8'), numbered(20), 'staging writes nothing');
});

test('a multi-edit result shows every change; replaceAll shows every place', async () => {
  const root = repoWith({ 'a.ts': numbered(60) + 'x x x\n' });
  const r = await executeAskTool(
    'edit_file',
    { path: 'a.ts', edits: [{ oldString: 'line 5\n', newString: 'five\n' }, { oldString: 'line 55\n', newString: 'fifty-five\n' }, { oldString: 'x', newString: 'y', replaceAll: true }] },
    ctxFor(root),
  );
  assert.strictEqual(r.ok, true, r.evidence);
  assert.match(r.content!, /\n-line 5\n\+five\n/);
  assert.match(r.content!, /\n-line 55\n\+fifty-five\n/);
  assert.match(r.content!, /\n-x x x\n\+y y y\n/);
});

test('a fuzzy-matched edit (curly quotes, CRLF) still shows its diff, and the file keeps its CRLF', async () => {
  const root = repoWith({ 'a.ts': 'const a = 1;\r\nconst msg = “hello”;\r\nconst b = 2;\r\n' });
  const r = await executeAskTool(
    'edit_file',
    { path: 'a.ts', oldString: 'const msg = "hello";', newString: 'const msg = "bye";' },
    ctxFor(root),
  );
  assert.strictEqual(r.ok, true, r.evidence);
  assert.match(r.evidence, /matched past/);
  assert.match(r.content!, /\n-const msg = “hello”;\n\+const msg = "bye";\n/);
  assert.strictEqual(r.proposal!.files[0]!.content, 'const a = 1;\r\nconst msg = "bye";\r\nconst b = 2;\r\n');
});

/* ───────────────────────────── refusals ───────────────────────────── */

test('not found: the refusal names the reason and the nearest lines, with their numbers', async () => {
  const root = repoWith({
    'src/cart.ts': 'import x from "y";\n\nfunction computeTotal(items) {\n  return items.reduce((a, b) => a + b.price, 0);\n}\n',
  });
  const r = await executeAskTool(
    'edit_file',
    { path: 'src/cart.ts', oldString: 'function computeTotals(items) {\n  return items.reduce((a, b) => a + b.cost, 0);\n}', newString: 'x' },
    ctxFor(root),
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.evidence, /^refused: edit 1 of 1/);
  assert.match(r.evidence, /does not appear in src\/cart\.ts/);
  assert.match(r.evidence, /even ignoring (trailing )?whitespace/i, 'says what was already forgiven');
  assert.match(r.evidence, /closest[^\n]*lines? 3/i);
  assert.match(r.evidence, /3\|function computeTotal\(items\) \{/);
  assert.match(r.evidence, /4\|\s+return items\.reduce\(\(a, b\) => a \+ b\.price, 0\);/);
});

test('not found, nothing similar: says so and invents no candidate', async () => {
  const root = repoWith({ 'src/cart.ts': 'alpha\nbeta\ngamma\n' });
  const r = await executeAskTool(
    'edit_file',
    { path: 'src/cart.ts', oldString: 'completely different words about databases', newString: 'x' },
    ctxFor(root),
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.evidence, /no similar lines/i);
  assert.doesNotMatch(r.evidence, /\d+\|alpha/);
});

test('ambiguous exact match is still refused with the line numbers (control for the fuzzy path)', async () => {
  const root = repoWith({ 'a.ts': 'foo\nbar\nfoo\n' });
  const r = await executeAskTool('edit_file', { path: 'a.ts', oldString: 'foo', newString: 'z' }, ctxFor(root));
  assert.strictEqual(r.ok, false);
  assert.match(r.evidence, /appears 2 times[^\n]*lines? 1, 3/);
});

test('fuzzy path never guesses: two fuzzy matches are refused, not applied', async () => {
  const root = repoWith({ 'a.ts': 'x = “a”;\ny = 1;\nx = “a”;\n' });
  const r = await executeAskTool('edit_file', { path: 'a.ts', oldString: 'x = "a";', newString: 'x = "b";' }, ctxFor(root));
  assert.strictEqual(r.ok, false);
  assert.match(r.evidence, /matches 2 places/);
});

/* ───────────────────────────── nearestLines ───────────────────────────── */

test('nearestLines: finds the best window, ranks a closer line above a farther one, and returns null for noise', () => {
  const content = 'const alpha = 1;\nconst beta = compute(a, b);\nconst gamma = 3;\n';
  const hit = nearestLines(content, 'const beta = compute(a, c);');
  assert.ok(hit);
  assert.strictEqual(hit!.startLine, 2);
  assert.strictEqual(hit!.lines[0], 'const beta = compute(a, b);');
  assert.strictEqual(nearestLines(content, 'zzzz qqqq wwww'), null);
});
