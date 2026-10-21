import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILTIN_PROGRAMS } from '@sequence/schema';

import { launchAndWatch } from '../activity/liveRun';
import { createSessionsClient } from '../sessions/sessionsClient';
import { SessionPanel } from '../shell2/SessionPanel';
import { StoreProvider } from '../state/connect';
import { createStore } from '../state/store';
import { resetProfiles } from '../chat/agentProfiles';
import menuCss from '../shell2/modelMenu.css?raw';
import cssRaw from './sectionRail.css?raw';
import chatSrc from '../v3/V3Chat.tsx?raw';
import railLists from './RailLists.tsx?raw';
import railActions from './railActions.ts?raw';

vi.mock('../activity/liveRun', async (orig) => ({ ...(await orig<typeof import('../activity/liveRun')>()), launchAndWatch: vi.fn(async () => ({ ok: true as const, runId: 'r1' })) }));

beforeEach(() => {
  resetProfiles();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const ml = ['be-ambitious', 'rea', 'rsi-anything'].map((id) => ({ id, name: id, blurb: `${id} blurb` }));
const core = Array.from({ length: 7 }, (_, i) => ({ id: `core-${i}`, name: `Core ${i}`, blurb: 'core blurb' }));
const LISTING = {
  enabled: true,
  mode: 'approve',
  groups: [
    { id: 'core', name: 'Core', blurb: '', components: core },
    { id: 'ml', name: 'Machine learning and research', blurb: '', components: ml },
    { id: 'empty', name: 'Nothing here', blurb: '', components: [] },
  ],
};
const PROFILES = { profiles: [{ name: 'review', description: 'Reads the diff', prompt: 'p', readOnly: true, source: 'builtin', format: 'builtin' }] };
const SAVED = { workflows: [{ id: 'wf1', name: 'My loop', blocks: [], program: { nodes: [], edges: [] }, valid: true, errors: [], notes: [] }] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function makeFetch(over: Record<string, () => Response> = {}) {
  const calls: string[] = [];
  const f = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    for (const [k, v] of Object.entries(over)) if (url.startsWith(k)) return v();
    if (url === '/api/components') return json(LISTING);
    if (url.startsWith('/api/components/')) return json({ id: 'rsi-anything', name: 'rsi-anything', blurb: 'b', source: 'bundled', license: 'MIT', installed: true, inWorkspace: false, status: 'ready', body: Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n') });
    if (url === '/api/acp/profiles') return json(PROFILES);
    if (url === '/api/workflows') return json(SAVED);
    return new Response('{}', { status: 404 });
  });
  return { f: f as unknown as typeof fetch, calls };
}

function mount(fetchImpl: typeof fetch) {
  const store = createStore({});
  const client = createSessionsClient((async () => new Response('{}', { status: 404 })) as typeof fetch);
  render(
    <StoreProvider store={store}>
      <SessionPanel client={client} skillsSource={async () => null} railFetch={fetchImpl} />
    </StoreProvider>,
  );
  return { store };
}

const open = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('Components in the rail', () => {
  it('lists the catalog by group with a count, including the ML and research group; empty groups are not drawn', async () => {
    const { f, calls } = makeFetch();
    mount(f);
    open('Components');
    const heads = await screen.findAllByTestId('rail-group-head');
    expect(calls).toContain('/api/components');
    expect(heads.map((h) => h.textContent)).toEqual(['Core7', 'Machine learning and research3']);
    for (const id of ['be-ambitious', 'rea', 'rsi-anything']) expect(screen.getByText(id)).toBeTruthy();
  });

  it('more than 8 items brings a filter that finds rsi-anything', async () => {
    const { f } = makeFetch();
    mount(f);
    open('Components');
    const filter = await screen.findByRole('searchbox', { name: 'Filter components' });
    fireEvent.change(filter, { target: { value: 'rsi' } });
    expect(screen.getAllByTestId('rail-component').map((r) => r.getAttribute('data-component'))).toEqual(['rsi-anything']);
    fireEvent.change(filter, { target: { value: 'zzz' } });
    expect(screen.getByTestId('rail-empty').textContent).toBe('No component matches \u201Czzz\u201D.');
  });

  it('a click opens a short scrolling detail, and Use adds the same chip the composer picker adds', async () => {
    const { f } = makeFetch();
    /* contract change: the rail draws the shared ComponentDetail (components/), which reads through the page's fetch. */
    vi.stubGlobal('fetch', f);
    const { store } = mount(f);
    open('Components');
    fireEvent.click(await screen.findByRole('button', { name: /rsi-anything/ }));
    const body = await screen.findByTestId('component-detail-scroll');
    expect(body.className).toContain('s2-comp-detail-body');
    expect(/\.s2-comp-detail-body\s*\{[^}]*max-height:[^;]+;[^}]*overflow-y:\s*auto/.test(menuCss)).toBe(true);
    await waitFor(() => expect(body.textContent).toContain('line 79'));
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    expect(store.getState().composer.chips).toEqual([{ id: 'component:rsi-anything', kind: 'component', ref: 'rsi-anything', label: 'rsi-anything', nodeKind: null }]);
  });

  it('a component row is one line: the name, the definition cut with an ellipsis, the whole text in the title', async () => {
    mount(makeFetch().f);
    open('Components');
    const rows = await screen.findAllByTestId('rail-component');
    const row = rows.find((r) => r.getAttribute('data-component') === 'rsi-anything')!;
    expect(row.classList.contains('rail-item-line')).toBe(true);
    expect(row.getAttribute('title')).toBe('rsi-anything blurb');
    expect(row.querySelector('[data-testid="rail-component-def"]')!.textContent).toBe('rsi-anything blurb');
    expect(/\.rail-item-def\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap/.test(cssRaw)).toBe(true);
    expect(/\.rail-list\s*\{[^}]*overflow-y:\s*auto/.test(cssRaw)).toBe(true);
  });

  it('the definition opens in a flyout in the body portal, not in the list; Escape or an outside press closes it and focus returns to the row', async () => {
    const { f } = makeFetch();
    vi.stubGlobal('fetch', f);
    mount(f);
    open('Components');
    const row = (await screen.findAllByTestId('rail-component')).find((r) => r.getAttribute('data-component') === 'rsi-anything')!;
    const list = screen.getByTestId('rail-list');
    const rowsBefore = list.querySelectorAll('[data-testid="rail-component"]').length;
    const childrenBefore = list.querySelectorAll('*').length;
    fireEvent.click(row);
    const detail = await screen.findByTestId('component-detail');
    const root = detail.closest('[data-testid="rail-pop-root"]');
    expect(root).toBeTruthy();
    expect(root!.parentElement).toBe(document.body);
    expect(list.contains(detail)).toBe(false);
    expect(list.querySelectorAll('*').length).toBe(childrenBefore);
    expect(list.querySelectorAll('[data-testid="rail-component"]').length).toBe(rowsBefore);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    /* focus moves in */
    const dialog = screen.getByRole('dialog', { name: 'rsi-anything definition' });
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    /* Escape closes it and returns focus to the row */
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByTestId('component-detail')).toBeNull();
    expect(document.activeElement).toBe(row);
    expect(row.getAttribute('aria-expanded')).toBe('false');
    /* an outside press closes it too, and does not pull focus */
    fireEvent.click(row);
    await screen.findByTestId('component-detail');
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('component-detail')).toBeNull();
    /* the row toggles it */
    fireEvent.click(row);
    await screen.findByTestId('component-detail');
    fireEvent.click(row);
    expect(screen.queryByTestId('component-detail')).toBeNull();
  });

  it('Close in the flyout and Use both close it; Use adds the chip', async () => {
    const { f } = makeFetch();
    vi.stubGlobal('fetch', f);
    const { store } = mount(f);
    open('Components');
    fireEvent.click(await screen.findByRole('button', { name: /rsi-anything/ }));
    fireEvent.click(await screen.findByTestId('component-detail-back'));
    expect(screen.queryByTestId('component-detail')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /rsi-anything/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use' }));
    expect(screen.queryByTestId('component-detail')).toBeNull();
    expect(store.getState().composer.chips).toHaveLength(1);
  });

  it('says so honestly when the engine has no components, or they are off', async () => {
    mount(makeFetch({ '/api/components': () => new Response('{}', { status: 404 }) }).f);
    open('Components');
    expect((await screen.findByRole('alert')).textContent).toBe('Components could not be loaded. The engine did not answer.');
    cleanup();
    mount(makeFetch({ '/api/components': () => json({ ...LISTING, enabled: false }) }).f);
    open('Components');
    expect((await screen.findByTestId('rail-empty')).textContent).toBe('Components are off. Turn them on with /components on.');
    cleanup();
    mount(makeFetch({ '/api/components': () => json({ ...LISTING, groups: [] }) }).f);
    open('Components');
    expect((await screen.findByTestId('rail-empty')).textContent).toBe('No components in this workspace yet.');
  });
});

describe('the component chip is added in one place', () => {
  it('only railActions dispatches it; the picker and the rail both call addComponentChip', () => {
    const makes = (src: string) => src.split("kind: 'component'").length - 1;
    expect(makes(railActions)).toBe(1);
    expect(makes(chatSrc)).toBe(0);
    expect(makes(railLists)).toBe(0);
    expect(chatSrc).toContain('addComponentChip(store, entry)');
    expect(railLists).toContain('addComponentChip(store,');
  });
});

describe('Agent profiles in the rail', () => {
  it('picking one puts @name at the start of the next message', async () => {
    const { f, calls } = makeFetch();
    const { store } = mount(f);
    open('Agent profiles');
    fireEvent.click(await screen.findByRole('button', { name: /review/ }));
    expect(calls).toContain('/api/acp/profiles');
    await waitFor(() => expect(store.getState().composer.draft).toBe('@review '));
  });

  it('an unreachable engine reads as an error, none defined reads as empty', async () => {
    mount(makeFetch({ '/api/acp/profiles': () => new Response('{}', { status: 500 }) }).f);
    open('Agent profiles');
    expect((await screen.findByRole('alert')).textContent).toBe('Agent profiles could not be loaded. The engine did not answer.');
    cleanup();
    resetProfiles();
    mount(makeFetch({ '/api/acp/profiles': () => json({ profiles: [] }) }).f);
    open('Agent profiles');
    expect((await screen.findByTestId('rail-empty')).textContent).toBe('No agent profiles yet. Add one in .sequence/agents.');
  });
});

describe('Workflows in the rail', () => {
  it('lists the premade programs and the saved ones; Launch on a preview calls launchAndWatch', async () => {
    const { f } = makeFetch();
    mount(f);
    open('Workflows');
    await screen.findByText('My loop');
    expect(screen.getAllByTestId('rail-builtin')).toHaveLength(BUILTIN_PROGRAMS.length);
    const row = screen.getAllByTestId('rail-builtin')[0]!;
    act(() => row.focus());
    fireEvent.focus(row);
    fireEvent.click(await screen.findByTestId('wfp-launch'));
    await waitFor(() => expect(launchAndWatch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(launchAndWatch).mock.calls[0]![1]).toMatchObject({ nodes: expect.any(Array) });
  });

  it('a failed saved read keeps the premade list and says the saved ones did not load', async () => {
    mount(makeFetch({ '/api/workflows': () => new Response('{}', { status: 500 }) }).f);
    open('Workflows');
    expect((await screen.findByRole('alert')).textContent).toBe('Saved workflows could not be loaded.');
    expect(screen.getAllByTestId('rail-builtin')).toHaveLength(BUILTIN_PROGRAMS.length);
  });
});

describe('every list scrolls inside the rail', () => {
  it('the list has an overflow rule and no copy carries a middle dot', () => {
    expect(/\.rail-list\s*\{[^}]*overflow-y:\s*auto/.test(cssRaw)).toBe(true);
    expect(cssRaw).not.toContain('\u00B7');
  });
});
