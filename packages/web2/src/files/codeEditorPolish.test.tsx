import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CodeEditor, gutterDigits } from './CodeEditor';

/* Owner 2026-10-10: gutter capped at 4 digits, edit view transparent, one scroller, transparent buttons.
   jsdom has no layout, so the CSS is read as text; the browser measurements are in the commit messages. */
const css = readFileSync(join(__dirname, 'files.css'), 'utf8').replace(/\r/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel: string) => {
  const at = css.indexOf(`${sel} {`);
  return at < 0 ? '' : css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
};
const mount = (n: number) =>
  render(<CodeEditor path="a.txt" value={Array.from({ length: n }, (_, i) => `l${i}`).join('\n')} onChange={vi.fn()} dirty={false} />).container.querySelector<HTMLElement>('.files-ed-inner')!;

describe('the gutter is sized to its digits, capped at four', () => {
  it('counts digits of the line count and stops at four', () => {
    expect([1, 9, 10, 99, 100, 999, 1000, 9999, 10000, 123456].map(gutterDigits)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 4, 4]);
  });
  it('sets the width on the editor from that count', () => {
    expect(mount(7).style.getPropertyValue('--files-ed-gutter')).toContain('calc(1ch');
    expect(mount(250).style.getPropertyValue('--files-ed-gutter')).toContain('calc(3ch');
    expect(mount(12000).style.getPropertyValue('--files-ed-gutter')).toContain('calc(4ch');
  });
  it('a number that does not fit spills into the padding, never clipped to a wrong number or given room', () => {
    const r = rule('.files-scope .files-ed-gutter > span');
    expect(r).toMatch(/overflow:\s*visible/);
    expect(r).toMatch(/direction:\s*rtl/);
    expect(r).not.toMatch(/overflow:\s*hidden/);
    expect(r).toMatch(/white-space:\s*nowrap/);
    expect(rule('.files-scope .files-ed-gutter')).not.toMatch(/\b52px/);
  });
});

describe('the edit view blends into the page', () => {
  it('has no fill of its own, and the field and listing stay clear', () => {
    expect(rule('.files-scope .files-ed')).toMatch(/background:\s*transparent/);
    expect(rule('.files-scope .files-ed')).not.toMatch(/surface-1/);
    expect(rule('.files-scope .files-editor.files-ed-ta')).toMatch(/background:\s*transparent/);
  });
  it('the current line stays a subtle hover wash, and the gutter keeps the page ground so sideways text cannot show through', () => {
    expect(rule('.files-scope .files-ed-curline')).toMatch(/background:\s*var\(--state-hover\)/);
    expect(rule('.files-scope .files-ed-gutter')).toMatch(/background:\s*var\(--bg-base\)/);
  });
});

describe('editor density and hairlines (owner 2026-10-10: zoom out, thinner lines)', () => {
  it('one step down the type scale with a tighter row pitch', () => {
    expect(rule('.files-scope .files-ed')).toMatch(/--files-ed-lh:\s*18px/);
    expect(rule('.files-scope .files-ed-gutter,\n.files-scope .files-ed-hl,\n.files-scope .files-ed-ta')).not.toMatch(/--t-12-5/);
  });
  it('the gutter side padding is tight and the inline width uses the same padding', () => {
    expect(rule('.files-scope .files-ed-gutter')).toMatch(/padding:\s*var\(--files-ed-pad\) var\(--sp-6\) var\(--files-ed-pad\) var\(--sp-4\)/);
    expect(mount(7).style.getPropertyValue('--files-ed-gutter')).toBe('calc(1ch + var(--sp-4) + var(--sp-6) + var(--w-hair))'); // the gutter's own hairline is counted, so 4 digits fit whole
  });
  it.each(['.files-ed', '.files-ed-gutter', '.files-ed-find', '.files-ed-status'])('%s hairline is the thinnest edge', (sel) => {
    const r = rule(`.files-scope ${sel}`);
    expect(r).toMatch(/border(-top|-right)?:\s*var\(--w-hair\) solid var\(--edge-faint\)/);
  });
});

