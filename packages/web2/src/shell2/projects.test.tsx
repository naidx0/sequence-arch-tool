import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoSessionsSection, SessionIndexEntry } from '@sequence/api-types';

import { createSessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider } from '../state';
import { buildProjects, orderWorkspaces, workspaceKey } from './projectList';
import { SessionPanel } from './SessionPanel';

/*
 * ROUND 7, B5 (Jaden, on the installed app): "Top left... It should just be
 * Sequence, and then the workspaces and the projects are on the side rail."
 * "It doesn't let you switch projects on the side rail... It should show all
 * your projects, like in Codex."
 * The list is the server's own answer (GET /api/sessions: `repos`, the
 * recent-repos catalog plus the home workspace; `index`, the active root's
 * chats). Nothing new is asked of the server.
 */

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

describe('buildProjects: every opened project, the current one first and marked', () => {
  it('lists the current project, then the catalog in its order, the home workspace last; a folder once', () => {
    const projects = buildProjects({
      repoPath: SHOP,
      repoName: 'shopfront',
      sessions: [chat('a', 'Rate limiting', 9), chat('b', 'Orders', 11), chat('w', 'wt', 12, { worktree: { branch: 'seq/x', path: 'p' } } as never)],
      repos: [section(HOME, 'Workspace', [chat('h', 'Notes', 1)], true), section(TICK, 'ticketing', [chat('t1', 'Seat holds', 3)]), section('c:\\work\\shopfront\\', 'shopfront', [])],
    });
    expect(projects.map((p) => p.name)).toEqual(['shopfront', 'ticketing', 'Workspace']);
    expect(projects.map((p) => p.current)).toEqual([true, false, false]);
    /* The current project's chats, newest first; its worktree chat goes under Worktrees. */
    expect(projects[0]!.chats.map((c) => c.id)).toEqual(['b', 'a']);
    expect(projects[2]!.home).toBe(true);
  });

  it('with no repository attached the home workspace IS the current project, listed once', () => {
    const projects = buildProjects({
      repoPath: null,
      repoName: null,
      sessions: [chat('h', 'Notes', 1)],
      repos: [section(HOME, 'Workspace', [chat('h', 'Notes', 1)], true), section(SHOP, 'shopfront', [chat('a', 'Rate', 2)])],
    });
    expect(projects.map((p) => [p.name, p.current, p.home])).toEqual([
      ['Workspace', true, true],
      ['shopfront', false, false],
    ]);
  });
});

