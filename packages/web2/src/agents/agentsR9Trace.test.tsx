import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgentsPanel, UsageStrip } from './AgentsPanel.js';
import { describeStep, formatTokens, stallOf, STALL_COMMAND_MS, STALL_MS, usageText } from './agentSteps.js';
import { createAgentStore } from './agentStream.js';
import { emptyTree, foldEvent } from './agentTree.js';
import { createAgentRunStore, type AgentRun } from './agentRuns.js';
import { fromSavedRun } from './savedRuns.js';
import type { AgentEvent, AgentNode } from './agentTypes.js';

/* Round 9 (asks 28, 29, 30): fake event streams, no agent, no server. */

let seq = 0;
const T0 = 1_000_000;
const ev = (e: Partial<AgentEvent> & Pick<AgentEvent, 'kind'>): AgentEvent => ({
  id: `e${++seq}`,
  at: T0 + seq * 100,
  source: 'acp',
  sessionId: 'chat',
  paths: [],
  status: 'done',
  ...e,
});
const at = (t: number, e: Partial<AgentEvent> & Pick<AgentEvent, 'kind'>): AgentEvent => ({ ...ev(e), at: T0 + t });

function fold(events: AgentEvent[]) {
  const t = emptyTree();
  for (const e of events) foldEvent(t, e);
  return t.nodes as ReadonlyMap<string, AgentNode>;
}

describe('ask 29: a step reads as a sentence', () => {
  const node = (over: Partial<AgentNode>): AgentNode => ({ id: 'x', sessionId: 's', parentId: null, rootId: 'r', kind: 'tool_call', status: 'completed', title: 't', toolKind: null, stepKind: null, locations: [], startedAt: 0, endedAt: 1, ...over });
  it('says what it did, in the right tense, and that it failed', () => {
    const loc = [{ path: 'src/a.ts', fileNodeId: null, moduleId: null, serviceId: null, serviceLabel: null, touchedEdgeIds: [], liftedEdges: [] }];
    expect(describeStep(node({ stepKind: 'read', title: 'Read src/a.ts', locations: loc }))).toBe('Read src/a.ts');
    expect(describeStep(node({ stepKind: 'read', status: 'running', locations: loc }))).toBe('Reading src/a.ts');
    expect(describeStep(node({ stepKind: 'edit', status: 'failed', locations: loc }))).toBe('Could not edit src/a.ts');
    expect(describeStep(node({ stepKind: 'execute', title: 'Bash: npm test' }))).toBe('Ran npm test');
    expect(describeStep(node({ stepKind: 'execute', title: 'npm test', status: 'failed' }))).toBe('Command failed: npm test');
    expect(describeStep(node({ stepKind: 'search', title: 'Grep foo', status: 'running' }))).toBe('Searching for foo');
  });
});

