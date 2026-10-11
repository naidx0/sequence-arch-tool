import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './settings.css';

import { AgentsPane } from './AgentsPane';
import type { AgentRow, AgentsClient } from './agentsClient';

const ROWS: AgentRow[] = [
  { id: 'codex', label: 'Codex', status: 'connected' },
  { id: 'claude', label: 'Claude Code', status: 'signed-out', signInCommand: 'claude /login' },
];
const api = (): AgentsClient => ({
  list: vi.fn(async () => ({ outcome: 'ok' as const, body: ROWS })),
  connect: vi.fn(),
  disconnect: vi.fn(),
});

describe('round 13 (N4): subscription models come from the agent', () => {
  it('lists a connected agent models read-only under it, with no Test, Edit or Remove', async () => {
    const load = vi.fn(async () => ['GPT-5 Codex', 'GPT-5']);
    render(<AgentsPane client={api()} loadModels={load} />);
    const list = await screen.findByTestId('settings-agent-models');
    expect(load).toHaveBeenCalledWith('codex');
    expect(load).toHaveBeenCalledTimes(1);
    expect(within(list).getAllByTestId('settings-agent-model').map((n) => n.textContent)).toEqual(['GPT-5 Codex', 'GPT-5']);
    const row = list.closest('[data-testid="settings-agent"]') as HTMLElement;
    const words = within(row).queryAllByRole('button').map((b) => b.textContent);
    expect(words.join(' ')).not.toMatch(/Test|Edit|Remove/);
    expect(row.querySelector('input,textarea')).toBeNull();
  });

  it('asks only connected agents, and says so plainly when it cannot read them', async () => {
    const load = vi.fn(async () => {
      throw new Error('500');
    });
    render(<AgentsPane client={api()} loadModels={load} />);
    expect((await screen.findByTestId('settings-agent-models-none')).textContent).toMatch(/could not be read/);
    expect(load).not.toHaveBeenCalledWith('claude');
  });
});
