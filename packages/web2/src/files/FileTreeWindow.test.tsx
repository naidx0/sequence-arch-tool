import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './files.css';

import { FILES } from './anchors';
import { FileTree, WINDOW_MIN } from './FileTree';
import { buildFileTree } from './filesModel';

/* ══════════════════════════════════════════════════════════════════════════
   THE TREE IS WINDOWED (perf, 019)
   packages/web2/src/files/FileTreeWindow.test.tsx

   A grouped tree of 1,225 rows was 14k DOM nodes: a 5 s open and a 28 fps scroll. The tree now mounts
   only the rows in (and just around) view, with two spacers standing for the rest. jsdom has no layout,
   so the scroller's box is given here the way a browser would give it: a viewport height, a settable
   scrollTop, and rows 30 px high.

   What is locked: rows outside the window are not in the DOM; a scroll moves the window; a reveal and
   the keyboard bring an off-screen row into view (it is scrolled TO, not just scrolled-into-view, since
   it is not there to be asked); a short list, and a tree with no layout at all, are drawn whole.
   ══════════════════════════════════════════════════════════════════════════ */

const ROW = 30;
const VIEW = 300;
const COUNT = 400;
const PATHS = Array.from({ length: COUNT }, (_, i) => `src/file-${String(i).padStart(4, '0')}.ts`);
const TREE = buildFileTree(PATHS);

const tops = new WeakMap<Element, number>();
let viewHeight = VIEW;
const saved: { client?: PropertyDescriptor; top?: PropertyDescriptor; rect?: () => DOMRect } = {};

beforeEach(() => {
  viewHeight = VIEW;
  saved.client = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  saved.top = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  saved.rect = HTMLElement.prototype.getBoundingClientRect;
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('files-tree') ? viewHeight : 0;
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
  HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement) {
    const h = this.classList.contains('s2-rail-row') ? ROW : 0;
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: h, width: 0, height: h, toJSON: () => ({}) } as DOMRect;
  };
});
afterEach(() => {
  if (saved.client) Object.defineProperty(HTMLElement.prototype, 'clientHeight', saved.client);
  else delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
  if (saved.top) Object.defineProperty(Element.prototype, 'scrollTop', saved.top);
  if (saved.rect) HTMLElement.prototype.getBoundingClientRect = saved.rect;
});

function Harness({ revealed = null, start = null, files = TREE }: { revealed?: string | null; start?: string | null; files?: typeof TREE }) {
  const [selected, setSelected] = useState<string | null>(start);
  return (
    <div className="files-scope">
      <FileTree
        nodes={files}
        expanded="all"
        selected={selected}
        revealed={revealed}
        cap={10_000}
        onSelect={setSelected}
        onToggle={vi.fn()}
        onOpen={vi.fn()}
      />
    </div>
  );
}

const tree = () => screen.getByTestId(FILES.tree);
const rowEls = () => [...document.querySelectorAll<HTMLElement>('[data-testid="files-row"]')];
const rowPaths = () => rowEls().map((r) => r.getAttribute('data-path'));
const has = (i: number) => rowPaths().includes(PATHS[i]);

function scrollTo(top: number) {
  act(() => {
    tops.set(tree(), top);
    fireEvent.scroll(tree());
  });
}

