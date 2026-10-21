import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FirstRun } from './FirstRun';
import { ReadyInOneClick, foundOnMachine } from './ReadyInOneClick';
import { resetSignInState } from './signInState';
import type { OnboardingClient, ProviderStatus } from './onboardingClient';

/**
 * READY IN ONE CLICK: the welcome screen reads what is already on the machine and sets
 * up everything that is ready with one click: signed-in agents, installed catalog agents,
 * and (when no model is set up) the first provider whose key is in the environment, by name.
 */

const codexReady: ProviderStatus = { id: 'codex', label: 'Codex', installed: true, version: '0.153.4', state: 'ready', plan: 'ChatGPT', signInCommand: 'codex login', installHint: 'npm i -g @openai/codex' };
const claudeOut: ProviderStatus = { id: 'claude', label: 'Claude Code', installed: true, version: '2.1.280', state: 'signIn', signInCommand: 'claude auth login', installHint: 'npm i -g x' };

const NEBIUS = { id: 'nebius', name: 'Nebius', wire: 'openai-compatible', api: 'https://api.tokenfactory.nebius.com/v1', env: ['NEBIUS_API_KEY'], models: [{ id: 'm1', name: 'Model One' }] };

function server(opts: { catalog?: unknown[]; detected?: unknown[]; configured?: boolean; failCatalogConnect?: boolean; failAgentConnect?: boolean; aiConfigDown?: boolean } = {}) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (url === '/api/acp/catalog') return json({ agents: opts.catalog ?? [] });
    if (url === '/api/providers/catalog') return json({ providers: [NEBIUS], detected: opts.detected ?? [] });
    if (url === '/api/ai-config' && method === 'GET') return opts.aiConfigDown ? json({ error: 'boom' }, 500) : json({ configured: opts.configured ?? false });
    if (url === '/api/ai-config' && method === 'PUT') return json({ configured: true });
    if (url === '/api/acp/agents/connect') return opts.failAgentConnect ? json({ error: 'Codex is signed out' }, 409) : json({ agent: { id: 'codex' } });
    if (url === '/api/acp/catalog/connect') return opts.failCatalogConnect ? json({ error: 'Cursor is not on this machine' }, 409) : json({ agent: { id: 'cursor' } });
    return json({}, 404);
  });
  return { f: f as unknown as typeof fetch, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetSignInState();
  window.sessionStorage.clear();
});

