/**
 * r186 Slice 1 — rationale & decision-record mining, deterministic and keyless.
 *
 * Locks four things:
 *  1. every comment style our five parsed languages use is mined;
 *  2. commented-out CODE is NOT mined as rationale;
 *  3. ADR / RFC / `.sequence/decisions/*.md` references are extracted with the
 *     real reference string and a real `file:line`;
 *  4. a file that records nothing changes NOTHING — `describeCluster` returns a
 *     byte-identical sentence to the one it produced before this feature.
 *
 * No model, no network, no key: these are string scans over the source lines
 * `extractFacts` already holds.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import type { Lang } from '../types.js';
import {
  MAX_NOTES_PER_FILE,
  MAX_NOTES_PER_MODULE,
  extractRationale,
  looksLikeCode,
  rationaleSentence,
  rollUpRationale,
  type RationaleNote,
} from '../rationale.js';
import { describeCluster, type ClusterFacts } from '../cluster/cluster.js';

function mine(file: string, language: Lang, src: string): RationaleNote[] {
  return extractRationale({ file, language, lines: src.split('\n') });
}

// ---------------------------------------------------------------- 1. styles

test('r186: `// WHY:` in TypeScript is mined with its real file:line', () => {
  const notes = mine(
    'src/cache.ts',
    'ts',
    ['export const TTL = 30;', '', '// WHY: the auth server rate-limits us to ten calls a minute.', 'const x = 1;'].join('\n')
  );
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].tag, 'WHY');
  assert.strictEqual(notes[0].text, 'the auth server rate-limits us to ten calls a minute.');
  assert.strictEqual(notes[0].evidence.file, 'src/cache.ts');
  assert.strictEqual(notes[0].evidence.line, 3);
  assert.ok(notes[0].evidence.snippet.includes('WHY:'));
});

test('r186: a `// WHY:` block absorbs its continuation lines into one note', () => {
  const notes = mine(
    'src/cache.ts',
    'ts',
    ['// WHY: we cache the token because the auth server', '// rate-limits us to ten calls a minute.', 'const x = 1;'].join('\n')
  );
  assert.strictEqual(notes.length, 1, 'the continuation must not become a second note');
  assert.strictEqual(
    notes[0].text,
    'we cache the token because the auth server rate-limits us to ten calls a minute.'
  );
});

test('r186: `# NOTE:` in Python is mined, and a shebang is not', () => {
  const notes = mine(
    'app/config.py',
    'py',
    ['#!/usr/bin/env python', '# NOTE: the default pool size mirrors the RDS parameter group.', 'POOL = 8'].join('\n')
  );
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].tag, 'NOTE');
  assert.strictEqual(notes[0].evidence.line, 2);
});

test('r186: `// HACK:` in Go is mined', () => {
  const notes = mine(
    'render/json.go',
    'go',
    ['package render', '', '// HACK: we retry twice because the upstream proxy flaps under load.', 'func Render() {}'].join('\n')
  );
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].tag, 'HACK');
  assert.strictEqual(notes[0].text, 'we retry twice because the upstream proxy flaps under load.');
});

test('r186: `RATIONALE:` inside a Javadoc block comment is mined', () => {
  const notes = mine(
    'src/main/java/Pool.java',
    'java',
    [
      '/**',
      ' * RATIONALE: the pool is fixed at eight because the database caps',
      ' * connections at ten and two are reserved for migrations.',
      ' */',
      'public class Pool {}',
    ].join('\n')
  );
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].tag, 'RATIONALE');
  assert.strictEqual(
    notes[0].text,
    'the pool is fixed at eight because the database caps connections at ten and two are reserved for migrations.'
  );
  assert.strictEqual(notes[0].evidence.line, 2);
});

test('r186: `/* GOTCHA: … */` on one line in JavaScript is mined', () => {
  const notes = mine(
    'lib/request.js',
    'js',
    ['/* GOTCHA: ranges are inclusive, so 0-3 is four items. */', 'module.exports = req;'].join('\n')
  );
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].tag, 'GOTCHA');
  assert.strictEqual(notes[0].text, 'ranges are inclusive, so 0-3 is four items.');
});

