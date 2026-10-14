import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GetArchGraphResponse } from '@sequence/api-types';

import { summarizeGraph, type BootTransport } from '../boot';
import { seqdFromGraph } from '../canvas/seqdFromGraph';
import { createStore, StoreProvider, type Store } from '../state';
import { FirstRun } from './FirstRun';
import { resetSignInState } from './signInState';
import { FirstRunGate, SKIP_KEY } from './FirstRunGate';
import {
  createOnboardingClient,
  providerPill,
  type OnboardingClient,
  type ProviderStatus,
} from './onboardingClient';

/**
 * FIRST RUN. The screen a person meets when nothing is attached: their agents
 * and their repos, and ONE click from a repo to the board.
 *
 * Every number here is the subject's own: the repos and providers are built by
 * this file, and the transport is a fake that records what it was asked.
 */

const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);

const PROVIDERS: ProviderStatus[] = [
  { id: 'claude', label: 'Claude Code', installed: true, version: '2.1.280', state: 'signIn', signInCommand: 'claude auth login', installHint: 'npm install -g @anthropic-ai/claude-code' },
  { id: 'codex', label: 'Codex', installed: true, version: '0.153.4', state: 'ready', plan: 'ChatGPT', signInCommand: 'codex login', installHint: 'npm install -g @openai/codex' },
];

const REPOS = [{ path: '/home/max/shop', name: 'shop', lastActive: NOW, recent: true }];

function fakeClient(over: Partial<OnboardingClient> = {}): OnboardingClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    providers: vi.fn(async (refresh?: boolean) => {
      calls.push(refresh ? 'providers:refresh' : 'providers');
      return { ok: true as const, body: PROVIDERS };
    }),
    repos: vi.fn(async () => {
      calls.push('repos');
      return { ok: true as const, body: { repos: REPOS, truncated: false } };
    }),
    ...over,
  };
}

afterEach(() => {
  resetSignInState();
  window.sessionStorage.clear();
});

describe('first-run helpers', () => {
  it('pills: Ready names the account kind; every state has its own word', () => {
    expect(providerPill(PROVIDERS[1]).text).toBe('Ready, ChatGPT');
    /* Round 7 (A4): Ready / Needs sign-in / Needs bridge / Not installed. */
    const words = (['ready', 'signIn', 'adapter', 'install', 'attention', 'checking'] as const).map(
      (state) => providerPill({ ...PROVIDERS[0], state }).text,
    );
    expect(words).toEqual(['Ready', 'Needs sign-in', 'Needs bridge', 'Not installed', 'Needs attention', 'Checking']);
    expect(new Set(words).size).toBe(words.length);
  });

  it('the client reads the two onboarding routes, and refresh=1 only when asked', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (u: string) => {
      urls.push(u);
      const body = u.includes('repos') ? { repos: REPOS, truncated: true } : { providers: PROVIDERS };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const c = createOnboardingClient(fetchImpl);
    const p = await c.providers();
    const r = await c.repos();
    await c.providers(true);
    expect(urls).toEqual(['/api/onboarding/providers', '/api/onboarding/repos', '/api/onboarding/providers?refresh=1']);
    expect(p.ok && p.body.length).toBe(2);
    expect(r.ok && r.body.truncated).toBe(true);
  });

  it('a refused route is a sentence, not a throw', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: 'local-only' }), { status: 403 })) as unknown as typeof fetch;
    const a = await createOnboardingClient(fetchImpl).providers();
    expect(a).toEqual({ ok: false, message: 'local-only' });
  });
});

/** Open one of the four options. */
async function choose(route: string) {
  const opt = (await screen.findAllByTestId('first-run-option')).find((o) => o.getAttribute('data-option') === route)!;
  fireEvent.click(opt);
}

