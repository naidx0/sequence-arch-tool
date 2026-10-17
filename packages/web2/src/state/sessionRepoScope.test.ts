/**
 * A DIFFERENT REPOSITORY IS A DIFFERENT CONVERSATION.
 *
 * Measured 2026-08-29: with the app attached to repo A (a session with turns
 * on screen), attaching repo B through the dialog left repo A's transcript
 * standing in repo B's workspace — under a "reloaded from the saved session"
 * banner, showing questions asked about A. The server had already switched
 * (sessions, chat memory and the canvas doc are all keyed by the attached
 * root); only the client store kept talking.
 *
 * The other half of the same coin must NOT change: `repo/loaded` also lands on
 * every rescan of the SAME repository (stale → rebase after an accepted edit),
 * and wiping the conversation because the user accepted an edit would be a
 * worse bug than the one this fixes.
 */
import { describe, expect, it } from 'vitest';

import { createStore } from './store';
import type { Turn } from './types';
import { seqdFromGraph } from '../canvas/seqdFromGraph';
import { summarizeGraph } from '../boot';
import { readShellPersisted, readShellTokens } from '../shell';
import type { GetArchGraphResponse } from '@sequence/api-types';

function graphFor(name: string): GetArchGraphResponse {
  return {
    repoName: name,
    scannedAt: '2026-08-29T00:00:00.000Z',
    nodes: [{ id: 'svc:api', label: 'api', kind: 'service', file: 'src/api.ts', line: 1 }],
    edges: [],
    nodeDetail: {},
  } as unknown as GetArchGraphResponse;
}

function load(store: ReturnType<typeof createStore>, root: string, name: string, at = 0) {
  const graph = graphFor(name);
  store.dispatch({
    type: 'repo/loaded',
    draft: { root, repoName: name, graph, summary: summarizeGraph(graph), scannedAt: graph.scannedAt as string },
    at,
  });
}

function storeWithConversation(root: string, name: string) {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  load(store, root, name);
  /* A hydrated transcript — the same door the reload restore uses. */
  const turns: Turn[] = [
    {
      id: 't-u1',
      role: 'user',
      text: `a question about ${name}`,
      chips: [],
      at: 1,
    } as unknown as Turn,
  ];
  store.dispatch({ type: 'session/hydrated', turns });
  expect(store.getState().session.turns).toHaveLength(1);
  return store;
}

describe('session scope — attaching a different repo never keeps another repo\'s transcript', () => {
  it('repo A → repo B clears the session slice', () => {
    const store = storeWithConversation('/home/max/repo-a', 'repo-a');
    load(store, '/home/max/repo-b', 'repo-b', 10);

    const state = store.getState();
    expect(state.repo.phase).toBe('attached');
    // The transcript, the sessions list, everything conversational: gone.
    // Repo B's own saved sessions arrive from the server, which keys them by
    // the attached root — nothing about A can be served now.
    expect(state.session.turns).toHaveLength(0);
    expect(state.session.sessions).toHaveLength(0);
    expect(state.session.inFlight).toBeNull();
  });

  it('a rescan of the SAME repo keeps the conversation', () => {
    const store = storeWithConversation('/home/max/repo-a', 'repo-a');
    // The rebase shape: same root, a fresh scan.
    load(store, '/home/max/repo-a', 'repo-a', 10);

    const state = store.getState();
    expect(state.repo.phase).toBe('attached');
    expect(state.session.turns).toHaveLength(1);
    expect(state.session.turns[0]!.text).toContain('repo-a');
  });

  it('the first attach after boot does not touch the (empty) session', () => {
    const store = createStore({
      project: (g) => seqdFromGraph(g, g.nodeDetail),
      tokens: readShellTokens(document.documentElement),
      persisted: readShellPersisted(),
    });
    load(store, '/home/max/repo-a', 'repo-a');
    expect(store.getState().session.turns).toHaveLength(0);
  });
});
