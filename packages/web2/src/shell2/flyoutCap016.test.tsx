import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuns } from '../agents/agentRuns';
import { resetSignInState } from '../onboarding/signInState';
import { StoreProvider, createStore } from '../state';
import { EffortFold, FLY_MAX_H, ModelMenu } from './ModelMenu';

/*
 * Review follow-ups on the agent flyout and the effort fold: the flyout follows its row while the menu folds, focus
 * is not lost with a section that goes away, and the flyout is a small box (about ten rows) that scrolls inside.
 */

const SID = 'chat-1';
const MODELS = Array.from({ length: 14 }, (_, i) => ({ id: `m${i}`, name: `Model ${i}`, efforts: ['low', 'high'], isDefault: i === 0 }));

function stubServer() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } }));
      if (url === '/api/acp/agents') return json({ agents: [{ id: 'codex', label: 'codex' }] });
      if (url.startsWith('/api/onboarding/providers')) return json({ providers: [{ id: 'codex', label: 'Codex', installed: true, version: '1', state: 'ready', plan: 'ChatGPT', signInCommand: 'codex login', installHint: '' }] });
      if (url.startsWith('/api/acp/capabilities')) return json({ agentRef: 'codex', models: MODELS, efforts: [], commands: [], skills: [] });
      return Promise.resolve(new Response('{}', { status: 404 }));
    }),
  );
}

function menu() {
  return (
    <StoreProvider store={createStore({})}>
      <ModelMenu
        wrapRef={createRef<HTMLDivElement>()}
        open={true}
        onTrigger={() => {}}
        onClose={() => {}}
        sessionId={SID}
        agentRun="codex"
        profiles={[]}
        pickModel={() => {}}
        modelErr={null}
        effort="medium"
        effortRows={[{ key: 'medium', label: 'Medium', description: 'Medium' }]}
        pickEffort={() => {}}
        modelChip="Codex"
        modelChipShort="Codex"
        modelChipTitle="Codex"
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
  agentRuns.patch((s) => ({ ...s, runs: [], agents: { [SID]: 'codex' }, caps: {}, config: {}, capsError: {}, registered: undefined }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the open flyout is a small box', () => {
  it('stops at about ten rows and scrolls inside, however tall the window is', async () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(2000);
    stubServer();
    render(menu());
    await waitFor(() => expect(agentRuns.get().caps?.codex).toBeTruthy());
    fireEvent.click(await screen.findByTestId('s2-agent-row'));
    const flyout = await screen.findByTestId('s2-agent-flyout');
    expect(FLY_MAX_H).toBeLessThan(400);
    expect(FLY_MAX_H).toBeGreaterThanOrEqual(10 * 32);
    expect(flyout.style.maxHeight).toBe(`${FLY_MAX_H}px`);
  });

  it('the CSS bounds the height by the window too, so the box cannot run off the bottom before it is placed', () => {
    const css = fs.readFileSync(path.join(__dirname, 'modelMenu.css'), 'utf8').replace(/\r\n/g, '\n');
    const i = css.indexOf('\n.s2-menu.s2-menu-fly {');
    const rule = css.slice(i, css.indexOf('\n}', i));
    expect(rule).toMatch(/max-height:\s*calc\(100vh\s*-\s*var\(--sp-16\)\)/);
    expect(rule).toMatch(/overflow-y:\s*auto/);
  });

  it('still fits a short window', async () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(200);
    stubServer();
    render(menu());
    await waitFor(() => expect(agentRuns.get().caps?.codex).toBeTruthy());
    fireEvent.click(await screen.findByTestId('s2-agent-row'));
    expect((await screen.findByTestId('s2-agent-flyout')).style.maxHeight).toBe('184px');
  });
});