function wired(repos: RepoSessionsSection[], index: SessionIndexEntry[], posts: { body: Record<string, unknown> }[] = []) {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/sessions' && init?.method === 'POST') {
      posts.push({ body: JSON.parse(String(init.body)) as Record<string, unknown> });
      const made = chat('new-1', 'New chat', 20);
      return new Response(JSON.stringify({ session: made, index: { version: 1, activeId: made.id, sessions: [made] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(input) === '/api/sessions' && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ index: { version: 1, activeId: index[0]?.id ?? '', sessions: index }, scope: 'workspace', repos }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return createSessionsClient(fetchImpl);
}

beforeEach(() => localStorage.clear());

describe('the sidebar: Sequence, then Workspaces, each with its chats under it', () => {
  function mount() {
    const opened = vi.fn();
    const openedHome = vi.fn();
    const posts: { body: Record<string, unknown> }[] = [];
    const client = wired(
      [section(SHOP, 'shopfront', [chat('s1', 'Rate limiting', 9), chat('s2', 'Orders health', 11)]), section(TICK, 'ticketing', [chat('t1', 'Seat holds', 3)])],
      [chat('h1', 'Workspace notes', 5)],
      posts,
    );
    render(
      <StoreProvider store={createStore({})}>
        <SessionPanel client={client} onOpenProject={opened} onOpenWorkspace={openedHome} />
      </StoreProvider>,
    );
    return { opened, openedHome, posts };
  }
  const projectRow = (name: string) => screen.getAllByTestId('s2-project').find((p) => p.getAttribute('data-project') === name)!;

  it('the title row reads just "Sequence", with no mark (round 8: "remove the icon to keep it simple")', () => {
    mount();
    const brand = screen.getByTestId('s2-brand');
    expect(brand.textContent).toBe('Sequence');
    expect(brand.querySelector('svg')).toBeNull();
    expect(brand.closest('.s2-ph')?.querySelector('.s2-logo')).toBeNull();
    /* The negative control: no project name in the title row any more. */
    expect(brand.closest('.s2-ph')?.textContent).not.toMatch(/Workspace|shopfront/);
  });

  it('one Workspaces tree: every folder (the home workspace too) with its chats under it, and no separate Chats section', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(3));
    expect(screen.getByTestId('s2-section-workspaces').textContent).toContain('Workspaces');
    expect(screen.queryByTestId('s2-group-chats')).toBeNull();
    expect(screen.queryByTestId('s2-group-projects')).toBeNull();
    expect(screen.getAllByTestId('s2-project').map((p) => p.getAttribute('data-project'))).toEqual(['Workspace', 'shopfront', 'ticketing']);
    /* Every folder has the same controls: a chevron, a name, its count, a "+". */
    for (const name of ['Workspace', 'shopfront', 'ticketing']) {
      const row = projectRow(name);
      expect(within(row).getByTestId('s2-project-fold')).toBeTruthy();
      expect(within(row).getByTestId('s2-project-new').getAttribute('aria-label')).toBe(`New chat in ${name}`);
    }
    /* The attached folder starts open, the rest closed; none is "primary" (no mark). */
    expect(projectRow('Workspace').getAttribute('data-open')).toBe('true');
    expect(within(projectRow('Workspace')).getByText('Workspace notes')).toBeTruthy();
    expect(projectRow('shopfront').getAttribute('data-open')).toBe('false');
    expect(within(projectRow('shopfront')).queryByText('Rate limiting')).toBeNull();
    expect(within(projectRow('shopfront')).queryByTestId('s2-project-count')).toBeNull(); /* 10 chats or fewer: no count */
    expect(document.querySelector('.s2-proj-dot')).toBeNull();
    /* No primary: no folder row is styled as the current one either. */
    expect(document.querySelector('.s2-ws-row.is-current')).toBeNull();
  });

  it('several folders are open at once, each fold is its own and remembered per workspace; clicking a folder attaches nothing', async () => {
    const { opened, openedHome } = mount();
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(3));
    fireEvent.click(within(projectRow('ticketing')).getByTestId('s2-project-fold'));
    fireEvent.click(within(projectRow('shopfront')).getByTestId('s2-project-switch'));
    expect(projectRow('ticketing').getAttribute('data-open')).toBe('true');
    expect(projectRow('shopfront').getAttribute('data-open')).toBe('true');
    expect(projectRow('Workspace').getAttribute('data-open')).toBe('true');
    expect(within(projectRow('shopfront')).getByText('Rate limiting')).toBeTruthy();
    expect(opened).not.toHaveBeenCalled();
    expect(openedHome).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('s2.projectsOpen') ?? '{}')).toMatchObject({ [TICK.toLowerCase()]: true, [SHOP.toLowerCase()]: true });
    /* Folding the attached one is its own too. */
    fireEvent.click(within(projectRow('Workspace')).getByTestId('s2-project-fold'));
    expect(projectRow('Workspace').getAttribute('data-open')).toBe('false');
    expect(projectRow('ticketing').getAttribute('data-open')).toBe('true');
    expect(JSON.parse(localStorage.getItem('s2.projectsOpen') ?? '{}')).toMatchObject({ __workspace: false });
  });

  it('what the reader saw stays: the open folder is written down, so it is still open when the engine moves elsewhere', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(3));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('s2.projectsOpen') ?? '{}')).toMatchObject({ __workspace: true, [SHOP.toLowerCase()]: false, [TICK.toLowerCase()]: false }));
    expect(localStorage.getItem('s2.workspaceOrder')).toContain('__workspace');
  });

  it('a chat in another workspace opens that workspace on that chat, and the click is seen to have landed', async () => {
    const { opened } = mount();
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(3));
    fireEvent.click(within(projectRow('ticketing')).getByTestId('s2-project-fold'));
    fireEvent.click(within(projectRow('ticketing')).getByText('Seat holds'));
    expect(opened).toHaveBeenCalledWith(TICK, 't1');
    expect(screen.getByTestId('s2-switching').textContent).toContain('ticketing');
  });

  it('New chat starts in the workspace of the open chat; a folder plus starts one in that folder', async () => {
    const { opened, posts } = mount();
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(3));
    /* The home workspace is the open one: the chat is made there, with no folder named. */
    fireEvent.click(screen.getByTestId('s2-new-chat'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toMatchObject({ mode: 'work' });
    expect(posts[0]!.body.repoPath).toBeUndefined();
    /* Another folder's plus makes the chat IN that folder and opens that folder on it. */
    fireEvent.click(within(projectRow('ticketing')).getByTestId('s2-project-new'));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]!.body).toMatchObject({ mode: 'code', repoPath: TICK });
    await waitFor(() => expect(opened).toHaveBeenCalledWith(TICK, 'new-1'));
  });

  it('New chat lands in the workspace of the chat that is open, even when that chat is a folder the engine is not on', async () => {
    const opened = vi.fn();
    const posts: { body: Record<string, unknown> }[] = [];
    const client = wired(
      [section(SHOP, 'shopfront', [chat('s1', 'Rate limiting', 9)]), section(TICK, 'ticketing', [chat('t1', 'Seat holds', 3)])],
      [chat('h1', 'Workspace notes', 5)],
      posts,
    );
    const store = createStore({});
    /* The reader opened ticketing's chat softly: its folder is the open workspace. */
    store.dispatch({ type: 'session/browse', activeId: 't1', turns: [], browseRepoPath: TICK });
    render(
      <StoreProvider store={store}>
        <SessionPanel client={client} onOpenProject={opened} onOpenWorkspace={vi.fn()} />
      </StoreProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(3));
    fireEvent.click(screen.getByTestId('s2-new-chat'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toMatchObject({ mode: 'code', repoPath: TICK });
    await waitFor(() => expect(opened).toHaveBeenCalledWith(TICK, 'new-1'));
  });

  it('the folders keep the order the reader met them in, whichever one the engine is on', () => {
    const nodes = buildProjects({ repoPath: TICK, repoName: 'ticketing', sessions: [], repos: [section(SHOP, 'shopfront', []), section(HOME, 'Workspace', [], true)] });
    expect(nodes.map((n) => n.name)).toEqual(['ticketing', 'shopfront', 'Workspace']);
    const saved = ['__workspace', SHOP.toLowerCase(), TICK.toLowerCase()];
    expect(orderWorkspaces(nodes, saved).map((n) => n.name)).toEqual(['Workspace', 'shopfront', 'ticketing']);
    /* Attach another one: the folders already seen stay put, the new one comes last. */
    const attachedShop = buildProjects({ repoPath: SHOP, repoName: 'shopfront', sessions: [], repos: [section(TICK, 'ticketing', []), section(HOME, 'Workspace', [], true), section('C:/work/new', 'new', [])] });
    expect(orderWorkspaces(attachedShop, saved).map(workspaceKey)).toEqual(['__workspace', SHOP.toLowerCase(), TICK.toLowerCase(), 'c:/work/new']);
  });
});
