import { describe, expect, it } from 'vitest';

import { AGENT_MARKS } from './agentMarks';
import { AGENT_MARK_KEYS, hasAgentMark, PROVIDER_MARK_KEYS } from './markKeys';
import { agentMark } from './agentMark';
import { LOBE_MARKS } from './lobeMarks';
import { PROVIDER_MARKS } from './providerMarks';

/* markKeys.ts holds the ids WITHOUT the path data so the shell does not load ~170 KB to ask "is there a mark". The sets are derived
   from the tables here, so a mark added to a table without its key fails this. */
describe('markKeys follow the mark tables', () => {
  it('agent keys are the agent and lobe table keys', () => {
    expect([...AGENT_MARK_KEYS].sort()).toEqual([...new Set([...Object.keys(AGENT_MARKS), ...Object.keys(LOBE_MARKS)])].sort());
  });
  it('provider keys are the provider table keys', () => {
    expect([...PROVIDER_MARK_KEYS].sort()).toEqual(Object.keys(PROVIDER_MARKS).sort());
  });
  it('hasAgentMark agrees with agentMark for every table key, every alias and a name with no mark', () => {
    for (const id of [...AGENT_MARK_KEYS, 'claude', 'codex', 'qwen', 'copilot', 'cursor-agent', 'gemini-cli', 'hermes-agent', 'droid', 'vibe', 'not-an-agent']) {
      expect(hasAgentMark(id), id).toBe(agentMark(id) !== undefined);
    }
    expect(hasAgentMark('not-an-agent')).toBe(false);
  });
});