describe('scrolling: one scroller, so the gutter cannot drift, and the status row cannot lose its buttons', () => {
  it('the gutter, the listing and the field share one font size and line height, and the rows are on the same pitch', () => {
    const shared = rule('.files-scope .files-ed-gutter,\n.files-scope .files-ed-hl,\n.files-scope .files-ed-ta');
    expect(shared).toMatch(/line-height:\s*var\(--files-ed-lh\)/);
    expect(shared).toMatch(/font-size:\s*var\(--t-12\)/);
    expect(rule('.files-scope .files-ed-gutter > span')).toMatch(/height:\s*var\(--files-ed-lh\)/);
    expect(rule('.files-scope .files-ed-gutter > span')).toMatch(/flex:\s*none/);
  });
  it('only the scroller scrolls: the field is as tall as its lines and never scrolls itself', () => {
    expect(rule('.files-scope .files-ed-scroll')).toMatch(/overflow:\s*auto/);
    expect(rule('.files-scope .files-editor.files-ed-ta')).toMatch(/overflow:\s*hidden/);
    expect(rule('.files-scope .files-ed-gutter')).toMatch(/position:\s*sticky/);
    const { container } = render(<CodeEditor path="a.txt" value={'a\nb\nc\nd'} onChange={vi.fn()} dirty={false} />);
    expect(container.querySelector('textarea')!.rows).toBe(4);
    expect(container.querySelectorAll('.files-ed-gutter > span')).toHaveLength(4);
    expect(container.querySelectorAll('.files-ed-hl > span')).toHaveLength(4);
  });
  it('the readouts are shown whole or hidden by width, never squeezed, so the state and the buttons stay in the row', () => {
    const r = rule('.files-scope .files-ed-info');
    expect(r).toMatch(/flex:\s*none/);
    expect(r).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(css).toMatch(/container:\s*files-ed \/ inline-size/);
    expect(css).toMatch(/@container files-ed \(max-width:\s*420px\)\s*\{[^}]*files-ed-info:not\(\[data-testid="files-ed-caret"\]\)\s*\{\s*display:\s*none/);
    expect(css).toMatch(/@container files-ed \(max-width:\s*300px\)\s*\{[^}]*files-ed-info\s*\{\s*display:\s*none/);
    expect(rule('.files-scope .files-ed-status > .files-ed-state,\n.files-scope .files-ed-status > button')).toMatch(/flex:\s*none/);
    const { container } = render(<CodeEditor path="a.txt" value="x" onChange={vi.fn()} dirty={false} onSave={vi.fn()} onDiscard={vi.fn()} />);
    expect(container.querySelectorAll('.files-ed-status .files-ed-info')).toHaveLength(3);
  });
});

describe('the editor uses the preview toolbar’s transparent button', () => {
  it('Discard, Save and the find bar buttons are .files-btn, with no pill fill or border of their own', () => {
    const { container, getByTestId } = render(<CodeEditor path="a.txt" value="x" onChange={vi.fn()} dirty onSave={vi.fn()} onDiscard={vi.fn()} />);
    const pills = container.querySelectorAll('.files-ed-pill');
    expect(pills).toHaveLength(2);
    pills.forEach((p) => expect(p.classList.contains('files-btn')).toBe(true));
    fireEvent.keyDown(getByTestId('files-code-editor'), { key: 'f', ctrlKey: true });
    const ibs = container.querySelectorAll('.files-ed-ib');
    expect(ibs).toHaveLength(3);
    ibs.forEach((b) => expect(b.classList.contains('files-btn')).toBe(true));
    for (const sel of ['.files-scope .files-ed-pill', '.files-scope .files-ed-ib']) expect(rule(sel)).not.toMatch(/glass-ctl|border:|background:/);
    expect(rule('.files-scope .files-ed-pill.is-solid')).not.toMatch(/accent-solid/);
    expect(css).toMatch(/\.files-scope \.files-btn \{[^}]*background-color:\s*transparent/);
  });
});
