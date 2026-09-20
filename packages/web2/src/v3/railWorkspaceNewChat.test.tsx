import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/* ══════════════════════════════════════════════════════════════════════════
   A "+" ON EVERY WORKSPACE SECTION — start a chat where you are looking
   packages/web2/src/v3/railWorkspaceNewChat.test.tsx

   Owner walk 2026-09-17: "there should be a start-chat button near each folder
   workspace so you can start a chat in that workspace."

   The rail has always rendered one section per catalogued repo and could
   already soft-open a thread in one without attaching it. It just had no way
   to MAKE one: the head's New Chat has only ever meant the active root, so a
   reader looking at ml-harness had to attach it first.

   The two things this locks: the POST names the section's root (and the
   Workspace "+" names none, which the server reads as the active root), and
   the reader LANDS in the new thread softly — `browseRepoPath` set, no attach,
   no reload.
   ══════════════════════════════════════════════════════════════════════════ */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createSessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider, type Store } from '../state';
import { V3SessionsRail } from './V3SessionsRail';

const REPO = '/home/max/ml-harness';
const HOME_THREAD = 'session-home';
const REPO_THREAD = 'session-repo';
const MINTED = 'session-minted';

function sessionsIndex(activeId: string, ids: string[]) {
  return {
    version: 1,
    activeId,
    sessions: ids.map((id) => ({
      id,
      title: id,
      createdAt: '2026-09-17T09:00:00.000Z',
      updatedAt: '2026-09-17T09:00:00.000Z',
    })),
  };
}

interface Wire {
  posts: { body: Record<string, unknown> }[];
  reads: string[];
}

function wiredClient(wire: Wire) {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url === '/api/sessions' && method === 'GET') {
      return new Response(
        JSON.stringify({
          index: sessionsIndex(HOME_THREAD, [HOME_THREAD]),
          scope: 'workspace',
          repos: [{ path: REPO, name: 'ml-harness', index: sessionsIndex(REPO_THREAD, [REPO_THREAD]) }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url === '/api/sessions' && method === 'POST') {
      wire.posts.push({ body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      return new Response(
        JSON.stringify({
          index: sessionsIndex(MINTED, [REPO_THREAD, MINTED]),
          session: { id: MINTED, chat: { version: 1, sessionId: MINTED, turns: [] }, meta: {} },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.startsWith('/api/sessions/') && method === 'GET') {
      wire.reads.push(url);
      return new Response(
        JSON.stringify({ chat: { version: 1, sessionId: MINTED, turns: [] }, meta: {} }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return createSessionsClient(fetchImpl);
}

function mount(wire: Wire): Store {
  const store = createStore({});
  render(
    <StoreProvider store={store}>
      <V3SessionsRail client={wiredClient(wire)} />
    </StoreProvider>,
  );
  return store;
}

describe('the rail can start a chat in any workspace section', () => {
  it('offers a "+" on the Workspace header and on every repo section', async () => {
    const wire: Wire = { posts: [], reads: [] };
    mount(wire);
    await waitFor(() => expect(screen.getByText('ml-harness')).toBeTruthy());

    const workspacePlus = screen.getByRole('button', { name: 'New chat in Workspace' });
    const repoPlus = screen.getByRole('button', { name: 'New chat in ml-harness' });
    expect(workspacePlus.className).toMatch(/v3-rail-section-new/);
    expect(repoPlus.className).toMatch(/v3-rail-section-new/);
    /* 12px, the size every other small rail glyph uses. */
    expect(repoPlus.querySelector('svg')?.getAttribute('class')).toMatch(/i-12/);

    /* Quiet until pointed at, then the product accent — the affordance every
       other rail glyph has. READS THE STYLESHEET: the rule lives in v3.css,
       so no inline style is asserted. */
    expect(repoPlus.getAttribute('style')).toBeNull();
    const css = readFileSync(resolve(__dirname, 'v3.css'), 'utf8');
    const quiet = /\.v3-rail-section-new \{[^}]*color: var\(--ink-4\)/.exec(css);
    const hot = /\.v3-rail-section-new:hover,\s*\.v3-rail-section-new:focus-visible \{[^}]*color: var\(--accent\)/.exec(css);
    expect(quiet, 'the resting rule names --ink-4').toBeTruthy();
    expect(hot, 'the hover and focus rule names --accent').toBeTruthy();
  });

  it('creates in THAT root and lands the reader in it without attaching', async () => {
    const wire: Wire = { posts: [], reads: [] };
    const store = mount(wire);
    await waitFor(() => expect(screen.getByText('ml-harness')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'New chat in ml-harness' }));

    await waitFor(() => expect(wire.posts).toHaveLength(1));
    expect(wire.posts[0]!.body.repoPath).toBe(REPO);

    /* Landed softly: the new thread is active AND the reader is marked as
       browsing that root, which is what keeps the attached repo (and every
       write fenced by it) exactly where it was. */
    await waitFor(() => expect(store.getState().session.activeId).toBe(MINTED));
    expect(store.getState().session.browseRepoPath).toBe(REPO);
    /* The soft read carried the root too — an id alone would have been read
       from the active root, which is a different repo's thread. */
    expect(wire.reads.some((u) => u.includes(encodeURIComponent(REPO)))).toBe(true);
  });

  it('the Workspace "+" names no root, which the server reads as the active one', async () => {
    const wire: Wire = { posts: [], reads: [] };
    mount(wire);
    await waitFor(() => expect(screen.getByText('ml-harness')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'New chat in Workspace' }));

    await waitFor(() => expect(wire.posts).toHaveLength(1));
    expect('repoPath' in wire.posts[0]!.body).toBe(false);
  });
});
