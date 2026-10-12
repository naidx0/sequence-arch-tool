import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createAgentRunStore } from '../agents/agentRuns';
import { createStore, StoreProvider } from '../state';
import AgentSlot from './agentComposer';
import { ContextRing } from './ContextRing';
import { modelEfforts } from './EffortSlider';

describe('provider reasoning controls', () => {
  it('explicit empty model efforts override provider defaults; unknown capabilities offer nothing', () => {
    expect(modelEfforts(undefined)).toEqual([]);
    expect(modelEfforts({ models: [{ id: 'plain', name: 'Plain', efforts: [] }], efforts: ['high'], commands: [], skills: [] }, 'plain')).toEqual([]);
  });
  it('offers a real range with only the chosen model efforts, persists the wire value', () => {
    const store = createAgentRunStore();
    store.patch(s => ({ ...s, agents: { s1: 'codex' }, caps: { codex: {
      models: [{ id: 'm', name: 'Recorded model', efforts: ['low', 'high', 'xhigh'], defaultEffort: 'high' }],
      efforts: ['fake'], commands: [], skills: [],
    } }, chatConfig: { s1: { model: 'm' } } }));
    const app = createStore({});
    app.dispatch({ type: 'session/index', sessions: [], activeId: 's1' });
    render(<StoreProvider store={app}><AgentSlot slot="models" store={store} /></StoreProvider>);
    const slider = screen.getByRole('slider', { name: 'Reasoning effort' });
    expect(slider.getAttribute('aria-valuetext')).toBe('high');
    expect(slider.getAttribute('max')).toBe('2');
    expect(screen.queryByText('fake')).toBeNull();
    fireEvent.change(slider, { target: { value: '2' } });
    expect(store.get().chatConfig?.s1?.effort).toBe('xhigh');
  });
});

describe('context explanation', () => {
  it('reads used of total, the percent and what is left (round 12: the four-part panel)', () => {
    render(<ContextRing used={250} window={1000} />);
    fireEvent.click(screen.getByTestId('composer-context'));
    const text = screen.getByRole('dialog').textContent ?? '';
    expect(text).toContain('Context window');
    expect(text).toContain('25%');
    expect(text).toContain('250 / 1k');
    expect(text).toContain('750 left');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
