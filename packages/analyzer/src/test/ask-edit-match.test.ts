/**
 * WAVE A8 — THE TWO EDIT REFUSALS (docs/research/carrying-harness-plan.md).
 *
 * An ambiguous edit is still refused, and now says WHERE the occurrences are.
 * A stale `oldString` gets one bounded pass past the differences nobody can
 * see — smart quotes, dashes, CRLF, trailing whitespace — and that pass is
 * FAIL-CLOSED: a span it cannot prove says the same thing is not edited.
 *
 * The last two tests are the ones that matter. A fuzzy matcher that guesses
 * writes the wrong span into somebody's source, and a wrong edit is worse than
 * a refused one.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  EDIT_FUZZY_MAX_NEEDLE,
  fuzzyFindEdit,
  normaliseForMatch,
  occurrenceLines,
  replaceSpans,
} from '../server/askEditMatch.js';
import { executeAskTool, type AskToolContext } from '../server/askTools.js';

function repoWith(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-edit-match-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return fs.realpathSync(dir);
}

function ctxFor(root: string): AskToolContext {
  return {
    repoRoot: root,
    resolveReadable: (rel: string) => {
      const abs = path.resolve(root, rel);
      return abs.startsWith(root) ? abs : null;
    },
    designMode: false,
    permission: 'build',
  } as AskToolContext;
}

/* ───────────────────────────── the normaliser ────────────────────────────── */

test('normalising forgives carriage returns, smart punctuation and trailing whitespace only', () => {
  assert.strictEqual(normaliseForMatch('a\r\nb').text, 'a\nb');
  assert.strictEqual(normaliseForMatch('say “hi” and ‘bye’').text, 'say "hi" and \'bye\'');
  assert.strictEqual(normaliseForMatch('a — b').text, 'a - b');
  assert.strictEqual(normaliseForMatch('a b').text, 'a b');
  assert.strictEqual(normaliseForMatch('const x = 1;   \nconst y = 2;\t').text, 'const x = 1;\nconst y = 2;');
  /* INDENTATION IS THE PROGRAM. It is never touched. */
  assert.strictEqual(normaliseForMatch('    indented').text, '    indented');
  assert.strictEqual(normaliseForMatch('a  b').text, 'a  b', 'inner runs of spaces are code, not noise');
});

test('the map points every normalised character back at the byte it came from', () => {
  const src = 'a\r\nb  \nc';
  const { text, map } = normaliseForMatch(src);
  assert.strictEqual(text, 'a\nb\nc');
  for (let i = 0; i < text.length; i += 1) {
    assert.strictEqual(src[map[i]!], text[i], `char ${i}`);
  }
  assert.strictEqual(map[text.length], src.length, 'the tail entry is the original length');
});

/* ────────────────────────────── the two paths ────────────────────────────── */

test('occurrenceLines gives the 1-based line of each hit, capped', () => {
  const content = 'x\nfoo\ny\nfoo\nz\nfoo\n';
  assert.deepStrictEqual(occurrenceLines(content, 'foo'), [2, 4, 6]);
  assert.deepStrictEqual(occurrenceLines(content, 'foo', 2), [2, 4]);
  assert.deepStrictEqual(occurrenceLines(content, 'nowhere'), []);
});

test('a fuzzy match resolves to the ORIGINAL bytes, so the file keeps its own quotes', () => {
  const content = 'const greeting = “hello”;\r\nconst other = 2;\r\n';
  const found = fuzzyFindEdit(content, 'const greeting = "hello";');
  assert.strictEqual(found.kind, 'one');
  if (found.kind !== 'one') return;
  assert.strictEqual(content.slice(found.span.from, found.span.to), 'const greeting = “hello”;');
  const after = replaceSpans(content, [found.span], 'const greeting = "hi";');
  assert.strictEqual(after, 'const greeting = "hi";\r\nconst other = 2;\r\n');
  assert.ok(after.includes('\r\n'), 'the rest of the file keeps its CRLF');
});

test('several fuzzy matches come back as several, with their lines — never picked between', () => {
  const content = 'a = “x”;\nb = 1;\na = “x”;\n';
  const found = fuzzyFindEdit(content, 'a = "x";');
  assert.strictEqual(found.kind, 'several');
  if (found.kind !== 'several') return;
  assert.strictEqual(found.spans.length, 2);
  assert.deepStrictEqual(found.lines, [1, 3]);
});