test('r186: prose that merely starts with the word "note" is NOT a marker', () => {
  // The colon is the whole false-positive defence — without it, ordinary
  // sentences would flood every card.
  const notes = mine('src/a.ts', 'ts', '// note that the caller owns this handle\n');
  assert.deepStrictEqual(notes, []);
});

// --------------------------------------------------- 2. commented-out code

test('r186: a marker whose body is commented-out CODE is skipped', () => {
  const notes = mine(
    'src/timeout.ts',
    'ts',
    ['// NOTE: const timeout = 30;', '// GOTCHA: return errors.New("boom")', 'export const t = 1;'].join('\n')
  );
  assert.deepStrictEqual(notes, [], 'commented-out code is not the team writing down why');
});

test('r186: a commented-out block that happens to cite an ADR yields the prose line only', () => {
  const notes = mine(
    'lib/cache.js',
    'js',
    ['// see ADR-0042 for why this was removed', '// const cached = compute(a, b);', 'module.exports = {};'].join('\n')
  );
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].ref, 'ADR-0042');
  assert.ok(!notes[0].text.includes('compute'), 'the commented-out statement must not be mined');
});

test('r186: looksLikeCode covers the shapes the five languages actually produce', () => {
  for (const code of [
    'const timeout = 30;',
    'if (user) { return next(); }',
    'def handle(request):',
    'func Render(c *Context) {}',
    'return errors.New("boom")',
    'public static void main(String[] a) {',
    'value := compute(a, b)',
    'doThing(a, b)',
    'x.y = z',
    'singleToken',
  ]) {
    assert.ok(looksLikeCode(code), `must read as code: ${code}`);
  }
  for (const prose of [
    'the auth server rate-limits us to ten calls a minute',
    'ranges are inclusive, so 0-3 is four items',
    'we retry twice because the upstream proxy flaps under load',
  ]) {
    assert.ok(!looksLikeCode(prose), `must read as prose: ${prose}`);
  }
});

// ------------------------------------------------------ 3. decision records

test('r186: ADR and RFC references are extracted verbatim with a real line', () => {
  // Shape taken from django `tests/mail/tests.py`, which cites RFC numbers in
  // comments exactly like this.
  const notes = mine(
    'tests/mail/tests.py',
    'py',
    ['import email', '', '# Encoding of the local part follows RFC-2047, not RFC-5890.', 'x = 1'].join('\n')
  );
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].tag, 'RFC');
  assert.strictEqual(notes[0].ref, 'RFC-2047');
  assert.strictEqual(notes[0].evidence.line, 3);
});

test('r186: "RFC 2616" without a hyphen is NOT treated as a decision record', () => {
  const notes = mine('src/a.ts', 'ts', '// the semantics here follow RFC 2616 closely\n');
  assert.deepStrictEqual(notes, []);
});

test('r186: a link to a .sequence/decisions record is extracted as its ref', () => {
  const notes = mine(
    'src/cache.ts',
    'ts',
    ['// The read cache was chosen in .sequence/decisions/0007-read-cache.md here.', 'export const c = 1;'].join('\n')
  );
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].tag, 'DECISION');
  assert.strictEqual(notes[0].ref, '.sequence/decisions/0007-read-cache.md');
});

test('r186: a marker that also names a record keeps the tag AND carries the ref', () => {
  const notes = mine(
    'src/cache.ts',
    'ts',
    ['// WHY: the tradeoff is written up in ADR-0007 in full.', 'export const c = 1;'].join('\n')
  );
  assert.strictEqual(notes[0].tag, 'WHY');
  assert.strictEqual(notes[0].ref, 'ADR-0007');
});

// ------------------------------------------------------------- 4. bounding

test('r186: a file is capped at MAX_NOTES_PER_FILE and duplicates are dropped', () => {
  const lines: string[] = [];
  for (let i = 0; i < 20; i++) {
    lines.push(`// NOTE: reason number ${i} for doing it this way.`, `const v${i} = ${i};`);
  }
  const notes = mine('src/many.ts', 'ts', lines.join('\n'));
  assert.strictEqual(notes.length, MAX_NOTES_PER_FILE);

  const dupes = ['// NOTE: the same reason written twice.', 'const a = 1;', '// NOTE: the same reason written twice.', 'const b = 2;'];
  assert.strictEqual(mine('src/dupe.ts', 'ts', dupes.join('\n')).length, 1);
});

