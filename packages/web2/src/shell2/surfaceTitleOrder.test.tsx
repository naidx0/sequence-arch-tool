import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seqdFromGraph } from '../canvas';
import { CHROME_TAB_DEFS, LIVE_PILLS } from '../app/chromeTabModel';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore, type Store } from '../state';
import { V3App } from '../v3/V3App';
import { sortByTitle } from './surfaceOrder';

/** 0.1.8.1 C1: a plain click switches the stage; these cases open surfaces BESIDE each other, which is Ctrl/Cmd+click. */
const BESIDE = { ctrlKey: true } as const;

/*
 * 0.1.8 C3 (owner: "surfaces should open according to their titles ... it shouldn't sort on the recency of windows
 * opened, it should sort based off of the surface names"). The expected order is computed from the labels the code
 * shows, so a renamed surface (Whiteboard to Spaces) keeps the test true.
 */
function freshStore(): Store {
  return createStore({
    project: (graph) => seqdFromGraph(graph, graph.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

const label = (id: (typeof LIVE_PILLS)[number]) => CHROME_TAB_DEFS[id].label;
const stripLabels = () =>
  Array.from(screen.getByTestId('s2-surfaces').querySelectorAll<HTMLElement>('.s2-sp[data-pill] .s2-seg-l')).map((n) => n.textContent);

describe('surfaces sort by their titles (C3)', () => {
  it('the strip reads alphabetically however the surfaces were opened', () => {
    render(<V3App appStore={freshStore()} />);
    /* Open in a deliberately non-alphabetical order: last opened must not move to the front or the end. */
    const opened = ['terminal', 'agents', 'files', 'whiteboard', 'architecture'].filter((id) => (LIVE_PILLS as readonly string[]).includes(id));
    for (const id of opened) fireEvent.click(screen.getByTestId(`s2-tab-${id}`), BESIDE);
    const expected = [...LIVE_PILLS].map(label).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    expect(stripLabels()).toEqual(expected);
  });

  it('a saved drag order still wins over the title order', () => {
    localStorage.setItem('sequence.surfaceOrder', JSON.stringify(['terminal', 'agents']));
    render(<V3App appStore={freshStore()} />);
    expect(stripLabels().slice(0, 2)).toEqual([label('terminal' as never), label('agents' as never)]);
  });

  it('sortByTitle reads the label it is given', () => {
    expect(sortByTitle(['b', 'a', 'c'], (id) => ({ a: 'Zed', b: 'Alpha', c: 'Mid' })[id]!)).toEqual(['b', 'c', 'a']);
  });
});

const paneLabels = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.s2-pane[data-surface-pane]')).map((n) => label(n.dataset.surfacePane as never));
const byTitle = (xs: string[]) => [...xs].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
const perms = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r])));

describe('the open panes follow the title order too (C3)', () => {
  const trio = ['files', 'terminal', 'agents'] as const;
  it.each(perms([...trio]))('opened as %s, the panes read in title order', (...order) => {
    cleanup();
    localStorage.clear();
    render(<V3App appStore={freshStore()} />);
    for (const id of order) fireEvent.click(screen.getByTestId(`s2-tab-${id}`), BESIDE);
    expect(paneLabels()).toEqual(byTitle(trio.map(label)));
  });

  it('close then reopen puts the surface back in its title place, not at the end', () => {
    render(<V3App appStore={freshStore()} />);
    for (const id of ['terminal', 'agents', 'files']) fireEvent.click(screen.getByTestId(`s2-tab-${id}`), BESIDE);
    fireEvent.click(screen.getByTestId('v3-tab-close-agents'));
    expect(paneLabels()).toEqual(byTitle([label('files'), label('terminal')]));
    fireEvent.click(screen.getByTestId('s2-tab-agents'), BESIDE);
    expect(paneLabels()).toEqual(byTitle(trio.map(label)));
  });

  it('a saved drag order sets the panes too', () => {
    localStorage.setItem('sequence.surfaceOrder', JSON.stringify(['terminal', 'files']));
    render(<V3App appStore={freshStore()} />);
    for (const id of ['agents', 'files', 'terminal']) fireEvent.click(screen.getByTestId(`s2-tab-${id}`), BESIDE);
    expect(paneLabels()).toEqual([label('terminal'), label('files'), label('agents')]);
  });
});