describe('ask 29: failures and stalls are marked, never green', () => {
  it('a failed step shows its own error text under the sentence', () => {
    const store = createAgentStore(() => null);
    for (const e of [
      at(0, { kind: 'session_start', status: 'running' }),
      at(100, { kind: 'tool_start', tool: 'Bash', toolKind: 'execute', toolUseId: 'b', status: 'running', title: 'npm test' }),
      at(2100, { kind: 'tool_end', tool: 'Bash', toolKind: 'execute', toolUseId: 'b', status: 'failed', title: 'npm test', error: 'npm ERR! missing script: test' }),
      at(2200, { kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 'r', status: 'running', title: 'Read a.ts' }),
      at(2300, { kind: 'tool_end', tool: 'Read', toolKind: 'read', toolUseId: 'r', title: 'Read a.ts', result: 'export const a = 1;' }),
    ])
      store.apply(e);
    render(<AgentsPanel store={store} />);
    const rows = screen.getAllByTestId('agents-tree-node');
    const bad = rows.find((r) => /Command failed: npm test/.test(r.textContent ?? ''))!;
    expect(bad.getAttribute('data-flag')).toBe('failed');
    expect(bad.querySelector('[data-testid="agents-why"]')!.textContent).toBe('npm ERR! missing script: test');
    expect(bad.textContent).toMatch(/2\.0s/);
    const ok = rows.find((r) => /Read a\.ts/.test(r.textContent ?? ''))!;
    expect(ok.getAttribute('data-flag')).toBeNull();
    expect(ok.querySelector('[data-testid="agents-why"]')!.textContent).toBe('export const a = 1;');
  });

  it('a failed step with no reason says so instead of looking fine', () => {
    const store = createAgentStore(() => null);
    const now = Date.now();
    for (const e of [{ ...ev({ kind: 'tool_start', tool: 'Bash', toolKind: 'execute', toolUseId: 'b', status: 'running', title: 'false' }), at: now - 200 }, { ...ev({ kind: 'tool_end', tool: 'Bash', toolKind: 'execute', toolUseId: 'b', status: 'failed', title: 'false' }), at: now - 150 }]) store.apply(e);
    render(<AgentsPanel store={store} />);
    const whys = screen.getAllByTestId('agents-why').map((w) => w.textContent);
    expect(whys).toContain('Failed, and the agent gave no reason');
    expect(whys, JSON.stringify(whys)).toContain('1 step failed inside');
  });

  it('a turn that failed marks the step it cut short as failed with the turn\'s reason, not completed', () => {
    const nodes = fold([
      at(0, { kind: 'session_start', status: 'running' }),
      at(100, { kind: 'tool_start', tool: 'Bash', toolKind: 'execute', toolUseId: 'b', status: 'running', title: 'sleep 999' }),
      at(5000, { kind: 'stop', status: 'failed', error: 'Session expired. Run claude /login.' }),
    ]);
    expect(nodes.get('tool:chat:b')).toMatchObject({ status: 'failed', error: 'Session expired. Run claude /login.' });
    expect(nodes.get('turn:chat:1')).toMatchObject({ status: 'failed', error: 'Session expired. Run claude /login.' });
    expect(nodes.get('session:chat')?.status).toBe('failed');
  });

  it('a turn that stopped well still completes its open steps (a hook that never reported an end)', () => {
    const nodes = fold([at(0, { kind: 'tool_start', tool: 'Edit', toolKind: 'edit', toolUseId: 'a', status: 'running' }), at(10, { kind: 'stop' })]);
    expect(nodes.get('tool:chat:a')?.status).toBe('completed');
    expect(nodes.get('turn:chat:1')?.status).toBe('completed');
  });

  it('a tool running past its limit is stalled, a command gets longer, a quiet turn is stalled with how long', () => {
    const nodes = fold([
      at(0, { kind: 'session_start', status: 'running' }),
      at(10, { kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 'r', status: 'running', title: 'Read big.log' }),
      at(20, { kind: 'tool_start', tool: 'Bash', toolKind: 'execute', toolUseId: 'b', status: 'running', title: 'pnpm build' }),
    ]);
    const read = nodes.get('tool:chat:r')!;
    const cmd = nodes.get('tool:chat:b')!;
    expect(stallOf(nodes, read, T0 + STALL_MS - 1000)).toBeNull();
    expect(stallOf(nodes, read, T0 + STALL_MS + 5000)?.text).toMatch(/^Stalled: no result after 45\.\ds|^Stalled: no result after 50/);
    expect(stallOf(nodes, cmd, T0 + STALL_MS + 5000)).toBeNull();
    expect(stallOf(nodes, cmd, T0 + STALL_COMMAND_MS + 5000)?.text).toMatch(/^Stalled: no result after 3m/);

    /* A turn with every step finished and then silence. */
    const quiet = fold([at(0, { kind: 'session_start', status: 'running' }), at(100, { kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 'r', status: 'running' }), at(200, { kind: 'tool_end', tool: 'Read', toolKind: 'read', toolUseId: 'r' })]);
    const turn = quiet.get('turn:chat:1')!;
    expect(stallOf(quiet, turn, T0 + 10_000)).toBeNull();
    expect(stallOf(quiet, turn, T0 + 90_000)?.text).toMatch(/^Stalled: nothing for 1m 29s/);
    /* A finished node never stalls. */
    expect(stallOf(quiet, quiet.get('tool:chat:r')!, T0 + 999_999)).toBeNull();
  });

  it('the panel marks a stalled step with the stall words and a stalled dot', () => {
    const store = createAgentStore(() => null);
    const start = Date.now() - 2 * 60_000;
    store.apply({ id: 'x1', at: start, source: 'acp', sessionId: 'chat', paths: [], status: 'running', kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 'r', title: 'Read big.log' });
    render(<AgentsPanel store={store} />);
    /* The step's own row: the turn above it names the step in flight, so the
       row is found by what it is, not by a phrase two rows share. */
    const row = screen.getAllByTestId('agents-tree-node').find((r) => r.closest('li')?.getAttribute('data-kind') === 'tool_call')!;
    expect(row.textContent).toMatch(/Reading big\.log/);
    expect(row.getAttribute('data-flag')).toBe('stalled');
    expect(row.querySelector('[data-testid="agents-why"]')!.textContent).toMatch(/^Stalled: no result after 2m/);
    expect(screen.getByTestId('agents-roster-row').getAttribute('data-flag')).toBe('stalled');
  });
});

