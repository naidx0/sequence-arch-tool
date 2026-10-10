import { describe, expect, it } from 'vitest';

import { loadWorkspaceCountFacts } from './settingsFactsLoad';

describe('loadWorkspaceCountFacts', () => {
  it('counts what the engines answered — never invents zeros for unasked routes', async () => {
    const facts = await loadWorkspaceCountFacts({
      recent: async () => ({ outcome: 'ok', body: { recent: [{}, {}] } }),
      sessions: async () => ({
        outcome: 'ok',
        body: { index: { sessions: [{}, {}, {}] } },
      }),
      memory: async () => ({ turns: [{ role: 'user' }] }),
      hooks: async () => ({
        outcome: 'ok',
        body: { declared: { 'pre-write': {}, 'post-write': {} } },
      }),
    });
    expect(facts).toEqual({
      recentCount: 2,
      sessionCount: 3,
      memoryAvailable: true,
      hookCount: 2,
      pluginCount: null,
      pluginError: null,
      pluginAskWired: null,
      mcpServerCount: null,
    });
  });

  it('mcp ok list becomes mcpServerCount', async () => {
    const facts = await loadWorkspaceCountFacts({
      recent: async () => ({ outcome: 'unreachable' }),
      sessions: async () => ({ outcome: 'error' }),
      memory: async () => null,
      hooks: async () => ({ outcome: 'error' }),
      mcp: async () => ({
        outcome: 'ok',
        body: { document: { servers: { a: {}, b: {} } } },
      }),
    });
    expect(facts.mcpServerCount).toBe(2);
  });

  it('plugins ok list becomes pluginCount', async () => {
    const facts = await loadWorkspaceCountFacts({
      recent: async () => ({ outcome: 'unreachable' }),
      sessions: async () => ({ outcome: 'error' }),
      memory: async () => null,
      hooks: async () => ({ outcome: 'error' }),
      plugins: async () => ({
        outcome: 'ok',
        body: { ok: true, plugins: [{ id: 'a' }, { id: 'b' }], askWired: true },
      }),
    });
    expect(facts.pluginCount).toBe(2);
    expect(facts.pluginError).toBeNull();
    expect(facts.pluginAskWired).toBe(true);
  });

  it('plugins ok:false surfaces pluginError without inventing tools', async () => {
    const facts = await loadWorkspaceCountFacts({
      recent: async () => ({ outcome: 'unreachable' }),
      sessions: async () => ({ outcome: 'error' }),
      memory: async () => null,
      hooks: async () => ({ outcome: 'error' }),
      plugins: async () => ({
        outcome: 'ok',
        body: { ok: false, plugins: [], error: 'mode must be readonly', askWired: true },
      }),
    });
    expect(facts.pluginCount).toBe(0);
    expect(facts.pluginError).toMatch(/readonly/);
    expect(facts.pluginAskWired).toBe(true);
  });

  it('empty transcript is memoryAvailable false — not null waiting', async () => {
    const facts = await loadWorkspaceCountFacts({
      recent: async () => ({ outcome: 'unreachable' }),
      sessions: async () => ({ outcome: 'error' }),
      memory: async () => ({ turns: [] }),
      hooks: async () => ({ outcome: 'error' }),
    });
    expect(facts.recentCount).toBe(0);
    expect(facts.sessionCount).toBeNull();
    expect(facts.memoryAvailable).toBe(false);
    expect(facts.hookCount).toBeNull();
  });
});
