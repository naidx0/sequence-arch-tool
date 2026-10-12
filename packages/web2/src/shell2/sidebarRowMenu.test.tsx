import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionIndexEntry } from '@sequence/api-types';

import { createSessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider } from '../state';
import { SessionPanel } from './SessionPanel';
import cssRaw from './shell2.css?raw';

const css = cssRaw.replace(/\r\n/g, '\n');
const rule = (selector: string): string => {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `rule ${selector}`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};

const at = (h: number) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const chat = (id: string, title: string, h: number): SessionIndexEntry => ({ id, title, createdAt: at(h), updatedAt: at(h) }) as SessionIndexEntry;

function mount() {
  const index = [chat('h1', 'Workspace notes', 5)];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/sessions') return new Response(JSON.stringify({ index: { version: 1, activeId: 'h1', sessions: index }, scope: 'workspace', repos: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  render(
    <StoreProvider store={createStore({})}>
      <SessionPanel client={createSessionsClient(fetchImpl)} onOpenProject={() => undefined} onOpenWorkspace={() => undefined} />
    </StoreProvider>,
  );
}

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

/** jsdom has no layout: the row sits where the test says, the menu is 150 x 64. */
function layout(row: DOMRect, viewport: { w: number; h: number }) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewport.w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewport.h });
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.classList.contains('s2-menu-row')) return rect(0, 0, 150, 64);
    if (this.classList.contains('s2-rail-row')) return row;
    return rect(0, 0, 0, 0);
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

const open = async () => {
  await screen.findByLabelText('Actions for Workspace notes');
  fireEvent.click(screen.getByLabelText('Actions for Workspace notes'));
  return (await screen.findByRole('menu')) as HTMLElement;
};

describe('the row menu is light and opens beside its row', () => {
  it('a hairline at the faint edge colour, small padding, 28 px rows, a near-opaque glass fill', () => {
    const r = rule('.s2-menu.s2-menu-row');
    expect(r).toContain('border: 1px solid var(--edge);');
    expect(r).toMatch(/padding: var\(--sp-4\);/);
    /* No backdrop blur: the style ratchet allows 7 and the fill is near-opaque. */
    expect(r).not.toContain('backdrop-filter');
    /* Near-opaque glass: a colour-mix toward transparent, not the opaque surface. */
    expect(r).toMatch(/background: color-mix\(in srgb, var\(--b-s2\) \d+%, transparent\);/);
    expect(r).not.toContain('background: var(--b-s2);');
    expect(rule('.s2-menu-row .s2-mi')).toContain('min-height: var(--control-h);');
    expect(rule('.s2-menu-row .s2-mi-d')).toContain('white-space: nowrap;'); /* a label never wraps into a second line */
  });

  it('keeps text labels, and Delete stays in the danger colour', async () => {
    mount();
    const menu = await open();
    expect(menu.textContent).toContain('Pin');
    expect(menu.textContent).toContain('Delete');
    expect(rule('.s2-menu-row .s2-mi.s2-mi-danger')).toContain('color: var(--b-del);');
  });

  it('opens to the right of the row, its top on the row top', async () => {
    layout(rect(4, 200, 252, 30), { w: 1440, h: 900 });
    mount();
    const menu = await open();
    await waitFor(() => expect(menu.style.left).toBe('260px'));
    expect(menu.style.top).toBe('200px');
  });

  it('flips to the left of the row when there is no room on the right', async () => {
    layout(rect(1200, 200, 232, 30), { w: 1440, h: 900 });
    mount();
    const menu = await open();
    /* 1200 (row left) - 4 gap - 150 menu */
    await waitFor(() => expect(menu.style.left).toBe('1046px'));
  });

  it('flips up (its bottom on the row bottom) when there is no room below', async () => {
    layout(rect(4, 860, 252, 30), { w: 1440, h: 900 });
    mount();
    const menu = await open();
    /* row bottom 890 - menu 64 */
    await waitFor(() => expect(menu.style.top).toBe('826px'));
    expect(menu.style.left).toBe('260px');
  });
});