describe('ready in one click', () => {
  it('lists what is on the machine in words; only ready things are set up; a model only when none is', () => {
    const found = foundOnMachine([codexReady, claudeOut], [{ id: 'cursor', name: 'Cursor', state: 'ready' }, { id: 'gemini', name: 'Gemini CLI', state: 'npx' }], [{ id: 'nebius', name: 'Nebius', keyEnv: 'NEBIUS_API_KEY' }], false);
    expect(found.map((f) => [f.key, f.detail, f.ready])).toEqual([
      ['agent:codex', 'Signed in, ChatGPT', true],
      ['agent:claude', 'Installed, needs sign-in (below)', false],
      ['catalog:cursor', 'Installed', true],
      ['model:nebius', 'Uses your NEBIUS_API_KEY', true],
    ]);
    expect(foundOnMachine([codexReady], [], [{ id: 'nebius', name: 'Nebius', keyEnv: 'NEBIUS_API_KEY' }], true).some((f) => f.kind === 'model')).toBe(false);
  });

  it('one click connects every ready agent and saves the found key by name, then moves on', async () => {
    const { f, calls } = server({ catalog: [{ id: 'cursor', name: 'Cursor', state: 'ready' }], detected: [{ id: 'nebius', name: 'Nebius', keyEnv: 'NEBIUS_API_KEY' }] });
    const onDone = vi.fn();
    render(<ReadyInOneClick providers={[codexReady, claudeOut]} onDone={onDone} fetchImpl={f} />);
    fireEvent.click(await screen.findByTestId('ready-set-up'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(['codex', 'cursor']));
    const writes = calls.filter((c) => c.method !== 'GET');
    expect(writes.map((c) => c.url)).toEqual(['/api/acp/agents/connect', '/api/acp/catalog/connect', '/api/ai-config']);
    const saved = writes[2]!.body as { profiles: { apiKeyEnv: string; apiKey?: string; model: string }[] };
    expect(saved.profiles[0]).toMatchObject({ apiKeyEnv: 'NEBIUS_API_KEY', model: 'm1' });
    expect(saved.profiles[0]!.apiKey).toBeUndefined();
    expect(screen.getAllByTestId('ready-state').map((s) => s.textContent)).toEqual(['Done', 'Later', 'Done', 'Done']);
    /* The model that will answer is named before the click. */
    expect(screen.getAllByTestId('ready-found').find((r) => r.getAttribute('data-key') === 'model:nebius')!.textContent).toMatch(/Chat model: Nebius, Model One.*NEBIUS_API_KEY/);
    /* The chat answers with the signed-in agent (the note the single Use button used to leave). */
    expect(window.localStorage.getItem('sequence.onboarding.firstAgent')).toBe('codex');
  });

  it('a failed read of the model settings never offers a model (it would overwrite the saved ones)', async () => {
    const { f, calls } = server({ catalog: [{ id: 'cursor', name: 'Cursor', state: 'ready' }], detected: [{ id: 'nebius', name: 'Nebius', keyEnv: 'NEBIUS_API_KEY' }], aiConfigDown: true });
    const onDone = vi.fn();
    render(<ReadyInOneClick providers={[codexReady]} onDone={onDone} fetchImpl={f} />);
    await screen.findByTestId('ready-set-up');
    expect(screen.getAllByTestId('ready-found').some((r) => r.getAttribute('data-key') === 'model:nebius')).toBe(false);
    fireEvent.click(screen.getByTestId('ready-set-up'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('when nothing works it stays on the card, where each row says why', async () => {
    const { f } = server({ catalog: [{ id: 'cursor', name: 'Cursor', state: 'ready' }], failCatalogConnect: true, failAgentConnect: true });
    const onDone = vi.fn();
    render(<ReadyInOneClick providers={[codexReady]} onDone={onDone} fetchImpl={f} />);
    fireEvent.click(await screen.findByTestId('ready-set-up'));
    await waitFor(() => expect(screen.getAllByTestId('ready-state').map((x) => x.textContent)).toEqual(['Did not work', 'Did not work']));
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByTestId('ready-in-one-click').textContent).toMatch(/Codex is signed out/);
  });

  it('a step that fails says why on its row and the rest still run', async () => {
    const { f } = server({ catalog: [{ id: 'cursor', name: 'Cursor', state: 'ready' }], failCatalogConnect: true });
    const onDone = vi.fn();
    render(<ReadyInOneClick providers={[codexReady]} onDone={onDone} fetchImpl={f} />);
    fireEvent.click(await screen.findByTestId('ready-set-up'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(['codex']));
    const cursor = screen.getAllByTestId('ready-found').find((r) => r.getAttribute('data-key') === 'catalog:cursor')!;
    expect(within(cursor).getByTestId('ready-state').textContent).toBe('Did not work');
    expect(cursor.textContent).toMatch(/Cursor is not on this machine/);
  });

  it('one thing ready (or none): no card; the welcome screen\'s own Use button covers it', async () => {
    const { f } = server();
    const onCount = vi.fn();
    const { container } = render(<ReadyInOneClick providers={[codexReady]} onDone={vi.fn()} onCount={onCount} fetchImpl={f} />);
    await waitFor(() => expect(onCount).toHaveBeenCalledWith(0));
    expect(container.textContent).toBe('');
  });

  it('on the welcome screen, several ready things replace the single Use button with Set up everything', async () => {
    const { f } = server({ catalog: [{ id: 'hermes', name: 'Hermes Agent', state: 'ready' }] });
    vi.stubGlobal('fetch', f);
    const client = { providers: vi.fn(async () => ({ ok: true as const, body: [codexReady] })), repos: vi.fn(async () => ({ ok: true as const, body: { repos: [], truncated: false } })) } as unknown as OnboardingClient;
    render(<FirstRun client={client} onDone={() => {}} />);
    expect(await screen.findByTestId('ready-set-up')).toBeTruthy();
    expect(screen.queryByTestId('first-run-use-ready')).toBeNull();
    fireEvent.click(screen.getByTestId('ready-set-up'));
    await waitFor(() => expect(screen.getByTestId('first-run').getAttribute('data-step')).toBe('setup'));
  });

  it('Ready is honest: signed in says Ready, an agent found only by its program Will connect, a model is its own line', async () => {
    const { f } = server({ catalog: [{ id: 'cursor', name: 'Cursor', state: 'ready' }], detected: [{ id: 'nebius', name: 'Nebius', keyEnv: 'NEBIUS_API_KEY' }] });
    render(<ReadyInOneClick providers={[codexReady]} onDone={vi.fn()} fetchImpl={f} />);
    await screen.findByTestId('ready-set-up');
    const rows = screen.getAllByTestId('ready-found');
    const word = (key: string) => within(rows.find((r) => r.getAttribute('data-key') === key)!).getByTestId('ready-state').textContent;
    expect(word('agent:codex')).toBe('Ready');
    expect(word('catalog:cursor')).toBe('Will connect');
    expect(rows.find((r) => r.getAttribute('data-key') === 'catalog:cursor')!.textContent).toMatch(/Installed/);
    expect(rows.find((r) => r.getAttribute('data-key') === 'catalog:cursor')!.textContent).not.toMatch(/Signed in/);
    const model = rows.find((r) => r.getAttribute('data-kind') === 'model')!;
    expect(model.textContent).toMatch(/^Chat model: Nebius/);
    expect(model.textContent).not.toMatch(/per 1M|in \/ \$|never copied/);
  });

  it('the model named is a familiar one, not the catalog first', () => {
    const p = { ...NEBIUS, models: [{ id: 'meta-models/muse-spark-open', name: 'Muse Spark Open' }, { id: 'deepseek-ai/DeepSeek-V4.1-Flash', name: 'DeepSeek V4.1 Flash' }] };
    const found = foundOnMachine([], [], [{ id: 'nebius', name: 'Nebius', keyEnv: 'NEBIUS_API_KEY' }], false, [p as never]);
    expect(found[0]!.label).toBe('Chat model: Nebius, DeepSeek V4.1 Flash');
  });

  it('on the welcome, the dialog has focus, not Set up everything, and the Found agents are not listed again below', async () => {
    const { f } = server({ catalog: [{ id: 'hermes', name: 'Hermes Agent', state: 'ready' }, { id: 'gemini', name: 'Gemini CLI', state: 'npx' }] });
    vi.stubGlobal('fetch', f);
    const client = { providers: vi.fn(async () => ({ ok: true as const, body: [codexReady] })), repos: vi.fn(async () => ({ ok: true as const, body: { repos: [], truncated: false } })) } as unknown as OnboardingClient;
    render(<FirstRun client={client} onDone={() => {}} />);
    await screen.findByTestId('ready-set-up');
    await waitFor(() => expect(screen.getByTestId('first-run-more').textContent).toBe('More agents: Gemini CLI'));
    expect(document.activeElement).not.toBe(screen.getByTestId('ready-set-up'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('first-run')));
    expect(screen.getByTestId('first-run-more').getAttribute('aria-expanded')).toBe('false');
  });
});
