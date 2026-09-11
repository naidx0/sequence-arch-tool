import { describe, expect, it } from 'vitest';

import {
  changedRanges,
  diffFromProposedContent,
  diffTotals,
  parseUnifiedDiff,
  type DiffFileChange,
} from './diffModel';

/* ══════════════════════════════════════════════════════════════════════════
   ITEM 5.1 — THE PARSER, AND WHY IT IS TESTED BEFORE IT IS DRAWN.

   v1's review surface rendered a list of bare filenames. The reason it never
   grew a diff is not that nobody wanted one: it is that a unified diff is the
   one thing on this surface with an ARITHMETIC to get wrong, and getting it
   wrong is invisible. A gutter that numbers a hunk one line off looks exactly
   like a gutter that does not, until somebody anchors a comment to line 42 and
   the agent edits line 41.

   So every case below is a real thing `git diff` emits, and three of them are
   things this repository in particular emits:

     · CRLF, because core.autocrlf=true here and CANON §6 names "CRLF on read"
       as a mistake already made in this project.
     · `\ No newline at end of file`, which is a marker and NOT a context line.
       Counting it advances both cursors and puts every subsequent line number
       off by one — silently, and only in files that lack a trailing newline.
     · A hunk whose count is omitted (`@@ -1 +1 @@`), which git emits whenever
       the count is exactly 1.
   ══════════════════════════════════════════════════════════════════════════ */

/** One file, one hunk, one of each line kind. The line numbers in the
 *  assertions are computed by hand from the header, not from the parser. */
const SIMPLE = [
  'diff --git a/src/auth.ts b/src/auth.ts',
  'index 1a2b3c4..5d6e7f8 100644',
  '--- a/src/auth.ts',
  '+++ b/src/auth.ts',
  /* The counts are HAND-COMPUTED from the body below and they are the
     authority: old lines 10, 11, 12 (three) become new lines 10, 11, 12, 13
     (four). A header that disagreed with its own body would let the parser's
     close-on-count rule pass vacuously. */
  '@@ -10,3 +10,4 @@ export function verify(token: string) {',
  '   const claims = decode(token);',
  '-  if (!claims) return null;',
  '+  if (!claims) throw new AuthError("unreadable token");',
  '+  if (claims.exp < now()) throw new AuthError("expired");',
  '   return claims;',
  '',
].join('\n');

