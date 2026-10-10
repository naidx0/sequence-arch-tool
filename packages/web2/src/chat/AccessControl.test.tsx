import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostAskStreamRequest } from '@sequence/api-types';
import type { ArchGraph } from '@sequence/schema';

import { seqdFromGraph } from '../canvas/seqdFromGraph';
import { composerPropsFrom, createStore, StoreProvider } from '../state';
import type { AccessMode, PermissionMode } from '../state/types';
import { V3Chat } from '../v3/V3Chat';
import type { AskTransport } from './askClient';
import { preloadFullAccessDialog } from './AccessControl';
import {
  ACCESS_MODES,
  acpPermissionModeFor,
  askPermissionFor,
  createFullAccessClient,
  nextAccess,
  type FullAccessClient,
} from './accessMode';

/**
 * THE ACCESS SWITCH. Intent (Plan / Build) and access (Ask / Auto-edit / Full
 * access) are two values; each reaches the wire it belongs to, Shift+Tab walks
 * access, and Full access asks once per project.
 */

const GRAPH = {
  version: 1,
  scannedAt: '2026-10-05T00:00:00.000Z',
  repoRoot: 'C:/repos/a',
  repoName: 'a',
  nodes: [{ id: 'svc:api', kind: 'service', label: 'api', files: [] }],
  edges: [],
  warnings: [],
  nodeDetail: {},
} as unknown as ArchGraph;

function attach(store: ReturnType<typeof createStore>, root: string) {
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root,
      repoName: root.split('/').pop()!,
      graph: { ...GRAPH, repoRoot: root },
      summary: { nodes: 1, edges: 0, services: 1, datastores: 0, topics: 0 },
      scannedAt: GRAPH.scannedAt,
    },
    at: 0,
  } as never);
}

function newStore(root = 'C:/repos/a') {
  const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail), persisted: null });
  attach(store, root);
  store.dispatch({ type: 'composer/permission-enabled', enabled: ['plan', 'build'] });
  return store;
}

const INTENTS: PermissionMode[] = ['plan', 'build'];
const ACCESS: AccessMode[] = ACCESS_MODES.map((m) => m.access);

describe('access mapping', () => {
  it('derives the subject set from ACCESS_MODES, weakest first, and Shift+Tab wraps', () => {
    expect(ACCESS).toEqual(['ask', 'autoEdit', 'full']);
    expect(ACCESS.map(nextAccess)).toEqual(['autoEdit', 'full', 'ask']);
  });

  it('every (intent, access) pair reaches /api/ask as plan|build, and Ask never reaches build', async () => {
    const want: Record<string, PermissionMode> = {
      'plan/ask': 'plan',
      'plan/autoEdit': 'plan',
      'plan/full': 'plan',
      'build/ask': 'plan',
      'build/autoEdit': 'build',
      'build/full': 'build',
    };
    for (const intent of INTENTS) {
      for (const access of ACCESS) {
        expect(askPermissionFor(intent, access)).toBe(want[`${intent}/${access}`]);
        /* THROUGH THE REAL SEND: the request object built by composerPropsFrom. */
        const store = newStore();
        store.dispatch({ type: 'composer/permission', mode: intent });
        store.dispatch({ type: 'composer/access', access });
        const sent: PostAskStreamRequest[] = [];
        const transport: AskTransport = {
          stream: async (request, _h) => {
            sent.push(request);
            return { outcome: 'ok', status: 200, body: null };
          },
        };
        store.dispatch({ type: 'composer/draft', text: 'go' });
        composerPropsFrom(store.getState(), store, transport).onSend();
        await vi.waitFor(() => expect(sent).toHaveLength(1));
        expect(sent[0]!.permission, `${intent}/${access}`).toBe(want[`${intent}/${access}`]);
      }
    }
  });

  it('ACP agent runs take the access mode whole (run-node permissionMode)', () => {
    expect(ACCESS.map((a) => acpPermissionModeFor('build', a))).toEqual(['propose', 'autoEdit', 'full']);
    expect(ACCESS.map((a) => acpPermissionModeFor('plan', a))).toEqual(['plan', 'plan', 'plan']);
  });

  it('the confirm client GETs state and POSTs {confirm:true} to /api/acp/full-access', async () => {
    const seen: { url: string; method: string; body?: string }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
      return new Response(JSON.stringify({ confirmed: init?.method === 'POST', prompt: 'Agents can run any command without asking' }));
    }) as unknown as typeof fetch;
    const c = createFullAccessClient(fetchImpl);
    expect(await c.state()).toEqual({ ok: true, confirmed: false, prompt: 'Agents can run any command without asking' });
    expect((await c.confirm()).ok).toBe(true);
    expect(seen).toEqual([
      { url: '/api/acp/full-access', method: 'GET', body: undefined },
      { url: '/api/acp/full-access', method: 'POST', body: '{"confirm":true}' },
    ]);
  });
});

/** A server double: consent recorded per project, keyed by whichever is attached. */
function fakeServer() {
  const consented = new Set<string>();
  const calls = { state: 0, confirm: 0 };
  let project = 'C:/repos/a';
  const client: FullAccessClient = {
    state: async () => {
      calls.state += 1;
      return { ok: true, confirmed: consented.has(project), prompt: 'Agents can run any command without asking' };
    },
    confirm: async () => {
      calls.confirm += 1;
      consented.add(project);
      return { ok: true, confirmed: true, prompt: 'Agents can run any command without asking' };
    },
  };
  return { client, calls, setProject: (p: string) => (project = p) };
}

function shiftTab(field: HTMLElement) {
  fireEvent.keyDown(field, { key: 'Tab', shiftKey: true });
}

