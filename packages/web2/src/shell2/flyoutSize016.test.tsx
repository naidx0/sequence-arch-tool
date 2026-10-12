import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { createRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuns } from '../agents/agentRuns';
import { resetSignInState } from '../onboarding/signInState';
import { StoreProvider, createStore } from '../state';
import { ModelMenu } from './ModelMenu';

/*
 * Owner, 2026-10-11, on the agent flyout: "It doesn't have to pan out so wide for just a model name... It's expanding
 * too wide. It should be a smaller box, easier to navigate." Every agent's flyout is as wide as its widest model row
 * (between a floor and a ceiling), a long name ellipsizes with its title, and the placement is measured again whenever
 * the box changes size.
 */

const SID = 'chat-1';
const LONG = 'A-Very-Long-Model-Name-That-Would-Never-Fit-In-A-Small-Box-0123456789';
const MODELS = {
  codex: [
    { id: 'gpt-6-astra', name: 'GPT-6-Astra', efforts: ['low', 'medium', 'high'], isDefault: true },
    { id: 'long-one', name: LONG, efforts: ['low'] },
  ],
};

function stubServer() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } }));
      if (url === '/api/acp/agents') return json({ agents: [{ id: 'codex', label: 'codex' }] });
      if (url.startsWith('/api/onboarding/providers')) return json({ providers: [{ id: 'codex', label: 'Codex', installed: true, version: '1', state: 'ready', plan: 'ChatGPT', signInCommand: 'codex login', installHint: '' }] });
      if (url.startsWith('/api/acp/capabilities')) return json({ agentRef: 'codex', models: MODELS.codex, efforts: [], commands: [], skills: [] });
      return Promise.resolve(new Response('{}', { status: 404 }));
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
        modes={[]}
        currentMode="plan"
        onMode={() => {}}
      />
    </StoreProvider>
  );
}

beforeEach(() => {
  resetSignInState();
  agentRuns.patch((s) => ({ ...s, runs: [], agents: {}, caps: {}, config: {}, capsError: {}, registered: undefined }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const css = fs.readFileSync(path.join(__dirname, 'modelMenu.css'), 'utf8').replace(/\r\n/g, '\n');
const block = (sel: string) => {
  const i = css.indexOf(`\n${sel} {`);
  if (i < 0) throw new Error(`no rule for ${sel}`);
  return css.slice(i, css.indexOf('\n}', i));
};

describe('the agent flyout is a small box sized to its rows', () => {
  it('has no fixed wide panel: width follows the widest row, between a ~180px floor and a ~280px ceiling', () => {
    const fly = block('.s2-menu.s2-menu-fly');
    expect(fly).toMatch(/width:\s*max-content/);
    expect(fly).not.toMatch(/--menu-w/);
    expect(fly).toMatch(/min-width:[^;]*--s2-fly-min/);
    expect(fly).toMatch(/max-width:[^;]*--s2-fly-max/);
    expect(css).toMatch(/--s2-fly-min:\s*180px/);
    expect(css).toMatch(/--s2-fly-max:\s*280px/);
  });

  it('a name is not capped at 60% of a box that is only as wide as its rows, and it never shrinks; the note gives way before it', () => {
    const name = block('.s2-menu-fly .s2-mi-name');
    expect(name).toMatch(/max-width:\s*none/);
    /* flex-shrink 0: the name keeps its full width, so it is never cut to "Opus ..." while the description takes the room. */
    expect(name).toMatch(/flex:\s*0\s+0\s+auto/);
    expect(name).not.toMatch(/text-overflow|overflow|flex:\s*\S+\s+1\s/);
    const note = block('.s2-menu-fly .s2-mi-note');
    const shrink = Number(/flex:\s*\S+\s+(\d+)/.exec(note)?.[1]);
    expect(shrink).toBeGreaterThan(1);
  });

  it('a long name ellipsizes and keeps its whole name in the title', async () => {
    stubServer();
    render(<Host />);
    const r = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-testid="s2-agent-row"][data-agent="codex"]');
      if (!el) throw new Error('no row');
      return el;
    }, { timeout: 4000 });
    await waitFor(() => expect(agentRuns.get().caps?.codex).toBeTruthy());
    fireEvent.click(r);
    const flyout = await screen.findByTestId('s2-agent-flyout');
    const long = within(flyout).getAllByTestId('agent-model').find((m) => m.getAttribute('data-model') === 'long-one')!;
    const shown = long.querySelector('.s2-mi-name')!.textContent!;
    expect(shown.length).toBeGreaterThan(40);
    expect(long.getAttribute('title')).toContain(shown);
    expect(long.getAttribute('title')).toContain('long-one');
    const chat = fs.readFileSync(path.join(__dirname, 'chat2.css'), 'utf8');
    expect(/\n\.s2-mi-name \{[^}]*text-overflow:\s*ellipsis/.test(chat)).toBe(true);
  });

  it('is placed again when the box changes size (rows change its width, so its side and left change)', async () => {
    const observers: (() => void)[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          observers.push(cb);
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    let w = 100;
    const rect = Element.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => w);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.getAttribute('data-testid') === 's2-model-menu'
        ? ({ left: 100, right: 300, top: 0, bottom: 0, width: 200, height: 0, x: 100, y: 0, toJSON() {} } as DOMRect)
        : rect.call(this);
    });
    stubServer();
    render(<Host />);
    const r = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-testid="s2-agent-row"][data-agent="codex"]');
      if (!el) throw new Error('no row');
      return el;
    }, { timeout: 4000 });
    await waitFor(() => expect(agentRuns.get().caps?.codex).toBeTruthy());
    fireEvent.click(r);
    const flyout = await screen.findByTestId('s2-agent-flyout');
    expect(observers.length).toBeGreaterThan(0);
    expect(flyout.style.left).toBe('306px');
    /* Wider rows: the box grows, the right edge would leave the window, so it is moved in. */
    w = 800;
    for (const cb of observers) cb();
    expect(flyout.style.left).toBe('216px');
  });
});
