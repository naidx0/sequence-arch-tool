import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FILES } from './anchors';
import { CodeEditor, EDITOR_OVERSCAN, EDITOR_WINDOW_MIN, editorWindow } from './CodeEditor';

/* ══════════════════════════════════════════════════════════════════════════
   THE EDITOR DRAWS ONLY THE LINES IN VIEW (perf, 019)
   packages/web2/src/files/codeEditorWindow.test.tsx

   An 8.8k-line file drew 17.7k elements (a gutter number and a highlighted line each) and froze the
   open for 0.6 s. The gutter and the listing now draw the lines in view plus an overscan, the rest
   being padding of the same height; the field (the text, the selection, the caret, Find's target)
   stays one element holding the whole file. jsdom has no layout, so the scroller's box is given here:
   a 400 px viewport, 18 px lines, a settable scrollTop.
   ══════════════════════════════════════════════════════════════════════════ */

const LH = 18;
const VIEW = 400;
const N = 3000;
const TEXT = Array.from({ length: N }, (_, i) => `const line${i + 1} = ${i + 1};`).join('\n');

const tops = new WeakMap<Element, number>();
let viewHeight = VIEW;
const saved: { client?: PropertyDescriptor; top?: PropertyDescriptor } = {};

beforeEach(() => {
  viewHeight = VIEW;
  saved.client = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  saved.top = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('files-ed-scroll') ? viewHeight : 0;
    },
  });
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) {
      return tops.get(this) ?? 0;
    },
    set(this: Element, v: number) {
      tops.set(this, v);
    },
  });
});
afterEach(() => {
  if (saved.client) Object.defineProperty(HTMLElement.prototype, 'clientHeight', saved.client);
  else delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
  if (saved.top) Object.defineProperty(Element.prototype, 'scrollTop', saved.top);
});

function mount(extra: Partial<Parameters<typeof CodeEditor>[0]> = {}, value = TEXT) {
  render(<CodeEditor path="src/big.ts" value={value} onChange={vi.fn()} dirty={false} {...extra} />);
  const root = screen.getByTestId('files-code-editor');
  return {
    root,
    scroller: root.querySelector<HTMLElement>('.files-ed-scroll')!,
    field: screen.getByTestId(FILES.editor) as HTMLTextAreaElement,
  };
}
const numbers = (root: HTMLElement) => [...root.querySelectorAll('.files-ed-gutter > span')].map((s) => Number(s.textContent));
const listed = (root: HTMLElement) => root.querySelectorAll('.files-ed-hl > span').length;

describe('editorWindow', () => {
  it('is the lines in view plus the overscan, clamped to the file', () => {
    expect(editorWindow(3000, 0, 400, LH, 8)).toEqual([0, Math.ceil((400 - 8) / LH) + EDITOR_OVERSCAN]);
    const [a, b] = editorWindow(3000, 18_000, 400, LH, 8);
    expect(a).toBe(Math.floor((18_000 - 8) / LH) - EDITOR_OVERSCAN);
    expect(b).toBe(Math.ceil((18_000 + 400 - 8) / LH) + EDITOR_OVERSCAN);
    expect(editorWindow(3000, 10_000_000, 400, LH, 8)[1]).toBe(3000);
    expect(editorWindow(10, 0, 400, LH, 8)).toEqual([0, 10]);
  });
});

