import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetSignInState } from '../onboarding/signInState';
import type { BridgeInstallStatus, OnboardingClient } from '../onboarding/onboardingClient';

import '../tokens/graphite.css';
import './settings.css';

import { AgentsPane } from './AgentsPane';
import { agentRows, type AgentRow, type AgentsClient } from './agentsClient';

/* 0.1.8.4: an installed agent older than the recommended version reads "Update available" with one button that runs the
   vendor installer through the guarded path on a click. Every client here is a fake: no real installer ever runs. */

afterEach(() => resetSignInState());

const OLD: AgentRow = { id: 'codex', label: 'Codex', status: 'ready', detail: 'v0.100.0, ChatGPT', version: '0.100.0', updateAvailable: { recommended: '0.153.4', command: 'npm install -g @openai/codex@latest' } };
const CURRENT: AgentRow = { id: 'codex', label: 'Codex', status: 'ready', detail: 'v0.153.4, ChatGPT', version: '0.153.4' };

function agents(lists: AgentRow[][]): AgentsClient {
  let i = 0;
  return {
    list: vi.fn(async () => ({ outcome: 'ok' as const, body: lists[Math.min(i++, lists.length - 1)]! })),
    connect: vi.fn(async (row: AgentRow) => ({ outcome: 'ok' as const, body: { ...row, status: 'connected' as const } })),
  };
}

function onboarding(over: Partial<OnboardingClient> = {}): OnboardingClient & { installs: string[] } {
  const installs: string[] = [];
  return {
    installs,
    providers: vi.fn(async () => ({ ok: true as const, body: [] })),
    repos: vi.fn(async () => ({ ok: true as const, body: { repos: [], truncated: false } })),
    installCli: vi.fn(async (p: string) => {
      installs.push(p);
      return { ok: true as const, body: { state: 'running', output: ['downloading'] } as BridgeInstallStatus };
    }),
    cliStatus: vi.fn(async () => ({ ok: true as const, body: { state: 'done', exitCode: 0, output: ['done'] } as BridgeInstallStatus })),
    ...over,
  };
}

describe('Settings > Agents: update available', () => {
  it('the wire maps updateAvailable onto the row, and a current agent has none (negative control)', () => {
    const wire = (version: string, updateAvailable?: { recommended: string; command: string }) =>
      agentRows([{ id: 'codex', label: 'Codex', installed: true, version, state: 'ready', signInCommand: 'codex login', installHint: 'x', ...(updateAvailable ? { updateAvailable } : {}) }], []);
    expect(wire('0.100.0', OLD.updateAvailable)[0]!.updateAvailable).toEqual(OLD.updateAvailable);
    expect(wire('0.153.4')[0]!.updateAvailable).toBeUndefined();
  });

  it('shows a calm Update available note and one Update button; nothing runs before the click', async () => {
    const ob = onboarding();
    render(<AgentsPane client={agents([[OLD]])} onboardingClient={ob} catalog={false} />);
    expect((await screen.findByTestId('settings-agent-update-note')).textContent).toContain('Update available');
    expect(screen.getByTestId('settings-agent-update-note').textContent).toContain('0.153.4');
    expect(screen.getByTestId('cli-update-button-codex').textContent).toBe('Update');
    expect(ob.installs).toEqual([]);
  });

  it('a current agent shows no update note', async () => {
    render(<AgentsPane client={agents([[CURRENT]])} onboardingClient={onboarding()} catalog={false} />);
    await screen.findByTestId('settings-agent');
    expect(screen.queryByTestId('settings-agent-update')).toBeNull();
  });

  it('the click runs the guarded installer for that agent, then the row reads current', async () => {
    const ob = onboarding();
    render(<AgentsPane client={agents([[OLD], [CURRENT]])} onboardingClient={ob} catalog={false} />);
    fireEvent.click(await screen.findByTestId('cli-update-button-codex'));
    await waitFor(() => expect(ob.installs).toEqual(['codex']));
    await waitFor(() => expect(screen.queryByTestId('settings-agent-update')).toBeNull());
  });

  it('a failed update says why and shows the exact command to copy', async () => {
    const ob = onboarding({
      cliStatus: vi.fn(async () => ({ ok: true as const, body: { state: 'failed', error: 'npm: EACCES permission denied', output: ['npm: EACCES permission denied'] } as BridgeInstallStatus })),
    });
    render(<AgentsPane client={agents([[OLD]])} onboardingClient={ob} catalog={false} />);
    fireEvent.click(await screen.findByTestId('cli-update-button-codex'));
    const failed = await screen.findByTestId('cli-failed-codex');
    expect(failed.textContent).toContain('EACCES');
    expect(screen.getByTestId('cli-command-codex').textContent).toBe('npm install -g @openai/codex@latest');
    expect(screen.getByTestId('cli-retry-codex')).toBeTruthy();
  });

  it('an installer that finishes while the old copy still wins says so, with the command', async () => {
    render(<AgentsPane client={agents([[OLD], [OLD]])} onboardingClient={onboarding()} catalog={false} />);
    fireEvent.click(await screen.findByTestId('cli-update-button-codex'));
    const stale = await screen.findByTestId('cli-stale-codex');
    expect(stale.textContent).toContain('still reads as out of date');
    expect(screen.getByTestId('cli-command-codex').textContent).toContain('@openai/codex@latest');
  });

  it('a not-installed Codex offers Install with the Install, Sign in, Connect line; an agent the server cannot install does not', async () => {
    const ob = onboarding();
    const rows: AgentRow[] = [
      { id: 'codex', label: 'Codex', status: 'not-installed', installHint: 'npm install -g @openai/codex' },
      { id: 'gemini', label: 'Gemini CLI', status: 'not-installed', installHint: 'npm i -g @google/gemini-cli' },
    ];
    render(<AgentsPane client={agents([rows])} onboardingClient={ob} catalog={false} />);
    await screen.findAllByTestId('settings-agent');
    expect(screen.getByTestId('settings-agent-steps-codex').textContent).toBe('Install → Sign in → Connect');
    expect(screen.getAllByTestId('settings-agent-install')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('cli-install-button-codex'));
    await waitFor(() => expect(ob.installs).toEqual(['codex']));
  });
});