/*
 * THE DIALOG IS A LAZY CHUNK (off the boot path), so under a loaded full suite
 * its first render can land after waitFor's 1 s default — the flake seen at
 * 28e0be90. The module is loaded once before these tests, and the waits on it
 * name their own bound instead of leaning on the global default.
 */
const DIALOG_WAIT = { timeout: 10_000 };

describe('the composer access switch', () => {
  beforeAll(async () => {
    preloadFullAccessDialog();
    await import('./FullAccessDialog');
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it('Shift+Tab cycles Plan -> Smart -> Full auto, Full asks exactly once per project', async () => {
    const store = newStore();
    store.dispatch({ type: 'composer/permission', mode: 'build' });
    store.dispatch({ type: 'composer/access', access: 'autoEdit' });
    const server = fakeServer();
    render(
      <StoreProvider store={store}>
        <V3Chat fullAccessClient={server.client} />
      </StoreProvider>,
    );
    const field = screen.getByTestId('composer-field');
    /* THE MODE LIVES IN THE POPUP: no separate access control. */
    expect(screen.queryByTestId('v3-access-trigger')).toBeNull();
    const label = screen.getByTestId('v3-mode-label');
    /* Build at auto-edit is Smart. (A saved Ask is carried over once at hydrate, V3App.test.tsx; the composer no longer rewrites it.) */
    expect(store.getState().composer.permission.access).toBe('autoEdit');
    expect(label.textContent).toBe('Smart');

    /* Into Full auto: the one-time question, and access does not move until it is answered. */
    shiftTab(field);
    const dialog = await screen.findByTestId('v3-full-access-confirm', {}, DIALOG_WAIT);
    expect(dialog.textContent).toContain('Agents can run any command without asking');
    expect(store.getState().composer.permission.access).toBe('autoEdit');
    fireEvent.click(screen.getByTestId('v3-full-access-allow'));
    await waitFor(() => expect(store.getState().composer.permission.access).toBe('full'));
    expect(server.calls.confirm).toBe(1);
    expect(label.textContent).toBe('Full auto');
    await waitFor(() => expect(screen.queryByTestId('v3-full-access-confirm')).toBeNull(), DIALOG_WAIT);

    /* Round again: Plan, then Smart, then Full auto — no second question in this project. */
    shiftTab(field);
    await waitFor(() => expect(store.getState().composer.permission.mode).toBe('plan'));
    expect(label.textContent).toBe('Plan');
    shiftTab(field);
    await waitFor(() => expect(store.getState().composer.permission.access).toBe('autoEdit'));
    expect(store.getState().composer.permission.mode).toBe('build');
    shiftTab(field);
    await waitFor(() => expect(store.getState().composer.permission.access).toBe('full'));
    expect(screen.queryByTestId('v3-full-access-confirm')).toBeNull();
    expect(server.calls.confirm).toBe(1);
    expect(localStorage.getItem('v3.composer.access')).toBe('full');

    /* A different project is a different consent: asked again (and a stored Full drops to Auto-edit). */
    server.setProject('C:/repos/b');
    act(() => attach(store, 'C:/repos/b'));
    await waitFor(() => expect(store.getState().composer.permission.access).toBe('autoEdit'));
    shiftTab(field);
    expect(await screen.findByTestId('v3-full-access-confirm', {}, DIALOG_WAIT)).toBeTruthy();
    fireEvent.click(screen.getByTestId('v3-full-access-cancel'));
    await waitFor(() => expect(screen.queryByTestId('v3-full-access-confirm')).toBeNull(), DIALOG_WAIT);
    expect(store.getState().composer.permission.access).toBe('autoEdit');
    expect(server.calls.confirm).toBe(1);
  });

  it("the popup's mode section sets intent and access together (Plan, Smart, Full auto), and the chip says which", async () => {
    const store = newStore();
    const server = fakeServer();
    render(
      <StoreProvider store={store}>
        <V3Chat fullAccessClient={server.client} />
      </StoreProvider>,
    );
    const trigger = screen.getByTestId('v3-model-trigger');
    const label = screen.getByTestId('v3-mode-label');
    expect(label.textContent).toBe('Plan');
    fireEvent.click(trigger);
    const menu = screen.getByTestId('s2-mode-menu');
    /* One row per mode, each with what it does, and the key that cycles them. */
    expect(Array.from(menu.querySelectorAll('[role="menuitemradio"]')).map((r) => r.getAttribute('data-testid'))).toEqual([
      's2-mode-plan',
      's2-mode-smart',
      's2-mode-full',
    ]);
    expect(menu.textContent).toContain('Cycle modes');
    fireEvent.click(screen.getByTestId('s2-mode-smart'));
    await waitFor(() => expect(store.getState().composer.permission.mode).toBe('build'));
    expect(store.getState().composer.permission.access).toBe('autoEdit');
    expect(label.textContent).toBe('Smart');
    expect(screen.getByTestId('s2-mode-trigger').getAttribute('data-mode')).toBe('smart');
    /* the send button is the same in every mode: it carries no mode at all */
    expect(screen.getByTestId('composer-send').hasAttribute('data-mode')).toBe(false);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId('s2-mode-plan'));
    await waitFor(() => expect(store.getState().composer.permission.mode).toBe('plan'));
    expect(label.textContent).toBe('Plan');
    expect(screen.getByTestId('s2-mode-trigger').getAttribute('data-mode')).toBe('plan');
    expect(screen.getByTestId('composer-send').hasAttribute('data-mode')).toBe(false);
    expect(screen.getByTestId('v3-tools-trigger').hasAttribute('data-mode')).toBe(false);
  });
});
