import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuns } from '../agents/agentRuns';
import { resetSignInState } from '../onboarding/signInState';
import { StoreProvider, createStore } from '../state';
import { V3App } from '../v3/V3App';
import { COMPACT_MENU_W, ModelMenu } from './ModelMenu';
import cssRaw from './modelMenu.css?raw';
import chat2Raw from './chat2.css?raw';

/* Owner-seat sweep: at 390 the agent flyout drew over the row that opened it. On a narrow window the models are a page
   of the menu (a back row on top), as an iOS menu does; a wide window keeps the flyout. The same file holds the
   copy nits: the group heading, the default-model row and the @ menu. */

const SID = 'chat-1';
const READY_CODEX = { id: 'codex', label: 'Codex', installed: true, version: '0.153.4', state: 'ready', plan: 'ChatGPT', signInCommand: 'codex login', installHint: 'npm i -g @openai/codex' };
const MODELS: Record<string, unknown[]> = {
  codex: [
    { id: 'gpt-6-astra', name: 'GPT-6-Astra', efforts: ['low', 'medium', 'high'], isDefault: true },
    { id: 'gpt-6-lite', name: 'GPT-6-Lite', efforts: ['low'] },
  ],
  cursor: [],
};

function stubServer(registered: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      const json = (status: number, b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } }));
      if (url === '/api/acp/agents') return json(200, { agents: registered.map((id) => ({ id, label: id })) });
      if (url.startsWith('/api/onboarding/providers')) return json(200, { providers: [READY_CODEX] });
      if (url.startsWith('/api/acp/capabilities')) {
        const ref = new URL(url, 'http://x').searchParams.get('agentRef') ?? '';
        return json(200, { agentRef: ref, models: MODELS[ref] ?? [], efforts: [], commands: [], skills: [] });
      }
      return json(404, {});
    }),
  );
}

function Host() {
  const [open, setOpen] = useState(true);
  const [run, setRun] = useState<string | undefined>(agentRuns.get().agents?.[SID] || undefined);
  agentRuns.subscribe(() => setRun(agentRuns.get().agents?.[SID] || undefined));
  return (
    <StoreProvider store={createStore({})}>
      <ModelMenu
        wrapRef={createRef<HTMLDivElement>()}
        open={open}
        onTrigger={() => setOpen((v) => !v)}
        onClose={() => setOpen(false)}
        sessionId={SID}
        agentRun={run}
        profiles={[]}
        pickModel={() => {}}
        modelErr={null}
        effort="medium"
        effortRows={[{ key: 'medium', label: 'Medium', description: 'Medium' }]}
        pickEffort={() => {}}
        modelChip="Connect agent"
        modelChipShort="Connect agent"
        modelChipTitle="Connect agent"
        effortLabel="Medium"
        modes={[{ key: 'plan', label: 'Plan', desc: 'Plans and teaches, no edits', icon: 'map' }]}
        currentMode="plan"
        onMode={() => {}}
      />
    </StoreProvider>
  );
}

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
const agentRow = (ref: string) =>
  waitFor(
    () => {
      const el = document.querySelector<HTMLElement>(`[data-testid="s2-agent-row"][data-agent="${ref}"]`);
      if (!el) throw new Error(`no row for ${ref}`);
      return el;
    },
    { timeout: 4000 },
  );

