import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './files.css';

import { FILES } from './anchors';
import { FilesPanel } from './FilesPanel';
import type { FilesPanelProps } from './FilesPanel';

/* ══════════════════════════════════════════════════════════════════════════
   THE TREE IS A DRAWER IN A NARROW PANE (round 9, ask 24)
   In a 1024 window with two other surfaces the Files pane is about 285 px and
   the preview was 163. jsdom has no layout, so the pane's width is a
   ResizeObserver stub; what is asserted is the behaviour that gives the file
   the whole pane (the real measure is e2e/files-boards.mjs).
   ══════════════════════════════════════════════════════════════════════════ */

let width = 285;
let observers: Array<() => void> = [];

beforeEach(() => {
  observers = [];
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const w = this.classList.contains('files-container') ? width : 0;
    return { left: 0, top: 0, right: w, bottom: 0, width: w, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  class RO {
    cb: () => void;
    constructor(cb: () => void) {
      this.cb = cb;
      observers.push(cb);
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
});

const PATHS = ['README.md', 'src/a.ts', 'src/b.ts'];

function Host({ selectedInit = null as string | null }) {
  const props: FilesPanelProps = {
    paths: PATHS,
    selected: selectedInit,
    expanded: new Set<string>(['src']),
    query: '',
    view: 'code',
    content: { state: 'ready', text: 'x' },
    diff: { state: 'idle' },
    onSelect: () => {},
    onToggle: () => {},
    onQuery: () => {},
    onView: () => {},
  };
  return <FilesPanel {...props} />;
}

const scope = () => screen.getByTestId(FILES.panel);

describe('narrow Files pane', () => {
  it('with a file open the tree is put away so the file has the pane', () => {
    render(<Host selectedInit="README.md" />);
    expect(scope().classList.contains('is-narrow')).toBe(true);
    expect(scope().classList.contains('has-file')).toBe(true);
    expect(scope().classList.contains('is-tree-shut')).toBe(true);
  });

  it('with no file open the tree stays: it is the pane', () => {
    render(<Host />);
    expect(scope().classList.contains('is-narrow')).toBe(true);
    expect(scope().classList.contains('is-tree-shut')).toBe(false);
  });

  it('the header toggle brings the tree back as a drawer, and choosing a file puts it away', () => {
    render(<Host selectedInit="README.md" />);
    fireEvent.click(screen.getByTestId(FILES.treeToggle));
    expect(scope().classList.contains('is-tree-shut')).toBe(false);
    fireEvent.click(screen.getAllByTestId(FILES.row).find((r) => r.getAttribute('data-path') === 'src/a.ts')!);
    expect(scope().classList.contains('is-tree-shut')).toBe(true);
  });

  it('pressing the file beside an open drawer puts the drawer away', () => {
    render(<Host selectedInit="README.md" />);
    fireEvent.click(screen.getByTestId(FILES.treeToggle));
    expect(scope().classList.contains('is-tree-shut')).toBe(false);
    fireEvent.pointerDown(screen.getByTestId(FILES.header));
    expect(scope().classList.contains('is-tree-shut')).toBe(true);
  });

  it('a wide pane is unchanged: tree beside the file, no drawer classes', () => {
    width = 900;
    render(<Host selectedInit="README.md" />);
    expect(scope().classList.contains('is-narrow')).toBe(false);
    expect(scope().classList.contains('is-tree-shut')).toBe(false);
    width = 285;
  });

  it('widening the pane brings back a tree that was put away for it', () => {
    render(<Host selectedInit="README.md" />);
    expect(scope().classList.contains('is-tree-shut')).toBe(true);
    width = 900;
    act(() => observers.forEach((cb) => cb()));
    expect(scope().classList.contains('is-tree-shut')).toBe(false);
    width = 285;
  });
});
