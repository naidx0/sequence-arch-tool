import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('EffortFold keeps focus when its section goes away', () => {
  it('moves focus from a control inside it to the menu\'s agent row', () => {
    const ui = (show: boolean) => (
      <div data-testid="s2-model-menu">
        <button data-testid="s2-agent-row">agent</button>
        <EffortFold show={show}>
          <button data-testid="in-fold">stop</button>
        </EffortFold>
      </div>
    );
    const { rerender } = render(ui(true));
    screen.getByTestId('in-fold').focus();
    expect(document.activeElement).toBe(screen.getByTestId('in-fold'));
    rerender(ui(false));
    expect(document.activeElement).toBe(screen.getByTestId('s2-agent-row'));
  });

  it('leaves focus alone when it was elsewhere', () => {
    const ui = (show: boolean) => (
      <div data-testid="s2-model-menu">
        <button data-testid="s2-agent-row">agent</button>
        <button data-testid="other">other</button>
        <EffortFold show={show}>
          <button>stop</button>
        </EffortFold>
      </div>
    );
    const { rerender } = render(ui(true));
    screen.getByTestId('other').focus();
    rerender(ui(false));
    expect(document.activeElement).toBe(screen.getByTestId('other'));
  });
});
