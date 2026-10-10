import { act, render, screen, waitFor, within } from '@testing-library/react';
import { createRef } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuns } from '../agents/agentRuns';
import { forgetAgent, noteConnected } from '../agents/agentRegistry';
import { capsTimeout } from '../agents/agentRunner';
import { StoreProvider, createStore } from '../state';
import { ModelMenu } from './ModelMenu';

/*
 * 0.1.5 G1, the owner on the installed app: "I have Codex enabled. I can't add
 * it anywhere in my model picker." Settings said Connected (it only means
 * registered), "but its models can't be read right now", and "I disconnected
 * it. I reconnected it. Still nothing."
 *
 * The state built here is his: codex registered (GET /api/acp/agents names it),
 * first run reads it ready and signed in, and its model list cannot be read
 * (the capabilities route fails), is empty, or has not answered yet. Before the
 * fix the picker had no Codex row in any of these: a registered agent was
 * hidden from "Connect an agent" and its group was built only from a non-empty
 * model list, so there was nothing to click.
 */

const SID = 'chat-1';
const READY_CODEX = { id: 'codex', label: 'Codex', installed: true, version: '0.153.4', state: 'ready', plan: 'ChatGPT', signInCommand: 'codex login', installHint: 'npm i -g @openai/codex' };

type Caps = 'fail' | 'empty' | 'pending' | 'models';

/* Requests that have not answered yet; each settles when its signal aborts, as a real fetch does. */
let inFlight: Promise<unknown>[] = [];

/* As a real fetch: a request that has not answered rejects with the signal's reason when its signal aborts. */
function hang(init?: RequestInit): Promise<Response> {
  const p = new Promise<Response>((_, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  if (init?.signal) inFlight.push(p.catch(() => undefined));
  return p;
}

function stubServer(caps: { current: Caps }) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    /* Not async: a request that hangs is the very promise a real fetch hands back, so its abort settles it first. */
    vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      calls.push(url);
      if (url === '/api/acp/agents') return Promise.resolve(new Response(JSON.stringify({ agents: [{ id: 'codex', label: 'Codex' }] }), { status: 200 }));
      if (url.startsWith('/api/onboarding/providers')) return Promise.resolve(new Response(JSON.stringify({ providers: [READY_CODEX] }), { status: 200 }));
      if (url.startsWith('/api/acp/capabilities')) {
        if (caps.current === 'fail') return Promise.resolve(new Response(JSON.stringify({ error: 'the agent could not say what it offers: codex app-server exited (code=1)' }), { status: 502 }));
        if (caps.current === 'pending') return hang(init);
        const models = caps.current === 'models' ? [{ id: 'gpt-6-astra', name: 'GPT-6-Astra', efforts: ['low', 'medium'], isDefault: true }] : [];
        return Promise.resolve(new Response(JSON.stringify({ agentRef: 'codex', models, efforts: [], commands: [], skills: [] }), { status: 200 }));
      }
      return hang(init);
    }),
  );
  return calls;
}

function mount(onClose = vi.fn()) {
  const wrapRef = createRef<HTMLDivElement>();
  const ui = (agentRun: string | undefined) => (
    <StoreProvider store={createStore({})}>
      <ModelMenu
        wrapRef={wrapRef}
        open
        onTrigger={() => {}}
        onClose={onClose}
        sessionId={SID}
        agentRun={agentRun}
        profiles={[]}
        pickModel={vi.fn()}
        modelErr={null}
        effort="medium"
        effortRows={[{ key: 'medium', label: 'Medium', description: 'Medium' }]}
        pickEffort={() => {}}
        modelChip="Connect an agent"
        modelChipShort="Connect an agent"
        modelChipTitle="Connect an agent"
        effortLabel="Medium"
        modes={[]}
        currentMode="ask"
        onMode={() => {}}
      />
    </StoreProvider>
  );
  const r = render(ui(agentRuns.get().agents?.[SID] || undefined));
  /* The composer passes the chat's agent down; re-render as it would after a pick. */
  const sync = () => r.rerender(ui(agentRuns.get().agents?.[SID] || undefined));
  return { onClose, sync };
}

const settle = () => act(async () => {
  await new Promise((r) => setTimeout(r, 30));
});

/* A request that never answers gives up quickly here, so none is still in flight for the next test. */
const realTimeout = capsTimeout.ms;
beforeEach(() => {
  capsTimeout.ms = 150;
  agentRuns.patch((s) => ({ ...s, runs: [], agents: {}, caps: {}, config: {}, capsError: {}, registered: undefined }));
});
afterEach(async () => {
  /* Event-driven, not a fixed sleep: every request still waiting has given up (its signal aborted) before the next test. */
  await act(async () => {
    await Promise.all(inFlight);
  });
  inFlight = [];
  vi.unstubAllGlobals();
});
afterAll(() => {
  capsTimeout.ms = realTimeout;
});