describe('ask 28: the tree follows the main agent', () => {
  const run = (): AgentEvent[] => [
    at(0, { kind: 'session_start', status: 'running' }),
    at(10, { kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 'a', status: 'running', title: 'Read a.ts', paths: ['a.ts'] }),
    at(20, { kind: 'tool_end', tool: 'Read', toolKind: 'read', toolUseId: 'a', title: 'Read a.ts', paths: ['a.ts'] }),
    at(30, { kind: 'subagent_start', agentId: 'sub', title: 'Explore', status: 'running' }),
    at(40, { kind: 'tool_start', agentId: 'sub', tool: 'Bash', toolKind: 'execute', toolUseId: 'b', status: 'running', title: 'ls' }),
    at(50, { kind: 'tool_end', agentId: 'sub', tool: 'Bash', toolKind: 'execute', toolUseId: 'b', status: 'failed', title: 'ls', error: 'permission denied' }),
    at(60, { kind: 'subagent_stop', agentId: 'sub', title: 'Explore' }),
    at(70, { kind: 'stop' }),
  ];

  it('sub-agents are one collapsed row that still shows their failure, and open on a click', () => {
    const store = createAgentStore(() => null);
    for (const e of run()) store.apply(e);
    render(<AgentsPanel store={store} />);
    const sub = screen.getAllByTestId('agents-tree-node').find((r) => /Sub-agent: Explore/.test(r.textContent ?? ''))!;
    expect(sub.closest('li')!.getAttribute('aria-expanded')).toBe('false');
    expect(sub.textContent).toMatch(/1 step/);
    expect(sub.querySelector('[data-testid="agents-why"]')!.textContent).toMatch(/1 step failed/);
    expect(screen.queryByText('Command failed: ls')).toBeNull();
    fireEvent.click(sub);
    expect(sub.closest('li')!.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Command failed: ls')).toBeTruthy();
    expect(screen.getByText('permission denied')).toBeTruthy();
  });

  it('only the latest turn is open; an older one is folded until opened, unless it failed', () => {
    const store = createAgentStore(() => null);
    const events = [
      at(0, { kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 'a', status: 'running', title: 'Read one.ts', paths: ['one.ts'] }),
      at(10, { kind: 'tool_end', tool: 'Read', toolKind: 'read', toolUseId: 'a', title: 'Read one.ts', paths: ['one.ts'] }),
      at(20, { kind: 'stop' }),
      at(30, { kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 'b', status: 'running', title: 'Read two.ts', paths: ['two.ts'] }),
      at(40, { kind: 'tool_end', tool: 'Read', toolKind: 'read', toolUseId: 'b', title: 'Read two.ts', paths: ['two.ts'] }),
    ];
    for (const e of events) store.apply(e);
    render(<AgentsPanel store={store} />);
    expect(screen.queryByText('Read one.ts')).toBeNull();
    expect(screen.getByText('Read two.ts')).toBeTruthy();
    act(() => fireEvent.click(screen.getByText('Turn 1')));
    expect(screen.getByText('Read one.ts')).toBeTruthy();
  });

  it('the roster is the main agent and counts its sub-agents', () => {
    const store = createAgentStore(() => null);
    for (const e of run()) store.apply(e);
    render(<AgentsPanel store={store} />);
    expect(screen.getAllByTestId('agents-roster-row')).toHaveLength(1);
    expect(screen.getByTestId('agents-subnote').textContent).toBe('1 sub-agent, nested in its turn');
  });
});

describe('ask 30: tokens per turn and per session', () => {
  const usage = { input: 1000, output: 400, cacheRead: 700, cacheWrite: 0, thought: 0, total: 1400 };

  it('the stop event\'s usage lands on the turn row', () => {
    const store = createAgentStore(() => null);
    for (const e of [at(0, { kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 'a', status: 'running', title: 'Read a.ts' }), at(10, { kind: 'tool_end', tool: 'Read', toolKind: 'read', toolUseId: 'a' }), at(20, { kind: 'stop', usage, tokens: 1400 })]) store.apply(e);
    render(<AgentsPanel store={store} />);
    const turn = screen.getAllByTestId('agents-tree-node').find((r) => /Turn 1/.test(r.textContent ?? ''))!;
    expect(turn.textContent).toMatch(/1k in, 400 out, 700 cached/);
  });

  it('formats counts and only the parts the agent reported', () => {
    expect(formatTokens(840)).toBe('840');
    expect(formatTokens(1400)).toBe('1.4k');
    expect(formatTokens(12_400)).toBe('12k');
    expect(formatTokens(2_500_000)).toBe('2.5M');
    expect(usageText(usage)).toBe('1k in, 400 out, 700 cached');
    expect(usageText({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thought: 0, total: 900 })).toBe('900 tokens');
  });

  const runOf = (id: string, u: typeof usage | null): AgentRun => ({ id, sessionId: 'chat', agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: `question ${id}`, status: 'done', startedAt: 1, endedAt: 2, items: [], approvals: [], error: null, turnUsage: u });

  it('the strip shows each turn and the session total, skips a turn the agent gave no usage for, and is absent with none', () => {
    const { rerender } = render(<UsageStrip runs={[runOf('1', usage), runOf('2', null), runOf('3', { ...usage, input: 500, output: 100, cacheRead: 0, total: 600 })]} />);
    expect(screen.getByTestId('agents-usage-total').textContent).toBe('Session total1.5k in, 500 out, 700 cached');
    const turns = screen.getAllByTestId('agents-usage-turn');
    expect(turns).toHaveLength(2);
    expect(turns[0].textContent).toMatch(/Turn 1/);
    /* The second turn that REPORTED usage is the chat's THIRD turn: the strip
       names the turn, not its place among the turns that reported. */
    expect(turns[1].textContent).toMatch(/Turn 3.*500 in, 100 out/);
    rerender(<UsageStrip runs={[runOf('9', null)]} />);
    expect(screen.queryByTestId('agents-usage')).toBeNull();
  });

  it('usage reported by the stream is kept on the run; a saved run brings it back after a relaunch', async () => {
    const store = createAgentRunStore({ clock: () => 5 });
    const started = await store.start({ question: 'hi', sessionId: 'chat' }, async () => new Response(null, { status: 500 }));
    await import('./agentRunFold');
    store.apply(started.id, { type: 'acp:usage', usage });
    expect(store.get().runs[0]!.turnUsage).toEqual(usage);
    store.apply(started.id, { type: 'acp:usage', usage: { input: 0, output: 0, total: 0 } });
    expect(store.get().runs[0]!.turnUsage).toEqual(usage);

    const saved = fromSavedRun({ id: 't1', prompt: 'hi', agentRef: 'claude', status: 'done', text: 'ok', startedAt: 1, endedAt: 2, tools: [], usage }, 'chat');
    expect(saved?.turnUsage).toEqual(usage);
    expect(fromSavedRun({ id: 't2', prompt: 'old', agentRef: 'claude', status: 'done', text: '', startedAt: 1, endedAt: 2, tools: [] }, 'chat')?.turnUsage).toBeNull();
  });
});