beforeAll(async () => {
  await Promise.all([import('./ConnectAgents'), import('../agents/agentRunner')]);
}, 120_000);
beforeEach(() => {
  resetSignInState();
  agentRuns.patch((s) => ({ ...s, runs: [], agents: {}, caps: {}, config: {}, capsError: {}, registered: undefined }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setWidth(1024);
});

describe('the agent flyout on a narrow window drills in', () => {
  it('at 390 a click opens the agent as a page of the menu with a back row, and no flyout beside it', async () => {
    expect(COMPACT_MENU_W).toBe(720);
    setWidth(390);
    stubServer(['codex']);
    render(<Host />);
    const row = await agentRow('codex');
    await waitFor(() => expect(agentRuns.get().caps?.codex).toBeTruthy());
    fireEvent.click(row);
    const page = await screen.findByTestId('s2-agent-page');
    expect(screen.queryByTestId('s2-agent-flyout')).toBeNull();
    expect(screen.getByTestId('s2-model-menu').contains(page)).toBe(true);
    expect(screen.getByTestId('s2-model-menu').getAttribute('data-page')).toBe('agent');
    expect(within(page).getByTestId('s2-agent-back').textContent).toContain('Codex');
    expect(within(page).getAllByTestId('agent-model').map((r) => r.getAttribute('data-model'))).toEqual(['gpt-6-astra', 'gpt-6-lite']);
    /* the back row is first in the page */
    expect(page.firstElementChild).toBe(within(page).getByTestId('s2-agent-back'));
  });

  it('the back row returns to the list and hands focus back to the agent row', async () => {
    setWidth(390);
    stubServer(['codex']);
    render(<Host />);
    const row = await agentRow('codex');
    await waitFor(() => expect(agentRuns.get().caps?.codex).toBeTruthy());
    fireEvent.click(row);
    fireEvent.click(await screen.findByTestId('s2-agent-back'));
    expect(screen.queryByTestId('s2-agent-page')).toBeNull();
    expect(screen.getByTestId('s2-model-menu').getAttribute('data-page')).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it('Escape on the page goes back one level, not out of the menu', async () => {
    setWidth(390);
    stubServer(['codex']);
    render(<Host />);
    const row = await agentRow('codex');
    await waitFor(() => expect(agentRuns.get().caps?.codex).toBeTruthy());
    fireEvent.click(row);
    const back = await screen.findByTestId('s2-agent-back');
    fireEvent.keyDown(back, { key: 'Escape' });
    expect(screen.queryByTestId('s2-agent-page')).toBeNull();
    expect(screen.getByTestId('s2-model-menu')).toBeTruthy();
  });

  it('hovering a row opens nothing on a narrow window', async () => {
    setWidth(390);
    stubServer(['codex']);
    render(<Host />);
    const row = await agentRow('codex');
    await waitFor(() => expect(agentRuns.get().caps?.codex).toBeTruthy());
    fireEvent.pointerEnter(row);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    expect(screen.queryByTestId('s2-agent-page')).toBeNull();
    expect(screen.queryByTestId('s2-agent-flyout')).toBeNull();
  });

  it('a wide window keeps the flyout and draws no page (negative control)', async () => {
    setWidth(1024);
    stubServer(['codex']);
    render(<Host />);
    const row = await agentRow('codex');
    await waitFor(() => expect(agentRuns.get().caps?.codex).toBeTruthy());
    fireEvent.click(row);
    expect(await screen.findByTestId('s2-agent-flyout')).toBeTruthy();
    expect(screen.queryByTestId('s2-agent-page')).toBeNull();
  });

  it('the page slides under no-preference only: reduced motion is an instant swap', () => {
    const css = cssRaw.replace(/\r\n/g, '\n');
    const at = css.indexOf('@media (prefers-reduced-motion: no-preference) {\n  .s2-menu-page[data-state=');
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at)).toMatch(/s2-menu-page\[data-state='open'\]\s*\{\s*animation: s2-page-in/);
    /* nothing animates the page outside that block */
    expect(css.slice(0, at)).not.toMatch(/\.s2-menu-page[^{]*\{[^}]*animation/);
  });
});

describe('the model menu copy', () => {
  it('heads a connected agent "Agents", not "Connect an agent"', async () => {
    stubServer(['codex']);
    render(<Host />);
    await agentRow('codex');
    expect(screen.getByTestId('s2-connect').querySelector('.s2-menu-gh')!.textContent).toBe('Agents');
  });

  it('an agent with no model list shows one "Default model" row that says who picks it, not "<Agent> default / Its default model"', async () => {
    stubServer(['cursor']);
    setWidth(390);
    render(<Host />);
    const row = await agentRow('cursor');
    await waitFor(() => expect(agentRuns.get().caps?.cursor).toBeTruthy());
    fireEvent.click(row);
    const page = await screen.findByTestId('s2-agent-page');
    const only = within(page).getByTestId('agent-default-model');
    expect(only.querySelector('.s2-mi-name')!.textContent).toBe('Default model');
    expect(only.querySelector('.s2-mi-note')!.textContent).toMatch(/picks it$/);
    expect(page.textContent).not.toContain('Its default model');
  });
});

describe('the @ menu', () => {
  const results = [
    { kind: 'node', ref: 'svc:edge', label: 'edge', detail: 'edge', nodeKind: 'service' },
    { kind: 'node', ref: 'db:redis', label: 'redis', detail: null, nodeKind: 'datastore' },
    { kind: 'file', ref: 'gateway/index.ts', label: 'index.ts', detail: 'gateway/index.ts', nodeKind: null },
  ];

  it('draws a detail only when it says something the name does not', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const store = createStore({});
    render(<V3App appStore={store} />);
    act(() => {
      store.dispatch({ type: 'composer/mention', mention: { query: 'e', from: 0, to: 2, status: 'resolved', results, activeIndex: 0 } } as never);
    });
    const rows = await screen.findAllByTestId('composer-mention');
    const detailOf = (i: number) => rows[i]!.querySelector('.s2-mi-d span')?.textContent ?? null;
    expect(detailOf(0)).toBeNull();
    expect(detailOf(1)).toBeNull();
    expect(detailOf(2)).toBe('gateway/index.ts');
  });

  it('every row is one line and one height', () => {
    const css = chat2Raw.replace(/\r\n/g, '\n');
    const rule = (sel: string) => css.slice(css.indexOf(`\n${sel} {`), css.indexOf('}', css.indexOf(`\n${sel} {`)));
    expect(rule('.s2-mention .s2-mi')).toContain('height: var(--row-h)');
    expect(rule('.s2-mention .s2-mi-d')).toContain('flex-direction: row');
  });
});
