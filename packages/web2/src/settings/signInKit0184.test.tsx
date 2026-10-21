/* ══════════════════════════════════════════════════════════════════════════
   0.1.8.4: THE SIGN-IN PANEL USES ITS HOST'S BUTTONS
   packages/web2/src/settings/signInKit0184.test.tsx

   Owner: some buttons "blend in". The browser sign-in panel drew Cancel, Open the page again and Show details with
   first run's borderless ghost words, inside Settings and inside the model menu, where every other button is a pill
   or an s2-btn with an edge. Each host now hands the panel its own kit. The Claude row that needs the bridge and a
   sign-in showed two filled buttons, Sign in first; its sentence says the bridge first, and one primary per row.
   ══════════════════════════════════════════════════════════════════════════ */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentRunStore } from '../agents/agentRuns';
import { resetSignInState } from '../onboarding/signInState';
import type { OnboardingClient, ProviderStatus } from '../onboarding/onboardingClient';
import { ConnectAgents } from '../shell2/ConnectAgents';
import { StoreProvider, createStore } from '../state';
import { AgentsPane } from './AgentsPane';
import { agentRows, type AgentsClient } from './agentsClient';
import css from './settings.css?raw';
import menuCss from '../shell2/connectAgents.css?raw';

vi.mock('../terminal/terminalClient', async (orig) => {
  const real = await orig<typeof import('../terminal/terminalClient')>();
  return {
    ...real,
    connectTerminal: vi.fn(async (handlers: { onOutput: (b: Uint8Array) => void }) => {
      handlers.onOutput(new TextEncoder().encode('Sign in at https://claude.example.invalid/authorize\n'));
      return { sendInput() {}, resize() {}, close() {}, readyState: 1 };
    }),
  };
});

afterEach(() => resetSignInState());
vi.spyOn(window, 'open').mockImplementation(() => null);

const CLAUDE: ProviderStatus = { id: 'claude', label: 'Claude Code', installed: true, version: '2.1.120', state: 'signIn', signInCommand: 'claude auth login', installHint: 'npm i -g claude', adapterInstall: 'npm i -g claude-agent-acp' };
const onboarding: OnboardingClient = { providers: async () => ({ ok: true, body: [CLAUDE] }), repos: async () => ({ ok: true, body: { repos: [], truncated: false } }), installBridge: async () => ({ ok: true, body: { state: 'running', output: [] } }) };
const BTN = ['first-run-signin-cancel', 'first-run-signin-open', 'first-run-signin-details'];

describe('Settings > Agents: the sign-in panel and the bridge', () => {
  const api: AgentsClient = { list: async () => ({ outcome: 'ok', body: agentRows([CLAUDE], []) }) };

  it('Cancel, Open the page again and Show details are Settings pills, none a borderless first-run ghost', async () => {
    render(<AgentsPane client={api} onboardingClient={onboarding} catalog={false} />);
    fireEvent.click(await screen.findByTestId('settings-agent-signin'));
    const panel = await screen.findByTestId('settings-agent-terminal');
    for (const id of BTN) {
      const b = await within(panel).findByTestId(id);
      expect(b.className, id).toContain('sb-pill');
      expect(b.className, id).not.toContain('fr-ghost');
    }
  });

  it('a row that needs the bridge and a sign-in has one filled button, the bridge, before Sign in', async () => {
    render(<AgentsPane client={api} onboardingClient={onboarding} catalog={false} />);
    const row = await screen.findByTestId('settings-agent');
    const bridge = within(row).getByTestId('bridge-install-button');
    const signIn = within(row).getByTestId('settings-agent-signin');
    expect(bridge.compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING, 'bridge first').toBeTruthy();
    expect(row.querySelectorAll('.sb-pill-solid')).toHaveLength(1);
    expect(bridge.className).toContain('sb-pill-solid');
    expect(signIn.className).not.toContain('sb-pill-solid');
  });

  it('a line of actions wraps instead of shrinking the pills into each other, and the panel is as tall as its content (CSS)', () => {
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (sel: string) => [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1]!.trim() === sel).map((m) => m[2]).join(';');
    expect(rule('.settings-scope .sb-agent-acts')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.settings-scope .sb-agent-acts > .sb-pill, .settings-scope .sb-agent-acts .bridge .sb-pill')).toMatch(/flex:\s*none/);
    expect(rule('.settings-scope .sb-agent-term')).not.toMatch(/height:\s*\d+px|overflow:\s*hidden/);
  });
});

describe('the model menu: the sign-in panel uses the menu buttons', () => {
  it('its buttons are s2-btn, and the panel is not a fixed-height clip (CSS)', async () => {
    const f = async (url: string): Promise<Response> => new Response(JSON.stringify(url === '/api/acp/agents' ? { agents: [] } : {}), { status: url === '/api/acp/agents' ? 200 : 404, headers: { 'content-type': 'application/json' } });
    render(
      <StoreProvider store={createStore({})}>
        <ConnectAgents sessionId="s1" fetchImpl={f} store={createAgentRunStore()} onboarding={onboarding} />
      </StoreProvider>,
    );
    fireEvent.click(await screen.findByTestId('s2-signin-claude'));
    for (const id of BTN) {
      const b = await screen.findByTestId(id);
      expect(b.className, id).toContain('s2-btn');
      expect(b.className, id).not.toContain('fr-ghost');
    }
    expect(menuCss.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/height:\s*168px/);
  });
});