describe('the tree mounts only the rows in view', () => {
  it('ROWS OUTSIDE THE WINDOW ARE NOT IN THE DOM; two spacers stand for them', () => {
    render(<Harness />);
    expect(tree().getAttribute('data-windowed')).toBe('true');
    /* the dir row + the files: well under 400 rows are mounted, the first are, the last are not */
    expect(rowEls().length).toBeLessThan(40);
    expect(rowEls().length).toBeGreaterThan(8);
    expect(has(0)).toBe(true);
    expect(has(COUNT - 1)).toBe(false);
    expect(document.getElementById(`files-row-${PATHS[COUNT - 1]}`)).toBeNull();
    const bottom = screen.getByTestId('files-tree-pad-bottom');
    expect(bottom.getAttribute('aria-hidden')).toBe('true');
    /* the spacer is the rest: every entry (1 dir + 400 files) is one row high */
    const mounted = rowEls().length;
    expect(parseFloat(bottom.style.height)).toBe((1 + COUNT - mounted) * ROW);
  });

  it('a scroll moves the window: the rows now in view mount and the ones left behind leave', () => {
    render(<Harness />);
    expect(has(0)).toBe(true);
    scrollTo(200 * ROW);
    expect(has(0)).toBe(false);
    expect(has(199)).toBe(true);
    expect(has(205)).toBe(true);
    expect(has(COUNT - 1)).toBe(false);
    expect(screen.getByTestId('files-tree-pad-top')).toBeTruthy();
  });

  it('A LIST THAT FITS IS DRAWN WHOLE, and so is a tree with no layout at all', () => {
    const few = buildFileTree(PATHS.slice(0, WINDOW_MIN - 10));
    const { unmount } = render(<Harness files={few} />);
    expect(rowEls().length).toBe(WINDOW_MIN - 10 + 1); /* + the folder */
    expect(tree().getAttribute('data-windowed')).toBeNull();
    unmount();
    viewHeight = 0; /* jsdom, a hidden pane */
    render(<Harness />);
    expect(rowEls().length).toBe(COUNT + 1);
    expect(tree().getAttribute('data-windowed')).toBeNull();
  });
});

describe('an off-screen row is scrolled TO', () => {
  it('A REVEAL OF A ROW FAR BELOW THE FOLD scrolls the tree to it, centred, and the row mounts', () => {
    render(<Harness revealed={PATHS[300]} />);
    /* entry index = 1 (the dir) + 300; its top is index * ROW; centred: top - (view - row) / 2 */
    const want = (1 + 300) * ROW + 0 - (VIEW - ROW) / 2;
    expect(Math.abs(tree().scrollTop - want)).toBeLessThanOrEqual(ROW * 2);
    expect(has(300)).toBe(true);
    expect(has(0)).toBe(false);
  });

  it('THE KEYBOARD walks Down past the window: the selected row stays mounted and in view, and the first row leaves', () => {
    render(<Harness start={PATHS[0]} />);
    expect(has(0)).toBe(true);
    const t = tree();
    t.focus();
    for (let i = 0; i < 60; i += 1) fireEvent.keyDown(t, { key: 'ArrowDown' });
    expect(has(60)).toBe(true);
    expect(has(0)).toBe(false);
    expect(t.getAttribute('aria-activedescendant')).toBe(`files-row-${PATHS[60]}`);
    expect(document.getElementById(`files-row-${PATHS[60]}`)).not.toBeNull();
    /* in view: its top is inside [scrollTop, scrollTop + view) */
    const top = (1 + 60) * ROW;
    expect(top).toBeGreaterThanOrEqual(t.scrollTop - 1);
    expect(top + ROW).toBeLessThanOrEqual(t.scrollTop + VIEW + 1);
  });

  it('Up from the middle comes back; End goes to the last row, Home to the first', () => {
    render(<Harness start={PATHS[0]} />);
    const t = tree();
    fireEvent.keyDown(t, { key: 'End' });
    expect(has(COUNT - 1)).toBe(true);
    expect(has(0)).toBe(false);
    fireEvent.keyDown(t, { key: 'Home' });
    expect(has(0)).toBe(true);
    expect(has(COUNT - 1)).toBe(false);
  });
});

describe('a windowed row keeps the tree semantics', () => {
  it('mounted rows are treeitems with their level, and the tree names the selected one', () => {
    render(<Harness start={PATHS[2]} />);
    const r = document.getElementById(`files-row-${PATHS[2]}`)!;
    expect(r.getAttribute('role')).toBe('treeitem');
    expect(r.getAttribute('aria-level')).toBe('2');
    expect(r.getAttribute('aria-selected')).toBe('true');
    expect(tree().getAttribute('role')).toBe('tree');
    expect(tree().getAttribute('aria-activedescendant')).toBe(`files-row-${PATHS[2]}`);
  });
});
