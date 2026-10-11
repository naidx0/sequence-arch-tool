import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoSessionsSection, SessionIndexEntry } from '@sequence/api-types';

import { createSessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider } from '../state';
import { seqdFromGraph } from '../canvas/seqdFromGraph';
import { SessionPanel } from './SessionPanel';
import { HOME_KEY, buildProjects, moveWorkspace, orderChats, orderWorkspaces } from './projectList';
import cssRaw from './shell2.css?raw';

/* A Windows checkout has CRLF line ends; the patterns below are written with \n. */
const css = cssRaw.replace(/\r\n/g, '\n');
const rule = (selector: string): string => {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `rule ${selector}`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};

const at = (h: number) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const chat = (id: string, title: string, h: number, extra: Partial<SessionIndexEntry> = {}): SessionIndexEntry =>
  ({ id, title, createdAt: at(h), updatedAt: at(h), ...extra }) as SessionIndexEntry;
const section = (path: string, name: string, chats: SessionIndexEntry[], home = false): RepoSessionsSection => ({
  path,
  name,
  ...(home ? { home: true } : {}),
  index: { version: 1, activeId: chats[0]?.id ?? '', sessions: chats },
});

const SHOP = 'C:/work/shopfront';
const TICK = 'C:/work/ticketing';
const HOME = 'C:/Users/dev/.sequence';

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

