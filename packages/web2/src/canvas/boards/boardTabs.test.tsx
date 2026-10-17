import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BoardTabs } from './BoardTabs';
import { ARCH_BOARD_ID, type BoardsIndex } from './boardsModel';

afterEach(cleanup);

const arch = { id: ARCH_BOARD_ID, name: 'Architecture', kind: 'architecture', rev: 1, createdAt: '', updatedAt: '' } as const;
const wb = { id: 'wb1', name: 'Sketch', kind: 'whiteboard', rev: 1, createdAt: '', updatedAt: '' } as const;
const noop = () => undefined;
const show = (boards: BoardsIndex['boards']) =>
  render(<BoardTabs index={{ version: 1, boards } as unknown as BoardsIndex} current={ARCH_BOARD_ID} onOpen={noop} onCreate={noop} onRename={noop} onDelete={noop} />);

describe('round 12 (D13): a lone board is not repeated on the stage at narrow widths', () => {
  const css = readFileSync(`${__dirname}/boards.css`, 'utf8');
  const board = readFileSync(`${__dirname}/../board.css`, 'utf8');
  it('marks the strip solo when there is one board, and not when there are several', () => {
    show([arch]);
    expect(screen.getByTestId('board-tabs').getAttribute('data-solo')).toBe('true');
    cleanup();
    show([arch, wb]);
    expect(screen.getByTestId('board-tabs').getAttribute('data-solo')).toBeNull();
  });
  it('a lone board folds to its icon on the boards own width, never the windows, and "+" stays', () => {
    /* Board 2: the window media query that hid the chip under 1200px is gone: three surfaces open at 1440 leave a small pane too. */
    expect(css).not.toMatch(/@media \(max-width: 1199px\)/);
    expect(board).toMatch(/@container boardstack \(max-width: 420px\) \{[^}]*\.board-tabs \.btag \.btag-t,/);
    show([arch]);
    expect(screen.getByTestId('board-tab-new')).toBeTruthy();
    /* The folded tag keeps its name as accessible name and tooltip. */
    expect(screen.getByTestId(`board-tab-${ARCH_BOARD_ID}`).getAttribute('aria-label')).toBe('Architecture');
    expect(screen.getByTestId(`board-tab-${ARCH_BOARD_ID}`).getAttribute('title')).toContain('Architecture');
  });
  it('marks three or more boards data-many so they fold sooner', () => {
    show([arch, wb]);
    expect(screen.getByTestId('board-tabs').getAttribute('data-many')).toBeNull();
    cleanup();
    show([arch, wb, { ...wb, id: 'wb2', name: 'Second' }]);
    expect(screen.getByTestId('board-tabs').getAttribute('data-many')).toBe('true');
  });
  it('the steps, as the pane narrows: other tags to icons, the open tag, the view word, then the fold pill', () => {
    /* The threshold is read from the query that holds each step's rule, so reordering the sheet fails here. */
    const widthOf = (rule: string) => {
      const heads = [...board.matchAll(/@container boardstack \(max-width: (\d+)px\) \{/g)];
      const found = heads
        .map((m) => ({ px: Number(m[1]), body: board.slice(m.index!, board.indexOf('\n}', m.index!)) }))
        .filter((h) => h.body.includes(rule) && !h.body.includes("[data-many='true']"));
      expect(found.length, rule).toBe(1);
      return found[0]!.px;
    };
    const other = widthOf(".btag[data-on='false'] .btag-t");
    const open = widthOf('.btag .btag-t,');
    const word = widthOf('.bview-menu .bview-menu-t { display: none; }');
    const fold = widthOf('.btag-fold { display: inline-flex; }');
    expect([other, open, word, fold]).toEqual([640, 420, 360, 320]);
    expect(other).toBeGreaterThan(open);
    expect(open).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(fold);
  });
});

describe('1024 and narrower: several boards fold into one pill and a list, never clipped under a neighbour', () => {
  const css = readFileSync(`${__dirname}/boards.css`, 'utf8');
  it('the fold names the open board and lists every board plus New whiteboard', () => {
    const onOpen = vi.fn();
    const onCreate = vi.fn();
    render(<BoardTabs index={{ version: 1, boards: [arch, wb] } as unknown as BoardsIndex} current={ARCH_BOARD_ID} onOpen={onOpen} onCreate={onCreate} onRename={noop} onDelete={noop} />);
    const fold = screen.getByTestId('board-tab-fold');
    expect(fold.getAttribute('aria-label')).toContain('Architecture');
    /* The pill is the open board's icon and a chevron: no word. */
    expect(fold.textContent).toBe('');
    expect(fold.querySelectorAll('svg').length).toBe(2);
    expect(screen.queryByTestId('board-tab-fold-list')).toBeNull();
    fireEvent.click(fold);
    expect(screen.getByTestId(`board-tab-fold-${ARCH_BOARD_ID}`).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('board-tab-fold-wb1'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'wb1' }));
    expect(screen.queryByTestId('board-tab-fold-list')).toBeNull();
    fireEvent.click(fold);
    fireEvent.click(screen.getByTestId('board-tab-fold-new'));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
  it('Escape closes the list', () => {
    show([arch, wb]);
    fireEvent.click(screen.getByTestId('board-tab-fold'));
    expect(screen.getByTestId('board-tab-fold-list')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('board-tab-fold-list')).toBeNull();
  });
  it('the stylesheet shows the fold, and hides the tags, only inside the toolbar of a narrow board with several boards', () => {
    const board = readFileSync(`${__dirname}/../board.css`, 'utf8');
    expect(css).toMatch(/\.board-tabs \.btag-fold \{[^}]*display: none;/);
    expect(board).toMatch(/@container boardstack \(max-width: 320px\) \{[\s\S]*\.board-controls \.board-tabs:not\(\[data-solo='true'\]\) \.btag-fold \{ display: inline-flex; \}/);
    expect(board).toMatch(/\.board-controls \.board-tabs:not\(\[data-solo='true'\]\) \.btag,\s*\.board-scope \.board-controls \.board-tabs:not\(\[data-solo='true'\]\) \.btag-add \{ display: none; \}/);
  });
});

describe('the fold list is a keyboard menu with valid ARIA and a bounded height', () => {
  const css = readFileSync(`${__dirname}/boards.css`, 'utf8');
  const open = () => {
    render(<BoardTabs index={{ version: 1, boards: [arch, wb, { ...wb, id: 'wb2', name: 'Second' }] } as unknown as BoardsIndex} current={ARCH_BOARD_ID} onOpen={noop} onCreate={noop} onRename={noop} onDelete={noop} />);
    fireEvent.click(screen.getByTestId('board-tab-fold'));
  };
  it('opening focuses the open board; arrows, Home and End move; delete is a labelled menuitem', () => {
    open();
    expect(document.activeElement).toBe(screen.getByTestId(`board-tab-fold-${ARCH_BOARD_ID}`));
    const list = screen.getByTestId('board-tab-fold-list');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('board-tab-fold-wb1'));
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('board-tab-fold-delete-wb1'));
    fireEvent.keyDown(list, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByTestId('board-tab-fold-new'));
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId(`board-tab-fold-${ARCH_BOARD_ID}`));
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByTestId('board-tab-fold-new'));
    fireEvent.keyDown(list, { key: 'Home' });
    expect(document.activeElement).toBe(screen.getByTestId(`board-tab-fold-${ARCH_BOARD_ID}`));
    const del = screen.getByTestId('board-tab-fold-delete-wb1');
    expect(del.getAttribute('role')).toBe('menuitem');
    expect(del.getAttribute('aria-label')).toBe('Delete Sketch');
    for (const row of list.querySelectorAll('.btag-fold-row')) expect(row.getAttribute('role')).toBe('none');
  });
  it('the lists scroll inside a bounded height (fold list and view list)', () => {
    expect(css).toMatch(/\.board-tabs \.btag-fold-list \{[^}]*max-height: min\([^}]*overflow-y: auto/);
    const board = readFileSync(`${__dirname}/../board.css`, 'utf8');
    expect(board).toMatch(/\.board-scope \.bview-list \{[^}]*max-height: min\([^}]*overflow-y: auto/);
  });
  it('the pill grows to the room there is (no fixed cap on its width)', () => {
    expect(css).toMatch(/\.btag-fold-btn \{ max-width: 100%;/);
    expect(css).not.toMatch(/\.btag-fold-btn \{ max-width: calc/);
  });
});

describe('0.1.5 review: a strip whose tags would not fit folds to the one pill (measureFold)', () => {
  /* jsdom has no layout: the strip's extents are given, as the 240 px whiteboard pane measured them (146 of 196).
     The real measure is e2e/board-tags-narrow.mjs. */
  const extents = (scroll: number, client: number) => {
    const s = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('data-testid') === 'board-tabs' ? scroll : 0;
    });
    const c = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('data-testid') === 'board-tabs' ? client : 0;
    });
    return () => {
      s.mockRestore();
      c.mockRestore();
    };
  };
  const strip = (measureFold: boolean) =>
    render(<BoardTabs measureFold={measureFold} index={{ version: 1, boards: [arch, wb] } as unknown as BoardsIndex} current="wb1" onOpen={noop} onCreate={noop} onRename={noop} onDelete={noop} />);

  it('folds when the tags need more than the strip has, and not when they fit', () => {
    let undo = extents(196, 146);
    strip(true);
    expect(screen.getByTestId('board-tabs').getAttribute('data-fold')).toBe('true');
    cleanup();
    undo();
    undo = extents(140, 146);
    strip(true);
    expect(screen.getByTestId('board-tabs').getAttribute('data-fold')).toBeNull();
    undo();
  });

  it('a strip that does not ask to be measured (the architecture toolbar) never folds this way', () => {
    const undo = extents(196, 146);
    strip(false);
    expect(screen.getByTestId('board-tabs').getAttribute('data-fold')).toBeNull();
    undo();
  });

  it('the whiteboard stylesheet folds a data-fold strip, and any strip in a pane of 320 px or less', () => {
    const css = readFileSync(`${__dirname}/boards.css`, 'utf8');
    expect(css).toMatch(/\.wb-boards-free > \.board-tabs\[data-fold='true'\] \.btag-fold \{ display: inline-flex; \}/);
    expect(css).toMatch(/@container s2pane \(max-width: 320px\) \{[^}]*\.wb-boards-free > \.board-tabs:not\(\[data-solo='true'\]\) \{ overflow: visible; \}/);
  });
});