test('text that is genuinely absent stays absent, and an oversized needle is not attempted', () => {
  assert.strictEqual(fuzzyFindEdit('const a = 1;\n', 'const b = 2;').kind, 'none');
  assert.strictEqual(fuzzyFindEdit('anything', '').kind, 'none');
  const huge = 'x'.repeat(EDIT_FUZZY_MAX_NEEDLE + 1);
  assert.strictEqual(fuzzyFindEdit(huge, huge).kind, 'none');
});

test('FAIL-CLOSED: the relaxation never slides a match onto different code', () => {
  /* Indentation, inner spacing and identifiers all still have to agree. */
  assert.strictEqual(fuzzyFindEdit('    return x;\n', 'return x;').kind, 'one', 'a substring is still a substring');
  assert.strictEqual(fuzzyFindEdit('return xx;\n', 'return x;').kind, 'none');
  assert.strictEqual(fuzzyFindEdit('return  x;\n', 'return x;').kind, 'none', 'inner spacing is code');
  assert.strictEqual(fuzzyFindEdit('if (a) {\n  b();\n}\n', 'if (a) {\n    b();\n}').kind, 'none', 'indentation is not forgiven');
});

/* ────────────────────────── through the real tool ────────────────────────── */

test('edit_file names the LINES of an ambiguous match instead of only the count', async () => {
  const root = repoWith({ 'src/a.ts': 'const n = 1;\nfoo();\nconst m = 2;\nfoo();\n' });
  const r = await executeAskTool(
    'edit_file',
    { path: 'src/a.ts', oldString: 'foo();', newString: 'bar();' },
    ctxFor(root),
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.evidence, /appears 2 times in src\/a\.ts, starting at lines 2, 4\./);
  assert.match(r.evidence, /Include more surrounding lines so it is unique, or set replaceAll/);
});

test('edit_file applies an edit typed with the wrong quotes, and SAYS what it forgave', async () => {
  const root = repoWith({ 'src/a.ts': 'const greeting = “hello”;   \nconst n = 1;\n' });
  const r = await executeAskTool(
    'edit_file',
    { path: 'src/a.ts', oldString: 'const greeting = "hello";', newString: 'const greeting = "hi";' },
    ctxFor(root),
  );
  assert.ok(r.ok, r.evidence);
  assert.match(r.evidence, /^edited src\/a\.ts — 1 replacement \(harness edit 1 matched past .*quote characters/);
  const file = r.proposal?.files[0];
  assert.ok(file);
  assert.match(file.content, /const greeting = "hi";/);
  assert.match(file.content, /const n = 1;/);
});

test('edit_file still refuses text that is not there, in the words it always used', async () => {
  const root = repoWith({ 'src/a.ts': 'const n = 1;\n' });
  const r = await executeAskTool(
    'edit_file',
    { path: 'src/a.ts', oldString: 'const somethingElse = 9;', newString: 'x' },
    ctxFor(root),
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.evidence, /"oldString" does not appear in src\/a\.ts/);
  assert.match(r.evidence, /copy the exact text, whitespace included/);
});

test('an edit that is ambiguous ONLY once whitespace is ignored is refused with its lines', async () => {
  /* Both lines differ from the needle — one by its quotes, one by its quotes
     AND trailing whitespace — so neither is an exact hit and both normalise to
     the same thing. That is the case this branch exists for. */
  const root = repoWith({ 'src/a.ts': 'call(“x”);   \nmid();\ncall(“x”);\n' });
  const r = await executeAskTool(
    'edit_file',
    { path: 'src/a.ts', oldString: 'call("x");', newString: 'call("y");' },
    ctxFor(root),
  );
  /* Two different smart-quote spellings both normalise to the same thing: the
     model must say which, exactly as with an ordinary ambiguous edit. */
  assert.strictEqual(r.ok, false);
  assert.match(r.evidence, /matches 2 places once quotes, dashes and trailing whitespace are ignored \(lines 1, 3\)/);
});

test('replaceAll takes every fuzzy span, and the count is the truth', async () => {
  const root = repoWith({ 'src/a.ts': 'call(“x”);\nmid();\ncall(“x”);\n' });
  const r = await executeAskTool(
    'edit_file',
    { path: 'src/a.ts', oldString: 'call("x");', newString: 'call("y");', replaceAll: true },
    ctxFor(root),
  );
  assert.ok(r.ok, r.evidence);
  assert.match(r.evidence, /2 replacements/);
  assert.match(r.evidence, /\(2 places\)/);
  const body = r.proposal!.files[0]!.content;
  assert.strictEqual(body, 'call("y");\nmid();\ncall("y");\n');
});