/** A sessions server in a closure: the catalog is the test's own, and every non-GET call is recorded. */
function wired(repos: RepoSessionsSection[], index: SessionIndexEntry[], calls: Call[] = []) {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method !== 'GET') calls.push({ method, url, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
    if (url === '/api/sessions' && method === 'GET') {
      return new Response(JSON.stringify({ index: { version: 1, activeId: index[0]?.id ?? '', sessions: index }, scope: 'workspace', repos }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === '/api/recent') return new Response(JSON.stringify({ recent: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return createSessionsClient(fetchImpl);
}

function mount(repos: RepoSessionsSection[], index: SessionIndexEntry[], calls: Call[] = []) {
  render(
    <StoreProvider store={createStore({})}>
      <SessionPanel client={wired(repos, index, calls)} onOpenProject={() => undefined} onOpenWorkspace={() => undefined} />
    </StoreProvider>,
  );
}

beforeEach(() => localStorage.clear());

describe('item 1: a chat row actions are findable and its menu is readable', () => {
  it('the three dots are hidden at rest on every row, the open chat row too', () => {
    /* Every selector that turns the dots on, with the rule declarations. */
    const on = (css.match(/(?:^|\n)([^{}]*\.s2-it-more[^{}]*)\{[^}]*opacity: 1;/g) ?? []).join('\n');
    expect(on).not.toContain('.is-on');
    expect(on).toContain('.s2-it:hover .s2-it-more');
    expect(on).toContain(".s2-it-more[aria-haspopup][aria-expanded='true']");
    /* Keyboard focus still reveals it; a mouse click focusing the row must not pin it open. */
    expect(on).toContain(':focus-visible');
    expect(on).not.toContain(':focus-within');
    expect(rule('.s2-it-more')).toContain('opacity: 0;');
  });

  it('the three dots are back to the pre-0.1.6 ink: ink-3 on the row fill, no edge', () => {
    const r = rule('.s2-it-more');
    expect(r).toContain('color: var(--b-ink3);');
    expect(r).toContain('background: var(--b-s2);');
    expect(r).not.toContain('box-shadow');
    expect(r).not.toContain('--b-ink2');
  });

  it('while its menu is open the button says so (aria-expanded), which is what keeps the dots shown', async () => {
    mount([], [chat('h1', 'Workspace notes', 5)]);
    const btn = await screen.findByLabelText('Actions for Workspace notes');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    await screen.findByRole('menu');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('the menu is a glass fill of the surface token, and wins over the popover frame fill (two classes)', () => {
    const r = rule('.s2-menu.s2-menu-row');
    expect(r).toContain('background: color-mix(in srgb, var(--b-s2)');
    expect(r).not.toContain('--b-float');
  });

  it('Delete is drawn in the danger colour at rest, Pin in ink-1', () => {
    expect(rule('.s2-menu-row .s2-mi.s2-mi-danger')).toContain('color: var(--b-del);');
    expect(rule('.s2-menu-row .s2-mi')).toContain('color: var(--b-ink1);');
  });

  it('the menu is drawn above the scroller, not inside the clipping section (it was cut off at the section edge)', async () => {
    mount([section(SHOP, 'shopfront', [chat('s1', 'Rate limiting', 9)])], [chat('h1', 'Workspace notes', 5)]);
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(2));
    fireEvent.click(screen.getByLabelText('Actions for Workspace notes'));
    const menu = await screen.findByRole('menu');
    expect(menu.textContent).toContain('Pin');
    expect(menu.textContent).toContain('Delete');
    expect(menu.closest('.s2-sec-in')).toBeNull();
    expect(menu.closest('[data-testid="s2-groups"]')).toBeNull();
  });
});

const shopRow = () => screen.getAllByTestId('s2-project').find((p) => p.getAttribute('data-project') === 'shopfront')!;
const rowOf = (name: string) => screen.getAllByTestId('s2-project').find((p) => p.getAttribute('data-project') === name)!.querySelector('.s2-proj-row')!;
const catalog = () => [section(SHOP, 'shopfront', [chat('s1', 'Rate limiting', 9)]), section(TICK, 'ticketing', [chat('t1', 'Seat holds', 3)])];

describe('item 2: right-click a project to take it off the sidebar', () => {
  it('right-click opens a small menu with New chat and Remove from sidebar', async () => {
    mount(catalog(), [chat('h1', 'Workspace notes', 5)]);
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(3));
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.contextMenu(rowOf('shopfront'));
    const menu = await screen.findByRole('menu', { name: 'Actions for shopfront' });
    expect(menu.className).toContain('s2-menu');
    expect(menu.querySelectorAll('.s2-mi')).toHaveLength(2);
    expect(menu.textContent).toContain('New chat');
    expect(menu.textContent).toContain('Remove from sidebar');
  });

  it('Remove asks first, says the folder and files are not touched, and only then edits the list', async () => {
    const calls: Call[] = [];
    mount(catalog(), [chat('h1', 'Workspace notes', 5)], calls);
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(3));
    fireEvent.contextMenu(rowOf('shopfront'));
    fireEvent.click(await screen.findByTestId('s2-project-menu-remove'));
    const dlg = await screen.findByTestId('s2-confirm-remove-project');
    expect(dlg.textContent).toMatch(/folder and its files on disk are not touched/i);
    expect(dlg.textContent).toContain('shopfront');
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    /* Cancel: nothing sent. */
    fireEvent.click(screen.getByTestId('s2-confirm-remove-project-cancel'));
    expect(screen.queryByTestId('s2-confirm-remove-project')).toBeNull();
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    /* Confirm: exactly one DELETE /api/recent naming the folder, and nothing else that could touch disk. */
    fireEvent.contextMenu(rowOf('shopfront'));
    fireEvent.click(await screen.findByTestId('s2-project-menu-remove'));
    fireEvent.click(await screen.findByTestId('s2-confirm-remove-project-ok'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1));
    expect(calls.filter((c) => c.method === 'DELETE')[0]).toMatchObject({ url: '/api/recent', body: { path: SHOP } });
    expect(calls.filter((c) => c.method === 'DELETE' && c.url !== '/api/recent')).toHaveLength(0);
  });

  it('the home Workspace has no Remove (it is not a list entry)', async () => {
    mount(catalog(), [chat('h1', 'Workspace notes', 5)]);
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(3));
    fireEvent.contextMenu(rowOf('Workspace'));
    const menu = await screen.findByRole('menu', { name: 'Actions for Workspace' });
    expect(menu.textContent).toContain('New chat');
    expect(menu.textContent).not.toContain('Remove');
  });

  it('Shift+F10 and the context-menu key on a focused row open the same menu; Escape closes it', async () => {
    mount(catalog(), [chat('h1', 'Workspace notes', 5)]);
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(3));
    const hit = shopRow().querySelector('[data-testid="s2-project-switch"]')!;
    (hit as HTMLElement).focus();
    fireEvent.keyDown(hit, { key: 'F10', shiftKey: true });
    expect((await screen.findByRole('menu', { name: 'Actions for shopfront' })).textContent).toContain('Remove from sidebar');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.keyDown(hit, { key: 'ContextMenu' });
    expect(await screen.findByRole('menu', { name: 'Actions for shopfront' })).toBeTruthy();
    /* Negative control: plain F10 opens nothing. */
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.keyDown(hit, { key: 'F10' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('item 6: the Workspace folder is always first', () => {
  const nodes = () => buildProjects({ repoPath: SHOP, repoName: 'shopfront', sessions: [], repos: [section(TICK, 'ticketing', []), section(HOME, 'Workspace', [], true)] });

  it('a saved order that puts the Workspace last still draws it first', () => {
    const saved = [SHOP.toLowerCase(), TICK.toLowerCase(), HOME_KEY];
    expect(orderWorkspaces(nodes(), saved).map((n) => n.name)).toEqual(['Workspace', 'shopfront', 'ticketing']);
    /* A saved order that never met it: still first. */
    expect(orderWorkspaces(nodes(), [TICK.toLowerCase(), SHOP.toLowerCase()]).map((n) => n.name)).toEqual(['Workspace', 'ticketing', 'shopfront']);
  });

  it('nothing can be moved above it, and it cannot be moved', () => {
    const keys = [HOME_KEY, 'a', 'b', 'c'];
    expect(moveWorkspace(keys, 'c', HOME_KEY)).toEqual([HOME_KEY, 'c', 'a', 'b']);
    expect(moveWorkspace(keys, 'b', 'a')).toEqual([HOME_KEY, 'b', 'a', 'c']);
    expect(moveWorkspace(keys, HOME_KEY, 'c')).toEqual(keys);
    expect(moveWorkspace(keys, HOME_KEY, null)).toEqual(keys);
    /* Negative controls: a drop where it already sits, and an unknown key, change nothing. */
    expect(moveWorkspace(keys, 'a', 'a')).toEqual(keys);
    expect(moveWorkspace(keys, 'zz', 'a')).toEqual(keys);
  });

  it('the sidebar draws it first even when localStorage holds an order with it last', async () => {
    localStorage.setItem('s2.workspaceOrder', JSON.stringify([SHOP.toLowerCase(), TICK.toLowerCase(), HOME_KEY]));
    mount([section(SHOP, 'shopfront', []), section(TICK, 'ticketing', []), section(HOME, 'Workspace', [], true)], [chat('h1', 'Workspace notes', 5)]);
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(3));
    expect(screen.getAllByTestId('s2-project').map((p) => p.getAttribute('data-project'))).toEqual(['Workspace', 'shopfront', 'ticketing']);
  });
});

describe('item 3: drag a folder (pointer) or Alt+Up / Alt+Down (keyboard) to reorder', () => {
  const names = () => screen.getAllByTestId('s2-project').map((p) => p.getAttribute('data-project'));
  const hitOf = (name: string) => screen.getAllByTestId('s2-project').find((p) => p.getAttribute('data-project') === name)!.querySelector<HTMLElement>('[data-testid="s2-project-switch"]')!;
  const blockOf = (name: string) => screen.getAllByTestId('s2-project').find((p) => p.getAttribute('data-project') === name)!;
  const saved = () => JSON.parse(localStorage.getItem('s2.workspaceOrder') ?? '[]') as string[];
  const ptr = (target: EventTarget, type: string, y: number) => act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY: y })));
  /* jsdom has no layout: each folder row is 30 px tall and 100 px below the one before. */
  let rect: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const i = [...document.querySelectorAll('.s2-proj-row')].indexOf(this);
      const top = i >= 0 ? i * 100 : 0;
      return { x: 0, y: top, top, left: 0, right: 200, bottom: top + 30, width: 200, height: i >= 0 ? 30 : 0, toJSON: () => ({}) } as DOMRect;
    });
  });
  afterEach(() => rect.mockRestore());
  const three = async () => {
    mount([section(SHOP, 'shopfront', [chat('s1', 'Rate limiting', 9)]), section(TICK, 'ticketing', [chat('t1', 'Seat holds', 3)]), section(HOME, 'Workspace', [], true)], [chat('h1', 'Workspace notes', 5)]);
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(3));
    expect(names()).toEqual(['Workspace', 'shopfront', 'ticketing']);
  };

  it('dragging ticketing above shopfront draws a line on shopfront, moves nothing until release, then files and saves it', async () => {
    await three();
    ptr(hitOf('ticketing'), 'pointerdown', 205);
    ptr(window, 'pointermove', 150);
    ptr(window, 'pointermove', 105);
    expect(blockOf('ticketing').getAttribute('data-dragging')).toBe('true');
    expect(blockOf('shopfront').getAttribute('data-drop')).toBe('before');
    expect(blockOf('Workspace').getAttribute('data-drop')).toBeNull();
    expect(names()).toEqual(['Workspace', 'shopfront', 'ticketing']);
    ptr(window, 'pointerup', 105);
    expect(names()).toEqual(['Workspace', 'ticketing', 'shopfront']);
    expect(saved()).toEqual(['__workspace', TICK.toLowerCase(), SHOP.toLowerCase()]);
    expect(document.querySelector('[data-drop],[data-dragging]')).toBeNull();
  });

  it('the click that ends a drag does not fold the folder; a plain click still does', async () => {
    await three();
    const before = blockOf('ticketing').getAttribute('data-open');
    ptr(hitOf('ticketing'), 'pointerdown', 205);
    ptr(window, 'pointermove', 105);
    ptr(window, 'pointerup', 105);
    fireEvent.click(hitOf('ticketing'));
    expect(blockOf('ticketing').getAttribute('data-open')).toBe(before);
    /* Negative control: a press that never moved is a click. */
    await act(async () => void (await new Promise((r) => setTimeout(r, 80))));
    const open = blockOf('shopfront').getAttribute('data-open');
    ptr(hitOf('shopfront'), 'pointerdown', 105);
    ptr(window, 'pointerup', 105);
    fireEvent.click(hitOf('shopfront'));
    expect(blockOf('shopfront').getAttribute('data-open')).not.toBe(open);
  });

  it('nothing can be dropped above the Workspace, and the Workspace is not draggable', async () => {
    await three();
    ptr(hitOf('ticketing'), 'pointerdown', 205);
    ptr(window, 'pointermove', 2);
    ptr(window, 'pointerup', 2);
    expect(names()).toEqual(['Workspace', 'ticketing', 'shopfront']);
    ptr(hitOf('Workspace'), 'pointerdown', 5);
    ptr(window, 'pointermove', 250);
    expect(document.querySelector('[data-dragging]')).toBeNull();
    ptr(window, 'pointerup', 250);
    expect(names()).toEqual(['Workspace', 'ticketing', 'shopfront']);
  });

  it('Escape puts the drag down with nothing changed', async () => {
    await three();
    ptr(hitOf('ticketing'), 'pointerdown', 205);
    ptr(window, 'pointermove', 105);
    expect(blockOf('shopfront').getAttribute('data-drop')).toBe('before');
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(document.querySelector('[data-drop],[data-dragging]')).toBeNull();
    ptr(window, 'pointerup', 105);
    expect(names()).toEqual(['Workspace', 'shopfront', 'ticketing']);
  });

  it('Alt+Up and Alt+Down on a focused folder move it one place, keep focus on it, save it, and say so', async () => {
    await three();
    const t = hitOf('ticketing');
    t.focus();
    fireEvent.keyDown(t, { key: 'ArrowUp', altKey: true });
    expect(names()).toEqual(['Workspace', 'ticketing', 'shopfront']);
    expect(document.activeElement).toBe(hitOf('ticketing'));
    expect(saved()).toEqual(['__workspace', TICK.toLowerCase(), SHOP.toLowerCase()]);
    expect(document.querySelector('.s2-live-note')?.textContent).toMatch(/ticketing moved to position 2 of 3/);
    /* Up again at the top of the movable folders: nothing goes above the Workspace. */
    fireEvent.keyDown(hitOf('ticketing'), { key: 'ArrowUp', altKey: true });
    expect(names()).toEqual(['Workspace', 'ticketing', 'shopfront']);
    fireEvent.keyDown(hitOf('ticketing'), { key: 'ArrowDown', altKey: true });
    expect(names()).toEqual(['Workspace', 'shopfront', 'ticketing']);
    expect(document.activeElement).toBe(hitOf('ticketing'));
    /* Negative controls: the arrow without Alt moves nothing, and the Workspace cannot be moved. */
    fireEvent.keyDown(hitOf('ticketing'), { key: 'ArrowUp' });
    expect(names()).toEqual(['Workspace', 'shopfront', 'ticketing']);
    fireEvent.keyDown(hitOf('Workspace'), { key: 'ArrowDown', altKey: true });
    expect(names()).toEqual(['Workspace', 'shopfront', 'ticketing']);
  });
});