describe('a connected Codex whose models cannot be read is still in the picker', () => {
  for (const state of ['fail', 'empty', 'pending'] as const) {
    it(`model list ${state}: the OpenAI group offers Codex on its default model, and one click attaches it`, async () => {
      stubServer({ current: state });
      const { onClose, sync } = mount();
      /* Waits for the thing itself, not a fixed sleep: a loaded machine is slower than 30 ms. */
      const group = await screen.findByTestId('s2-model-group-openai', {}, { timeout: 4000 });
      const row = await within(group).findByTestId('agent-default-model', {}, { timeout: 4000 });
      expect(row.getAttribute('data-agent')).toBe('codex');
      expect(row.getAttribute('aria-disabled')).not.toBe('true');
      /* Not offered twice: a registered agent is not also under "Connect an agent". */
      expect(screen.queryByTestId('s2-connect-codex')).toBeNull();
      act(() => row.click());
      expect(agentRuns.get().agents?.[SID]).toBe('codex');
      expect(onClose).toHaveBeenCalled();
      sync();
      expect(within(screen.getByTestId('s2-model-group-openai')).getByTestId('agent-default-model').getAttribute('aria-checked')).toBe('true');
    });
  }

  it('an agent that never answers becomes an honest failure with Retry, not "Reading" for ever', async () => {
    {
      stubServer({ current: 'pending' });
      mount();
      await settle();
      expect(within(screen.getByTestId('s2-model-group-openai')).getByTestId('agent-default-model').textContent).toContain('Reading its models');
      /* Waits for the failure itself (up to 3 s), not a fixed 250 ms against a 150 ms timeout. */
      const err = await screen.findByTestId('s2-model-caps-error', {}, { timeout: 3000 });
      /* The page's own reason, not the fetch's abort ("signal is aborted without reason"). */
      expect(err.textContent).toContain('did not answer within');
      expect(err.textContent).not.toMatch(/abort/i);
      expect(screen.getByTestId('s2-model-caps-retry')).toBeTruthy();
    }
  });

  it('says honestly why, with one Retry, even before the chat is on Codex', async () => {
    const caps = { current: 'fail' as Caps };
    const calls = stubServer(caps);
    mount();
    const err = await screen.findByTestId('s2-model-caps-error', {}, { timeout: 4000 });
    expect(err.textContent).toContain('codex app-server exited');
    expect(within(screen.getByTestId('s2-model-group-openai')).getByTestId('s2-model-caps-retry')).toBeTruthy();
    caps.current = 'models';
    act(() => screen.getByTestId('s2-model-caps-retry').click());
    const rows = await within(screen.getByTestId('s2-model-group-openai')).findAllByTestId('agent-model', {}, { timeout: 4000 });
    expect(calls.filter((c) => c.includes('refresh=1'))).toHaveLength(1);
    expect(rows.map((r) => r.getAttribute('data-model'))).toEqual(['gpt-6-astra']);
    expect(screen.queryByTestId('s2-model-caps-error')).toBeNull();
  });
});

describe('an agent with no provider group of its own', () => {
  it('its group header names it once; its row is the model, not the agent again', async () => {
    /* 0.1.5 review: an agent that is neither Claude nor OpenAI got a group named after itself AND a row of the same
       name under it ("Hang" / "Hang"). */
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        if (url === '/api/acp/agents') return Promise.resolve(new Response(JSON.stringify({ agents: [{ id: 'hang', label: 'Hang' }] }), { status: 200 }));
        if (url.startsWith('/api/acp/capabilities')) return Promise.resolve(new Response(JSON.stringify({ error: 'it printed nothing' }), { status: 502 }));
        return hang(init);
      }),
    );
    act(() => agentRuns.patch((s) => ({ ...s, registered: ['hang'] })));
    mount();
    await settle();
    const group = await screen.findByTestId('s2-model-group-hang');
    const header = group.querySelector('.s2-group-h')!.textContent!.trim();
    const row = within(group).getByTestId('agent-default-model');
    const rowName = row.querySelector('.s2-mi-name')!.textContent!.trim();
    expect(header).toBe('Hang');
    expect(rowName).not.toBe(header);
    expect(rowName).toBe('Hang default');
    /* Still one click to attach it. */
    act(() => row.click());
    expect(agentRuns.get().agents?.[SID]).toBe('hang');
  });
});

describe('disconnect and reconnect change the picker at once', () => {
  it('disconnect drops Codex and detaches its chats; reconnect asks for its models again despite an old failure', async () => {
    const caps = { current: 'fail' as Caps };
    const calls = stubServer(caps);
    mount();
    await screen.findByTestId('s2-model-caps-error', {}, { timeout: 4000 });
    act(() => agentRuns.patch((s) => ({ ...s, agents: { [SID]: 'codex' } })));

    act(() => forgetAgent(agentRuns, 'codex'));
    expect(agentRuns.get().agents?.[SID]).toBe('');
    expect(agentRuns.get().capsError?.codex).toBeUndefined();
    expect(screen.queryByTestId('s2-model-group-openai')).toBeNull();

    caps.current = 'models';
    const before = calls.filter((c) => c.startsWith('/api/acp/capabilities')).length;
    await act(async () => {
      await noteConnected(agentRuns, 'codex', (i, init) => fetch(i, init));
    });
    expect(calls.filter((c) => c.startsWith('/api/acp/capabilities')).length).toBe(before + 1);
    expect(calls[calls.length - 1]).toContain('refresh=1');
    await waitFor(() => expect(within(screen.getByTestId('s2-model-group-openai')).getAllByTestId('agent-model')).toHaveLength(1));
  });
});