describe('<FirstRun>', () => {
  it('Welcome to Sequence: four big options, the ready one first (P0-3), no project picker, no profile names', async () => {
    render(<FirstRun client={fakeClient()} onDone={() => {}} />);
    /* Codex is the ready one in PROVIDERS: it moves ahead of Claude Code; the rest keep their order. */
    await waitFor(() => expect(screen.getAllByTestId('first-run-option')[0]!.getAttribute('data-option')).toBe('codex'));
    const opts = screen.getAllByTestId('first-run-option');
    expect(opts.map((o) => o.getAttribute('data-option'))).toEqual(['codex', 'claude', 'local', 'key']);
    expect(opts.map((o) => o.querySelector('.fr-option-name')!.textContent)).toEqual(['Codex', 'Claude Code', 'Local model', 'API key']);
    /* Exactly one is ready: it is the preselected one, and the one primary button names it. */
    expect(opts.filter((o) => o.getAttribute('data-preselected') === 'true').map((o) => o.getAttribute('data-option'))).toEqual(['codex']);
    expect(screen.getByTestId('first-run-use-ready').textContent).toBe('Use Codex');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome to Sequence');
    expect(screen.getByTestId('first-run').getAttribute('aria-label')).toBe('Add an agent');
    expect(screen.queryByTestId('first-run-repos')).toBeNull();
    expect(screen.queryByTestId('first-run-setup')).toBeNull();
    const text = screen.getByTestId('first-run').textContent ?? '';
    expect(text).not.toMatch(/daily|cheap/i);
  });

  it('shows the Sequence mark above the title', async () => {
    render(<FirstRun client={fakeClient()} onDone={() => {}} />);
    const root = await screen.findByTestId('first-run');
    const mark = root.querySelector('.fr-brand svg');
    expect(mark).not.toBeNull();
    const title = root.querySelector('.fr-title')!;
    expect(mark!.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a ready agent: the option opens Start chatting at once; it connects, then the setup opens (not the chat yet)', async () => {
    const calls: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (u: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${u}`);
      return new Response(JSON.stringify({ agents: [] }), { status: 200 });
    }) as unknown as typeof fetch);
    const onDone = vi.fn();
    try {
      render(<FirstRun client={fakeClient()} onDone={onDone} />);
      await choose('codex');
      fireEvent.click(await screen.findByTestId('first-run-start'));
      expect(await screen.findByTestId('first-run-setup')).toBeTruthy();
      expect(onDone).not.toHaveBeenCalled();
      expect(calls).toEqual(['GET /api/ai-config', 'GET /api/local/setup', 'GET /api/acp/agents', 'POST /api/acp/agents/connect', 'GET /api/agent-settings']);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('a signed-out agent has Sign in and no Start chatting', async () => {
    render(<FirstRun client={fakeClient()} onDone={() => {}} />);
    await choose('claude');
    expect(await screen.findByTestId('first-run-setup-agent')).toBeTruthy();
    expect(screen.queryByTestId('first-run-start')).toBeNull();
  });

  it('a refused connect says so and stays on the screen', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (_u: string, init?: RequestInit) =>
      init?.method === 'POST' ? new Response('{}', { status: 500 }) : new Response('{"agents":[]}')) as unknown as typeof fetch);
    const onDone = vi.fn();
    try {
      render(<FirstRun client={fakeClient()} onDone={onDone} />);
      await choose('codex');
      fireEvent.click(await screen.findByTestId('first-run-start'));
      expect((await screen.findByTestId('first-run-start-error')).textContent).toContain('Could not connect Codex');
      expect(onDone).not.toHaveBeenCalled();
      expect(screen.queryByTestId('first-run-setup')).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('Skip for now lands in the chat without an agent', async () => {
    const onDone = vi.fn();
    render(<FirstRun client={fakeClient()} onDone={onDone} />);
    fireEvent.click(await screen.findByTestId('first-run-skip'));
    expect(onDone).toHaveBeenCalledWith(false);
  });

  it('Back returns from an option to the four', async () => {
    render(<FirstRun client={fakeClient()} onDone={() => {}} />);
    await choose('codex');
    fireEvent.click(await screen.findByTestId('first-run-back'));
    expect((await screen.findAllByTestId('first-run-option')).length).toBe(4);
  });

  it('re-probes providers (fresh) when the window regains focus, but not twice in a burst', async () => {
    const client = fakeClient();
    render(<FirstRun client={client} onDone={() => {}} />);
    await screen.findAllByTestId('first-run-option');
    expect(client.calls.filter((c) => c.startsWith('providers'))).toEqual(['providers']);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 10_000;
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
      await waitFor(() => expect(client.calls).toContain('providers:refresh'));
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
    } finally {
      Date.now = realNow;
    }
    expect(client.calls.filter((c) => c === 'providers:refresh')).toHaveLength(1);
  });

  it('Install is one click to the chat: it hands the install to the agent as a ready prompt and ends first run; it runs nothing and shows no command', async () => {
    const client = fakeClient({
      providers: async () => ({ ok: true, body: [{ ...PROVIDERS[0], installed: false, version: null, state: 'install' }] }),
    });
    const asked: string[] = [];
    const done = vi.fn();
    render(<FirstRun client={client} onDone={done} onAskAgent={(p) => asked.push(p)} />);
    await choose('claude');
    const btn = await screen.findByTestId('first-run-install');
    expect(btn.textContent).toBe('Set up in chat');
    expect(screen.queryByText(/npm install/)).toBeNull();
    fireEvent.click(btn);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('npm install -g @anthropic-ai/claude-code');
    expect(done).toHaveBeenCalledWith(false);
  });

  it('with no model connected either, nothing can answer a draft: Copy setup prompt and Connect a model replace Set up in chat', async () => {
    const client = fakeClient({
      providers: async () => ({ ok: true, body: [{ ...PROVIDERS[0], installed: false, version: null, state: 'install' }] }),
    });
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void written.push(t) } });
    const asked: string[] = [];
    const done = vi.fn();
    render(<FirstRun client={client} onDone={done} onAskAgent={(p) => asked.push(p)} canAnswer={false} />);
    await choose('claude');
    const copy = await screen.findByTestId('first-run-copy');
    expect(screen.queryByTestId('first-run-install')).toBeNull();
    fireEvent.click(copy);
    await waitFor(() => expect(copy.textContent).toBe('Copied'));
    expect(written[0]).toContain('npm install -g @anthropic-ai/claude-code');
    expect(asked).toHaveLength(0);
    expect(done).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('first-run-model'));
    /* P0-3: Connect a model goes to the model route, never back to the picker it came from. */
    expect(screen.getByTestId('first-run').getAttribute('data-step')).toBe('route');
    expect(screen.getByTestId('first-run-route').getAttribute('data-route')).toBe('local');
    expect(screen.queryByTestId('first-run-options')).toBeNull();
    expect(await screen.findByTestId('first-run-local')).toBeTruthy();
    /* The API key route is one click on from there. */
    fireEvent.click(screen.getByTestId('first-run-to-key'));
    expect(await screen.findByTestId('first-run-key')).toBeTruthy();
  });

  it('first-run-model never lands on pick, for every state that offers it', async () => {
    for (const state of ['install', 'update', 'attention'] as const) {
      const client = fakeClient({
        providers: async () => ({ ok: true, body: [{ ...PROVIDERS[0], state }] }),
      });
      const { unmount } = render(<FirstRun client={client} onDone={() => {}} onAskAgent={() => {}} canAnswer={false} />);
      await choose('claude');
      fireEvent.click(await screen.findByTestId('first-run-model'));
      expect(screen.getByTestId('first-run').getAttribute('data-step'), state).not.toBe('pick');
      expect(screen.queryByTestId('first-run-options'), state).toBeNull();
      unmount();
    }
  });

  it('with Claude Code signed in, first run is ONE click to the setup (P0-3)', async () => {
    const calls: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (u: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${u}`);
      return new Response(JSON.stringify({ agents: [] }), { status: 200 });
    }) as unknown as typeof fetch);
    try {
      const client = fakeClient({
        providers: async () => ({ ok: true, body: [{ ...PROVIDERS[0], state: 'ready', plan: 'Max' }, { ...PROVIDERS[1], state: 'install', installed: false }] }),
      });
      render(<FirstRun client={client} onDone={() => {}} />);
      const use = await screen.findByTestId('first-run-use-ready');
      expect(use.textContent).toBe('Use Claude Code');
      /* It is where focus starts, so even Enter is that one click. */
      await waitFor(() => expect(document.activeElement).toBe(use));
      fireEvent.click(use);
      expect(await screen.findByTestId('first-run-setup')).toBeTruthy();
      expect(calls).toContain('POST /api/acp/agents/connect');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('no ready option: no primary button and nothing preselected (negative control)', async () => {
    const client = fakeClient({ providers: async () => ({ ok: true, body: [{ ...PROVIDERS[0] }, { ...PROVIDERS[1], state: 'signIn' }] }) });
    render(<FirstRun client={client} onDone={() => {}} />);
    await waitFor(() => expect(screen.getAllByTestId('first-run-option')[0]!.getAttribute('data-state')).toBe('signIn'));
    expect(screen.queryByTestId('first-run-use-ready')).toBeNull();
    expect(screen.getAllByTestId('first-run-option').some((o) => o.getAttribute('data-preselected'))).toBe(false);
  });

  it('a running Ollama makes Local model a ready option, sorted first, and its one button saves that model', async () => {
    const wrote: unknown[] = [];
    const settings = {
      read: async () => ({ outcome: 'ok' as const, body: { profiles: [], localProviders: [{ name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', models: ['qwen3:8b'] }] } }),
      write: async (d: unknown) => {
        wrote.push(d);
        return { outcome: 'ok' as const, body: {} };
      },
      selectProfile: async () => ({ outcome: 'ok' as const, body: {} }),
    } as unknown as import('../settings/settingsClient').SettingsClient;
    const client = fakeClient({ providers: async () => ({ ok: true, body: [{ ...PROVIDERS[0] }] }) });
    render(<FirstRun client={client} onDone={() => {}} settings={settings} />);
    const use = await screen.findByTestId('first-run-use-ready');
    expect(use.textContent).toBe('Use qwen3:8b');
    expect(screen.getAllByTestId('first-run-option')[0]!.getAttribute('data-option')).toBe('local');
    fireEvent.click(use);
    expect(await screen.findByTestId('first-run-setup')).toBeTruthy();
    expect(JSON.stringify(wrote)).toContain('qwen3:8b');
  });

  it('an agent older than Sequence can drive gets Update in chat, with its versions in the prompt', async () => {
    const client = fakeClient({
      providers: async () => ({ ok: true, body: [{ ...PROVIDERS[0], version: '2.0.5', minVersion: '2.1.0', state: 'update' }] }),
    });
    const asked: string[] = [];
    render(<FirstRun client={client} onDone={() => {}} onAskAgent={(p) => asked.push(p)} />);
    await choose('claude');
    const btn = await screen.findByTestId('first-run-install');
    expect(btn.textContent).toBe('Update in chat');
    fireEvent.click(btn);
    expect(asked[0]).toContain('2.0.5');
    expect(asked[0]).toContain('2.1.0');
  });
});

/* ── THE GATE ─────────────────────────────────────────────────────────── */

const GRAPH = {
  repoName: 'shop',
  scannedAt: '2026-10-05T09:00:00.000Z',
  nodes: [{ id: 'svc:api', label: 'api', kind: 'service', file: 'src/api.ts', line: 1 }],
  edges: [],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

function settle(store: Store, kind: 'unattached' | 'attached') {
  act(() => {
    store.dispatch({
      type: 'boot/settled',
      outcome:
        kind === 'attached'
          ? {
              kind: 'attached',
              repo: { root: '/home/max/shop', repoName: 'shop', graph: GRAPH, summary: summarizeGraph(GRAPH), scannedAt: GRAPH.scannedAt },
              platform: { reachable: true, detail: 'ok', at: 1 },
            }
          : { kind: 'unattached', platform: { reachable: true, detail: 'ok', at: 1 } },
    });
  });
}

/** The server's registered agents, as GET /api/acp/agents answers; any other route is a refusal. */
function agentsServer(registered: string[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((async (u: string, init?: RequestInit) => {
    if (String(u) === '/api/acp/agents' && (init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ agents: registered.map((id) => ({ id })) }));
    return new Response('{"agents":[]}');
  }) as unknown as typeof fetch);
}

/** Codex option, Start chatting, then Skip on every setup card and Done. */
async function finishSetup() {
  await choose('codex');
  fireEvent.click(await screen.findByTestId('first-run-start'));
  fireEvent.click(await screen.findByTestId('first-run-setup-project-skip'));
  fireEvent.click(await screen.findByTestId('first-run-setup-trust-skip'));
  fireEvent.click(await screen.findByTestId('first-run-setup-map-skip'));
  fireEvent.click(await screen.findByTestId('first-run-skills-skip'));
  fireEvent.click(await screen.findByTestId('first-run-setup-done-go'));
}

function gate(store: Store) {
  return (
    <StoreProvider store={store}>
      <FirstRunGate client={fakeClient()} />
    </StoreProvider>
  );
}

describe('<FirstRunGate>', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('does not draw before boot settles, draws when nothing is attached and no agent is registered, never over an attached repo', async () => {
    agentsServer([]);
    const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail) });
    const { rerender } = render(gate(store));
    expect(screen.queryByTestId('first-run')).toBeNull();
    settle(store, 'unattached');
    expect(await screen.findByTestId('first-run')).toBeTruthy();

    const attachedStore = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail) });
    settle(attachedStore, 'attached');
    rerender(gate(attachedStore));
    expect(screen.queryByTestId('first-run')).toBeNull();
  });

  it('Start chatting closes the screen, remembers it on this machine, and never reloads or attaches', async () => {
    const spy = agentsServer([]);
    const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail) });
    render(gate(store));
    settle(store, 'unattached');
    await finishSetup();
    await waitFor(() => expect(screen.queryByTestId('first-run')).toBeNull());
    expect(window.localStorage.getItem(SKIP_KEY)).toBe('1');
    expect(spy.mock.calls.some(([u]) => String(u).includes('attach'))).toBe(false);
  });

  it('a new launch after Start chatting (sessionStorage gone) does not bring first run back', async () => {
    const spy = agentsServer([]);
    const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail) });
    const first = render(gate(store));
    settle(store, 'unattached');
    await finishSetup();
    await waitFor(() => expect(screen.queryByTestId('first-run')).toBeNull());
    first.unmount();
    window.sessionStorage.clear();
    spy.mockRestore();
    agentsServer([]);
    const again = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail) });
    render(gate(again));
    settle(again, 'unattached');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.queryByTestId('first-run')).toBeNull();
  });

  it('a machine with an agent already registered goes straight to the chat, even with nothing remembered', async () => {
    agentsServer(['claude']);
    const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail) });
    render(gate(store));
    settle(store, 'unattached');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.queryByTestId('first-run')).toBeNull();
  });

  it('setup "Choose a project" opens the usual project picker once the screen is gone', async () => {
    agentsServer([]);
    const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail) });
    render(gate(store));
    settle(store, 'unattached');
    await choose('codex');
    fireEvent.click(await screen.findByTestId('first-run-start'));
    fireEvent.click(await screen.findByTestId('first-run-setup-project-yes'));
    fireEvent.click(await screen.findByTestId('first-run-setup-trust-skip'));
    fireEvent.click(await screen.findByTestId('first-run-setup-map-skip'));
    fireEvent.click(await screen.findByTestId('first-run-skills-skip'));
    fireEvent.click(await screen.findByTestId('first-run-setup-done-go'));
    await waitFor(() => expect(screen.queryByTestId('first-run')).toBeNull());
    expect(store.getState().shell.overlay?.kind).toBe('attach');
  });

  it('a reload in the middle of the setup does not bring Welcome back: connecting is remembered at once', async () => {
    agentsServer([]);
    const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail) });
    render(gate(store));
    settle(store, 'unattached');
    expect(window.localStorage.getItem(SKIP_KEY)).toBeNull();
    await choose('codex');
    fireEvent.click(await screen.findByTestId('first-run-start'));
    await screen.findByTestId('first-run-setup');
    expect(window.localStorage.getItem(SKIP_KEY)).toBe('1');
    /* The screen is still up for the setup cards. */
    expect(screen.getByTestId('first-run')).toBeTruthy();
  });

  it('Skip for now closes it and remembers that on this machine', async () => {
    agentsServer([]);
    const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail) });
    render(gate(store));
    settle(store, 'unattached');
    fireEvent.click(await screen.findByTestId('first-run-skip'));
    expect(screen.queryByTestId('first-run')).toBeNull();
    expect(window.localStorage.getItem(SKIP_KEY)).toBe('1');
  });
});

