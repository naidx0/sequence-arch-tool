/* ══════════════════════════════════════════════════════════════════════════
   0019 — A RAIL ROW HOLDS NO CONTROL INSIDE ANOTHER
   packages/web2/src/v3/railRowNesting.test.tsx

   The accessibility audit (axe, nested-interactive, serious): `.v3-session`
   was a div[role=button][tabindex=0] wrapping the pin button and the "Chat
   actions" button. A screen reader flattens a button's children, and the
   row's own Enter handler took Enter from both: Enter on the pin, or on "Chat
   actions", opened the chat instead. The row now keeps its mouse click, and
   its keyboard control is a sibling of the pin and the menu, not their parent.
   ══════════════════════════════════════════════════════════════════════════ */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createSessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider } from '../state';
import { V3SessionsRail } from './V3SessionsRail';

const HOME = 'session-home';
const OTHER = 'session-other';

const index = {
  version: 1,
  activeId: HOME,
  sessions: [HOME, OTHER].map((id) => ({
    id,
    title: id === HOME ? 'Home chat' : 'Other chat',
    createdAt: '2026-09-17T09:00:00.000Z',
    updatedAt: '2026-09-17T09:00:00.000Z',
  })),
};

function mount() {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url === '/api/sessions' && method === 'GET') {
      return new Response(JSON.stringify({ index, scope: 'workspace', repos: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    calls.push(`${method} ${url}`);
    if (url.startsWith('/api/sessions/')) {
      return new Response(
        JSON.stringify({ index, chat: { version: 1, sessionId: OTHER, turns: [] }, meta: {} }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const store = createStore({});
  const view = render(
    <StoreProvider store={store}>
      <V3SessionsRail client={createSessionsClient(fetchImpl)} />
    </StoreProvider>,
  );
  return { calls, ...view };
}

const INTERACTIVE =
  'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [tabindex]:not([tabindex="-1"])';

async function otherRow(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getByText('Other chat')).toBeTruthy());
  return screen.getByText('Other chat').closest('.v3-session') as HTMLElement;
}

describe('0019 — the sessions rail row', () => {
  it('has no interactive element inside another', async () => {
    const { container } = mount();
    const row = await otherRow(container);
    expect(row.getAttribute('role')).toBeNull();
    expect(row.getAttribute('tabindex')).toBeNull();
    const nested = [...container.querySelectorAll('.v3-session')].flatMap((r) =>
      [...r.querySelectorAll(INTERACTIVE)].filter((el) => {
        const outer = el.parentElement?.closest(INTERACTIVE);
        return outer != null && r.contains(outer);
      }),
    );
    expect(nested).toEqual([]);
  });

  it('keeps a keyboard control per row, named by the chat, first in the row’s tab order', async () => {
    const { container } = mount();
    const row = await otherRow(container);
    const buttons = [...row.querySelectorAll('button')];
    expect(buttons[0]!.getAttribute('data-testid')).toBe('v3-session-hit');
    expect(buttons[0]!.getAttribute('aria-label')).toBe('Other chat');
    const home = screen.getByText('Home chat').closest('.v3-session')!;
    expect(home.querySelector('[data-testid="v3-session-hit"]')!.getAttribute('aria-current')).toBe('true');
    expect(buttons[0]!.getAttribute('aria-current')).toBeNull();
  });

  it('opens the chat on Enter from the row control, as before', async () => {
    const { container, calls } = mount();
    const row = await otherRow(container);
    const hit = row.querySelector('[data-testid="v3-session-hit"]')!;
    expect(fireEvent.keyDown(hit, { key: 'Enter' })).toBe(false);
    await waitFor(() => expect(calls.some((c) => c.includes(OTHER))).toBe(true));
  });

  it('leaves Enter on the pin and on "Chat actions" to those buttons — it does not open the chat', async () => {
    const { container, calls } = mount();
    const row = await otherRow(container);
    const pin = row.querySelector('.v3-pin')!;
    const more = row.querySelector('.v3-session-more')!;
    // Not default-prevented, so the browser turns each into its own button's click.
    expect(fireEvent.keyDown(pin, { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(more, { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(more, { key: ' ' })).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([]);
  });

  it('still opens the chat on a mouse click anywhere on the row', async () => {
    const { container, calls } = mount();
    const row = await otherRow(container);
    fireEvent.click(row.querySelector('.v3-session-title')!);
    await waitFor(() => expect(calls.some((c) => c.includes(OTHER))).toBe(true));
  });
});