describe('item 5.1 — parseUnifiedDiff', () => {
  it('returns nothing for an empty diff, and says so without inventing a file', () => {
    /* GET /api/git/diff documents this verbatim: "May be EMPTY for an untracked
       or unchanged file." A parser that answered with one file and zero hunks
       would put an expandable filename on screen for a file with no change in
       it, which is precisely v1's defect wearing a new coat. */
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('   \n\n')).toEqual([]);
  });

  it('reads the path off +++ b/, not off the diff --git line', () => {
    const files = parseUnifiedDiff(SIMPLE);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/auth.ts');
    expect(files[0].oldPath).toBe('src/auth.ts');
    expect(files[0].binary).toBe(false);
  });

  it('numbers every line from the hunk header, in both gutters', () => {
    const [file] = parseUnifiedDiff(SIMPLE);
    const hunk = file.hunks[0];

    expect(hunk.oldStart).toBe(10);
    expect(hunk.oldCount).toBe(3);
    expect(hunk.newStart).toBe(10);
    expect(hunk.newCount).toBe(4);
    /* The text after the second @@ is git's own enclosing-context guess. It is
       the single most useful string in a hunk header for a human skimming a
       long diff, and dropping it is how a diff view becomes a wall. */
    expect(hunk.section).toBe('export function verify(token: string) {');

    expect(hunk.lines.map((l) => [l.kind, l.oldLine, l.newLine])).toEqual([
      ['context', 10, 10],
      ['del', 11, null],
      ['add', null, 11],
      ['add', null, 12],
      ['context', 12, 13],
    ]);
  });

  it('strips the leading sign and keeps the rest of the line verbatim', () => {
    const [file] = parseUnifiedDiff(SIMPLE);
    expect(file.hunks[0].lines[1].text).toBe('  if (!claims) return null;');
    expect(file.hunks[0].lines[4].text).toBe('  return claims;');
  });

  it('counts + and − for the file header', () => {
    const [file] = parseUnifiedDiff(SIMPLE);
    expect(file.added).toBe(2);
    expect(file.removed).toBe(1);
  });

  it('survives CRLF, because core.autocrlf=true in this repository', () => {
    const crlf = SIMPLE.replace(/\n/g, '\r\n');
    const [file] = parseUnifiedDiff(crlf);
    expect(file.path).toBe('src/auth.ts');
    expect(file.added).toBe(2);
    /* The carriage return must not survive into the rendered text — a stray
       \r paints as nothing and makes a line silently one character longer than
       the one it is being compared against. */
    expect(file.hunks[0].lines[0].text).toBe('  const claims = decode(token);');
  });

  it('treats "\\ No newline at end of file" as a marker, never as a context line', () => {
    const text = [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,2 +1,2 @@',
      ' one',
      '-two',
      '\\ No newline at end of file',
      '+three',
      '\\ No newline at end of file',
      '',
    ].join('\n');

    const [file] = parseUnifiedDiff(text);
    expect(file.hunks[0].lines.map((l) => l.kind)).toEqual(['context', 'del', 'add']);
    /* The invariant, not the expression: if the marker were counted the add
       would be numbered 3 instead of 2, and every comment anchored below it
       would point at the wrong line. */
    expect(file.hunks[0].lines[2].newLine).toBe(2);
    expect(file.noNewlineAtEof).toBe(true);
  });

  it('reads a hunk header whose count is omitted as a count of one', () => {
    const text = ['--- a/x', '+++ b/x', '@@ -1 +1 @@', '-a', '+b', ''].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(file.hunks[0].oldCount).toBe(1);
    expect(file.hunks[0].newCount).toBe(1);
    expect(file.hunks[0].lines.map((l) => [l.oldLine, l.newLine])).toEqual([
      [1, null],
      [null, 1],
    ]);
  });

  it('reads a new file as a new file rather than as a rename from /dev/null', () => {
    const text = [
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.ts',
      '@@ -0,0 +1,2 @@',
      '+one',
      '+two',
      '',
    ].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(file.path).toBe('new.ts');
    expect(file.oldPath).toBe(null);
    expect(file.change).toBe('added');
    expect(file.added).toBe(2);
  });

  it('reads a deletion, and keeps a path to name in the header', () => {
    const text = [
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-one',
      '',
    ].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(file.path).toBe('gone.ts');
    expect(file.change).toBe('deleted');
    expect(file.removed).toBe(1);
  });

  it('reports a binary file as binary instead of as an empty diff', () => {
    const text = [
      'diff --git a/logo.png b/logo.png',
      'index 1111111..2222222 100644',
      'Binary files a/logo.png and b/logo.png differ',
      '',
    ].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(file.path).toBe('logo.png');
    expect(file.binary).toBe(true);
    expect(file.hunks).toEqual([]);
  });

  it('splits a multi-file diff on diff --git, in the order git emitted them', () => {
    const text = [SIMPLE, '', 'diff --git a/b.ts b/b.ts', '--- a/b.ts', '+++ b/b.ts', '@@ -1,1 +1,1 @@', '-x', '+y', ''].join(
      '\n',
    );
    const files = parseUnifiedDiff(text);
    expect(files.map((f) => f.path)).toEqual(['src/auth.ts', 'b.ts']);
  });

  it('keeps a spaced path whole, and drops the tab git terminates it with', () => {
    /* MEASURED, not assumed. Real git 2.x does NOT quote a space; it emits the
       path bare and appends a TAB. Rendering the tab means the string on screen
       is not the string a PUT /api/file must carry. */
    const text = [
      'diff --git a/src/two words.ts b/src/two words.ts',
      '--- a/src/two words.ts\t',
      '+++ b/src/two words.ts\t',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '',
    ].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(file.path).toBe('src/two words.ts');
  });

  it('unquotes a non-ASCII path and decodes its octal escapes as UTF-8 BYTES', () => {
    /* This is the shape real git produced for `src/café.ts`: the WHOLE thing
       quoted, prefix included, with each UTF-8 byte as a three-digit octal
       escape. Decoding \303\251 one byte at a time through fromCharCode yields
       "Ã©" — a path that looks almost right and writes to the wrong file. */
    const text = [
      'diff --git "a/src/caf\\303\\251.ts" "b/src/caf\\303\\251.ts"',
      '--- "a/src/caf\\303\\251.ts"',
      '+++ "b/src/caf\\303\\251.ts"',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '',
    ].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(file.path).toBe('src/café.ts');
  });

  it('closes a hunk on its declared counts, so the input’s trailing newline is not a line', () => {
    /* THE INVARIANT: the parsed file is exactly as tall as the file. Every
       `git diff` output ends with a newline, `split` therefore yields a
       trailing '', and an empty string inside a hunk is a legitimate context
       line — so the ONLY thing separating the two is the hunk's own arithmetic.
       Without it the last hunk of every diff in the product grows one phantom
       line and a comment on it anchors past the end of the file. */
    const [file] = parseUnifiedDiff(SIMPLE);
    expect(file.hunks[0].lines).toHaveLength(5);
    const nonDeleted = file.hunks[0].lines.filter((l) => l.kind !== 'del');
    expect(nonDeleted).toHaveLength(file.hunks[0].newCount);
    expect(file.hunks[0].lines.filter((l) => l.kind !== 'add')).toHaveLength(file.hunks[0].oldCount);
  });
});