describe('first run holds the keyboard', () => {
  it('is a modal dialog, focuses the first option, makes the shell inert, and Tab cycles inside it', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<div id="shell"><button id="behind">behind</button></div><div id="slot"></div>';
    document.body.appendChild(host);
    const { unmount } = render(<FirstRun client={fakeClient()} onDone={() => {}} />, { container: host.querySelector('#slot')! });
    const dialog = await screen.findByTestId('first-run');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    /* Codex is ready: focus starts on its one primary button. */
    await waitFor(() => expect(document.activeElement?.getAttribute('data-testid')).toBe('first-run-use-ready'));
    expect(host.querySelector('#shell')!.hasAttribute('inert')).toBe(true);
    const buttons = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled)'));
    const last = buttons[buttons.length - 1]!;
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0]!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    unmount();
    expect(host.querySelector('#shell')!.hasAttribute('inert')).toBe(false);
    host.remove();
  });
});

/* ── SIGN IN IN THE BROWSER (P0-2) ─────────────────────────────────────── */

const term = vi.hoisted(() => ({
  calls: [] as (string | undefined)[],
  close: null as null | ((info: { code: number; reason: string }) => void),
  output: '',
  sent: [] as string[],
  closed: 0,
}));

vi.mock('../terminal/terminalClient', async (orig) => {
  const real = await orig<typeof import('../terminal/terminalClient')>();
  return {
    ...real,
    connectTerminal: vi.fn(
      async (
        handlers: { onOutput: (b: Uint8Array) => void; onClose?: (i: { code: number; reason: string }) => void },
        signIn?: string,
      ) => {
        term.calls.push(signIn);
        term.close = handlers.onClose ?? null;
        handlers.onOutput(new TextEncoder().encode(term.output));
        return {
          sendInput(d: string | Uint8Array) {
            term.sent.push(typeof d === 'string' ? d : new TextDecoder().decode(d));
          },
          resize() {},
          close() {
            term.closed += 1;
          },
          readyState: 1,
        };
      },
    ),
  };
});

