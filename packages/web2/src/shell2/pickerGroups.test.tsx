import { act, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuns } from '../agents/agentRuns';
import { StoreProvider, createStore } from '../state';
import { ModelMenu } from './ModelMenu';

const prof = (id: string, provider: string, model: string, active = false) => ({ id, nickname: model, model, provider, active, reasoningEffort: undefined });

function mount(profiles: ReturnType<typeof prof>[], over: Record<string, unknown> = {}) {
  return render(
    <StoreProvider store={createStore({})}>
      <ModelMenu
        wrapRef={createRef<HTMLDivElement>()}
        open
        onTrigger={() => {}}
        onClose={() => {}}
        sessionId="s"
        agentRun={undefined}
        profiles={profiles as never}
        pickModel={vi.fn()}
        modelErr={null}
        effort="medium"
        effortRows={[{ key: 'medium', label: 'Medium', description: 'Medium' }]}
        pickEffort={() => {}}
        modelChip="Sonnet 5.5"
        modelChipShort="Sonnet 5.5"
        modelChipTitle="Sonnet 5.5, claude-sonnet-5-5"
        effortLabel="Medium"
        modes={[
          { key: 'ask', label: 'Ask', desc: 'Asks before every change', icon: 'shield' },
          { key: 'plan', label: 'Plan', desc: 'Reads only, writes a plan', icon: 'map' },
        ]}
        currentMode="plan"
        onMode={() => {}}
        {...over}
      />
    </StoreProvider>,
  );
}

beforeEach(() => agentRuns.patch((s) => ({ ...s, runs: [], agents: {}, caps: {}, config: {}, capsError: {} })));

describe('the one popup', () => {
  it('groups saved models as Local, Claude and OpenAI; none is called Sequence', () => {
    mount([prof('1', 'ollama', 'minicpm5:latest'), prof('2', 'anthropic', 'claude-sonnet-5-5', true), prof('3', 'openai', 'gpt-5.1-codex')]);
    const heads = Array.from(document.querySelectorAll('.s2-group-h')).map((h) => h.lastChild!.textContent);
    expect(heads).toEqual(['Local', 'Claude', 'OpenAI']);
    expect(document.body.textContent).not.toMatch(/Sequence/);
    const rows = screen.getAllByTestId('v3-model-row').map((r) => r.querySelector('.s2-mi-name')!.textContent);
    expect(rows).toEqual(['MiniCPM 5', 'Sonnet 5.5', 'GPT-5.1 Codex']);
    expect(within(screen.getByTestId('s2-model-group-local')).getByTestId('v3-model-row').querySelector('[data-brand]')).toBeNull();
    expect(within(screen.getByTestId('s2-model-group-openai')).getByTestId('v3-model-row').querySelector('[data-brand]')!.getAttribute('data-brand')).toBe('openai');
  });

  it('puts the groups first, then reasoning; the model popup carries no mode rows, and the mode icon names the mode', () => {
    mount([prof('2', 'anthropic', 'claude-sonnet-5-5', true)]);
    const menu = screen.getByTestId('s2-model-menu');
    const order = Array.from(menu.querySelectorAll('[data-testid="s2-mode-menu"], [data-testid^="s2-model-group-"], [data-testid="s2-effort"]')).map((e) => e.getAttribute('data-testid'));
    expect(order).toEqual(['s2-model-group-claude', 's2-effort']);
    expect(screen.getByTestId('v3-model-trigger').getAttribute('data-mode')).toBe('plan');
    expect(screen.getByTestId('s2-mode-trigger').getAttribute('data-mode')).toBe('plan');
  });

  it('an agent is a row of the Connect an agent section, not of a provider group: Codex opens its models in a flyout', () => {
    act(() => agentRuns.patch((s) => ({ ...s, caps: { codex: { models: [{ id: 'gpt-5.1-codex', name: 'gpt-5.1-codex', efforts: [] }], efforts: [], commands: [], skills: [], slash: [] } } })));
    mount([prof('3', 'openai', 'gpt-5.1-codex')]);
    /* The saved OpenAI model keeps its group; the agent is not in it. */
    expect(within(screen.getByTestId('s2-model-group-openai')).queryByTestId('agent-model')).toBeNull();
    const section = screen.getByTestId('s2-connect');
    expect(section.querySelector('.s2-menu-gh')!.textContent).toBe('Connect an agent');
    const row = within(section).getByTestId('s2-agent-row');
    expect(row.querySelector('.s2-mi-name')!.textContent).toBe('Codex');
    expect(screen.queryByTestId('s2-agent-flyout')).toBeNull();
    act(() => row.click());
    expect(within(screen.getByTestId('s2-agent-flyout')).getByTestId('agent-model').querySelector('.s2-mi-name')!.textContent).toBe('GPT-5.1 Codex');
  });
});