describe('item 4: chats are sorted by their last activity, newest first', () => {
  /* The same instant ordering that a string comparison gets wrong: +02:00 is two hours ahead of Z. */
  const older = chat('older', 'Older chat', 0, { updatedAt: '2026-10-06T09:00:00+02:00', createdAt: '2026-10-06T09:00:00+02:00' }); // 07:00Z
  const newer = chat('newer', 'Newer chat', 0, { updatedAt: '2026-10-06T08:00:00.000Z', createdAt: '2026-10-06T01:00:00.000Z' }); // 08:00Z
  const ids = (rows: readonly SessionIndexEntry[]) => rows.map((r) => r.id);

  it('orders on the instant, not on the spelling of the timestamp', () => {
    expect(ids(orderChats([older, newer]))).toEqual(['newer', 'older']);
    expect(ids(orderChats([newer, older]))).toEqual(['newer', 'older']);
  });

  it('uses last activity (updatedAt), not creation: an old chat that was written to leads a newer, idle one', () => {
    const idle = chat('idle', 'Idle', 0, { createdAt: at(20), updatedAt: at(20) });
    const worked = chat('worked', 'Worked', 0, { createdAt: at(1), updatedAt: at(22) });
    expect(ids(orderChats([idle, worked]))).toEqual(['worked', 'idle']);
  });

  it('a row with no usable updatedAt falls back to its creation time, and sorts after dated ones when it has neither', () => {
    const bare = chat('bare', 'Bare', 0, { updatedAt: '' as never, createdAt: at(21) });
    const none = chat('none', 'None', 0, { updatedAt: 'not a date' as never, createdAt: 'nor this' as never });
    const dated = chat('dated', 'Dated', 0, { createdAt: at(3), updatedAt: at(3) });
    expect(ids(orderChats([none, dated, bare]))).toEqual(['bare', 'dated', 'none']);
  });

  it('an agent run the page saw counts as activity even though the server did not stamp the chat', () => {
    const a = chat('a', 'A', 0, { updatedAt: at(10), createdAt: at(10) });
    const b = chat('b', 'B', 0, { updatedAt: at(12), createdAt: at(12) });
    expect(ids(orderChats([a, b]))).toEqual(['b', 'a']);
    expect(ids(orderChats([a, b], (id) => (id === 'a' ? Date.parse(at(15)) : 0)))).toEqual(['a', 'b']);
    /* Negative control: a run older than the stamp changes nothing. */
    expect(ids(orderChats([a, b], (id) => (id === 'a' ? Date.parse(at(5)) : 0)))).toEqual(['b', 'a']);
  });

  it('the sidebar draws a project\'s chats in that order', async () => {
    mount([section(SHOP, 'shopfront', [older, newer])], [chat('h1', 'Workspace notes', 5)]);
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(2));
    fireEvent.click(screen.getByLabelText('Unfold shopfront'));
    await waitFor(() => expect(screen.getAllByTestId('s2-session').filter((r) => r.getAttribute('data-workspace') === 'shopfront')).toHaveLength(2));
    expect(screen.getAllByTestId('s2-session').filter((r) => r.getAttribute('data-workspace') === 'shopfront').map((r) => r.getAttribute('data-session-id'))).toEqual(['newer', 'older']);
  });
});