describe('item 5.1 — diffTotals, the "n files changed" header', () => {
  it('sums the arithmetic across files and never counts a binary as zero-change', () => {
    const files = parseUnifiedDiff(
      [
        SIMPLE,
        'diff --git a/logo.png b/logo.png',
        'Binary files a/logo.png and b/logo.png differ',
        '',
      ].join('\n'),
    );
    expect(diffTotals(files)).toEqual({ files: 2, added: 2, removed: 1, binary: 1 });
  });
});

describe('item 5.5 — changedRanges, the bridge to the impact panel', () => {
  it('returns the NEW-file line spans a change touched', () => {
    const [file] = parseUnifiedDiff(SIMPLE);
    expect(changedRanges(file)).toEqual([{ start: 11, end: 12 }]);
  });

  it('anchors a pure deletion at the new-file position it was removed from', () => {
    /* A deletion contributes no new lines, and returning nothing for it would
       make "you deleted the body of handleAuth()" an invisible change to the
       impact panel — the single loudest thing it should say. */
    const text = ['--- a/x', '+++ b/x', '@@ -1,3 +1,2 @@', ' a', '-b', ' c', ''].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(changedRanges(file)).toEqual([{ start: 2, end: 2 }]);
  });

  it('merges adjacent runs and keeps disjoint ones apart', () => {
    const text = [
      '--- a/x',
      '+++ b/x',
      '@@ -1,6 +1,7 @@',
      ' a',
      '+b',
      '+c',
      ' d',
      ' e',
      ' f',
      '+g',
      ' h',
      '',
    ].join('\n');
    const [file] = parseUnifiedDiff(text);
    expect(changedRanges(file)).toEqual([
      { start: 2, end: 3 },
      { start: 7, end: 7 },
    ]);
  });

  it('returns nothing for a binary file rather than a range it cannot know', () => {
    const binary: DiffFileChange = parseUnifiedDiff(
      ['diff --git a/l.png b/l.png', 'Binary files a/l.png and b/l.png differ', ''].join('\n'),
    )[0];
    expect(changedRanges(binary)).toEqual([]);
  });
});

describe('diffFromProposedContent', () => {
  it('renders a new-file proposal as all-added lines', () => {
    const file = diffFromProposedContent('src/new.ts', 'export const ok = 1;\n');
    expect(file.added).toBe(1);
    expect(file.removed).toBe(0);
    expect(file.hunks[0]?.lines[0]?.text).toBe('export const ok = 1;');
  });
});
