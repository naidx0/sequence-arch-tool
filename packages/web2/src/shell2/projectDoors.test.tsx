import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createStore, StoreProvider } from '../state';
import { V3App } from '../v3/V3App';
import { SessionPanel } from './SessionPanel';
import { openRepoSession } from '../sessions/openRepoSession';
import { startChatWorktree } from '../worktree/newChatWorktree';
import { createNewChat } from '../v3/sessionActions';

vi.mock('../sessions/openRepoSession', () => ({
  openRepoSession: vi.fn(async () => ({ outcome: 'error', message: 'Folder is missing' })),
  openWorkspaceSession: vi.fn(async () => ({ outcome: 'error', message: 'Workspace is unavailable' })),
}));
vi.mock('../worktree/newChatWorktree', () => ({ startChatWorktree: vi.fn(async () => ({ kind: 'error', text: 'Git is unavailable' })) }));
vi.mock('../v3/sessionActions', async (original) => ({ ...await original<object>(), createNewChat: vi.fn(async () => ({ outcome: 'ok', sessionId: 'new-tree-chat' })) }));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/sessions') return new Response(JSON.stringify({
      index: { version: 1, activeId: 'home', sessions: [] }, scope: 'workspace',
      repos: [{ path: 'C:/test/project', name: 'project', index: { version: 1, activeId: 'project-chat', sessions: [{ id: 'project-chat', title: 'Project chat' }] } }],
    }));
    return new Promise<Response>(() => {});
  }));
});
afterEach(() => { vi.unstubAllGlobals(); document.documentElement.setAttribute('data-theme', 'dark'); });

it('keeps the pre-paint light selection when the app mounts', () => {
  localStorage.setItem('seq.theme', 'light');
  document.documentElement.setAttribute('data-theme', 'light');
  render(<V3App appStore={createStore({})} />);
  expect(document.documentElement.getAttribute('data-theme')).toBe('light');
});

it('reports a refused project switch in the workspace, with retry', async () => {
  render(<V3App appStore={createStore({})} />);
  /* A folder opens by a click and attaches nothing; the chat inside it is what opens the project. */
  const project = await screen.findByText('project');
  fireEvent.click(project.closest('button')!);
  fireEvent.click(await screen.findByText('Project chat'));
  expect((await screen.findByTestId('s2-project-error')).textContent).toContain('Folder is missing');
  fireEvent.click(screen.getByRole('button', { name: 'Retry opening' }));
  await waitFor(() => expect(openRepoSession).toHaveBeenCalledTimes(2));
});

it('offers the first worktree in an attached project with none and reports creation refusal', async () => {
  const seed = createStore({}).getState();
  const store = createStore({ hydrate: { ...seed, repo: {
    phase: 'attached', repo: { root: 'C:/test/project', repoName: 'project' },
  } as typeof seed.repo } });
  render(<StoreProvider store={store}><SessionPanel /></StoreProvider>);
  const group = screen.getByTestId('s2-group-worktrees');
  fireEvent.click(within(group).getByRole('button', { name: 'New chat in a worktree' }));
  await waitFor(() => expect(startChatWorktree).toHaveBeenCalledWith(store, 'new-tree-chat'));
  expect(createNewChat).toHaveBeenCalledTimes(1);
  expect((await screen.findByTestId('s2-new-chat-note')).textContent).toContain('Git is unavailable');
});