describe('item 5: Pinned chats from every project, at the very top (and still in their projects)', () => {
  const rows = () => screen.getAllByTestId('s2-session');
  const inGroup = (id: string) => within(screen.getByTestId('s2-group-pinned')).queryAllByTestId('s2-session').filter((r) => r.getAttribute('data-session-id') === id);
  const catalogPinned = () => [
    section(SHOP, 'shopfront', [chat('s1', 'Rate limiting', 9, { pinned: true }), chat('s2', 'Orders health', 11)]),
    section(TICK, 'ticketing', [chat('t1', 'Seat holds', 14, { pinned: true }), chat('t2', 'Refunds', 12)]),
  ];
  const mountOpen = async (calls: Call[] = [], opened = vi.fn()) => {
    render(
      <StoreProvider store={createStore({})}>
        <SessionPanel client={wired(catalogPinned(), [chat('h1', 'Workspace notes', 5, { pinned: true })], calls)} onOpenProject={opened} onOpenWorkspace={() => undefined} />
      </StoreProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(3));
    for (const name of ['shopfront', 'ticketing']) fireEvent.click(screen.getByLabelText(`Unfold ${name}`));
    await waitFor(() => expect(screen.getAllByTestId('s2-session').length).toBeGreaterThanOrEqual(5));
    return opened;
  };

  it('a Pinned group sits above Workspaces and lists the pinned chats of every project, newest first', async () => {
    await mountOpen();
    const pinned = screen.getByTestId('s2-group-pinned');
    const projects = screen.getByTestId('s2-group-workspaces');
    expect(pinned.compareDocumentPosition(projects) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(pinned).getByTestId('s2-section-pinned').textContent).toContain('Pinned');
    expect(within(pinned).getAllByTestId('s2-session').map((r) => r.getAttribute('data-session-id'))).toEqual(['t1', 's1', 'h1']);
  });

  it('each pinned row names its project in muted text', async () => {
    await mountOpen();
    const tags = within(screen.getByTestId('s2-group-pinned')).getAllByTestId('s2-pinned-project').map((t) => t.textContent);
    expect(tags).toEqual(['ticketing', 'shopfront', 'Workspace']);
    expect(document.querySelector('.s2-pin-proj')?.className).toContain('s2-meta');
  });

  it('a pinned chat is in the Pinned group AND in its own project list: the same chat, one id', async () => {
    await mountOpen();
    for (const id of ['s1', 't1', 'h1']) {
      expect(inGroup(id)).toHaveLength(1);
      /* Two rows (Pinned + its project), both naming the one chat id. */
      expect(rows().filter((r) => r.getAttribute('data-session-id') === id)).toHaveLength(2);
    }
    for (const id of ['s2', 't2']) expect(rows().filter((r) => r.getAttribute('data-session-id') === id)).toHaveLength(1);
    const shop = screen.getAllByTestId('s2-project').find((p) => p.getAttribute('data-project') === 'shopfront')!;
    expect(within(shop).queryByTestId('s2-project-count')).toBeNull(); /* 10 chats or fewer: no count */
    expect(within(shop).getAllByTestId('s2-session').map((r) => r.getAttribute('data-session-id'))).toEqual(['s2', 's1']);
  });

  it('opening a pinned chat of another project opens that project on it; Unpin goes to that project\'s folder', async () => {
    const calls: Call[] = [];
    const opened = await mountOpen(calls);
    fireEvent.click(within(screen.getByTestId('s2-group-pinned')).getAllByTestId('s2-session')[0]!.querySelector('.s2-it-hit')!);
    expect(opened).toHaveBeenCalledWith(TICK, 't1');
    /* Two rows of the one chat now (Pinned and ticketing); the first is the Pinned row. */
    fireEvent.click(screen.getAllByLabelText('Actions for Seat holds')[0]!);
    fireEvent.click(await screen.findByText('Unpin'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/api/sessions/t1'))).toBe(true));
    const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/api/sessions/t1'))!;
    expect(put.body).toMatchObject({ pinned: false, repoPath: TICK });
  });

  it('with nothing pinned there is no Pinned group', async () => {
    mount([section(SHOP, 'shopfront', [chat('s1', 'Rate limiting', 9)])], [chat('h1', 'Workspace notes', 5)]);
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(2));
    expect(screen.queryByTestId('s2-group-pinned')).toBeNull();
  });
});

describe('review fixes (G9)', () => {
  const names = () => screen.getAllByTestId('s2-project').map((p) => p.getAttribute('data-project'));
  const hitOf = (name: string) => screen.getAllByTestId('s2-project').find((p) => p.getAttribute('data-project') === name)!.querySelector<HTMLElement>('[data-testid="s2-project-switch"]')!;
  const blockOf = (name: string) => screen.getAllByTestId('s2-project').find((p) => p.getAttribute('data-project') === name)!;
  const ptr = (target: EventTarget, type: string, y: number) => act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY: y })));
  let rect: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const i = [...document.querySelectorAll('.s2-proj-row')].indexOf(this);
      const top = i >= 0 ? i * 100 : 0;
      return { x: 0, y: top, top, left: 0, right: 200, bottom: top + 30, width: 200, height: i >= 0 ? 30 : 0, toJSON: () => ({}) } as DOMRect;
    });
  });
  afterEach(() => rect.mockRestore());

  it('Alt+Up on the top folder with no home Workspace in the list leaves it where it is (it used to drop to the bottom)', async () => {
    /* A repository is attached, so the home Workspace is not the open project and the catalog has no home entry. */
    const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail), persisted: null });
    const graph = { nodes: [{ id: 'svc:api', kind: 'service', label: 'api', files: [] }], edges: [], warnings: [] };
    store.dispatch({ type: 'repo/loaded', draft: { root: SHOP, repoName: 'shopfront', graph, summary: { nodes: 0, edges: 0 }, scannedAt: '2026-10-06T00:00:00.000Z' }, at: 0 } as never);
    render(
      <StoreProvider store={store}>
        <SessionPanel client={wired([section(TICK, 'ticketing', []), section('C:/work/billing', 'billing', [])], [chat('h1', 'Notes', 5)])} onOpenProject={() => undefined} onOpenWorkspace={() => undefined} />
      </StoreProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(3));
    expect(names()).toEqual(['shopfront', 'ticketing', 'billing']);
    const first = names()[0]!;
    hitOf(first).focus();
    fireEvent.keyDown(hitOf(first), { key: 'ArrowUp', altKey: true });
    expect(names()[0]).toBe(first);
  });

  it('the drop line over the Workspace\'s upper half is drawn on the folder after it, where the drop lands', async () => {
    mount([section(SHOP, 'shopfront', []), section(TICK, 'ticketing', []), section(HOME, 'Workspace', [], true)], [chat('h1', 'Workspace notes', 5)]);
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(3));
    ptr(hitOf('ticketing'), 'pointerdown', 205);
    ptr(window, 'pointermove', 5);
    expect(blockOf('Workspace').getAttribute('data-drop')).toBeNull();
    expect(blockOf('shopfront').getAttribute('data-drop')).toBe('before');
    ptr(window, 'pointerup', 5);
    expect(names()).toEqual(['Workspace', 'ticketing', 'shopfront']);
  });

  it('the drop line is drawn inside the folder\'s box (the section clips what is outside it)', () => {
    const css = cssRaw.replace(/\r\n/g, '\n');
    expect(css).toMatch(/\.s2-proj\[data-drop='before'\]::before \{\n  top: 0;/);
    expect(css).toMatch(/\.s2-proj\[data-drop='after'\]::before \{\n  bottom: 0;/);
  });

  it('a row menu closes when its sidebar scrolls, not when something else on the page does', async () => {
    mount([section(SHOP, 'shopfront', [chat('s1', 'Rate limiting', 9)])], [chat('h1', 'Workspace notes', 5)]);
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(2));
    const transcript = document.createElement('div');
    document.body.appendChild(transcript);
    fireEvent.click(screen.getByLabelText('Actions for Workspace notes'));
    await screen.findByRole('menu');
    act(() => void transcript.dispatchEvent(new Event('scroll')));
    expect(screen.queryByRole('menu')).not.toBeNull();
    act(() => void screen.getByTestId('s2-groups').dispatchEvent(new Event('scroll')));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    transcript.remove();
  });

  it('a failed Remove says so in one line, and a failed answer is not silent', async () => {
    const failing = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/recent') return new Response(JSON.stringify({ error: 'disk is read-only' }), { status: 500, headers: { 'content-type': 'application/json' } });
      if (url === '/api/sessions' && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ index: { version: 1, activeId: 'h1', sessions: [chat('h1', 'Workspace notes', 5)] }, scope: 'workspace', repos: [section(SHOP, 'shopfront', [])] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    render(
      <StoreProvider store={createStore({})}>
        <SessionPanel client={createSessionsClient(failing)} onOpenProject={() => undefined} onOpenWorkspace={() => undefined} />
      </StoreProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(2));
    fireEvent.contextMenu(screen.getAllByTestId('s2-project').find((p) => p.getAttribute('data-project') === 'shopfront')!.querySelector('.s2-proj-row')!);
    fireEvent.click(await screen.findByTestId('s2-project-menu-remove'));
    fireEvent.click(await screen.findByTestId('s2-confirm-remove-project-ok'));
    expect((await screen.findByTestId('s2-new-chat-note')).textContent).toMatch(/Could not remove shopfront.*disk is read-only/);
  });
});
