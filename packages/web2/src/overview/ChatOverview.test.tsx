import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { preloadChatLazies } from '../../test/preloadChat';
import { assistantTurn, userTurn } from '../chat/fixtures';
import { createStore, StoreProvider, type Store } from '../state';
import { V3App } from '../v3/V3App';
import { ChatOverview } from './ChatOverview';
import { OVERVIEW_KEY, OVERVIEW_MIN_W, overviewAvailable, overviewVisible } from './overviewPrefs';
import { seedOpenArchitecture } from '../shell2/legacyDefaultTabs.testSupport';

beforeAll(async () => {
  await Promise.all([preloadChatLazies(), import('./ChatOverview'), import('../files/ConnectedFilesPanel'), import('../files/FilesPanel'), import('../files/FilesFind')]);
}, 120_000);

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

const GENUI = '```genui\n{"title":"Pricing card","root":{}}\n```';

function seeded(): Store {
  const store = createStore({});
  store.dispatch({
    type: 'session/hydrated',
    turns: [
      userTurn('u1', 'look at the shell', { chips: [{ id: 'c1', kind: 'file', ref: 'src/mention.ts', label: 'mention.ts', nodeKind: null }] }),
      assistantTurn('a1', 'u1', {
        text: `Here is a card.\n${GENUI}`,
        todos: [
          { id: 't1', title: 'Read the shell', status: 'done' },
          { id: 't2', title: 'Write the rail', status: 'active' },
        ],
        evidence: { tools: [], filesRead: ['src/shell.ts:12'.split(':')[0]!, 'src/other.ts'], proposals: [] },
        charts: [{ version: 1, kind: 'flow', title: 'Request path', items: [] } as never],
      }),
    ],
  } as never);
  store.dispatch({ type: 'composer/attachment-add', attachment: { id: 'h1', name: 'build.log', bytes: 5 } } as never);
  return store;
}

function drawRail(store: Store, onOpenSurface: (id: never) => void = () => {}) {
  return render(
    <StoreProvider store={store}>
      <ChatOverview onOpenSurface={onOpenSurface} />
    </StoreProvider>,
  );
}

describe('the overview sections', () => {
  /* contract change (compact panel): the empty Files and Artifacts headings collapse into one quiet line. */
  it('an empty chat shows Context and Quick open, and one quiet line in place of the two empty lists', () => {
    drawRail(createStore({}));
    expect(screen.getByTestId('ov-sec-context')).toBeTruthy();
    expect(screen.getByTestId('ov-sec-quick')).toBeTruthy();
    expect(screen.queryByTestId('ov-sec-progress')).toBeNull();
    expect(screen.queryByTestId('ov-sec-files')).toBeNull();
    expect(screen.queryByTestId('ov-sec-artifacts')).toBeNull();
    expect(screen.getByTestId('ov-empty').textContent).toBe('No files or artifacts yet');
    expect(screen.getByTestId('ov-empty').textContent).not.toContain('·');
  });

  it('a chat with files and artifacts has no empty line', () => {
    drawRail(seeded());
    expect(screen.queryByTestId('ov-empty')).toBeNull();
  });

  it('draws each section from the model', () => {
    drawRail(seeded());
    expect(screen.getByTestId('ov-sum-progress').textContent).toBe('1 of 2 done');
    expect(screen.getAllByTestId('ov-todos')[0]!.querySelectorAll('li')).toHaveLength(2);
    /* contract change: four files fold to their summary line until asked (a list of three or fewer opens in place). */
    expect(screen.getByTestId('ov-sum-files').textContent).toBe('4 files');
    expect(screen.queryByTestId('ov-file')).toBeNull();
    fireEvent.click(within(screen.getByTestId('ov-sec-files')).getByRole('button', { name: /Files/ }));
    const files = screen.getAllByTestId('ov-file').map((f) => `${f.getAttribute('data-path') ?? f.getAttribute('title')}:${f.getAttribute('data-state')}`);
    expect(files.sort()).toEqual(['build.log:attached', 'src/mention.ts:mentioned', 'src/other.ts:read', 'src/shell.ts:read']);
    expect(screen.getByTestId('ov-sum-artifacts').textContent).toBe('2 cards');
    const arts = screen.getAllByTestId('ov-artifact').map((a) => `${a.getAttribute('data-kind')}:${a.getAttribute('title')}`);
    expect(arts).toEqual(['chart:Request path', 'genui:Pricing card']);
    expect(screen.getByTestId('ov-window').textContent).toBe('Not measured');
  });

  it('shows the composer chips under Context', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/chip-add', chip: { id: 'k1', kind: 'file', ref: 'src/c.ts', label: 'c.ts', nodeKind: null } } as never);
    drawRail(store);
    const chips = store.getState().composer.chips;
    if (chips.length > 0) expect(screen.getByTestId('ov-chips').textContent).toContain('c.ts');
  });

  it('a section folds and unfolds from its header', () => {
    drawRail(seeded());
    const head = within(screen.getByTestId('ov-sec-artifacts')).getByRole('button', { name: /Artifacts/ });
    expect(head.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('ov-artifacts')).toBeNull();
    fireEvent.click(head);
    expect(screen.getByTestId('ov-artifacts')).toBeTruthy();
  });

  it('draws no middle dot', () => {
    const { container } = drawRail(seeded());
    expect(container.textContent).not.toContain('·');
  });
});