test('r186: a module roll-up caps at MAX_NOTES_PER_MODULE and puts cited records first', () => {
  const byFile = new Map<string, RationaleNote[]>();
  for (let i = 0; i < 6; i++) {
    byFile.set(`src/f${i}.ts`, mine(`src/f${i}.ts`, 'ts', `// NOTE: reason ${i} for this shape.\nconst a = 1;`));
  }
  byFile.set('src/z.ts', mine('src/z.ts', 'ts', '// WHY: recorded in ADR-0007 with the numbers.\nconst a = 1;'));
  const rolled = rollUpRationale([...byFile.keys()], byFile);
  assert.strictEqual(rolled.length, MAX_NOTES_PER_MODULE);
  assert.strictEqual(rolled[0].ref, 'ADR-0007', 'a cited record is a harder fact than a NOTE');
});

test('r186: the surfaced sentence is ONE line and names a real file:line', () => {
  const notes = mine('render/json.go', 'go', '// WHY: msgpack is opt-in because the tag bloats the binary.\nfunc a() {}');
  const sentence = rationaleSentence(notes)!;
  assert.strictEqual(sentence, 'Rationale noted at render/json.go:1.');
  assert.ok(!sentence.includes('\n'));

  const cited = mine('src/cache.ts', 'ts', '// WHY: the tradeoff is written up in ADR-0007 in full.\nconst a = 1;');
  assert.strictEqual(rationaleSentence(cited), 'Cites ADR-0007 (src/cache.ts:1).');
});

// ------------------------------- 5. absent signal changes nothing (the lock)

test('r186 LOCK: a file with no rationale mines nothing and leaves describeCluster byte-identical', () => {
  const src = ['package render', '', '// loadTemplate reads the template set.', 'func loadTemplate() {}'].join('\n');
  assert.deepStrictEqual(mine('render/render.go', 'go', src), []);

  const members = ['render/render.go', 'render/json.go'];
  const facts: ReadonlyMap<string, ClusterFacts> = new Map([
    ['render/render.go', { file: 'render/render.go', language: 'go', functions: [{ name: 'Render' }], classes: [] }],
    ['render/json.go', { file: 'render/json.go', language: 'go', functions: [{ name: 'Instance' }], classes: [] }],
  ]);

  const before = describeCluster(members, facts);
  assert.strictEqual(before, '2 go files in render, defining Instance, Render.');
  // The three ways "no rationale" can reach the function must all agree, byte
  // for byte, with the pre-feature output.
  assert.strictEqual(describeCluster(members, facts, undefined), before);
  assert.strictEqual(describeCluster(members, facts, []), before);
  assert.strictEqual(describeCluster(members, facts, rollUpRationale(members, new Map())), before);
});

test('r186: when rationale IS present describeCluster appends exactly one sentence', () => {
  const members = ['render/render.go'];
  const facts: ReadonlyMap<string, ClusterFacts> = new Map([
    ['render/render.go', { file: 'render/render.go', language: 'go', functions: [{ name: 'Render' }], classes: [] }],
  ]);
  const notes = mine('render/render.go', 'go', '// WHY: html escaping happens here, not in the handler.\nfunc Render() {}');
  const out = describeCluster(members, facts, notes)!;
  assert.strictEqual(out, '1 go file in render, defining Render. Rationale noted at render/render.go:1.');
  assert.strictEqual(out.split('Rationale noted').length, 2, 'never twice');
});

test('r186: rationale never becomes a graph edge — the extractor returns notes only', () => {
  // Guard against the obvious future mistake: a comment is prose, not a
  // dependency. `extractRationale` has no edge shape to return at all, and this
  // asserts the note shape stays evidence-only.
  const notes = mine('src/a.ts', 'ts', '// WHY: service B owns this table, we only read it.\nconst a = 1;');
  const keys = Object.keys(notes[0]).sort();
  assert.deepStrictEqual(keys, ['evidence', 'tag', 'text']);
  assert.deepStrictEqual(Object.keys(notes[0].evidence).sort(), ['file', 'line', 'snippet']);
});
