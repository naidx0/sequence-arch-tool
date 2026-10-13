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
  it('Welcome to Sequence: four big options in order, no project picker, no profile names', async () => {
    render(<FirstRun client={fakeClient()} onDone={() => {}} />);
    const opts = await screen.findAllByTestId('first-run-option');
    expect(opts.map((o) => o.getAttribute('data-option'))).toEqual(['claude', 'codex', 'local', 'key']);
    expect(opts.map((o) => o.querySelector('.fr-option-name')!.textContent)).toEqual(['Claude Code', 'Codex', 'Local model', 'API key']);
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
      expect(calls).toEqual(['GET /api/local/setup', 'GET /api/acp/agents', 'POST /api/acp/agents/connect', 'GET /api/agent-settings']);
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
    expect((await screen.findAllByTestId('first-run-option')).length).toBeGreaterThan(0);
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
    await waitFor(() => expect(document.activeElement?.getAttribute('data-testid')).toBe('first-run-option'));
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

/* ── SIGN IN THROUGH THE EMBEDDED TERMINAL ─────────────────────────────── */

const term = vi.hoisted(() => ({
  calls: [] as (string | undefined)[],
  close: null as null | ((info: { code: number; reason: string }) => void),
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
        handlers.onOutput(new TextEncoder().encode('FAKE-CLAUDE ran: claude auth login\n'));
        return { sendInput() {}, resize() {}, close() {}, readyState: 1 };
      },
    ),
  };
});

describe('Sign in', () => {
  it('opens the Terminal running exactly the vendor command for that provider, and re-probes when it exits', async () => {
    term.calls.length = 0;
    const client = fakeClient();
    render(<FirstRun client={client} onDone={() => {}} />);
    /* Only the signed-out provider offers it (negative control: Codex is ready). */
    await choose('codex');
    expect(screen.queryByTestId('first-run-setup-agent')).toBeNull();
    fireEvent.click(await screen.findByTestId('first-run-back'));
    await choose('claude');
    fireEvent.click(await screen.findByTestId('first-run-setup-agent'));

    expect(screen.getByTestId('first-run-signin-command').textContent).toBe('Signing in to Claude Code');
    await waitFor(() => expect(term.calls).toEqual(['claude']));
    await waitFor(() =>
      expect(screen.getByTestId('terminal-pane-surface').textContent).toContain('FAKE-CLAUDE ran: claude auth login'),
    );

    expect(client.calls.filter((c) => c === 'providers:refresh')).toHaveLength(0);
    act(() => term.close?.({ code: 1000, reason: 'shell exited (code 0)' }));
    await waitFor(() => expect(client.calls.filter((c) => c === 'providers:refresh')).toHaveLength(1));
    expect(screen.getByTestId('first-run-signin-terminal').textContent).toContain('Finished');
    /* UX study 2026-10-09: a finished sign-in is not a lost connection. */
    expect(screen.getByTestId('terminal-pane-status').textContent).toBe('Command ended. Run again');
  });

  it('a dropped socket (1006) during sign-in reads Terminal disconnected, not Command ended', async () => {
    term.calls.length = 0;
    const client = fakeClient();
    render(<FirstRun client={client} onDone={() => {}} />);
    await choose('claude');
    fireEvent.click(await screen.findByTestId('first-run-setup-agent'));
    await waitFor(() => expect(term.calls).toEqual(['claude']));
    act(() => term.close?.({ code: 1006, reason: '' }));
    await waitFor(() => expect(screen.getByTestId('terminal-pane-status').textContent).toBe('Terminal disconnected. Reconnect'));
    /* Review v2 nit: the header agrees with the pane: not "Finished". */
    expect(screen.getByTestId('first-run-signin-terminal').textContent).toContain('Disconnected');
    expect(screen.getByTestId('first-run-signin-terminal').textContent).not.toContain('Finished');
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
