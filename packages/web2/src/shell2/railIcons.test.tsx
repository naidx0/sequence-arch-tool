import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RepoSessionsSection, SessionIndexEntry } from '@sequence/api-types';

import { createSessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider } from '../state';
import type { ProjectNode } from './projectList';
import { ChatGlyph, chatAgent, projectGlyph, SessionPanel } from './SessionPanel';

/*
 * ROUND 8, item 3 (Jaden: the sidebar's icons must mean something; "don't use
 * the spark for everything"). A project row wears a repository or a folder
 * (a branch badge when it is a chat's worktree); a chat row wears its agent's
 * mark (Codex, Claude), the branch for a worktree chat, else the plain chat
 * bubble. The spark is the negative control: no row may draw it.
 */

const at = (h: number) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const chat = (id: string, title: string, h: number, extra: Record<string, unknown> = {}): SessionIndexEntry =>
  ({ id, title, createdAt: at(h), updatedAt: at(h), ...extra }) as SessionIndexEntry;
const node = (over: Partial<ProjectNode>): ProjectNode =>
  ({ key: 'k', path: 'C:/work/shop', name: 'shop', home: false, current: false, chats: [], section: null, ...over }) as ProjectNode;

describe('what a row is, from its own data', () => {
  it('a chat names its agent: the live run first, else the thread it kept on disk', () => {
    expect(chatAgent(chat('a', 'A', 1), undefined)).toBeNull();
    expect(chatAgent(chat('a', 'A', 1, { agentThreads: { codex: { id: 't', kind: 'acp', at: at(1) } } }), undefined)).toBe('codex');
    expect(chatAgent(chat('a', 'A', 1, { agentThreads: { codex: {} } }), { a: 'claude-code' })).toBe('claude-code');
  });

  it('draws the agent mark, the branch, or the chat bubble; never the spark', () => {
    const glyph = (entry: SessionIndexEntry, agent: string | null) => {
      const { container, unmount } = render(<ChatGlyph entry={entry} agent={agent} />);
      const out = { brand: container.querySelector('[data-brand]')?.getAttribute('data-brand') ?? null, icon: container.querySelector('svg')?.getAttribute('data-icon') ?? null };
      unmount();
      return out;
    };
    expect(glyph(chat('a', 'A', 1), 'codex').brand).toBe('codex');
    expect(glyph(chat('a', 'A', 1), 'claude-code').brand).toBe('claude');
    /* Round 9: no generic bubble; a chat with no agent or model is Sequence's own. */
    expect(glyph(chat('a', 'A', 1), null).brand).toBe('sequence');
    expect(glyph(chat('a', 'A', 1), null).icon).not.toBe('chat');
    expect(glyph(chat('a', 'A', 1, { worktree: { id: 'w', path: 'p', branch: 'sequence/x' } }), 'codex').icon).toBe('branch');
    for (const agent of [null, 'codex', 'claude', 'ollama', 'something']) expect(glyph(chat('a', 'A', 1), agent).icon).not.toBe('spark');
  });

  it('a project is a repository, a folder, or a worktree', () => {
    const none = new Set<string>();
    expect(projectGlyph(node({ home: true, path: null }), 'main', none)).toEqual({ icon: 'folder', worktree: false });
    expect(projectGlyph(node({ current: true }), 'main', none).icon).toBe('folder');
    expect(projectGlyph(node({ current: true }), null, none).icon).toBe('folder');
    expect(projectGlyph(node({}), null, none).icon).toBe('folder');
    expect(projectGlyph(node({ path: 'C:\\data\\worktrees\\ab12\\' }), null, new Set(['c:/data/worktrees/ab12'])).worktree).toBe(true);
  });
});

describe('the sidebar draws them', () => {
  beforeEach(() => localStorage.clear());

  it('rows carry their meaning, and no row in the panel draws the spark', async () => {
    const repos: RepoSessionsSection[] = [
      { path: 'C:/work/shop', name: 'shop', index: { version: 1, activeId: 's1', sessions: [chat('s1', 'Rate limiting', 9)] } },
    ];
    const index = [chat('h1', 'Notes', 5), chat('h2', 'Codex run', 6, { agentThreads: { codex: { id: 't', kind: 'acp', at: at(6) } } })];
    const fetchImpl = (async (input: RequestInfo | URL) =>
      String(input) === '/api/sessions'
        ? new Response(JSON.stringify({ index: { version: 1, activeId: 'h1', sessions: index }, scope: 'workspace', repos }), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response('{}', { status: 404 })) as typeof fetch;
    render(
      <StoreProvider store={createStore({})}>
        <SessionPanel client={createSessionsClient(fetchImpl)} />
      </StoreProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(2));
    const shop = screen.getAllByTestId('s2-project').find((p) => p.getAttribute('data-project') === 'shop')!;
    expect(shop.querySelector('.s2-proj-row')?.getAttribute('data-glyph')).toBe('folder');
    const home = screen.getAllByTestId('s2-project').find((p) => p.getAttribute('data-project') === 'Workspace')!;
    expect(home.querySelector('.s2-proj-row')?.getAttribute('data-glyph')).toBe('folder');
    /* The home workspace is the attached one here, so it starts open with its chats under it. */
    await waitFor(() => expect(within(home).getAllByTestId('s2-session')).toHaveLength(2));
    const rows = within(home).getAllByTestId('s2-session');
    const codex = rows.find((r) => r.textContent?.includes('Codex run'))!;
    expect(codex.querySelector('.s2-rail-ic [data-brand]')?.getAttribute('data-brand')).toBe('codex');
    const plain = rows.find((r) => r.textContent?.includes('Notes'))!;
    expect(plain.querySelector('.s2-rail-ic [data-brand]')?.getAttribute('data-brand')).toBe('sequence');
    expect(screen.getByTestId('s2-panel').querySelector('[data-icon="chat"]')).toBeNull();
    expect(screen.getByTestId('s2-panel').querySelector('[data-icon="spark"]')).toBeNull();
  });
});
