import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BoardControls } from '../BoardControls';
import { ViewMenu } from './ViewMenu';

afterEach(cleanup);

const VIEWS = ['map', 'grid', 'diff', 'hotspots'] as const;

/* Board 2: Map, Grid, Diff and Hotspots are ONE dropdown pill at every width. jsdom has no layout, so the default (wide)
   render is the proof that no width is special-cased in the markup. */
describe('the view pill', () => {
  it('shows the current view as icon, name and chevron in a single button', () => {
    render(<ViewMenu views={VIEWS} value="diff" onChange={() => undefined} />);
    const pill = screen.getByTestId('board-view-menu');
    expect(pill.tagName).toBe('BUTTON');
    expect(pill.querySelectorAll('svg')).toHaveLength(2);
    expect(screen.getByTestId('board-view-menu-name').textContent).toBe('Diff');
    expect(pill.getAttribute('aria-label')).toContain('Diff');
    expect(pill.getAttribute('title')).toContain('Diff');
  });

  it('follows the view on screen', () => {
    const { rerender } = render(<ViewMenu views={VIEWS} value="map" onChange={() => undefined} />);
    expect(screen.getByTestId('board-view-menu-name').textContent).toBe('Map');
    rerender(<ViewMenu views={VIEWS} value="hotspots" onChange={() => undefined} />);
    expect(screen.getByTestId('board-view-menu-name').textContent).toBe('Hotspots');
  });

  it('opens a list of every view and changes the view', () => {
    let picked = 'map';
    render(<ViewMenu views={VIEWS} value="map" onChange={(v) => (picked = v)} />);
    fireEvent.click(screen.getByTestId('board-view-menu'));
    for (const v of VIEWS) expect(screen.getByTestId(`board-view-menu-${v}`)).toBeTruthy();
    fireEvent.click(screen.getByTestId('board-view-menu-grid'));
    expect(picked).toBe('grid');
  });
});

describe('the view pill by keyboard', () => {
  const pill = () => screen.getByTestId('board-view-menu');
  const item = (v: string) => screen.getByTestId(`board-view-menu-${v}`);
  const list = () => screen.getByTestId('board-view-list');
  it('opening by click focuses the checked view', () => {
    render(<ViewMenu views={VIEWS} value="diff" onChange={() => undefined} />);
    fireEvent.click(pill());
    expect(document.activeElement).toBe(item('diff'));
  });
  it('ArrowDown and ArrowUp on the pill open the list and focus the checked view', () => {
    for (const key of ['ArrowDown', 'ArrowUp']) {
      render(<ViewMenu views={VIEWS} value="grid" onChange={() => undefined} />);
      pill().focus();
      fireEvent.keyDown(pill(), { key });
      expect(screen.getByTestId('board-view-list')).toBeTruthy();
      expect(document.activeElement).toBe(item('grid'));
      cleanup();
    }
  });
  it('Up and Down wrap, Home and End jump', () => {
    render(<ViewMenu views={VIEWS} value="map" onChange={() => undefined} />);
    fireEvent.keyDown(pill(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item('map'));
    fireEvent.keyDown(list(), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(item('hotspots'));
    fireEvent.keyDown(list(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item('map'));
    fireEvent.keyDown(list(), { key: 'End' });
    expect(document.activeElement).toBe(item('hotspots'));
    fireEvent.keyDown(list(), { key: 'Home' });
    expect(document.activeElement).toBe(item('map'));
  });
  it('a focused item picks on click (Enter and Space are a buttons click), and focus returns to the pill', () => {
    let picked = 'map';
    render(<ViewMenu views={VIEWS} value="map" onChange={(v) => (picked = v)} />);
    fireEvent.keyDown(pill(), { key: 'ArrowDown' });
    fireEvent.keyDown(list(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item('grid'));
    expect((document.activeElement as HTMLElement).tagName).toBe('BUTTON');
    fireEvent.click(document.activeElement as HTMLElement);
    expect(picked).toBe('grid');
    expect(document.activeElement).toBe(pill());
  });
  it('Escape closes and returns focus to the pill', () => {
    render(<ViewMenu views={VIEWS} value="map" onChange={() => undefined} />);
    fireEvent.keyDown(pill(), { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('board-view-list')).toBeNull();
    expect(document.activeElement).toBe(pill());
  });
});

describe('the board toolbar draws no row of view pills', () => {
  it('the top row is tags, the view pill, Find and More, and no board-view-<name> pill exists at the default width', () => {
    render(
      <BoardControls
        {...({} as never)}
        query=""
        onQuery={() => undefined}
        matches={null}
        onFitMatches={() => undefined}
        leading={<span data-testid="tags">tags</span>}
        viewMenu={<ViewMenu views={VIEWS} value="map" onChange={() => undefined} />}
      />,
    );
    const row = screen.getByTestId('board-controls');
    const order = [...row.children].map((c) => c.getAttribute('data-testid') ?? c.className);
    expect(order).toEqual(['tags', 'bview-menu-wrap', 'bfind', 'bc-morewrap']);
    for (const v of VIEWS) expect(screen.queryByTestId(`board-view-${v}`)).toBeNull();
    expect(screen.queryByTestId('board-view-switcher')).toBeNull();
  });

  it('ConnectedBoard no longer hands the toolbar a row of pills', () => {
    const src = readFileSync(`${__dirname}/../ConnectedBoard.tsx`, 'utf8');
    expect(src).not.toContain('PlainViewSwitcher');
    expect(src).not.toMatch(/viewSwitcher=/);
    expect(src).toMatch(/viewMenu=\{SWITCHER_VIEWS\.length > 1/);
  });
});
