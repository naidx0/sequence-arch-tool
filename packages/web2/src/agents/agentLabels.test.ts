import { describe, expect, it } from 'vitest';

import { activeAgentModel } from './activeModel';
import { agentDisplayName, labelsOf } from './agentLabels';
import { noteAgentLabels } from './agentRegistry';
import { createAgentRunStore } from './agentRuns';
import { agentName, pillAgentText } from '../shell2/ModelMenu';

/* The Opus walk of 2026-10-15: "The registered `label` is ignored ('Goal agent (fake, tick)' shows as 'Goal'); the
   composer truncates 'Goalslow defaul'". */
const AGENTS = [
  { id: 'goal', label: 'Goal agent (fake, tick)' },
  { id: 'goalslow', label: 'Goal agent (fake, slow)' },
  { id: 'codex', label: 'codex' },
  { id: 'claude' },
];

describe('an agent is named by the label it was registered with', () => {
  it('the label wins; a label that only repeats the id falls back to the vendor name, then the id', () => {
    const labels = labelsOf(AGENTS);
    expect(labels).toEqual({ goal: 'Goal agent (fake, tick)', goalslow: 'Goal agent (fake, slow)' });
    expect(agentDisplayName('goal', labels)).toBe('Goal agent (fake, tick)');
    expect(agentName('goalslow', labels)).toBe('Goal agent (fake, slow)');
    expect(agentDisplayName('codex', labels)).toBe('Codex');
    expect(agentDisplayName('claude', labels)).toBe('Claude Code');
    expect(agentDisplayName('other')).toBe('Other');
  });

  it('the page keeps them, and a changed registry replaces them', () => {
    const store = createAgentRunStore();
    noteAgentLabels(store, AGENTS);
    expect(store.get().agentLabels).toEqual({ goal: 'Goal agent (fake, tick)', goalslow: 'Goal agent (fake, slow)' });
    noteAgentLabels(store, [{ id: 'goal', label: 'Goal two' }]);
    expect(store.get().agentLabels).toEqual({ goal: 'Goal two' });
  });

  it('an agent that has not said its model reads "<label> default", and the pill cuts at a word, not mid-word', () => {
    const base = { runs: [], caps: {}, config: {}, chatConfig: {} } as never;
    expect(activeAgentModel({ ...(base as object), agentLabels: labelsOf(AGENTS) } as never, 'goal', null).label).toBe('Goal agent (fake, tick) default');
    expect(activeAgentModel(base, 'goalslow', null).label).toBe('Goalslow default');
    expect(pillAgentText('Goalslow default')).toBe('Goalslow');
    expect(pillAgentText('Pi default')).toBe('Pi default');
    expect(pillAgentText('Opus 4.5')).toBe('Opus 4.5');
  });
});
