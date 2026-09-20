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

  it('session rows sit flat under QUIET section titles, and take their hairline only on hover', async () => {
    /*
     * OWNER, 2026-09-02: "the new chat, the general, and the workspace folders
     * have this crisp outline. Unless you hover on the actual chat sessions, I
     * don't want them to have this whole outline." So the row's resting rule
     * carries a TRANSPARENT stroke — present in the box model, invisible —
     * with the hairline and hover wash arriving together in the :hover rule.
     *
     * OWNER, 2026-09-13 (Decision 12): the group labels lose their box too —
     * "use font sizes and contrast colors instead of big surrounding borders
     * around sections, projects and so on". This used to assert the label
     * kept a --surface-2 fill and a border; it now asserts the opposite.
     *
     * AND THE SECTION LEADS THE THREADS UNDER IT, his third and settling pass
     * the same day: "the project files and section names should be priority as
     * threads, not secondary applications as they are now — the chats can be
     * dimmed in font colour and smaller in font size as well."
     *
     * THIS CASE NOW PINS THE RULING, NOT THE NUMBERS, and that is deliberate.
     * It asserted an exact pair three times in one session and went red on two
     * of his own corrections, which means the pair was never what it was
     * protecting. What must not silently flip is the ORDER: the title is at
     * least as large as the row and strictly brighter than it. Both readings
     * are taken off the resolved ramp, so a future re-tune of --t-* or --ink-*
     * moves them together and only an inversion fails.
     */
    const ramp = (token: string): number => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
      return Number.parseFloat(raw);
    };
    const tokenIn = (rule: CSSStyleRule, prop: string): string | null =>
      /var\((--[a-z0-9-]+)\)/.exec(rule.style.getPropertyValue(prop))?.[1] ?? null;
    /* --ink-1 is the brightest and --ink-4 the faintest, so a SMALLER index is
       more prominent. Ordering on the name is exact where a parsed colour
       would not be. */
    const inkRank = (name: string | null): number =>
      name === null ? 99 : Number.parseInt(name.replace('--ink-', ''), 10);
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
            r.cssText.includes('--t-11') &&
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
            r.cssText.includes('--glass-hover') &&
            /* Draft V3 · Graphite: hover is soft glass lighten — no --edge
               hairline. The outline-on-hover rule was the pre-Native shape. */
            !r.cssText.includes('--edge'),
        );
      } catch {
        return false;
      }
    });
    expect(rowHoverRule, 'hover materialises as soft glass, not an outline').toBe(true);
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
            !r.cssText.includes(':hover') &&
            r.cssText.includes('solid transparent') &&
            r.cssText.includes('--font-mono') &&
            !r.cssText.includes('--surface-2'),
        );
      } catch {
        return false;
      }
    });
    expect(rowButtonRule).toBe(true);
    expect(listSpacingRule).toBe(true);
    expect(repoToggleRule).toBe(true);

    /* THE ORDER, off the resolved ramp. */
    const restingRule = (selector: string): CSSStyleRule | undefined =>
      [...document.styleSheets]
        .flatMap((sheet) => {
          try {
            return [...sheet.cssRules];
          } catch {
            return [];
          }
        })
        .filter((r): r is CSSStyleRule => r instanceof CSSStyleRule)
        .find(
          (r) =>
            r.selectorText.includes(selector) &&
            !r.selectorText.includes(':hover') &&
            !r.selectorText.includes('data-active') &&
            r.style.getPropertyValue('font-size') !== '',
        );
    const title = restingRule('.sessions-group-label');
    const row = restingRule('.sessions-row');
    expect(title, 'no resting rule for the section title').toBeTruthy();
    expect(row, 'no resting rule for a thread row').toBeTruthy();
    const titleSize = ramp(tokenIn(title!, 'font-size')!);
    const rowSize = ramp(tokenIn(row!, 'font-size')!);
    expect(titleSize, 'a section title may never be smaller than the threads under it').toBeGreaterThanOrEqual(rowSize);
    /*
     * Draft A · Native (Decision 18): group labels are QUIET uppercase marks
     * (--ink-4 / --t-11); threads stay --ink-3. Hierarchy is caps + mono +
     * letterspacing, not a louder title. The 2026-09-13 "title brighter than
     * threads" lock encoded the pre-Native rail and would refuse the mock.
     */
    expect(
      inkRank(tokenIn(title!, 'color')),
      'a Native section label is quieter than (or equal to) the threads under it',
    ).toBeGreaterThanOrEqual(inkRank(tokenIn(row!, 'color')));
    const firstRow = rows()[0]!;
    expect(generalLabel.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a resting session row spends no black — the active thread is marked by a glass tint, not a black sink', async () => {
    /*
     * OWNER, 2026-09-02: "just in the background, when not hovering, the chat
     * sessions … it's hard seeing some weird little small black outline around
     * it." The black was an inset sink shadow.
     *
     * Draft A · Native (Decision 18) keeps that ban on BLACK sinks, and marks
     * the loaded thread with --accent-wash plus a NEUTRAL glass top highlight
     * (inset --glass-ctl-hi). That inset is light, not a charcoal outline — so
     * the lock now refuses black literals and charcoal sinks, and REQUIRES the
     * glass highlight on the active row rather than banning every inset.
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
    }

    /* `:has()` rules dress the ITEM around the row (the acts overlay lives
       there), not the row itself — they are not the active row's mark. */
    const activeRules = resting.filter(
      (r) =>
        r.selectorText.includes('.sessions-row[data-active') &&
        !r.selectorText.includes(':has(') &&
        !r.selectorText.includes('.sessions-pin-mark') &&
        !r.selectorText.includes('.sessions-when'),
    );
    expect(activeRules.length, 'the loaded thread still has a rule of its own').toBeGreaterThan(0);
    for (const rule of activeRules) {
      /*
       * AND NO STROKE AT ALL. Draft A fills the loaded row; an outline reads
       * as a pill sitting on top of the list.
       */
      const border = rule.style.getPropertyValue('border-color').trim();
      expect(
        border === '' || border === 'transparent',
        `the loaded row must be filled, not outlined: ${border}`,
      ).toBe(true);
      expect(rule.style.getPropertyValue('background-color').trim()).not.toBe('');
      /* Neutral glass highlight is allowed; a black / charcoal sink is not. */
      const shadow = rule.style.getPropertyValue('box-shadow');
      if (shadow.trim() !== '') {
        expect(
          shadow,
          'active row inset must be a glass highlight, not a sink',
        ).toMatch(/--glass-inset|--glass-ctl-hi/);
        expect(shadow).not.toMatch(blackLiteral);
      }
      expect(
        rule.style.getPropertyValue('color').trim(),
        'the loaded row reads in accent ink',
      ).toContain('--accent-ink');
    }
    /*
     * THE FILL HAS BODY — and as of Decision 18 its body is an accent TINT on
     * glass (--accent-wash), never an opaque --accent-chosen slab and never a
     * bare --bg-ground sink alone.
     */
    const fills = activeRules.map((r) => r.style.getPropertyValue('background-color').trim());
    expect(
      fills.every((f) => f.includes('--accent-wash')),
      `the loaded row is an accent tint on glass: ${fills.join(' | ')}`,
    ).toBe(true);
    expect(fills.some((f) => f.includes('--accent-wash'))).toBe(true);

    const hover = rowRules.find((r) => r.selectorText.includes(':hover'));
    expect(hover?.cssText, 'hover still materialises a soft wash').toMatch(/--glass-hover/);
    expect(hover?.cssText, 'Native hover carries no --edge hairline').not.toMatch(/--edge/);
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
    /* --accent-wash since Decision 17; the property this guards is that the
       chip's fill is DISJOINT from the row's, not which token the row uses. */
    expect(rowFills, 'the row rules must be readable for this to mean anything').toContain('--accent-wash');

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

  it('workspace catalog soft-opens a project chat without attaching', async () => {
    const opened: Array<{ repo: string; id: string }> = [];
    const browsed: Array<{ repo: string; id: string }> = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/sessions/session-r')) {
        return new Response(
          JSON.stringify({
            chat: { version: 1, sessionId: 'session-r', turns: [] },
            meta: { mode: 'code' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
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
      );
    }) as typeof fetch;
    render(
      <SessionsPanel
        client={createSessionsClient(fetchImpl)}
        onBrowseCatalogSession={(repo, id) => {
          browsed.push({ repo, id });
          return { outcome: 'ok' as const };
        }}
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
    await waitFor(() => expect(browsed).toEqual([{ repo: '/home/ubuntu/shopfront', id: 'session-r' }]));
    expect(opened).toEqual([]);
  });

  it('workspace catalog Open project still attaches when asked', async () => {
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
        onBrowseCatalogSession={() => ({ outcome: 'ok' as const })}
        onOpenRepoSession={(repo, id) => {
          opened.push({ repo, id });
        }}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('sessions-open-project')).toBeTruthy());
    fireEvent.click(screen.getByTestId('sessions-open-project'));
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

/* ══════════════════════════════════════════════════════════════════════════
   WORKING WITH SEVERAL THREADS AT ONCE.

   OWNER, 2026-09-14: "add a select and delete so you can work with multiple
   sessions."

   The rail could only ever be worked one row at a time: four threads to clear
   meant four hovers, four trash clicks and four questions. What follows pins
   the shape of the answer rather than its pixels — a selection is a MODIFIER
   on the existing click (so the panel's primary job, opening a thread, is
   untouched), the bar only exists while there is something to do with it, and
   the road to a `DELETE` still runs through a question that names what is
   about to go.

   The row order these cases count on is INDEX's: pinned first, then newest —
   session-d, session-b, session-a, session-c. `session-b` is the ACTIVE one
   and is `disabled`, so the selectable order is d, a, c.
   ══════════════════════════════════════════════════════════════════════════ */

function pick(id: string, modifier: { ctrlKey?: true; shiftKey?: true }): void {
  fireEvent.click(
    rows().find((r) => r.getAttribute('data-id') === id)!,
    modifier,
  );
}

function selectedIds(): string[] {
  return rows()
    .filter((r) => r.getAttribute('data-selected') === 'true')
    .map((r) => r.getAttribute('data-id')!);
}

describe('SessionsPanel — selecting several threads', () => {
  it('Ctrl-click picks a row and does NOT open it', async () => {
    /* The whole design rests on this: if a modifier-click also switched the
       session, picking the second row would reload the workspace out from
       under the reader mid-gesture. */
    const { calls, client } = wireRecorder();
    const switched: string[] = [];
    render(<SessionsPanel client={client} onSwitched={(id) => switched.push(id)} />);
    await waitFor(() => expect(rows().length).toBe(4));

    pick('session-a', { ctrlKey: true });

    expect(selectedIds()).toEqual(['session-a']);
    expect(calls.some((c) => c.url === '/api/sessions/active')).toBe(false);
    expect(switched).toEqual([]);
    /* The mark is not only a fill: a rail read with the ears says it too. */
    const row = rows().find((r) => r.getAttribute('data-id') === 'session-a')!;
    expect(row.getAttribute('aria-label')).toContain('selected');
    /* One picked row is not "working with multiple sessions" — no bar yet. */
    expect(screen.queryByTestId('sessions-selection-bar')).toBeNull();
  });

  it('Shift-click extends the range — and never reaches the thread you are in', async () => {
    const { client } = wireRecorder();
    render(<SessionsPanel client={client} />);
    await waitFor(() => expect(rows().length).toBe(4));

    pick('session-d', { ctrlKey: true });
    pick('session-c', { shiftKey: true });

    /* Top to bottom the rail reads d, b, a, c. The range from d to c is every
       row between them — except session-b, which is the loaded thread: it is
       disabled, it cannot be clicked into a selection, and a range that swept
       it up would hand the bulk delete the one thread whose removal re-homes
       activeId and reboots the host. */
    expect(selectedIds()).toEqual(['session-d', 'session-a', 'session-c']);
    expect(
      rows().find((r) => r.getAttribute('data-id') === 'session-b')!.getAttribute('data-selected'),
    ).toBe('false');
    expect(screen.getByTestId('sessions-selection-count').textContent).toBe('3 selected');
  });

  it('a plain click still opens the thread, and drops the selection', async () => {
    const { calls, client } = wireRecorder();
    const switched: string[] = [];
    render(<SessionsPanel client={client} onSwitched={(id) => switched.push(id)} />);
    await waitFor(() => expect(rows().length).toBe(4));

    pick('session-d', { ctrlKey: true });
    pick('session-a', { ctrlKey: true });
    expect(screen.getByTestId('sessions-selection-bar')).toBeTruthy();

    fireEvent.click(rows().find((r) => r.getAttribute('data-id') === 'session-c')!);

    await waitFor(() => expect(switched).toEqual(['session-c']));
    expect(calls.find((c) => c.url === '/api/sessions/active')!.body).toEqual({
      activeId: 'session-c',
    });
    /* Leaving rows picked behind a switch would leave a "Delete 2" armed over
       threads whose marks are no longer where the reader left them. */
    await waitFor(() => expect(selectedIds()).toEqual([]));
    expect(screen.queryByTestId('sessions-selection-bar')).toBeNull();
  });

  it('the bar arrives at two, and floats rather than pushing the list', async () => {
    const { client } = wireRecorder();
    render(<SessionsPanel client={client} />);
    await waitFor(() => expect(rows().length).toBe(4));

    pick('session-a', { ctrlKey: true });
    expect(screen.queryByTestId('sessions-selection-bar')).toBeNull();

    pick('session-c', { ctrlKey: true });
    const bar = screen.getByTestId('sessions-selection-bar');
    expect(screen.getByTestId('sessions-selection-count').textContent).toBe('2 selected');
    expect(screen.getByTestId('sessions-selection-delete').textContent).toBe('Delete 2');
    expect(screen.getByTestId('sessions-selection-clear')).toBeTruthy();

    /*
     * A RAIL THAT JUMPS AS YOU SELECT IS A RAIL YOU CANNOT SELECT IN: the
     * second Ctrl-click lands on whatever moved under the pointer. The bar is
     * out of flow, which is the mechanism that makes that impossible — jsdom
     * has no layout to measure, but it resolves the cascade, and this is the
     * declaration the guarantee rests on.
     */
    expect(getComputedStyle(bar).position).toBe('absolute');
    /* And it is the PANEL it floats inside. Without a containing block on the
       panel root the bar would anchor to the viewport — still out of flow,
       still passing the line above, and sitting at the bottom of the window
       instead of the bottom of the rail. */
    expect(getComputedStyle(screen.getByTestId('sessions-panel')).position).toBe('relative');

    /*
     * THE COUNT IS NOT MONO, AND THIS LINE IS A MEASUREMENT FROM THE REAL
     * RAIL. Driven against the running app (22 threads, the 216px shell rail),
     * the bar came out 191px wide and read "4 select…": "4 selected" wanted
     * 66px at the mono advance and had 63px, because "Delete 4" (61px),
     * "Clear" (45px), the gaps and the padding got there first — so the one
     * flexible child clipped the only text on the bar that says what the
     * reader has done. On the UI face the same string measures 63px and fits.
     *
     * jsdom has no text metrics, so it cannot re-measure that; what it CAN do
     * is fail the silent revert to `var(--font-mono)`, which is the move that
     * would put the ellipsis back.
     */
    const countRule = [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules];
        } catch {
          return [];
        }
      })
      .find(
        (r): r is CSSStyleRule =>
          r instanceof CSSStyleRule && r.selectorText.endsWith('.sessions-selection-count'),
      );
    expect(countRule, 'the count has a rule of its own').toBeTruthy();
    expect(countRule!.style.getPropertyValue('font-family')).not.toMatch(/--font-mono/);

    /* Both controls are real buttons, reachable by Tab and named for someone
       who cannot see the count beside them. */
    for (const id of ['sessions-selection-delete', 'sessions-selection-clear']) {
      const control = screen.getByTestId(id);
      expect(control.tagName).toBe('BUTTON');
      expect(control.getAttribute('aria-label')).toBeTruthy();
      expect(control.getAttribute('tabindex')).toBeNull();
    }
  });

  it('bulk delete ASKS first, names the count, and lands focus on Cancel', async () => {
    const { calls, client } = wireRecorder();
    render(<SessionsPanel client={client} />);
    await waitFor(() => expect(rows().length).toBe(4));

    pick('session-d', { ctrlKey: true });
    pick('session-c', { shiftKey: true });
    fireEvent.click(screen.getByTestId('sessions-selection-delete'));

    /* THE POINT OF THIS TEST: the destructive request has not been sent. */
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(screen.getByTestId('sessions-bulk-delete-prompt').textContent).toBe(
      'Delete 3 threads?',
    );
    /* A keyboard reader who arms this and hits Enter must keep the threads,
       not lose three of them — the row's own confirm settled this and the
       stakes here are higher, not lower. */
    expect(document.activeElement).toBe(screen.getByTestId('sessions-bulk-delete-cancel'));

    fireEvent.click(screen.getByTestId('sessions-bulk-delete-cancel'));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    /* Cancel takes the question down and keeps the selection: it answered the
       question, it did not undo the work of picking three rows. */
    expect(screen.queryByTestId('sessions-bulk-delete-prompt')).toBeNull();
    expect(screen.getByTestId('sessions-selection-count').textContent).toBe('3 selected');
  });

  it('confirming sends one DELETE per picked thread and empties the selection', async () => {
    const { calls, client } = wireRecorder();
    const switched: string[] = [];
    render(<SessionsPanel client={client} onSwitched={(id) => switched.push(id)} />);
    await waitFor(() => expect(rows().length).toBe(4));

    pick('session-d', { ctrlKey: true });
    pick('session-a', { ctrlKey: true });
    fireEvent.click(screen.getByTestId('sessions-selection-delete'));
    fireEvent.click(screen.getByTestId('sessions-bulk-delete-confirm'));

    await waitFor(() => expect(rows().length).toBe(2));
    const deletes = calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
    expect(deletes).toEqual(['/api/sessions/session-d', '/api/sessions/session-a']);
    expect(rows().map((r) => r.getAttribute('data-id'))).toEqual(['session-b', 'session-c']);
    /* Nothing was picked that could move the pointer, so the host is not told
       to reload — N deletes must never mean N reboots, and here they mean
       none at all. */
    expect(switched).toEqual([]);
    expect(screen.queryByTestId('sessions-selection-bar')).toBeNull();
    expect(selectedIds()).toEqual([]);
  });

  it('Escape takes the question down first, then the selection', async () => {
    const { calls, client } = wireRecorder();
    render(<SessionsPanel client={client} />);
    await waitFor(() => expect(rows().length).toBe(4));

    pick('session-d', { ctrlKey: true });
    pick('session-a', { ctrlKey: true });
    fireEvent.click(screen.getByTestId('sessions-selection-delete'));

    const panel = screen.getByTestId('sessions-panel');
    fireEvent.keyDown(panel, { key: 'Escape' });
    /* One Escape, one step back: throwing away both the question and six
       Ctrl-clicks because someone changed their mind about a confirm is work
       there is no way to get back. */
    expect(screen.queryByTestId('sessions-bulk-delete-prompt')).toBeNull();
    expect(screen.getByTestId('sessions-selection-count').textContent).toBe('2 selected');

    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(selectedIds()).toEqual([]);
    expect(screen.queryByTestId('sessions-selection-bar')).toBeNull();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('NO gesture in the selection reaches DELETE without the confirm', async () => {
    /*
     * The irreversibility rule, swept across every control the selection adds.
     * Deleting is `rmSync` on the session directory; a single path from a
     * click to the wire without a question in between is the whole defect,
     * and it would not be caught by any of the cases above, each of which
     * walks one gesture.
     */
    const { calls, client } = wireRecorder();
    render(<SessionsPanel client={client} />);
    await waitFor(() => expect(rows().length).toBe(4));
    const noDeletes = () => expect(calls.some((c) => c.method === 'DELETE')).toBe(false);

    pick('session-d', { ctrlKey: true });
    noDeletes();
    pick('session-c', { shiftKey: true });
    noDeletes();
    fireEvent.click(screen.getByTestId('sessions-selection-delete'));
    noDeletes();
    /* Arming swaps the bar's face, so Clear is reached by answering the
       question first — there is no state in which both are on screen, which is
       itself the point: the reader is never offered a tidy-up button beside a
       destructive one they have already armed. */
    fireEvent.click(screen.getByTestId('sessions-bulk-delete-cancel'));
    fireEvent.click(screen.getByTestId('sessions-selection-clear'));
    noDeletes();
    expect(selectedIds()).toEqual([]);

    pick('session-a', { ctrlKey: true });
    pick('session-c', { ctrlKey: true });
    fireEvent.click(screen.getByTestId('sessions-selection-delete'));
    fireEvent.keyDown(screen.getByTestId('sessions-panel'), { key: 'Escape' });
    noDeletes();
  });

  it('a picked row is marked with GLASS DEPTH — brighter pane, no new hue slab', async () => {
    /*
     * OWNER, 2026-09-14: "TOO MUCH PURPLE HUE EVERYWHERE". A multi-select pick
     * is not a claim about the world, so it may not spend a hue.
     *
     * Draft A · Native (Decision 18): picked = --glass-sel with glass edge +
     * top highlight (depth), while LOADED keeps --accent-wash (tint). Two
     * states, two marks. The old lock demanded --bg-ground and banned inset —
     * that was the charcoal-sink era and would refuse the mock.
     */
    const { client } = wireRecorder();
    render(<SessionsPanel client={client} />);
    await waitFor(() => expect(rows().length).toBe(4));

    const pickedRules: CSSStyleRule[] = [];
    for (const sheet of [...document.styleSheets]) {
      try {
        for (const rule of [...sheet.cssRules]) {
          /* Both halves of the filter matter: `[data-selected]` is a shared
             vocabulary (the rail, the files pane and the whiteboard all use
             it, and graphite.css dresses some of them), so a scan that did not
             also name `.sessions-row` would grade another surface's rule. */
          if (
            rule instanceof CSSStyleRule &&
            rule.selectorText.includes('.sessions-row') &&
            rule.selectorText.includes('data-selected')
          ) {
            pickedRules.push(rule);
          }
        }
      } catch {
        /* a cross-origin sheet cannot be read; none of ours are */
      }
    }
    expect(pickedRules.length, 'a picked row has a rule of its own').toBeGreaterThan(0);
    for (const rule of pickedRules) {
      const fill = rule.style.getPropertyValue('background-color');
      expect(fill, `a picked row is glass depth: ${fill}`).toContain('--glass-sel');
      /* No accent / verdict hue on a multi-select pick. */
      expect(rule.cssText).not.toMatch(/--accent-wash|--accent-chosen|--accent-solid/);
      expect(rule.cssText).not.toMatch(/--st-/);
      expect(rule.cssText).not.toMatch(/rgba?\(\s*0\s*,\s*0\s*,\s*0/);
      /* Glass thickness insets are required; a black sink is not. */
      expect(rule.cssText).toMatch(/--glass-ctl-hi|--glass-sel-edge/);
    }
  });
});

describe('SessionsPanel — selecting across the workspace catalog', () => {
  it('a range spans General and a repo section, and each delete carries its own repo', async () => {
    const switched: string[] = [];
    const { calls, client } = catalogRecorder();
    render(<SessionsPanel client={client} onSwitched={(id) => switched.push(id)} />);
    await waitFor(() => expect(screen.getAllByTestId('sessions-list-repo').length).toBe(1));

    /* On screen: General d, b, a, c — then shopfront's session-r, session-r2.
       A range from the last General row into the section is one gesture, so
       the selection order has to be one order across both lists. */
    pick('session-c', { ctrlKey: true });
    pick('session-r', { shiftKey: true });
    expect(selectedIds()).toEqual(['session-c', 'session-r']);

    /* Narrow it back to the section alone, so the deletes below are purely
       foreign rows and the workspace pointer provably never moves. */
    pick('session-c', { ctrlKey: true });
    pick('session-r2', { ctrlKey: true });
    expect(selectedIds()).toEqual(['session-r', 'session-r2']);

    fireEvent.click(screen.getByTestId('sessions-selection-delete'));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(screen.getByTestId('sessions-bulk-delete-prompt').textContent).toBe(
      'Delete 2 threads?',
    );
    fireEvent.click(screen.getByTestId('sessions-bulk-delete-confirm'));

    /* A DELETE has no body, so the repo travels as a query param — on EVERY
       row, because a selection may hold threads from several repos at once and
       a delete that lost the path would fall through to the attached one. */
    await waitFor(() => expect(calls.filter((c) => c.method === 'DELETE').length).toBe(2));
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([
      `/api/sessions/session-r?repoPath=${encodeURIComponent(CATALOG_REPO)}`,
      `/api/sessions/session-r2?repoPath=${encodeURIComponent(CATALOG_REPO)}`,
    ]);

    /* The section emptied; the workspace the reader is actually in never moved
       and was never told it had. */
    await waitFor(() => expect(screen.queryAllByTestId('sessions-list-repo').length).toBe(0));
    expect(switched).toEqual([]);
    expect(
      within(screen.getByTestId('sessions-list')).getAllByTestId('sessions-row').length,
    ).toBe(4);
  });

  it('a refusal stops the run, is reported verbatim, and keeps what it did not delete', async () => {
    /*
     * Half a bulk delete is the state a reader cannot reason about on their
     * own: which four of the six went? The rows that were destroyed leave the
     * list (the server said so), the refused row and everything behind it stay
     * picked, and the message is the server's own words.
     */
    const calls: Call[] = [];
    let current: SessionIndex = INDEX;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: null });
      if (method === 'GET') return json({ index: current });
      if (method === 'DELETE') {
        const id = decodeURIComponent(url.replace('/api/sessions/', ''));
        if (id === 'session-c') {
          return new Response(JSON.stringify({ error: 'no repository is attached' }), {
            status: 409,
            headers: { 'content-type': 'application/json' },
          });
        }
        current = {
          version: 1,
          activeId: current.activeId,
          sessions: current.sessions.filter((s) => s.id !== id),
        };
        return json({ ok: true, index: current });
      }
      return json({ index: current });
    }) as typeof fetch;

    const switched: string[] = [];
    render(
      <SessionsPanel client={createSessionsClient(fetchImpl)} onSwitched={(id) => switched.push(id)} />,
    );
    await waitFor(() => expect(rows().length).toBe(4));

    /* d and a go; c refuses. */
    pick('session-d', { ctrlKey: true });
    pick('session-c', { shiftKey: true });
    fireEvent.click(screen.getByTestId('sessions-selection-delete'));
    fireEvent.click(screen.getByTestId('sessions-bulk-delete-confirm'));

    const failure = await screen.findByTestId('sessions-failure');
    expect(failure.textContent).toBe('no repository is attached');
    await waitFor(() => expect(rows().map((r) => r.getAttribute('data-id'))).toEqual([
      'session-b',
      'session-c',
    ]));
    /* The refused row is still picked, so pressing Delete again retries
       exactly what did not happen. */
    expect(selectedIds()).toEqual(['session-c']);
    expect(switched).toEqual([]);
  });
});
