import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './files.css';

import { FILES } from './anchors';
import { DiffView } from './DiffView';
import { DIFF_LINE_CAP } from './filesModel';

/* ══════════════════════════════════════════════════════════════════════════
   THE DIFF — item 2.1
   packages/web2/src/files/DiffView.test.tsx

   Every fixture below is REAL `git diff --no-color` output, which is what
   `GET /api/git/diff` returns. A hand-shaped "diff" that the parser happens to
   like is the version of this suite that passes while the product renders
   nothing — the parser's own test file makes the same point about being
   measured against real git rather than against an assumption.

   THE FOUR STATES ARE THE POINT OF THIS FILE. `empty`, `binary`, `unreadable`
   and `ready` are four different facts with four different next moves, and the
   worst failure available here is the one where a reader believes they have
   reviewed a change they never saw.
   ══════════════════════════════════════════════════════════════════════════ */

const CHANGE = [
  'diff --git a/src/auth.ts b/src/auth.ts',
  'index 8b1a9c3..2f4d1e0 100644',
  '--- a/src/auth.ts',
  '+++ b/src/auth.ts',
  /* The counts are git's, and they are LOAD-BEARING: a hunk closes on its own
     declared counts rather than on the next header, because the trailing
     newline of `git diff` output is indistinguishable from an empty context
     line. Get them wrong in a fixture and the last hunk grows a phantom line —
     which is exactly what a wrong count here produced on the first run. */
  '@@ -10,3 +10,4 @@ export function verify(token: string) {',
  '   const claims = decode(token);',
  '-  if (!claims) return false;',
  '+  if (!claims) throw new Error("no claims");',
  '+  audit(claims.sub);',
  '   return true;',
  '',
].join('\n');

function mount(text: string, path: string | null = 'src/auth.ts', lineCap?: number) {
  const onShowMore = vi.fn();
  render(
    <div className="files-scope">
      <DiffView text={text} path={path} lineCap={lineCap} onShowMore={onShowMore} />
    </div>,
  );
  return { onShowMore };
}

describe('a real diff', () => {
  it('draws every line with the numbers from BOTH sides', () => {
    mount(CHANGE);
    const lines = screen.getAllByTestId(FILES.line);
    expect(lines.map((l) => l.getAttribute('data-kind'))).toEqual([
      'context',
      'del',
      'add',
      'add',
      'context',
    ]);

    /* A REMOVED LINE HAS NO NEW NUMBER, and that is not a nicety: it occupies
       no line in the file anything will edit next, so numbering it sends a
       reader — or an agent the reader steers — at the wrong line, silently. */
    const removed = lines[1]!;
    expect(removed.getAttribute('data-old')).toBe('11');
    expect(removed.getAttribute('data-new')).toBeNull();

    const added = lines[2]!;
    expect(added.getAttribute('data-new')).toBe('11');
    expect(added.getAttribute('data-old')).toBeNull();
  });

  it('SHOWS THE HUNK HEADER WITH git’s OWN CONTEXT GUESS', () => {
    /* On a long file the header is the only thing that says WHERE you are, and
       dropping it is how a diff view becomes a wall. */
    mount(CHANGE);
    const head = screen.getByTestId(FILES.hunkHead);
    expect(head.textContent).toContain('@@');
    expect(head.textContent).toContain('10,3');
    expect(head.textContent).toContain('export function verify(token: string) {');
  });

  it('names the file, and states the arithmetic', () => {
    mount(CHANGE);
    expect(screen.getByTestId(FILES.diffFile).getAttribute('data-path')).toBe('src/auth.ts');
    const summary = screen.getByTestId(FILES.diffSummary);
    expect(summary.textContent).toContain('+2');
    expect(summary.textContent).toContain('−1');
    /* One sentence for a screen reader, produced by the same function every
       other surface uses, so the third caller cannot write a fifth wording. */
    expect(summary.getAttribute('aria-label')).toBe('1 file · +2 −1');
  });

  it('spends the verdict hues on the arithmetic and on NOTHING ELSE', () => {
    /* Law 1 counts hues, and `+2 −1` is a claim about what happened — the one
       thing a hue may pay for here. An added LINE gets the diff channel's wash
       instead, "so a removed line can never be misread as won't fit". */
    const { container } = render(
      <div className="files-scope">
        <DiffView text={CHANGE} path="src/auth.ts" />
      </div>,
    );
    expect(container.querySelectorAll('.files-stat-add')).toHaveLength(1);
    expect(container.querySelectorAll('.files-stat-del')).toHaveLength(1);
    const addedLine = screen.getAllByTestId(FILES.line)[2]!;
    expect(addedLine.className).toContain('files-line-add');
    expect(addedLine.querySelector('.files-stat-add')).toBeNull();
  });
});

