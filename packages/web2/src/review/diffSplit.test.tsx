import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REVIEW } from './anchors';
import { DiffToolbar, DiffView } from './DiffView';
import { parseUnifiedDiff } from './diffModel';
import { DIFF_VIEW_KEY, DIFF_WRAP_KEY, diffPrefs, effectiveMode, isOneSided, pairHunkLines } from './diffSplit';

const MIXED = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -10,4 +10,5 @@ function f() {',
  '   keep one',
  '-  old two',
  '-  old three',
  '+  new two',
  '+  new three',
  '+  new four',
  '   keep five',
  '',
].join('\n');

const ONLY_ADDS = [
  'diff --git a/src/b.ts b/src/b.ts',
  '--- a/src/b.ts',
  '+++ b/src/b.ts',
  '@@ -1,1 +1,3 @@',
  ' head',
  '+added one',
  '+added two',
  '',
].join('\n');

const noop = () => undefined;
const props = (file: ReturnType<typeof parseUnifiedDiff>[number]) => ({
  file,
  comments: [],
  composing: null,
  onComment: noop,
  onCancel: noop,
  onSend: noop,
  draft: '',
  onDraft: noop,
});

beforeEach(() => {
  localStorage.clear();
  diffPrefs.reset();
});
afterEach(() => {
  localStorage.clear();
  diffPrefs.reset();
});

describe('pairHunkLines: removed runs are laid against the added runs that follow', () => {
  it('pads the shorter side and puts context on both', () => {
    const [file] = parseUnifiedDiff(MIXED);
    const rows = pairHunkLines(file.hunks[0].lines);
    expect(rows.map((r) => [r.left?.kind ?? null, r.right?.kind ?? null])).toEqual([
      ['context', 'context'],
      ['del', 'add'],
      ['del', 'add'],
      [null, 'add'],
      ['context', 'context'],
    ]);
    expect(rows[1].left?.oldLine).toBe(11);
    expect(rows[1].right?.newLine).toBe(11);
    expect(rows[3].left).toBeNull();
  });

  it('a diff that only adds, or only removes, is one-sided (one column in either mode)', () => {
    const [mixed] = parseUnifiedDiff(MIXED);
    const [adds] = parseUnifiedDiff(ONLY_ADDS);
    expect(isOneSided(mixed)).toBe(false);
    expect(isOneSided(adds)).toBe(true);
    expect(effectiveMode(mixed, 'split')).toBe('split');
    expect(effectiveMode(adds, 'split')).toBe('unified');
    expect(effectiveMode(mixed, 'unified')).toBe('unified');
  });
});

describe('DiffView in side-by-side', () => {
  it('draws old and new cells in step, with the numbers of each side', () => {
    const [file] = parseUnifiedDiff(MIXED);
    render(<DiffView {...props(file)} mode="split" />);
    expect(screen.getByTestId(REVIEW.diff).getAttribute('data-view')).toBe('split');
    const olds = screen.getAllByTestId(REVIEW.splitOld);
    const news = screen.getAllByTestId(REVIEW.splitNew);
    expect(olds).toHaveLength(5);
    expect(news).toHaveLength(5);
    expect(olds.map((c) => c.getAttribute('data-kind'))).toEqual(['context', 'del', 'del', 'empty', 'context']);
    expect(news.map((c) => c.getAttribute('data-kind'))).toEqual(['context', 'add', 'add', 'add', 'context']);
    expect(olds[1].textContent).toContain('old two');
    expect(news[1].textContent).toContain('new two');
  });

  it('keeps the comment affordance on the new side and routes it to the new line number', () => {
    const [file] = parseUnifiedDiff(MIXED);
    const onComment = vi.fn();
    render(<DiffView {...props(file)} onComment={onComment} mode="split" />);
    const adds = screen.getAllByTestId(REVIEW.commentAdd);
    fireEvent.click(adds[1]);
    expect(onComment).toHaveBeenCalledWith(11);
  });

  it('an add-only file stays in one column although the person chose side by side', () => {
    const [file] = parseUnifiedDiff(ONLY_ADDS);
    render(<DiffView {...props(file)} mode="split" />);
    expect(screen.getByTestId(REVIEW.diff).getAttribute('data-view')).toBe('unified');
    expect(screen.queryAllByTestId(REVIEW.splitOld)).toHaveLength(0);
    expect(screen.getAllByTestId(REVIEW.line).length).toBeGreaterThan(0);
  });
});

describe('the toolbar remembers the choice', () => {
  it('switching to side by side redraws the diff and is written to storage; Wrap likewise', () => {
    const [file] = parseUnifiedDiff(MIXED);
    render(
      <>
        <DiffToolbar />
        <DiffView {...props(file)} />
      </>,
    );
    expect(screen.getByTestId(REVIEW.diff).getAttribute('data-view')).toBe('unified');
    fireEvent.click(screen.getByTestId(REVIEW.viewSplit));
    expect(screen.getByTestId(REVIEW.diff).getAttribute('data-view')).toBe('split');
    expect(localStorage.getItem(DIFF_VIEW_KEY)).toBe('split');
    fireEvent.click(screen.getByTestId(REVIEW.wrapToggle));
    expect(screen.getByTestId(REVIEW.diff).getAttribute('data-wrap')).toBe('on');
    expect(localStorage.getItem(DIFF_WRAP_KEY)).toBe('on');
    fireEvent.click(screen.getByTestId(REVIEW.viewUnified));
    expect(screen.getByTestId(REVIEW.diff).getAttribute('data-view')).toBe('unified');
  });

  it('a stored choice is read back on the next mount', () => {
    localStorage.setItem(DIFF_VIEW_KEY, 'split');
    diffPrefs.reset();
    const [file] = parseUnifiedDiff(MIXED);
    render(<DiffView {...props(file)} />);
    expect(screen.getByTestId(REVIEW.diff).getAttribute('data-view')).toBe('split');
  });

  it('storage that throws leaves the defaults standing', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    diffPrefs.reset();
    expect(diffPrefs.get()).toEqual({ view: 'unified', wrap: false });
    spy.mockRestore();
  });
});