describe('a long file draws only the lines in view', () => {
  it('LINES OUTSIDE THE WINDOW ARE NOT IN THE DOM, and the box keeps the whole height as padding', () => {
    const { root, field } = mount();
    const nums = numbers(root);
    expect(nums.length).toBeLessThan(EDITOR_OVERSCAN * 2 + 40);
    expect(nums[0]).toBe(1);
    expect(nums).not.toContain(N);
    expect(listed(root)).toBe(nums.length);
    const gutter = root.querySelector<HTMLElement>('.files-ed-gutter')!;
    expect(gutter.getAttribute('data-windowed')).toBe('true');
    expect(gutter.style.paddingBottom).toContain(`${N - nums.length} * var(--files-ed-lh)`);
    expect(root.querySelector<HTMLElement>('.files-ed-hl')!.style.paddingBottom).toContain(`${N - nums.length} * var(--files-ed-lh)`);
    /* the field is one element and holds the whole file: select, copy and Find work on it */
    expect(field.value).toBe(TEXT);
    expect(field.rows).toBe(N);
  });

  it('a scroll moves the window: the lines now in view are drawn with their numbers, the ones left behind are not', () => {
    const { root, scroller } = mount();
    act(() => {
      tops.set(scroller, 1500 * LH);
      fireEvent.scroll(scroller);
    });
    const nums = numbers(root);
    expect(nums).toContain(1501);
    expect(nums).not.toContain(1);
    expect(nums).not.toContain(N);
    /* a highlighted line is the line with that number */
    const texts = [...root.querySelectorAll('.files-ed-hl > span')].map((s) => s.textContent ?? '');
    expect(texts.some((t) => t.includes('line1501 '))).toBe(true);
    expect(root.querySelector<HTMLElement>('.files-ed-gutter')!.style.paddingTop).toContain(`${nums[0]! - 1} * var(--files-ed-lh)`);
  });

  it('A FOLLOWED file:LINE reveal scrolls to a line that is not drawn, and draws it', () => {
    const { root, scroller } = mount({ revealLine: 2500, revealKey: 1 });
    expect(scroller.scrollTop).toBeGreaterThan(2000 * LH);
    expect(numbers(root)).toContain(2500);
    expect(numbers(root)).not.toContain(1);
  });

  it('Find carries the view to a match that is not drawn', () => {
    const { root, scroller, field } = mount();
    fireEvent.keyDown(field, { key: 'f', ctrlKey: true });
    fireEvent.change(screen.getByTestId('files-find-input'), { target: { value: 'line2900 ' } });
    fireEvent.keyDown(screen.getByTestId('files-find-input'), { key: 'Enter' });
    expect(screen.getByTestId('files-find-count').textContent).toBe('1 of 1');
    expect(scroller.scrollTop).toBeGreaterThan(2500 * LH);
    expect(numbers(root)).toContain(2900);
    expect(numbers(root)).not.toContain(1);
  });

  it('the current line stays lit when it is drawn', () => {
    const { root, scroller, field } = mount();
    act(() => {
      tops.set(scroller, 1000 * LH);
      fireEvent.scroll(scroller);
    });
    const at = TEXT.split('\n').slice(0, 1000).join('\n').length + 1;
    field.setSelectionRange(at, at);
    fireEvent.click(field);
    expect(root.querySelector('.files-ed-gutter .is-cur')?.textContent).toBe('1001');
  });
});

describe('what is drawn whole', () => {
  it('a short file, and a file with no layout (jsdom, a hidden pane), draw every line', () => {
    const short = Array.from({ length: EDITOR_WINDOW_MIN - 1 }, (_, i) => `l${i}`).join('\n');
    const first = mount({}, short);
    expect(numbers(first.root)).toHaveLength(EDITOR_WINDOW_MIN - 1);
    expect(first.root.querySelector('.files-ed-gutter')!.getAttribute('data-windowed')).toBeNull();
  });

  it('no layout: every line', () => {
    viewHeight = 0;
    const { root } = mount();
    expect(numbers(root)).toHaveLength(N);
    expect(listed(root)).toBe(N);
  });
});

describe('the field is shaped for speed', () => {
  it('its transparent text is laid out without kerning or ligatures (laying out 405 KB was ~80 ms of the open)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(__dirname, 'files.css'), 'utf8');
    const block = css.slice(css.indexOf('.files-scope .files-editor.files-ed-ta {'));
    expect(block.slice(0, block.indexOf('}'))).toMatch(/text-rendering:\s*optimizeSpeed/);
  });
});
