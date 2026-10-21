import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GetArchGraphResponse } from '@sequence/api-types';
import { summarizeGraph } from '../boot';
import { seqdFromGraph } from '../canvas';
import { resetProfiles } from '../chat/agentProfiles';
import { SessionRail } from '../shell2/SessionRail';
import { StoreProvider } from '../state/connect';
import { createStore } from '../state/store';
import { RAIL_SECTIONS } from './railSections';

beforeEach(() => resetProfiles());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url === '/api/components') return json({ enabled: true, mode: 'approve', groups: [{ id: 'ml', name: 'Machine learning and research', blurb: '', components: [{ id: 'rea', name: 'rea', blurb: 'b' }] }] });
  if (url.startsWith('/api/components/')) return json({ id: 'rea', name: 'rea', blurb: 'b', source: 'bundled', license: null, body: 'text' });
  if (url === '/api/acp/profiles') return json({ profiles: [{ name: 'review', description: '', prompt: 'p', readOnly: false }] });
  return new Response('{}', { status: 404 });
}) as unknown as typeof fetch;

function mount() {
  const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail) });
  const graph = { repoName: 'shopfront', scannedAt: '2026-10-06T01:00:00.000Z', nodes: [], edges: [], nodeDetail: {} } as unknown as GetArchGraphResponse;
  store.dispatch({ type: 'repo/loaded', draft: { root: 'C:/work/shopfront', repoName: 'shopfront', graph, summary: summarizeGraph(graph), scannedAt: '2026-10-06T01:00:00.000Z' }, at: 1 });
  render(
    <StoreProvider store={store}>
      <SessionRail onExpand={() => undefined} railFetch={fetchImpl} skillsSource={async () => ({ dir: '.sequence/skills', skills: [{ slug: 'review', name: 'Code review', description: '' }], warnings: [], trusted: true, instructions: null })} />
    </StoreProvider>,
  );
  return { store };
}

describe('the collapsed rail shows the same rows', () => {
  it('has one icon button per section, with the section name as its label and tooltip, in the panel\'s order and glyphs', () => {
    mount();
    const rail = screen.getByTestId('s2-iconrail');
    const btns = RAIL_SECTIONS.map((s) => within(rail).getByRole('button', { name: s.label }));
    expect(btns.map((b) => b.getAttribute('title'))).toEqual(RAIL_SECTIONS.map((s) => s.label));
    expect(btns.map((b) => b.querySelector('svg')?.getAttribute('data-icon'))).toEqual(RAIL_SECTIONS.map((s) => s.icon));
    /* they sit between New chat and Settings */
    const all = within(rail).getAllByRole('button');
    const at = (n: string) => all.findIndex((b) => b.getAttribute('aria-label') === n);
    expect(at('New chat')).toBeLessThan(at('Workflows'));
    expect(at('Skills')).toBeLessThan(at('Settings'));
  });

  it('a button opens the same section view the panel shows; Escape closes it and returns focus', async () => {
    mount();
    const btn = screen.getByRole('button', { name: 'Components' });
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const view = await screen.findByTestId('rail-section');
    expect(view.getAttribute('data-rail-section')).toBe('components');
    await within(view).findByTestId('rail-component');
    fireEvent.keyDown(view, { key: 'Escape' });
    expect(screen.queryByTestId('rail-section')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it('Use from the flyout adds the chip and closes it; profiles and skills open the same lists', async () => {
    /* contract change: the rail draws the shared ComponentDetail, whose button reads Use and which fetches through the page. */
    vi.stubGlobal('fetch', fetchImpl);
    const { store } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Components' }));
    fireEvent.click(await screen.findByTestId('rail-component'));
    fireEvent.click(await screen.findByRole('button', { name: 'Use' }));
    expect(store.getState().composer.chips.map((c) => c.ref)).toEqual(['rea']);
    expect(screen.queryByTestId('rail-section')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Agent profiles' }));
    await screen.findByTestId('rail-profile');
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    await waitFor(() => expect(screen.getAllByTestId('s2-skill')).toHaveLength(1));
    /* one flyout at a time */
    expect(screen.getAllByTestId('rail-section')).toHaveLength(1);
  });
});