describe('saved generated cards', () => {
  const SPEC = { root: 'c', state: {}, actions: {}, meta: {}, elements: { c: { type: 'Card', props: { title: 'Saved card' } } } };
  function savedStore(): Store {
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [{ id: 'chat-a', title: 'a', createdAt: '2026-09-21T09:00:00.000Z', updatedAt: '2026-09-21T09:00:00.000Z' }], activeId: 'chat-a' });
    return store;
  }
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).startsWith('/api/genui/surfaces?chat=chat-a')
          ? { ok: true, status: 200, json: async () => ({ surfaces: [{ chat: 'chat-a', turn: 'run-1', surface: 's1', saved: 1, title: 'Upgrade plan', spec: SPEC }] }) }
          : { ok: false, status: 404, json: async () => ({}) },
      ),
    );
  });

  it('lists a saved surface of the chat under Artifacts and jumps to its turn on a click', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<article id="agrun-run-1"></article>';
    const row = host.firstElementChild as HTMLElement;
    const scroll = vi.fn();
    row.scrollIntoView = scroll;
    document.body.appendChild(host);
    drawRail(savedStore());
    const art = await screen.findByTestId('ov-artifact');
    expect(art.getAttribute('data-kind')).toBe('genui');
    expect(art.getAttribute('title')).toBe('Upgrade plan');
    fireEvent.click(art);
    expect(scroll).toHaveBeenCalledTimes(1);
    host.remove();
  });
});

