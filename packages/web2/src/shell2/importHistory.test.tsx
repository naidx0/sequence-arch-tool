import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImportHistory } from './ImportHistory';

/* T3 gap G11: the sidebar lists the CLI chats of this project and imports one on a click. */

const rows = [
  { source: 'claude', providerSessionId: 'c1', title: 'Parser comment handling', updatedAt: '2026-10-01T10:00:00Z', imported: false },
  { source: 'codex', providerSessionId: 'x1', title: 'Rename the helper', updatedAt: '2026-10-02T10:00:00Z', imported: true, chatId: 'chat-9' },
];

function server(over: { post?: () => Response } = {}) {
  const calls: { url: string; body?: unknown }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === '/api/import/sessions') return new Response(JSON.stringify({ sessions: rows }), { status: 200 });
    return over.post?.() ?? new Response(JSON.stringify({ chatId: 'chat-new', turns: 2 }), { status: 200 });
  });
  return { f, calls };
}

describe('Import chats', () => {
  it('lists the sessions, imports one on a click and opens its chat', async () => {
    const s = server();
    const opened: string[] = [];
    render(<ImportHistory fetchImpl={s.f} now={Date.parse('2026-10-03T10:00:00Z')} onOpened={(id) => void opened.push(id)} />);
    const items = await screen.findAllByTestId('s2-import-row');
    expect(items.map((r) => r.getAttribute('data-source'))).toEqual(['claude', 'codex']);
    fireEvent.click(items[0]!.querySelector('button')!);
    await waitFor(() => expect(opened).toEqual(['chat-new']));
    expect(s.calls[1]).toEqual({ url: '/api/import/session', body: { source: 'claude', providerSessionId: 'c1' } });
    /* The row now reads Imported, and a second click opens the chat without importing again. */
    await waitFor(() => expect(screen.getAllByTestId('s2-import-row')[0]!.getAttribute('data-imported')).toBe('true'));
    fireEvent.click(screen.getAllByTestId('s2-import-row')[1]!.querySelector('button')!);
    await waitFor(() => expect(opened).toEqual(['chat-new', 'chat-9']));
    expect(s.calls.filter((c) => c.url === '/api/import/session')).toHaveLength(1);
  });

  it('says so when nothing is found or the import is refused', async () => {
    const s = server({ post: () => new Response(JSON.stringify({ error: 'That session has no messages to import.' }), { status: 422 }) });
    const opened: string[] = [];
    render(<ImportHistory fetchImpl={s.f} onOpened={(id) => void opened.push(id)} />);
    fireEvent.click((await screen.findAllByTestId('s2-import-row'))[0]!.querySelector('button')!);
    expect((await screen.findByTestId('s2-import-note')).textContent).toBe('That session has no messages to import.');
    expect(opened).toEqual([]);
  });
});
