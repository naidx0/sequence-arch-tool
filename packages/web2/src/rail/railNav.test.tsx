import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SkillsView } from '../settings/settingsClient';
import { createSessionsClient } from '../sessions/sessionsClient';
import { SessionPanel } from '../shell2/SessionPanel';
import { summarizeGraph } from '../boot';
import { seqdFromGraph } from '../canvas';
import type { GetArchGraphResponse } from '@sequence/api-types';
import { createStore } from '../state/store';
import { StoreProvider } from '../state/connect';
import { RAIL_SECTIONS } from './railSections';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const SKILLS: SkillsView = {
  dir: '.sequence/skills',
  skills: [{ slug: 'review', name: 'Code review', description: 'Review the diff' }],
  warnings: [],
  trusted: true,
  instructions: null,
};

function mount() {
  const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail) });
  const graph = { repoName: 'shopfront', scannedAt: '2026-10-06T01:00:00.000Z', nodes: [], edges: [], nodeDetail: {} } as unknown as GetArchGraphResponse;
  store.dispatch({ type: 'repo/loaded', draft: { root: 'C:/work/shopfront', repoName: 'shopfront', graph, summary: summarizeGraph(graph), scannedAt: '2026-10-06T01:00:00.000Z' }, at: 1 });
  const client = createSessionsClient((async () => new Response('{}', { status: 404 })) as typeof fetch);
  render(
    <StoreProvider store={store}>
      <SessionPanel client={client} skillsSource={async () => SKILLS} railFetch={(async () => new Response('{}', { status: 404 })) as typeof fetch} />
    </StoreProvider>,
  );
  return { store };
}

describe('the sidebar navigation rows (Devin-style format)', () => {
  it('Workflows, Components, Agent profiles and Skills are rows with accessible names, under New chat and above the chat groups', () => {
    mount();
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(within(nav).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Workflows', 'Components', 'Agent profiles', 'Skills']);
    expect(RAIL_SECTIONS.map((s) => s.label)).toEqual(['Workflows', 'Components', 'Agent profiles', 'Skills']);
    const newChat = screen.getByTestId('s2-new-chat');
    const groups = screen.getByTestId('s2-groups');
    expect(newChat.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.compareDocumentPosition(groups) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    /* contract change: no "Chats" heading sits above the Workspaces header (it read as a double header). */
    expect(screen.queryByTestId('rail-chats-head')).toBeNull();
    expect(within(groups).getByText('Workspaces')).toBeTruthy();
    /* every row carries a 16 px glyph from the shell's own set */
    for (const b of within(nav).getAllByRole('button')) expect(b.querySelector('svg.s2-i')).toBeTruthy();
    /* no middle dot in any row */
    expect(nav.textContent).not.toContain('·');
  });

  it('arrow keys, Home and End move focus between the rows', () => {
    mount();
    const rows = within(screen.getByRole('navigation', { name: 'Sections' })).getAllByRole('button');
    rows[0]!.focus();
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1]!, { key: 'End' });
    expect(document.activeElement).toBe(rows[3]);
    fireEvent.keyDown(rows[3]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[3]);
    fireEvent.keyDown(rows[3]!, { key: 'Home' });
    expect(document.activeElement).toBe(rows[0]);
  });

  it('the Skills row opens the skills (moved under its row); the chats come back with the back button', async () => {
    mount();
    expect(screen.queryByTestId('s2-group-skills')).toBeNull();
    const row = screen.getByRole('button', { name: 'Skills' });
    expect(row.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(row.className).toContain('is-on');
    await waitFor(() => expect(screen.getAllByTestId('s2-skill')).toHaveLength(1));
    expect(screen.getByTestId('s2-groups').hasAttribute('inert')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back to chats' }));
    expect(screen.queryByTestId('s2-skill')).toBeNull();
    expect(screen.getByTestId('s2-groups').hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(row);
  });

  it('a drilled-in section has a labelled back row naming the way back, above the section title', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    const view = await screen.findByTestId('rail-section');
    const back = within(view).getByTestId('rail-back');
    expect(back.textContent).toBe('Back to chats');
    expect(back.getAttribute('aria-label')).toBe('Back to chats');
    expect(back.querySelector('svg.s2-i')).toBeTruthy();
    expect(within(view).getByRole('heading', { name: 'Skills' })).toBeTruthy();
    expect(back.compareDocumentPosition(within(view).getByRole('heading', { name: 'Skills' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(view.textContent).not.toContain('·');
  });

  it('Escape closes an open section', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    const view = await screen.findByTestId('rail-section');
    fireEvent.keyDown(view, { key: 'Escape' });
    expect(screen.queryByTestId('rail-section')).toBeNull();
  });
});

void vi;