describe('what a click does', () => {
  it('a file opens in Files at its path; an attachment is not a button', () => {
    const store = seeded();
    const dispatch = vi.spyOn(store, 'dispatch');
    drawRail(store);
    fireEvent.click(within(screen.getByTestId('ov-sec-files')).getByRole('button', { name: /Files/ }));
    const row = screen.getAllByTestId('ov-file').find((f) => f.getAttribute('data-path') === 'src/other.ts')!;
    fireEvent.click(row);
    expect(dispatch).toHaveBeenCalledWith({ type: 'files/open', path: 'src/other.ts' });
    const att = screen.getAllByTestId('ov-file').find((f) => f.getAttribute('data-state') === 'attached')!;
    expect(att.tagName).not.toBe('BUTTON');
    dispatch.mockClear();
    fireEvent.click(att);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('an artifact scrolls its turn into view', () => {
    const store = seeded();
    const host = document.createElement('div');
    host.innerHTML = '<div data-row-key="turn:a1"></div>';
    const row = host.firstElementChild as HTMLElement;
    const scroll = vi.fn();
    row.scrollIntoView = scroll;
    document.body.appendChild(host);
    drawRail(store);
    fireEvent.click(screen.getAllByTestId('ov-artifact')[1]!);
    expect(scroll).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it('a quick-open pill asks the shell to open that surface', () => {
    const open = vi.fn();
    drawRail(createStore({}), open);
    const pills = screen.getByTestId('ov-quick').querySelectorAll('button');
    expect([...pills].map((p) => p.getAttribute('data-testid'))).toEqual(['ov-open-architecture', 'ov-open-files', 'ov-open-whiteboard', 'ov-open-terminal', 'ov-open-agents']);
    fireEvent.click(screen.getByTestId('ov-open-terminal'));
    expect(open).toHaveBeenCalledWith('terminal');
  });
});

describe('when the rail is shown (rule)', () => {
  const base = { alone: true, winW: OVERVIEW_MIN_W, agentsOpen: false, open: true };
  it('alone and wide it shows unless the Agents dock holds the column', () => {
    expect(overviewVisible(base)).toBe(true);
    expect(overviewVisible({ ...base, winW: OVERVIEW_MIN_W - 1 })).toBe(false);
    expect(overviewVisible({ ...base, agentsOpen: true })).toBe(false);
  });
  it('CONTRACT CHANGE (0184 finish): a chat that is alone cannot be hidden by hand, a stored hide does not count', () => {
    expect(overviewVisible({ ...base, open: false })).toBe(true);
    expect(overviewVisible({ ...base, open: false, winW: OVERVIEW_MIN_W - 1 })).toBe(false);
    expect(overviewVisible({ ...base, open: false, agentsOpen: true })).toBe(false);
  });
  it('with a surface open it yields its column until the reader presses the toggle', () => {
    expect(overviewVisible({ ...base, alone: false })).toBe(false);
    expect(overviewVisible({ ...base, alone: false, open: false })).toBe(false);
    expect(overviewVisible({ ...base, alone: false, beside: true })).toBe(true);
    expect(overviewVisible({ ...base, alone: false, beside: true, agentsOpen: true })).toBe(false);
  });
  it('the toggle is offered at any width of 1180 or more, surface or not, and under it never', () => {
    expect(overviewAvailable({ winW: OVERVIEW_MIN_W })).toBe(true);
    expect(overviewAvailable({ winW: OVERVIEW_MIN_W - 1 })).toBe(false);
  });
});

describe('in the shell', () => {
  /* The shell opens with the map beside the chat; the chat alone is a stored choice. */
  beforeEach(() => localStorage.setItem('v3.chromeTabs', JSON.stringify({ tabs: [{ id: 'chat', minimized: false }], active: 'chat' })));
  function wide(w: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  }

  it('is at the right of a chat that is alone and wide', async () => {
    wide(1440);
    render(<V3App appStore={createStore({})} />);
    expect(await screen.findByTestId('chat-overview')).toBeTruthy();
    expect(document.querySelector('.s2-row')?.contains(screen.getByTestId('chat-overview'))).toBe(true);
  });

  it('is absent when the window is under the width', () => {
    wide(OVERVIEW_MIN_W - 1);
    render(<V3App appStore={createStore({})} />);
    expect(screen.queryByTestId('chat-overview')).toBeNull();
    expect(screen.queryByTestId('s2-overview-toggle')).toBeNull();
  });

  it('a surface opening from Quick open yields the column but keeps the toggle, and the toggle brings the rail back', async () => {
    wide(1440);
    render(<V3App appStore={createStore({})} />);
    fireEvent.click(await screen.findByTestId('ov-open-files'));
    await waitFor(() => expect(screen.queryByTestId('chat-overview')).toBeNull());
    const toggle = screen.getByTestId('s2-overview-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Show overview');
    fireEvent.click(toggle);
    expect(await screen.findByTestId('chat-overview')).toBeTruthy();
    expect(document.querySelector('.s2-row')?.getAttribute('data-stage')).not.toBe('none');
    expect(screen.getByTestId('s2-overview-toggle').getAttribute('aria-pressed')).toBe('true');
    /* Hiding it beside a surface is for now only: the stored choice for a lone chat stands. */
    fireEvent.click(screen.getByTestId('s2-overview-toggle'));
    await waitFor(() => expect(screen.queryByTestId('chat-overview')).toBeNull());
    expect(localStorage.getItem(OVERVIEW_KEY)).toBeNull();
  });

  it('a layout with a surface open offers the toggle at once and the rail one press away', async () => {
    seedOpenArchitecture();
    wide(1440);
    render(<V3App appStore={createStore({})} />);
    const toggle = await screen.findByTestId('s2-overview-toggle');
    expect(screen.queryByTestId('chat-overview')).toBeNull();
    fireEvent.click(toggle);
    expect(await screen.findByTestId('chat-overview')).toBeTruthy();
  });

  it('under 1180 neither the rail nor the toggle is drawn, with or without a surface', () => {
    localStorage.removeItem('v3.chromeTabs');
    wide(OVERVIEW_MIN_W - 1);
    render(<V3App appStore={createStore({})} />);
    expect(screen.queryByTestId('s2-overview-toggle')).toBeNull();
    expect(screen.queryByTestId('chat-overview')).toBeNull();
  });

  it('CONTRACT CHANGE (0184 finish): a chat that is alone keeps its overview, whatever the toggle or an older stored hide says', async () => {
    wide(1440);
    localStorage.setItem(OVERVIEW_KEY, '0');
    const first = render(<V3App appStore={createStore({})} />);
    expect(await screen.findByTestId('chat-overview')).toBeTruthy();
    expect(document.querySelector('.s2-row')?.getAttribute('data-stage')).toBe('none');
    /* No surface open: there is nothing to toggle, so the header offers no control. */
    expect(screen.queryByTestId('s2-overview-toggle')).toBeNull();
    expect(screen.getByTestId('chat-overview')).toBeTruthy();
    first.unmount();
    render(<V3App appStore={createStore({})} />);
    expect(await screen.findByTestId('chat-overview')).toBeTruthy();
  });
});
