import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider } from '../state';
import { V3SessionsRail } from './V3SessionsRail';

/* Owner (macOS): "deleting chats doesn't work". The rail used window.confirm, a native sheet that on macOS
   Electron needs a keypress and is unreliable. Deleting now asks with the app's own dialog, answerable by mouse.
   window.confirm is stubbed to THROW, so any use of it fails these tests. */

const deletes: string[] = [];
let holdDelete: Promise<void> | null = null;
const idx = (ids: string[]) => ({
  version: 1,
  activeId: ids[0] ?? '',
  sessions: ids.map((id) => ({ id, title: `Chat ${id}`, createdAt: '2026-09-21T09:00:00.000Z', updatedAt: '2026-09-21T09:00:00.000Z' })),
});

function client() {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url === '/api/sessions' && method === 'GET') {
      return new Response(JSON.stringify({ index: idx(['a', 'b']), scope: 'workspace', repos: [{ path: '/home/max/proj', name: 'proj', index: idx(['a', 'b']) }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (method === 'DELETE' && url.startsWith('/api/sessions/')) {
      deletes.push(url);
      if (holdDelete) await holdDelete;
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return createSessionsClient(fetchImpl);
}

async function openDeleteFor(title: string) {
  render(
    <StoreProvider store={createStore({})}>
      <V3SessionsRail client={client()} onOpenProject={vi.fn()} />
    </StoreProvider>,
  );
  const row = (await screen.findByText(title)).closest('li, div[role], div') as HTMLElement;
  const more = row.parentElement!.querySelector('button[aria-label="Chat actions"]') as HTMLElement;
  fireEvent.click(more);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
}

beforeEach(() => {
  deletes.length = 0;
  holdDelete = null;
  vi.stubGlobal('confirm', () => {
    throw new Error('window.confirm must not be used');
  });
  vi.spyOn(window, 'confirm').mockImplementation(() => {
    throw new Error('window.confirm must not be used');
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('deleting a chat from the rail', () => {
  it('Delete in the menu opens the in-page confirm; clicking its Delete removes the chat once', async () => {
    await openDeleteFor('Chat a');
    expect(deletes).toEqual([]);
    expect(screen.getByTestId('v3-delete-confirm')).toBeTruthy();
    fireEvent.click(screen.getByTestId('v3-delete-confirm-ok'));
    await waitFor(() => expect(deletes.length).toBe(1));
    expect(deletes[0]).toContain('/api/sessions/a');
    await waitFor(() => expect(screen.queryByTestId('v3-delete-confirm')).toBeNull());
  });

  it('Escape cancels and deletes nothing', async () => {
    await openDeleteFor('Chat a');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('v3-delete-confirm')).toBeNull());
    expect(deletes).toEqual([]);
  });

  it('Enter on the focused Delete button also deletes, once', async () => {
    await openDeleteFor('Chat a');
    const ok = screen.getByTestId('v3-delete-confirm-ok');
    ok.focus();
    fireEvent.keyDown(ok, { key: 'Enter' });
    await waitFor(() => expect(deletes.length).toBe(1));
  });

  it('Cancel deletes nothing', async () => {
    await openDeleteFor('Chat a');
    fireEvent.click(screen.getByTestId('v3-delete-confirm-cancel'));
    await waitFor(() => expect(screen.queryByTestId('v3-delete-confirm')).toBeNull());
    expect(deletes).toEqual([]);
  });

  it('Enter keydown and the click that follows it in the same act send exactly one DELETE', async () => {
    await openDeleteFor('Chat a');
    const ok = screen.getByTestId('v3-delete-confirm-ok');
    await act(async () => {
      fireEvent.keyDown(ok, { key: 'Enter' });
      fireEvent.click(ok);
    });
    await waitFor(() => expect(deletes.length).toBe(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(deletes.length).toBe(1);
  });

  it('a chat whose DELETE is still pending cannot be deleted again', async () => {
    let release: () => void = () => {};
    holdDelete = new Promise<void>((r) => {
      release = r;
    });
    await openDeleteFor('Chat a');
    fireEvent.click(screen.getByTestId('v3-delete-confirm-ok'));
    await waitFor(() => expect(deletes.length).toBe(1));
    /* The row is still on screen while the DELETE is pending: delete it again. */
    const more = screen.getAllByLabelText('Chat actions')[0]!;
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(screen.getByTestId('v3-delete-confirm-ok'));
    await new Promise((r) => setTimeout(r, 50));
    expect(deletes.length).toBe(1);
    release();
  });
});
