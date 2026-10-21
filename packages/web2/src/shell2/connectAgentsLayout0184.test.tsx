/* ══════════════════════════════════════════════════════════════════════════
   0.1.8.4: THE CONNECT MENU, NOTHING CONNECTED YET
   packages/web2/src/shell2/connectAgentsLayout0184.test.tsx

   Owner: "buttons blend in and overlap words (Claude, Codex rows)". Reproduced on a machine with no agent CLI
   and no model: each row drew Copy setup prompt and Connect a model beside the name, and the two buttons took
   the whole line, so the name and its note had no width at all (a row of an icon and two buttons, nothing to say
   which agent it was). The two buttons now sit on their own line under the words.
   ══════════════════════════════════════════════════════════════════════════ */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createAgentRunStore } from '../agents/agentRuns';
import type { OnboardingClient, ProviderStatus } from '../onboarding/onboardingClient';
import { StoreProvider, createStore } from '../state';
import { ConnectAgents } from './ConnectAgents';
import menuCss from './modelMenu.css?raw';

const P = (id: string, label: string): ProviderStatus => ({ id, label, installed: false, version: null, state: 'install', signInCommand: `${id} login`, installHint: `npm install -g ${id}` });

const onboarding = (list: ProviderStatus[]): OnboardingClient => ({ providers: async () => ({ ok: true, body: list }), repos: async () => ({ ok: true, body: { repos: [], truncated: false } }) });

const fetchImpl = async (url: string): Promise<Response> => new Response(JSON.stringify(url === '/api/acp/agents' ? { agents: [] } : {}), { status: url === '/api/acp/agents' ? 200 : 404, headers: { 'content-type': 'application/json' } });

const rule = (sel: string): string => {
  const css = menuCss.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1]!.trim() === sel).map((m) => m[2]).join(';');
};

describe('Connect an agent with nothing connected: the name keeps its line', () => {
  it('an installable agent gets one Install action beside the name, not two actions that squeeze it', async () => {
    render(
      <StoreProvider store={createStore({})}>
        <ConnectAgents sessionId="s1" fetchImpl={fetchImpl} store={createAgentRunStore()} onboarding={onboarding([P('claude', 'Claude Code'), P('codex', 'Codex')])} />
      </StoreProvider>,
    );
    for (const id of ['claude', 'codex']) {
      const line = await screen.findByTestId(`s2-connect-line-${id}`);
      expect(line.querySelector('.s2-agent-line-acts')).toBeNull();
      expect(screen.getByTestId(`s2-install-${id}`)).toBeTruthy();
      expect([...line.children].filter((c) => c.tagName === 'BUTTON').map((c) => c.getAttribute('data-testid'))).toEqual([`s2-connect-${id}`, `s2-install-${id}`]);
    }
  });

  it('an agent the installer cannot run keeps the two stuck actions as one block under the words', async () => {
    render(
      <StoreProvider store={createStore({})}>
        <ConnectAgents sessionId="s1" fetchImpl={fetchImpl} store={createAgentRunStore()} onboarding={onboarding([P('gemini', 'Gemini')])} />
      </StoreProvider>,
    );
    const line = await screen.findByTestId('s2-connect-line-gemini');
    const acts = line.querySelector('.s2-agent-line-acts');
    expect(acts, 'gemini: one block for the stuck actions').not.toBeNull();
    expect(acts!.contains(screen.getByTestId('s2-copy-gemini'))).toBe(true);
    expect(acts!.contains(screen.getByTestId('s2-model-gemini'))).toBe(true);
    /* Neither button is a direct child of the line any more. */
    expect([...line.children].filter((c) => c.tagName === 'BUTTON').map((c) => c.getAttribute('data-testid'))).toEqual(['s2-connect-gemini']);
  });

  it('the line wraps, the name keeps a minimum width, and the actions take the full line under it (CSS)', () => {
    expect(rule('.s2-agent-line')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.s2-agent-line > .s2-mi')).toMatch(/flex:\s*1 1 calc\(var\(--sp-32\) \* 3\)/);
    expect(rule('.s2-agent-line-acts')).toMatch(/flex:\s*1 0 100%/);
    expect(rule('.s2-agent-line-acts')).toMatch(/flex-wrap:\s*wrap/);
  });
});