const CLAUDE_URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=abc&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=xyz';

describe('Sign in in the browser (P0-2)', () => {
  function signInClient() {
    const s = { signedIn: false, client: null as unknown as OnboardingClient & { calls: string[] } };
    s.client = fakeClient({
      providers: vi.fn(async (refresh?: boolean) => {
        s.client.calls.push(refresh ? 'providers:refresh' : 'providers');
        return { ok: true as const, body: [{ ...PROVIDERS[0], state: s.signedIn ? ('ready' as const) : ('signIn' as const) }, PROVIDERS[1]] };
      }),
    });
    return s;
  }

  function reset(output: string) {
    term.calls.length = 0;
    term.sent.length = 0;
    term.closed = 0;
    term.close = null;
    term.output = output;
  }

  it('opens the vendor sign-in page in the system browser, shows one waiting state and no terminal, and moves on by itself once signed in', async () => {
    reset(`${CLAUDE_URL}\nPaste code here if prompted >`);
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async () => new Response(JSON.stringify({ agents: [] }), { status: 200 })) as unknown as typeof fetch);
    const s = signInClient();
    try {
      render(<FirstRun client={s.client} onDone={() => {}} />);
      await choose('claude');
      fireEvent.click(await screen.findByTestId('first-run-setup-agent'));
      await waitFor(() => expect(term.calls).toEqual(['claude']));
      /* The page went to the browser, whole, once. */
      await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
      expect(opened.mock.calls[0]![0]).toBe(CLAUDE_URL);
      /* One state, with Cancel; nothing to read in a terminal, nothing pasted unless the CLI asks for it. */
      expect(screen.getByTestId('first-run-signin-waiting').textContent).toContain('Waiting for you to finish in the browser…');
      expect(screen.getByTestId('first-run-signin-cancel')).toBeTruthy();
      expect(screen.queryByTestId('terminal-pane')).toBeNull();
      expect(screen.queryByTestId('first-run-signin-log')).toBeNull();
      fireEvent.click(screen.getByTestId('first-run-signin-details'));
      expect(screen.getByTestId('first-run-signin-log').textContent).toContain(CLAUDE_URL);
      /* The person finishes in the browser: the probe reads Ready and first run goes on to the setup with no click. */
      s.signedIn = true;
      await waitFor(() => expect(screen.getByTestId('first-run-setup')).toBeTruthy(), { timeout: 5000 });
      expect(s.client.calls).toContain('providers:refresh');
    } finally {
      opened.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  it('a CLI that opens the browser itself (Codex) is not opened twice; the page can still be opened again', async () => {
    reset('Starting local login server on http://localhost:1455.\nIf your browser did not open, navigate to this URL to authenticate:\n\nhttps://auth.openai.com/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback\n');
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    const s = signInClient();
    try {
      render(<FirstRun client={s.client} onDone={() => {}} />);
      await choose('claude');
      fireEvent.click(await screen.findByTestId('first-run-setup-agent'));
      await screen.findByTestId('first-run-signin-open');
      expect(opened).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('first-run-signin-open'));
      expect(opened.mock.calls[0]![0]).toContain('https://auth.openai.com/oauth/authorize');
    } finally {
      opened.mockRestore();
    }
  });

  it('Cancel ends the sign-in and shows a clear Retry, which starts it again', async () => {
    reset(`${CLAUDE_URL}\n`);
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      render(<FirstRun client={signInClient().client} onDone={() => {}} />);
      await choose('claude');
      fireEvent.click(await screen.findByTestId('first-run-setup-agent'));
      fireEvent.click(await screen.findByTestId('first-run-signin-cancel'));
      expect(term.closed).toBeGreaterThan(0);
      expect(screen.getByTestId('first-run-signin-retry-state').textContent).toContain('Sign-in cancelled.');
      fireEvent.click(screen.getByTestId('first-run-signin-retry'));
      await waitFor(() => expect(term.calls).toEqual(['claude', 'claude']));
      expect(await screen.findByTestId('first-run-signin-waiting')).toBeTruthy();
    } finally {
      opened.mockRestore();
    }
  });

  it('coming back to the window still signed out (the browser tab was closed) offers Retry', async () => {
    reset(`${CLAUDE_URL}\n`);
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      render(<FirstRun client={signInClient().client} onDone={() => {}} />);
      await choose('claude');
      fireEvent.click(await screen.findByTestId('first-run-setup-agent'));
      await screen.findByTestId('first-run-signin-open');
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
      expect((await screen.findByTestId('first-run-signin-back')).textContent).toContain('Retry');
    } finally {
      opened.mockRestore();
    }
  });

  it('a command that ends while still signed out says so with Retry, never a dead terminal', async () => {
    reset(`${CLAUDE_URL}\n`);
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      render(<FirstRun client={signInClient().client} onDone={() => {}} />);
      await choose('claude');
      fireEvent.click(await screen.findByTestId('first-run-setup-agent'));
      await waitFor(() => expect(term.close).not.toBeNull());
      act(() => term.close?.({ code: 1006, reason: '' }));
      expect((await screen.findByTestId('first-run-signin-retry-state')).textContent).toContain('The sign-in stopped.');
      expect(screen.getByTestId('first-run-signin-retry')).toBeTruthy();
    } finally {
      opened.mockRestore();
    }
  });

  it('a CLI that asks for the code from the browser gets one field, which goes to the command', async () => {
    reset(`${CLAUDE_URL}\nPaste code here if prompted >`);
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      render(<FirstRun client={signInClient().client} onDone={() => {}} />);
      await choose('claude');
      fireEvent.click(await screen.findByTestId('first-run-setup-agent'));
      fireEvent.change(await screen.findByTestId('first-run-signin-code'), { target: { value: ' abc#123 ' } });
      fireEvent.click(screen.getByTestId('first-run-signin-code-send'));
      expect(term.sent).toEqual(['abc#123\r']);
      expect(screen.queryByTestId('first-run-signin-code')).toBeNull();
    } finally {
      opened.mockRestore();
    }
  });
});

/* ── YOUR SETUP: names only ────────────────────────────────────────────── */

describe('Setup inventory client', () => {
  it('the client keeps names and sources only, whatever else the wire carries', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          mcpServers: [{ name: 'github', source: 'claude', command: 'npx', env: { TOKEN: 'sk-x' } }, { name: 'x', source: 'evil' }],
          skills: 'nope',
        }),
      )) as unknown as typeof fetch;
    const a = await createOnboardingClient(fetchImpl).setup!();
    expect(a.ok && a.body.mcpServers).toEqual([{ name: 'github', source: 'claude' }]);
    expect(a.ok && a.body.skills).toEqual([]);
  });
});