describe('the three states that are not a diff', () => {
  it('EMPTY NAMES BOTH CAUSES, BECAUSE THE ROUTE CANNOT TELL THEM APART', () => {
    /* `GET /api/git/diff` documents an empty body for a file that is unchanged
       AND for one that is untracked. Naming only one would be a guess, and the
       reader's next move differs between them. */
    mount('', 'src/new.ts');
    const note = screen.getByTestId(FILES.diffNote).textContent ?? '';
    expect(screen.getByTestId(FILES.diff).getAttribute('data-state')).toBe('empty');
    expect(note).toContain('src/new.ts');
    expect(note).toContain('unchanged');
    expect(note).toContain('not tracking');
  });

  it('BINARY SAYS THE FILE CHANGED, WHICH IS NOT THE SAME AS NO CHANGE', () => {
    mount(
      [
        'diff --git a/docs/logo.png b/docs/logo.png',
        'index 1111111..2222222 100644',
        'Binary files a/docs/logo.png and b/docs/logo.png differ',
        '',
      ].join('\n'),
      'docs/logo.png',
    );
    expect(screen.getByTestId(FILES.diff).getAttribute('data-state')).toBe('binary');
    expect(screen.getByTestId(FILES.diffFile).getAttribute('data-path')).toBe('docs/logo.png');
    const notes = screen.getAllByTestId(FILES.diffNote).map((n) => n.textContent ?? '');
    expect(notes.some((n) => n.includes('no lines to show'))).toBe(true);
    /* And it draws no line rows at all, because there are none to draw. */
    expect(screen.queryAllByTestId(FILES.line)).toHaveLength(0);
  });

  it('UNREADABLE IS NOT "NO CHANGES", AND SAYS SO OUT LOUD', () => {
    /* Text arrived and nothing in it parsed. Rendering that as a clean tree is
       how somebody ships believing they reviewed a change. */
    mount('<<<<<<< this is not a unified diff', 'src/auth.ts');
    expect(screen.getByTestId(FILES.diff).getAttribute('data-state')).toBe('unreadable');
    const note = screen.getByTestId(FILES.diffNote);
    expect(note.getAttribute('role')).toBe('alert');
    expect(note.textContent).toContain('not a unified diff');
  });
});

describe('a very large diff does not lock the page', () => {
  const SIZE = DIFF_LINE_CAP + 500;
  const HUGE = [
    'diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml',
    '--- a/pnpm-lock.yaml',
    '+++ b/pnpm-lock.yaml',
    `@@ -0,0 +1,${SIZE} @@`,
    ...Array.from({ length: SIZE }, (_, i) => `+  resolution-${i}: true`),
    '',
  ].join('\n');

  it('MOUNTS THE CAP AND NOT THE DIFF', () => {
    /* One DOM row per line over a regenerated lockfile is the rail's measured
       stall — "mounted a DOM button for every one, stalling the whole shell" —
       arriving through a different door. */
    mount(HUGE, 'pnpm-lock.yaml');
    expect(screen.getAllByTestId(FILES.line)).toHaveLength(DIFF_LINE_CAP);
  });

  it('SAYS WHAT IT WITHHELD, because capping silently is worse than stalling', () => {
    mount(HUGE, 'pnpm-lock.yaml');
    const notes = screen.getAllByTestId(FILES.diffNote).map((n) => n.textContent ?? '');
    expect(notes.some((n) => n.includes('500 more lines not drawn'))).toBe(true);
    /* The ARITHMETIC is still of the whole change, never of the excerpt. */
    expect(screen.getByTestId(FILES.diffSummary).textContent).toContain(`+${SIZE}`);
  });

  it('draws the rest when the reader asks for it', () => {
    const { onShowMore } = mount(HUGE, 'pnpm-lock.yaml');
    fireEvent.click(screen.getByTestId(FILES.diffMore));

    expect(screen.getAllByTestId(FILES.line)).toHaveLength(SIZE);
    expect(screen.queryByTestId(FILES.diffMore)).toBeNull();
    expect(onShowMore).toHaveBeenCalledWith(DIFF_LINE_CAP * 2);
  });

  it('RESETS THE CAP WHEN THE DIFF CHANGES', () => {
    /* Carrying a raised cap from one file to the next is the stall
       reintroduced by the code meant to manage it — and doing the reset in an
       effect would mount the rows for one frame before undoing it, which is the
       same defect one paint later. */
    const { rerender } = render(
      <div className="files-scope">
        <DiffView text={HUGE} path="pnpm-lock.yaml" lineCap={10} />
      </div>,
    );
    fireEvent.click(screen.getByTestId(FILES.diffMore));
    expect(screen.getAllByTestId(FILES.line).length).toBeGreaterThan(10);

    rerender(
      <div className="files-scope">
        <DiffView text={HUGE.replace('pnpm-lock.yaml', 'other.yaml')} path="other.yaml" lineCap={10} />
      </div>,
    );
    expect(screen.getAllByTestId(FILES.line)).toHaveLength(10);
  });
});

describe('more than one file in one diff', () => {
  const TWO = [
    CHANGE.trimEnd(),
    'diff --git a/docs/logo.png b/docs/logo.png',
    'Binary files a/docs/logo.png and b/docs/logo.png differ',
    '',
  ].join('\n');

  it('renders each file with its own header, text and binary together', () => {
    mount(TWO, null);
    const files = screen.getAllByTestId(FILES.diffFile);
    expect(files.map((f) => f.getAttribute('data-path'))).toEqual([
      'src/auth.ts',
      'docs/logo.png',
    ]);
    /* A mixed diff is `ready`, not `binary`: some of it has lines. */
    expect(screen.getByTestId(FILES.diff).getAttribute('data-state')).toBe('ready');
    expect(screen.getByTestId(FILES.diffSummary).textContent).toContain('2 files');
  });
});
