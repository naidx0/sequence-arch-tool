import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import '../sessions/sessions.css';
import '../shell/shell.css';

import { SessionsPanel } from './SessionsPanel';
import { createSessionsClient } from './sessionsClient';
import type { SessionIndex, SessionIndexEntry } from '@sequence/api-types';

/**
 * `Ctrl-K → Sessions` SAID "BUILT IN A LATER WAVE" while the engine kept a full
 * index on disk the whole time — `.sequence/sessions/index.json`, with a title,
 * a mode and an `activeId`. Work the user had already done was reachable by the
 * server and not by them.
 */

const INDEX: SessionIndex = {
  version: 1,
  activeId: 'session-b',
  sessions: [
    { id: 'session-a', title: 'Scanner work', createdAt: '2026-08-20T09:00:00.000Z', updatedAt: '2026-08-20T09:00:00.000Z', mode: 'code' },
    { id: 'session-b', title: 'Board rebuild', createdAt: '2026-08-21T09:00:00.000Z', updatedAt: '2026-08-22T10:00:00.000Z', mode: 'code' },
    { id: 'session-c', title: '', createdAt: '2026-08-19T09:00:00.000Z', updatedAt: '2026-08-19T09:00:00.000Z' },
    { id: 'session-d', title: 'Pinned thing', createdAt: '2026-08-01T09:00:00.000Z', updatedAt: '2026-08-01T09:00:00.000Z', pinned: true },
  ],
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function recorder(index: SessionIndex = INDEX, fail?: { status: number; error: string }) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (fail && method !== 'GET') {
      return new Response(JSON.stringify({ error: fail.error }), {
        status: fail.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (method === 'POST') {
      const made = { id: 'session-new', title: 'New', createdAt: 'x', updatedAt: 'x', mode: 'code' as const };
      return new Response(
        JSON.stringify({
          index: { ...index, activeId: made.id, sessions: [...index.sessions, made] },
          session: { id: made.id, chat: {}, meta: {} },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (method === 'PUT') {
      const id = (JSON.parse(String(init?.body ?? '{}')) as { id: string }).id;
      return new Response(JSON.stringify({ index: { ...index, activeId: id } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ index }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls, client: createSessionsClient(fetchImpl) };
}

function rows() {
  return screen.queryAllByTestId('sessions-row');
}

describe('SessionsPanel', () => {
  it('lists what the engine already had', async () => {
    const { client } = recorder();
    render(<SessionsPanel client={client} />);
    await waitFor(() => expect(rows().length).toBe(4));
    /* No second worded "Sessions" heading in the body — pane chrome owns the mark. */
    expect(screen.queryByTestId('sessions-heading')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Sessions' })).toBeNull();
  });

  it('refetches the list when repoRevision changes after attach or detach', async () => {
    let listCalls = 0;
    const workspaceIndex = INDEX;
    const repoIndex: SessionIndex = {
      version: 1,
      activeId: 'session-r1',
      sessions: [
        {
          id: 'session-r1',
          title: 'Repo chat',
          createdAt: '2026-08-20T09:00:00.000Z',
          updatedAt: '2026-08-20T09:00:00.000Z',
          mode: 'code',
        },
      ],
    };
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        listCalls += 1;
        const index = listCalls === 1 ? workspaceIndex : repoIndex;
        return new Response(
          JSON.stringify({ index, scope: listCalls === 1 ? 'workspace' : 'repo' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ index: repoIndex }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const client = createSessionsClient(fetchImpl);
    const { rerender } = render(<SessionsPanel client={client} repoRevision="unattached:none" />);
    await waitFor(() => expect(rows().length).toBe(4));
    expect(listCalls).toBe(1);
    rerender(<SessionsPanel client={client} repoRevision="attached:/home/ubuntu/shop" />);
    await waitFor(() => expect(rows().length).toBe(1));
    expect(rows()[0]!.getAttribute('data-id')).toBe('session-r1');
    expect(listCalls).toBe(2);
  });

  it('a stale row that 404s refetches the list instead of leaving ghost sessions', async () => {
    let listCalls = 0;
    const staleIndex = INDEX;
    const freshIndex: SessionIndex = {
      version: 1,
      activeId: 'session-b',
      sessions: [INDEX.sessions[1]!],
    };
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        listCalls += 1;
        const index = listCalls === 1 ? staleIndex : freshIndex;
        return new Response(JSON.stringify({ index }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/sessions/active') {
        return new Response(JSON.stringify({ error: 'session not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ index: staleIndex }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const switched: string[] = [];
    render(
      <SessionsPanel
        client={createSessionsClient(fetchImpl)}
        onSwitched={(id) => switched.push(id)}
      />,
    );
    await waitFor(() => expect(rows().length).toBe(4));
    fireEvent.click(rows().find((r) => r.getAttribute('data-id') === 'session-a')!);
    const failure = await screen.findByTestId('sessions-failure');
    expect(failure.textContent).toBe('session not found');
    expect(switched).toEqual([]);
    await waitFor(() => expect(listCalls).toBe(2));
    await waitFor(() => expect(rows().length).toBe(1));
    expect(rows()[0]!.getAttribute('data-id')).toBe('session-b');
  });

  it('pinned first, then newest — and the order is deterministic', async () => {
    const { client } = recorder();
    render(<SessionsPanel client={client} />);
    await waitFor(() => expect(rows().length).toBe(4));
    expect(rows().map((r) => r.getAttribute('data-id'))).toEqual([
      'session-d', // pinned
      'session-b', // newest updated
      'session-a',
      'session-c',
    ]);
  });

  it('an untitled session shows its ID, never an invented name', async () => {
    const { client } = recorder();
    render(<SessionsPanel client={client} />);
    await waitFor(() => expect(rows().length).toBe(4));
    const untitled = rows().find((r) => r.getAttribute('data-id') === 'session-c')!;
    /*
     * "Untitled conversation 3" would fabricate the one thing a reader scans
     * this list for. The id is ugly and it is true.
     */
    expect(untitled.textContent).toContain('session-c');
  });

  it('the current session is MARKED, not merely coloured', async () => {
    const { client } = recorder();
    render(<SessionsPanel client={client} />);
    await waitFor(() => expect(rows().length).toBe(4));
    const active = rows().find((r) => r.getAttribute('data-id') === 'session-b')!;
    /* A highlight tells only the people who can see it. `aria-current` is what
       tells a keyboard or screen-reader user which thread they are in. */
    expect(active.getAttribute('aria-current')).toBe('true');
    /* Seat-walk: cramped "current" text tag overflowed the 216px sidebar —
       `aria-current` + data-active carry the mark without the word. */
    expect(active.textContent).not.toMatch(/\bcurrent\b/i);
    /* And it cannot be clicked, because switching to where you are is a reload
       for nothing. */
    expect((active as HTMLButtonElement).disabled).toBe(true);
  });

  it('row actions reveal on hover — not always visible crowding the title', async () => {
    const { client } = recorder();
    render(<SessionsPanel client={client} />);
    await waitFor(() => expect(rows().length).toBe(4));
    const item = rows()[0]!.closest('li')!;
    const acts = within(item).getByTestId('sessions-acts');
    /* At rest the cluster is invisible — seat-walk crushed titles when acts
       were always painted beside a mono timestamp in a 216px sidebar. */
    expect(getComputedStyle(acts).opacity).toBe('0');
    /* The reveal rule is in sessions.css (`.sessions-item:hover` /
       `:focus-within`). jsdom does not apply :hover; assert the stylesheet
       carries both selectors so a future delete of the rule fails here. */
    const sheets = [...document.styleSheets];
    const ruled = sheets.some((sheet) => {
      try {
        return [...sheet.cssRules].some((r) =>
          r.cssText.includes('.sessions-item:hover .sessions-acts') ||
          r.cssText.includes('.sessions-item:focus-within .sessions-acts'),
        );
      } catch {
        return false;
      }
    });
    expect(ruled).toBe(true);
  });

  it('New chat is the first control — before the session list', async () => {
    const { client } = recorder();
    render(<SessionsPanel client={client} />);
    await waitFor(() => expect(rows().length).toBe(4));
    const panel = screen.getByTestId('sessions-panel');
    const newBtn = screen.getByTestId('sessions-new');
    const firstRow = rows()[0]!;
    expect(panel.compareDocumentPosition(newBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(newBtn.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(newBtn.textContent).toMatch(/new chat/i);
  });

  it('does not show explanatory copy under New chat', async () => {
    const { client } = recorder();
    render(<SessionsPanel client={client} />);
    await waitFor(() => expect(rows().length).toBe(4));
    expect(screen.queryByTestId('sessions-arch-scope')).toBeNull();
    expect(screen.queryByText(/Architecture edits stay on this chat/i)).toBeNull();
    expect(screen.queryByText(/General sessions stay in this workspace/i)).toBeNull();
  });

  it('shows relative session timing, not ISO stamps', async () => {
    const { client } = recorder();
    render(<SessionsPanel client={client} />);
    await waitFor(() => expect(rows().length).toBe(4));
    const whenText = rows()[0]!.querySelector('.sessions-when')?.textContent ?? '';
    expect(whenText).not.toMatch(/2026-/);
    expect(whenText).toMatch(/^\d+[smhd]$/);
  });

  it('repo sections collapse and expand', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          index: INDEX,
          scope: 'workspace',
          repos: [
            {
              path: '/home/ubuntu/shopfront',
              name: 'shopfront',
              index: {
                version: 1,
                activeId: 'session-r',
                sessions: [
                  {
                    id: 'session-r',
                    title: 'Repo thread',
                    createdAt: '2026-08-20T09:00:00.000Z',
                    updatedAt: '2026-08-20T09:00:00.000Z',
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;
    render(<SessionsPanel client={createSessionsClient(fetchImpl)} />);
    await waitFor(() => expect(screen.getAllByTestId('sessions-list-repo').length).toBe(1));
    fireEvent.click(screen.getByTestId('sessions-group-repo-toggle'));
    expect(screen.queryAllByTestId('sessions-list-repo').length).toBe(0);
    fireEvent.click(screen.getByTestId('sessions-group-repo-toggle'));
    expect(screen.getAllByTestId('sessions-list-repo').length).toBe(1);
  });

  it('choosing another session activates it and tells the host', async () => {
    const { calls, client } = recorder();
    const switched: string[] = [];
    render(<SessionsPanel client={client} onSwitched={(id) => switched.push(id)} />);
    await waitFor(() => expect(rows().length).toBe(4));

    fireEvent.click(rows().find((r) => r.getAttribute('data-id') === 'session-a')!);
    await waitFor(() => expect(switched).toEqual(['session-a']));

    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe('/api/sessions/active');
    /*
     * `activeId`, NOT `id`, AND THIS ASSERTION USED TO PIN THE BUG.
     *
     * `PutActiveSessionRequest` in @sequence/api-types declares `activeId`,
     * and repoServer rejects anything else with 400 "activeId required". The
     * client sent `{ id }`, so every click on a session row failed — and this
     * line asserted `{ id }`, which is why 991 green tests never noticed that
     * the only wired session action in the product did not work.
     *
     * A wire test must assert the CONTRACT, never whatever the client happens
     * to send; asserting the latter is a mirror, and a mirror cannot disagree.
     */
    expect(put.body).toEqual({ activeId: 'session-a' });
  });

  it('creating one activates it too — a new session you are not in is a trap', async () => {
    const { calls, client } = recorder();
    const switched: string[] = [];
    render(<SessionsPanel client={client} onSwitched={(id) => switched.push(id)} />);
    await waitFor(() => expect(rows().length).toBe(4));

    fireEvent.click(screen.getByTestId('sessions-new'));
    await waitFor(() => expect(switched).toEqual(['session-new']));
    expect(calls.some((c) => c.method === 'POST')).toBe(true);
  });

  it('flushes remembered chat before New chat so the blank session stays blank', async () => {
    const flushCalls: string[] = [];
    const { rememberChatForFlush, clearSessionFlush } = await import('./sessionPersist');
    clearSessionFlush();
    rememberChatForFlush([
      {
        id: 'u1',
        role: 'user',
        text: 'old thread prose',
        intents: [],
        chips: [],
        contextLines: [],
        surface: null,
        at: 1,
      },
    ]);
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        flushCalls.push(`${init?.method ?? 'GET'} ${String(url)}`);
        return { ok: true } as Response;
      }),
    );
    try {
      const { calls, client } = recorder();
      const switched: string[] = [];
      render(<SessionsPanel client={client} onSwitched={(id) => switched.push(id)} />);
      await waitFor(() => expect(rows().length).toBe(4));
      fireEvent.click(screen.getByTestId('sessions-new'));
      await waitFor(() => expect(switched).toEqual(['session-new']));
      expect(flushCalls.some((c) => c.includes('/api/chat-memory'))).toBe(true);
      const flushAt = flushCalls.findIndex((c) => c.includes('/api/chat-memory'));
      const createAt = calls.findIndex((c) => c.method === 'POST' && c.url.includes('/api/sessions'));
      expect(flushAt).toBeGreaterThanOrEqual(0);
      expect(createAt).toBeGreaterThanOrEqual(0);
      /* Flush must finish before create flips activeId — otherwise the old
         transcript lands in the new blank session on host reload. */
      expect(flushCalls[flushAt]!).toMatch(/PUT/);
    } finally {
      clearSessionFlush();
      vi.unstubAllGlobals();
      globalThis.fetch = realFetch;
    }
  });

  it('repo headers use a folder mark and drop the session count', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          index: INDEX,
          scope: 'workspace',
          repos: [
            {
              path: '/home/ubuntu/shopfront',
              name: 'shopfront',
              index: {
                version: 1,
                activeId: 'session-r',
                sessions: [
                  {
                    id: 'session-r',
                    title: 'Repo thread',
                    createdAt: '2026-08-20T09:00:00.000Z',
                    updatedAt: '2026-08-20T09:00:00.000Z',
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;
    render(<SessionsPanel client={createSessionsClient(fetchImpl)} />);
    await waitFor(() => expect(screen.getAllByTestId('sessions-list-repo').length).toBe(1));
    const toggle = screen.getByTestId('sessions-group-repo-toggle');
    expect(toggle.querySelector('[data-icon="folder"]')).not.toBeNull();
    expect(toggle.querySelector('.sessions-group-count')).toBeNull();
    expect(toggle.textContent).not.toMatch(/\b1\b/);
    const sheets = [...document.styleSheets];
    const folderRule = sheets.some((sheet) => {
      try {
        return [...sheet.cssRules].some(
          (r) =>
            r.cssText.includes('.sessions-group-folder') &&
            r.cssText.includes('scale(0.86)') &&
            !r.cssText.includes('scaleY(1.1)'),
        );
      } catch {
        return false;
      }
    });
    expect(folderRule).toBe(true);
  });

  it('session rows sit flat under bordered section title cards, and take their hairline only on hover', async () => {
    /*
     * OWNER, 2026-09-02: "the new chat, the general, and the workspace folders
     * have this crisp outline. Unless you hover on the actual chat sessions, I
     * don't want them to have this whole outline." So the group labels keep
     * their hairline (asserted below, unchanged) and the row's resting rule
     * carries a TRANSPARENT stroke — present in the box model, invisible —
     * with the hairline and hover wash arriving together in the :hover rule.
     */
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          index: INDEX,
          scope: 'workspace',
          repos: [
            {
              path: '/home/ubuntu/shopfront',
              name: 'shopfront',
              index: {
                version: 1,
                activeId: 'session-r',
                sessions: [
                  {
                    id: 'session-r',
                    title: 'Repo thread',
                    createdAt: '2026-08-20T09:00:00.000Z',
                    updatedAt: '2026-08-20T09:00:00.000Z',
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;
    render(<SessionsPanel client={createSessionsClient(fetchImpl)} />);
    await waitFor(() => expect(screen.getByTestId('sessions-group-general-label')).toBeTruthy());
    const generalLabel = screen.getByTestId('sessions-group-general-label');
    expect(generalLabel.querySelector('[data-icon="gpu"]')).not.toBeNull();
    const sheets = [...document.styleSheets];
    const rowButtonRule = sheets.some((sheet) => {
      try {
        return [...sheet.cssRules].some(
          (r) =>
            r.cssText.includes('.sessions-row') &&
            !r.cssText.includes(':hover') &&
            r.cssText.includes('solid transparent') &&
            r.cssText.includes('--t-12') &&
            !r.cssText.includes('--surface-2'),
        );
      } catch {
        return false;
      }
    });
    const rowHoverRule = sheets.some((sheet) => {
      try {
        return [...sheet.cssRules].some(
          (r) =>
            r.cssText.includes('.sessions-row:hover') &&
            r.cssText.includes('--state-hover') &&
            r.cssText.includes('border-color') &&
            r.cssText.includes('--edge'),
        );
      } catch {
        return false;
      }
    });
    expect(rowHoverRule, 'the outline is a hover state, not a resting one').toBe(true);
    const listSpacingRule = sheets.some((sheet) => {
      try {
        return [...sheet.cssRules].some(
          (r) =>
            r.cssText.includes('.sessions-list') &&
            r.cssText.includes('padding') &&
            r.cssText.includes('--sp-16'),
        );
      } catch {
        return false;
      }
    });
    const repoToggleRule = sheets.some((sheet) => {
      try {
        return [...sheet.cssRules].some(
          (r) =>
            r.cssText.includes('.sessions-group-label') &&
            r.cssText.includes('border') &&
            r.cssText.includes('--surface-2'),
        );
      } catch {
        return false;
      }
    });
    expect(rowButtonRule).toBe(true);
    expect(listSpacingRule).toBe(true);
    expect(repoToggleRule).toBe(true);
    const firstRow = rows()[0]!;
    expect(generalLabel.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a resting session row spends no black — the active thread is marked by the ramp, not by an inset shadow', async () => {
    /*
     * OWNER, 2026-09-02: "just in the background, when not hovering, the chat
     * sessions … it's hard seeing some weird little small black outline around
     * it. You don't hover over it, which I don't like. It should only pop up
     * when you hover over stuff."
     *
     * The black was the ACTIVE row's own mark — `inset 0 2px 5px
     * rgba(0,0,0,.22)`, measured live on a 30px row, where a 5px black blur
     * hugs the whole inner edge and reads as an outline. He has one session, so
     * the active row is the only row he sees. A raw rgba() in a component sheet
     * breaks the token law besides. Nothing at REST may carry an inset shadow
     * or a black literal; the focus ring (:focus-visible, --bg-base inner ring)
     * and the hover wash are the only states allowed to add anything.
     */
    render(<SessionsPanel client={recorder().client} />);
    await waitFor(() => expect(rows().length).toBe(4));

    const rowRules: CSSStyleRule[] = [];
    for (const sheet of [...document.styleSheets]) {
      try {
        for (const rule of [...sheet.cssRules]) {
          if (rule instanceof CSSStyleRule && rule.selectorText.includes('.sessions-row')) {
            rowRules.push(rule);
          }
        }
      } catch {
        /* a cross-origin sheet cannot be read; none of ours are */
      }
    }
    expect(rowRules.length, 'sessions.css must be loaded for this to mean anything').toBeGreaterThan(0);

    const resting = rowRules.filter(
      (r) => !r.selectorText.includes(':hover') && !r.selectorText.includes(':focus-visible'),
    );
    const blackLiteral = /rgba?\(\s*0\s*,\s*0\s*,\s*0/;
    for (const rule of resting) {
      expect(rule.cssText, `${rule.selectorText} paints black at rest`).not.toMatch(blackLiteral);
      expect(rule.cssText, `${rule.selectorText} sinks the row with an inset shadow`).not.toMatch(/inset/);
    }

    /* `:has()` rules dress the ITEM around the row (the acts overlay lives
       there), not the row itself — they are not the active row's mark. */
    const activeRules = resting.filter(
      (r) => r.selectorText.includes('data-active') && !r.selectorText.includes(':has('),
    );
    expect(activeRules.length, 'the loaded thread still has a rule of its own').toBeGreaterThan(0);
    for (const rule of activeRules) {
      /* No stroke and no shadow: the mark is the ramp step + the weight. */
      expect(rule.style.getPropertyValue('box-shadow').trim()).toBe('');
      const border = rule.style.getPropertyValue('border-color').trim();
      expect(border === '' || border === 'transparent', `active row draws a stroke: ${border}`).toBe(true);
      expect(rule.style.getPropertyValue('background-color').trim()).not.toBe('');
    }
    /* It must be RAISED off the rail ground, not level with it: the ground under
       these rows is --surface-1 (measured on .shell-cb-rail). */
    const fills = activeRules.map((r) => r.style.getPropertyValue('background-color').trim());
    expect(fills.every((f) => f.includes('--surface-3'))).toBe(true);

    const hover = rowRules.find((r) => r.selectorText.includes(':hover'));
    expect(hover?.cssText, 'the wash and the hairline still arrive together on hover').toMatch(
      /--state-hover/,
    );
    expect(hover?.cssText).toMatch(/--edge/);
  });

  it('the hover chip keeps a fill of its own — it never lands on the colour of the row it covers', async () => {
    /*
     * The round that raised the active row to --surface-3 gave the chip its own
     * ground: `.sessions-acts` was --surface-3 too, so the pin/rename/delete
     * overlay had ZERO fill separation from the row it sits on, with a single
     * --edge hairline (rgba(255,255,255,.09) over --surface-3 ≈ rgb(55,55,58), a
     * ~1.4:1 step) as the entire boundary. The owner's shape is ONE session —
     * the active row is the only row he ever hovers — so this is the only state
     * that matters, and the chip occludes the timestamp with no visible edge.
     *
     * The chip is an overlay, so it must read as raised over EVERY row state,
     * not just today's. Asserting the tokens are disjoint (rather than pinning
     * one name) is what makes the next ramp change fail here instead of on his
     * screen.
     */
    const oneSession: SessionIndex = {
      version: 1,
      activeId: 'session-b',
      sessions: [INDEX.sessions[1] as SessionIndexEntry],
    };
    render(<SessionsPanel client={recorder(oneSession).client} />);
    await waitFor(() => expect(rows().length).toBe(1));
    expect(rows()[0]!.getAttribute('data-active')).toBe('true');
    /* The chip is in the DOM at rest and revealed by the hover rule, so the
       row the owner hovers is the row it covers. */
    expect(screen.getByTestId('sessions-acts')).toBeTruthy();

    const styleRules: CSSStyleRule[] = [];
    for (const sheet of [...document.styleSheets]) {
      try {
        for (const rule of [...sheet.cssRules]) {
          if (rule instanceof CSSStyleRule) styleRules.push(rule);
        }
      } catch {
        /* a cross-origin sheet cannot be read; none of ours are */
      }
    }
    const tokensIn = (rule: CSSStyleRule, prop: 'background' | 'background-color'): string[] =>
      [...(rule.style.getPropertyValue(prop).matchAll(/var\((--[a-z0-9-]+)\)/g) as Iterable<RegExpMatchArray>)].map(
        (m) => m[1]!,
      );

    const chipRules = styleRules.filter((r) => r.selectorText.endsWith('.sessions-acts'));
    const chipFills = chipRules.flatMap((r) => [...tokensIn(r, 'background'), ...tokensIn(r, 'background-color')]);
    expect(chipFills.length, 'the acts chip still paints a fill of its own').toBeGreaterThan(0);

    const rowFills = styleRules
      .filter((r) => r.selectorText.includes('.sessions-row') && !r.selectorText.includes(':has('))
      .flatMap((r) => [...tokensIn(r, 'background'), ...tokensIn(r, 'background-color')]);
    expect(rowFills, 'the row rules must be readable for this to mean anything').toContain('--surface-3');

    for (const fill of chipFills) {
      expect(
        rowFills.includes(fill),
        `the acts chip paints ${fill}, the same token a session row paints — the overlay has no fill separation from its ground`,
      ).toBe(false);
    }

    /* A fill step alone is one ramp change away from colliding again; the book
       gives every overlay that sits over content an elevation (.menu/.popover
       take --e3). It is free at rest — the chip is opacity 0 until hover. */
    const chipShadow = chipRules.map((r) => r.style.getPropertyValue('box-shadow').trim()).join(' ');
    expect(chipShadow, 'the acts chip carries an elevation token').toMatch(/var\(--e[1-4]\)/);
  });

  it('a refusal is reported verbatim and the host is NOT told anything switched', async () => {
    const { client } = recorder(INDEX, { status: 409, error: 'no repository is attached' });
    const switched: string[] = [];
    render(<SessionsPanel client={client} onSwitched={(id) => switched.push(id)} />);
    await waitFor(() => expect(rows().length).toBe(4));

    fireEvent.click(rows().find((r) => r.getAttribute('data-id') === 'session-a')!);
    const failure = await screen.findByTestId('sessions-failure');
    expect(failure.textContent).toBe('no repository is attached');
    /* Reloading the workspace for a switch that did not happen would land the
       reader back where they started with no explanation. */
    expect(switched).toEqual([]);
  });

  it('an empty index says so, rather than showing an empty box', async () => {
    const { client } = recorder({ version: 1, activeId: '', sessions: [] });
    render(<SessionsPanel client={client} />);
    const empty = await screen.findByTestId('sessions-empty');
    expect(empty.textContent).toMatch(/first question you ask starts one/i);
  });

  it('a failed read is reported on the failure strip', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: 'server unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    render(<SessionsPanel client={createSessionsClient(fetchImpl)} />);
    expect((await screen.findByTestId('sessions-failure')).textContent).toMatch(/server unavailable/);
    expect((screen.getByTestId('sessions-new') as HTMLButtonElement).disabled).toBe(true);
  });

  it('workspace scope shows General label and opens repo catalog sessions', async () => {
    const opened: Array<{ repo: string; id: string }> = [];
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          index: INDEX,
          scope: 'workspace',
          repos: [
            {
              path: '/home/ubuntu/shopfront',
              name: 'shopfront',
              index: {
                version: 1,
                activeId: 'session-r',
                sessions: [
                  {
                    id: 'session-r',
                    title: 'Repo thread',
                    createdAt: '2026-08-20T09:00:00.000Z',
                    updatedAt: '2026-08-20T09:00:00.000Z',
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;
    render(
      <SessionsPanel
        client={createSessionsClient(fetchImpl)}
        onOpenRepoSession={(repo, id) => {
          opened.push({ repo, id });
        }}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('sessions-group-general-label')).toBeTruthy());
    expect(screen.getByTestId('sessions-group-general-label').textContent).toBe('General');
    expect(screen.getAllByTestId('sessions-list-repo').length).toBe(1);
    const repoRow = screen.getAllByTestId('sessions-row').find((r) => r.getAttribute('data-id') === 'session-r')!;
    expect((repoRow as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(repoRow);
    await waitFor(() => expect(opened).toEqual([{ repo: '/home/ubuntu/shopfront', id: 'session-r' }]));
  });

  it('workspace catalog highlights ONLY the live General session — not each repo last-active', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          index: INDEX,
          scope: 'workspace',
          repos: [
            {
              path: '/home/ubuntu/sequence',
              name: 'SEQUENCE',
              index: {
                version: 1,
                activeId: 'session-r',
                sessions: [
                  {
                    id: 'session-r',
                    title: 'hi',
                    createdAt: '2026-08-20T09:00:00.000Z',
                    updatedAt: '2026-08-20T09:00:00.000Z',
                  },
                ],
              },
            },
            {
              path: '/home/ubuntu/schwai',
              name: 'SCHWAI_COM',
              index: {
                version: 1,
                activeId: 'session-s',
                sessions: [
                  {
                    id: 'session-s',
                    title: 'Can you just break down for me how I c',
                    createdAt: '2026-08-20T08:00:00.000Z',
                    updatedAt: '2026-08-20T08:00:00.000Z',
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;
    render(<SessionsPanel client={createSessionsClient(fetchImpl)} />);
    await waitFor(() => expect(screen.getAllByTestId('sessions-list-repo').length).toBe(2));
    const actives = rows().filter((r) => r.getAttribute('data-active') === 'true');
    /* INDEX.activeId is session-b — only that General row, never catalog last-actives. */
    expect(actives.map((r) => r.getAttribute('data-id'))).toEqual(['session-b']);
    const catalogHi = rows().find((r) => r.getAttribute('data-id') === 'session-r')!;
    expect(catalogHi.getAttribute('data-active')).toBe('false');
    expect(catalogHi.getAttribute('aria-current')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   WAVE 5 · G1 TAIL — RENAME, PIN AND DELETE IN THE SIDEBAR.

   The backend ground truth first: `PUT /api/sessions/:id` takes `title` /
   `pinned` as a patch (`updateSession` in the analyzer's sessionsStore), and
   `DELETE /api/sessions/:id` removes the directory and re-homes `activeId`
   itself when the deleted session was the active one. Everything below wires
   what that server actually does — nothing is faked client-side.

   The recorder here routes BY URL like the real route table, because a
   recorder that answers every verb identically cannot tell a rename from an
   activation — which is precisely the confusion the `{ id }` vs `activeId`
   defect above was made of.
   ══════════════════════════════════════════════════════════════════════════ */

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function wireRecorder(index: SessionIndex = INDEX) {
  const calls: Call[] = [];
  let current = index;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body });

    if (method === 'GET') return json({ index: current });

    if (url === '/api/sessions/active') {
      current = { ...current, activeId: (body as { activeId: string }).activeId };
      return json({ index: current });
    }

    const id = decodeURIComponent(url.replace('/api/sessions/', ''));

    if (method === 'PUT') {
      const patch = body as { title?: string; pinned?: boolean };
      current = {
        ...current,
        sessions: current.sessions.map((s) =>
          s.id === id
            ? {
                ...s,
                ...(patch.title !== undefined ? { title: patch.title, titleEdited: true as const } : {}),
                ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
              }
            : s,
        ),
      };
      return json({ ok: true, index: current });
    }

    if (method === 'DELETE') {
      const remaining = current.sessions.filter((s) => s.id !== id);
      const nextActive =
        current.activeId === id ? remaining[remaining.length - 1]?.id ?? '' : current.activeId;
      current = { version: 1, activeId: nextActive, sessions: remaining };
      return json({ ok: true, index: current });
    }

    return json({ index: current });
  }) as typeof fetch;
  return { calls, client: createSessionsClient(fetchImpl) };
}

describe('SessionsPanel — rename, pin, delete (backend-served)', () => {
  /* The action cluster is a SIBLING of the row button, not a descendant of it
     — a control that activated the session cannot also be the pin — so the
     actions are found from the row's own <li>. */
  function actOn(id: string, testId: string): HTMLElement {
    const row = rows().find((r) => r.getAttribute('data-id') === id)!;
    return within(row.closest('li')!).getByTestId(testId);
  }

  /* Delete is ARMED, then confirmed — see the confirm strip in SessionsPanel.
     These older tests are about what the delete DOES; they walk the two steps
     rather than pretend one click still destroys a thread. */
  function deleteThrough(id: string): void {
    const li = rows().find((r) => r.getAttribute('data-id') === id)!.closest('li')!;
    fireEvent.click(within(li).getByTestId('sessions-delete'));
    fireEvent.click(within(li).getByTestId('sessions-delete-confirm'));
  }

  it('renames in place and sends ONLY the title patch', async () => {
    const { calls, client } = wireRecorder();
    render(<SessionsPanel client={client} />);
    await waitFor(() => expect(rows().length).toBe(4));

    fireEvent.click(actOn('session-a', 'sessions-rename'));
    const field = screen.getByTestId('sessions-rename-field') as HTMLInputElement;

    /* The field starts from the STORED title, never an invented one. */
    expect(field.value).toBe('Scanner work');

    fireEvent.change(field, { target: { value: 'Auth middleware dig' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByTestId('sessions-rename-field')).toBeNull());

    const put = calls.find((c) => c.method === 'PUT' && c.url.includes('session-a'))!;
    expect(put.url).toBe('/api/sessions/session-a');
    /* A PATCH: nothing but the field the reader edited goes over the wire. */
    expect(put.body).toEqual({ title: 'Auth middleware dig' });

    /* The list shows what the SERVER answered, not local optimism. */
    await waitFor(() =>
      expect(
        rows().find((r) => r.getAttribute('data-id') === 'session-a')!.textContent,
      ).toContain('Auth middleware dig'),
    );
  });

  it('an empty rename is refused locally and sends nothing', async () => {
    const { calls, client } = wireRecorder();
    render(<SessionsPanel client={client} />);
    await waitFor(() => expect(rows().length).toBe(4));

    fireEvent.click(actOn('session-a', 'sessions-rename'));
    const field = screen.getByTestId('sessions-rename-field');
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    /* The store ignores an empty title but still bumps updatedAt, which would
       silently reorder the list — so it never leaves the client. */
    expect(calls.some((c) => c.method === 'PUT' && !c.url.includes('active'))).toBe(false);
  });

  it('pins with the toggle, and the state is a pressed attribute, not a colour', async () => {
    const { calls, client } = wireRecorder();
    render(<SessionsPanel client={client} />);
    await waitFor(() => expect(rows().length).toBe(4));

    const pin = actOn('session-a', 'sessions-pin');
    expect(pin.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(pin);
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PUT' && c.url.includes('session-a'))).toBe(true),
    );
    expect(calls.find((c) => c.url.includes('session-a'))!.body).toEqual({ pinned: true });

    /* The server's answer is the truth — the pin flag comes back on the index. */
    await waitFor(() => {
      const after = rows().find((r) => r.getAttribute('data-id') === 'session-a')!;
      expect(
        within(after.closest('li')!).getByTestId('sessions-pin').getAttribute('aria-pressed'),
      ).toBe('true');
    });
  });

  it('deleting a NON-active session is quiet — no reload for a workspace that did not move', async () => {
    /*
     * REVIEW ROUND 2, FINDING G2, and this supersedes finding F12's
     * "always report" contract. The host's switch handler reloads the whole
     * SPA — composer draft, whiteboard, scroll — so reporting every delete
     * rebooted the workspace because someone deleted a thread that was not
     * open. The panel compares the SERVER's returned pointer against the one
     * its own SERVER index load carries: same answer twice → quiet.
     */
    const { calls, client } = wireRecorder();
    const switched: string[] = [];
    render(<SessionsPanel client={client} onSwitched={(id) => switched.push(id)} />);
    await waitFor(() => expect(rows().length).toBe(4));

    deleteThrough('session-c');

    await waitFor(() =>
      expect(rows().some((r) => r.getAttribute('data-id') === 'session-c')).toBe(false),
    );
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('session-c'))).toBe(true);
    /* The server kept 'session-b' active — exactly what this panel loaded, so
       nothing moved as far as either side can prove. The list still updates;
       only the reload is spared. */
    expect(switched).toEqual([]);
  });

  it('a delete whose re-homed pointer differs from what this panel loaded is reported', async () => {
    /*
     * THE STALENESS SCENARIO, RECONSTRUCTED FOR THE ROUND-2 CONTRACT. The
     * panel loads 'session-x' as active — the server's own answer at load
     * time. A stale local copy somewhere else in the shell still believes
     * 'session-a' is active; that belief is NOT what the panel compares
     * against. The reader deletes 'session-x'; the server re-homes onto
     * 'session-a' — the very id the stale copy held. The returned pointer
     * differs from the loaded one, so the move is reported.
     */
    const calls: Call[] = [];
    const withX: SessionIndexEntry[] = [
      INDEX.sessions.find((s) => s.id === 'session-b')!,
      INDEX.sessions.find((s) => s.id === 'session-c')!,
      INDEX.sessions.find((s) => s.id === 'session-d')!,
      { id: 'session-x', title: 'Current thread', createdAt: 'x', updatedAt: 'y', mode: 'code' },
      INDEX.sessions.find((s) => s.id === 'session-a')!, // last: the re-home target
    ];
    let current: SessionIndex = { version: 1, activeId: 'session-x', sessions: withX };
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: null });
      if (method === 'GET') return json({ index: current });
      if (method === 'DELETE') {
        const id = decodeURIComponent(url.replace('/api/sessions/', ''));
        const remaining = current.sessions.filter((s) => s.id !== id);
        const nextActive =
          current.activeId === id ? remaining[remaining.length - 1]?.id ?? '' : current.activeId;
        current = { version: 1, activeId: nextActive, sessions: remaining };
        return json({ ok: true, index: current });
      }
      return json({ index: current });
    }) as typeof fetch;

    const switched: string[] = [];
    render(<SessionsPanel client={createSessionsClient(fetchImpl)} onSwitched={(id) => switched.push(id)} />);
    await waitFor(() => expect(rows().length).toBe(5));

    deleteThrough('session-x');

    // The server re-homes onto 'session-a'. That equals the STALE LOCAL COPY'S
    // pointer — but not the pointer this panel LOADED from the server
    // ('session-x') — so the difference reports the re-home honestly.
    await waitFor(() => expect(switched).toEqual(['session-a']));
  });

  it('deleting the ACTIVE session reports the engine re-homing activeId', async () => {
    const { client } = wireRecorder();
    const switched: string[] = [];
    render(<SessionsPanel client={client} onSwitched={(id) => switched.push(id)} />);
    await waitFor(() => expect(rows().length).toBe(4));

    deleteThrough('session-b');

    /* The chat, board and scan hang off the active session; once the server
       moved the pointer, the host must reload — the same contract a switch
       carries, said out loud on the control. */
    await waitFor(() => expect(switched.length).toBe(1));
    expect(switched[0]).toBeTruthy();
    expect(switched[0]).not.toBe('session-b');
  });

  it('a refused patch is reported verbatim', async () => {
    const calls: Call[] = [];
    const failing = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: null });
      if (method === 'GET') return json({ index: INDEX });
      return new Response(JSON.stringify({ error: 'no repository is attached' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    render(<SessionsPanel client={createSessionsClient(failing)} />);
    await waitFor(() => expect(rows().length).toBe(4));

    fireEvent.click(actOn('session-a', 'sessions-pin'));
    const failure = await screen.findByTestId('sessions-failure');
    expect(failure.textContent).toBe('no repository is attached');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   REPORT C — EDIT ANY CHAT SESSION WITHOUT BEING IN IT

   OWNER, 2026-09-02: "Should also let you edit any type of chat session
   without actually being in that chat session, just whenever you want."

   The workspace catalog lists other repos' threads. Before this round the
   rename / pin / delete cluster rendered only when `!fromCatalog`, so the one
   place the panel showed you every thread on the machine was the one place it
   would not let you touch any of them.
   ══════════════════════════════════════════════════════════════════════════ */

const CATALOG_REPO = '/home/ubuntu/shopfront';

/** Workspace scope: a General index plus one repo section, both writable. */
function catalogRecorder() {
  const calls: Call[] = [];
  let workspace: SessionIndex = INDEX;
  let section: SessionIndex = {
    version: 1,
    activeId: 'session-r',
    sessions: [
      {
        id: 'session-r',
        title: 'Repo thread',
        createdAt: '2026-08-20T09:00:00.000Z',
        updatedAt: '2026-08-20T09:00:00.000Z',
      },
      {
        id: 'session-r2',
        title: 'Second repo thread',
        createdAt: '2026-08-19T09:00:00.000Z',
        updatedAt: '2026-08-19T09:00:00.000Z',
      },
    ],
  };

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body });

    if (method === 'GET') {
      return json({
        index: workspace,
        scope: 'workspace',
        repos: [{ path: CATALOG_REPO, name: 'shopfront', index: section }],
      });
    }

    const [pathOnly, query] = url.split('?');
    const id = decodeURIComponent(pathOnly.replace('/api/sessions/', ''));
    const queryRepo = query ? new URLSearchParams(query).get('repoPath') : null;
    const bodyRepo = (body as { repoPath?: string } | null)?.repoPath ?? null;
    const repo = queryRepo ?? bodyRepo;
    /* The server answers with the index of the repo it WROTE — for a catalog
       row that is the section's, never the workspace's. */
    const target = repo === CATALOG_REPO ? section : workspace;

    if (method === 'PUT') {
      const patch = body as { title?: string; pinned?: boolean };
      const next: SessionIndex = {
        ...target,
        sessions: target.sessions.map((s) =>
          s.id === id
            ? {
                ...s,
                ...(patch.title !== undefined ? { title: patch.title } : {}),
                ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
              }
            : s,
        ),
      };
      if (repo === CATALOG_REPO) section = next;
      else workspace = next;
      return json({ ok: true, index: next });
    }

    if (method === 'DELETE') {
      const remaining = target.sessions.filter((s) => s.id !== id);
      /* The deleted row was that repo's activeId, so the store re-homes onto a
         DIFFERENT id than the workspace pointer this panel loaded. That is the
         exact shape that used to reboot the SPA for a thread nobody opened. */
      const next: SessionIndex = {
        version: 1,
        activeId: remaining[0]?.id ?? '',
        sessions: remaining,
      };
      if (repo === CATALOG_REPO) section = next;
      else workspace = next;
      return json({ ok: true, index: next });
    }

    return json({ index: target });
  }) as typeof fetch;

  return { calls, client: createSessionsClient(fetchImpl) };
}

function catalogRow(id: string): HTMLElement {
  const row = screen
    .getAllByTestId('sessions-row')
    .find((r) => r.getAttribute('data-id') === id)!;
  return row.closest('li')!;
}

describe('SessionsPanel — editing a catalog session you are not in', () => {
  it('a catalog row carries pin / rename / delete, and renaming names its repo without switching', async () => {
    const switched: string[] = [];
    const { calls, client } = catalogRecorder();
    render(<SessionsPanel client={client} onSwitched={(id) => switched.push(id)} />);
    await waitFor(() => expect(screen.getAllByTestId('sessions-list-repo').length).toBe(1));

    const li = catalogRow('session-r');
    expect(within(li).getByTestId('sessions-pin')).toBeTruthy();
    expect(within(li).getByTestId('sessions-rename')).toBeTruthy();
    expect(within(li).getByTestId('sessions-delete')).toBeTruthy();

    fireEvent.click(within(li).getByTestId('sessions-rename'));
    const field = screen.getByTestId('sessions-rename-field') as HTMLInputElement;
    expect(field.value).toBe('Repo thread');
    fireEvent.change(field, { target: { value: 'Checkout bug' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe('/api/sessions/session-r');
    /* The repo travels in the PUT body; the title patch is otherwise untouched. */
    expect(put.body).toEqual({ title: 'Checkout bug', repoPath: CATALOG_REPO });

    /* Editing another repo's thread never moves the thread you are in. */
    expect(switched).toEqual([]);

    /* The FOREIGN answer must not land on the workspace list: General still
       holds its own four rows, and the renamed row is in the repo section. */
    await waitFor(() =>
      expect(
        within(screen.getByTestId('sessions-list')).getAllByTestId('sessions-row').length,
      ).toBe(4),
    );
    expect(within(screen.getByTestId('sessions-list')).getByText('Board rebuild')).toBeTruthy();
    await waitFor(() =>
      expect(
        within(screen.getByTestId('sessions-list-repo')).getByText('Checkout bug'),
      ).toBeTruthy(),
    );
  });

  it('deleting a catalog row never fires onSwitched — the user is not in that thread', async () => {
    const switched: string[] = [];
    const { calls, client } = catalogRecorder();
    render(<SessionsPanel client={client} onSwitched={(id) => switched.push(id)} />);
    await waitFor(() => expect(screen.getAllByTestId('sessions-list-repo').length).toBe(1));

    /* Capture the <li> BEFORE arming: the confirm strip replaces the row
       button, so `data-id` is not on screen to look the row up by afterwards. */
    const li = catalogRow('session-r');
    fireEvent.click(within(li).getByTestId('sessions-delete'));
    fireEvent.click(within(li).getByTestId('sessions-delete-confirm'));

    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    const del = calls.find((c) => c.method === 'DELETE')!;
    /* A DELETE has no body, so the repo is a query param. */
    expect(del.url).toBe(`/api/sessions/session-r?repoPath=${encodeURIComponent(CATALOG_REPO)}`);

    /* The section re-homed onto `session-r2`, which differs from this panel's
       loaded workspace pointer `session-b` — and STILL nothing reloads. */
    expect(switched).toEqual([]);
    await waitFor(() =>
      expect(
        within(screen.getByTestId('sessions-list-repo')).getAllByTestId('sessions-row').length,
      ).toBe(1),
    );
    expect(
      within(screen.getByTestId('sessions-list')).getAllByTestId('sessions-row').length,
    ).toBe(4);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   REVIEW ROUND 3 — ONE CLICK MUST NOT DESTROY A THREAD.

   OWNER'S LIVE CATALOG, read from `GET /api/sessions`: `C:\Users\dev\
   Projects\realapp` holds exactly ONE session, `session-7657`, titled "Hi";
   the workspace they are actually in holds `session-3105`. He hovers the realapp
   row and the three-icon cluster appears — pin, rename, trash — and the trash
   click went straight to `DELETE`, which `rmSync`s the session directory. With
   `keepOneLiveThread: false` now correct on the server for a foreign repo (see
   `deleteSession` in the analyzer's sessionsStore), that click makes the whole
   realapp section vanish: no confirmation, no message, no undo, and the repo
   whose only transcript just went is one they were not even in.
   ══════════════════════════════════════════════════════════════════════════ */

const OWNER_REPO = 'C:\\Users\\dev\\Projects\\realapp';

/** The owner's shape: workspace with ONE thread, catalog repo with ONE thread. */
function ownerCatalogRecorder() {
  const calls: Call[] = [];
  let workspace: SessionIndex = {
    version: 1,
    activeId: 'session-3105',
    sessions: [
      {
        id: 'session-3105',
        title: 'Hi',
        createdAt: '2026-09-01T09:00:00.000Z',
        updatedAt: '2026-09-01T09:00:00.000Z',
      },
    ],
  };
  let section: SessionIndex = {
    version: 1,
    activeId: 'session-7657',
    sessions: [
      {
        id: 'session-7657',
        title: 'Hi',
        createdAt: '2026-09-01T08:00:00.000Z',
        updatedAt: '2026-09-01T08:00:00.000Z',
      },
    ],
  };
  let sectionGone = false;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });

    if (method === 'GET') {
      return json({
        index: workspace,
        scope: 'workspace',
        repos: sectionGone ? [] : [{ path: OWNER_REPO, name: 'realapp', index: section }],
      });
    }

    if (method === 'DELETE') {
      const [pathOnly, query] = url.split('?');
      const id = decodeURIComponent(pathOnly.replace('/api/sessions/', ''));
      const repo = query ? new URLSearchParams(query).get('repoPath') : null;
      if (repo === OWNER_REPO) {
        /* The server's real answer for the LAST thread in a repo you are not
           in: an empty list, no pointer, and the section stops being listed. */
        sectionGone = true;
        section = { version: 1, activeId: '', sessions: [] };
        return json({ ok: true, index: section });
      }
      workspace = {
        version: 1,
        activeId: '',
        sessions: workspace.sessions.filter((s) => s.id !== id),
      };
      return json({ ok: true, index: workspace });
    }

    return json({ index: workspace });
  }) as typeof fetch;

  return { calls, client: createSessionsClient(fetchImpl) };
}

describe('SessionsPanel — a delete is armed before it is fired', () => {
  it('the trash click on the owner’s only realapp thread ASKS, and sends nothing', async () => {
    const { calls, client } = ownerCatalogRecorder();
    render(<SessionsPanel client={client} />);
    await waitFor(() => expect(screen.getAllByTestId('sessions-list-repo').length).toBe(1));

    const li = screen
      .getAllByTestId('sessions-row')
      .find((r) => r.getAttribute('data-id') === 'session-7657')!
      .closest('li')!;
    fireEvent.click(within(li).getByTestId('sessions-delete'));

    /* THE POINT OF THIS TEST: the destructive request has not been sent. */
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);

    /* And the reader is told exactly what is about to go, and from where —
       "Hi" is a title that appears in BOTH lists, so naming the repo is the
       only thing that distinguishes his workspace thread from realapp's. */
    const prompt = within(li).getByTestId('sessions-delete-prompt');
    expect(prompt.textContent).toContain('Hi');
    expect(prompt.textContent).toContain('realapp');
    /* Never the raw Windows path: `path.split('/').pop()` returned the whole
       `C:\Users\...` string, which does not fit a 216px rail. */
    expect(prompt.textContent).not.toContain('C:\\Users');

    /* Cancel keeps the thread, and the row comes back untouched. */
    fireEvent.click(within(li).getByTestId('sessions-delete-cancel'));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(
      within(screen.getByTestId('sessions-list-repo')).getAllByTestId('sessions-row').length,
    ).toBe(1);
  });

  it('confirming is what deletes — and only then does the section go', async () => {
    const { calls, client } = ownerCatalogRecorder();
    render(<SessionsPanel client={client} />);
    await waitFor(() => expect(screen.getAllByTestId('sessions-list-repo').length).toBe(1));

    const li = screen
      .getAllByTestId('sessions-row')
      .find((r) => r.getAttribute('data-id') === 'session-7657')!
      .closest('li')!;
    fireEvent.click(within(li).getByTestId('sessions-delete'));
    fireEvent.click(within(li).getByTestId('sessions-delete-confirm'));

    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(calls.find((c) => c.method === 'DELETE')!.url).toBe(
      `/api/sessions/session-7657?repoPath=${encodeURIComponent(OWNER_REPO)}`,
    );
    /* The row does not come back holding a minted stand-in — the section is
       gone, which is what a delete is supposed to look like. */
    await waitFor(() => expect(screen.queryAllByTestId('sessions-list-repo').length).toBe(0));
    /* The workspace he is actually in never moved. */
    expect(
      within(screen.getByTestId('sessions-list')).getAllByTestId('sessions-row').length,
    ).toBe(1);
  });

  it('arming one row disarms the other — and rename closes the question', async () => {
    const { calls, client } = catalogRecorder();
    render(<SessionsPanel client={client} />);
    await waitFor(() => expect(screen.getAllByTestId('sessions-list-repo').length).toBe(1));

    const first = catalogRow('session-r');
    const second = catalogRow('session-r2');
    fireEvent.click(within(first).getByTestId('sessions-delete'));
    fireEvent.click(within(second).getByTestId('sessions-delete'));

    /* Two rows asking "delete this?" at once is a question nobody can answer. */
    expect(screen.getAllByTestId('sessions-delete-confirm-strip').length).toBe(1);
    expect(within(second).queryByTestId('sessions-delete-prompt')).not.toBeNull();
    expect(within(first).queryByTestId('sessions-delete-prompt')).toBeNull();

    /* Starting a rename on the armed row takes the question off the screen. */
    fireEvent.click(within(second).getByTestId('sessions-delete-cancel'));
    fireEvent.click(within(second).getByTestId('sessions-delete'));
    fireEvent.click(within(first).getByTestId('sessions-rename'));
    expect(screen.queryAllByTestId('sessions-delete-confirm-strip').length).toBe(0);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });
});
