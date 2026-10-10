import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentRoster, AgentTree, AgentsPanel, axisTicks, tickLabel, type ChatLike } from './AgentsPanel.js';
import StartWithHooks from './startWithHooks';
import { emptyTree, foldEvent } from './agentTree.js';
import { createAgentStore } from './agentStream.js';
import type { AgentEvent } from './agentTypes.js';

let seq = 0;
const ev = (e: Partial<AgentEvent> & Pick<AgentEvent, 'kind'>): AgentEvent => ({
  id: `e${++seq}`,
  at: 1000 + seq * 100,
  source: 'claude-hook',
  sessionId: 's1',
  paths: [],
  status: 'done',
  ...e,
});

/** One session: two edits on the main thread, a subagent with a failing command, a stop. */
function session(): AgentEvent[] {
  const hit = (p: string) => [{ path: p, fileNodeId: `file:${p}`, moduleId: null, serviceId: 'svc:orders', serviceLabel: 'orders', touchedEdgeIds: [], liftedEdges: [] }];
  return [
    ev({ kind: 'session_start', status: 'running' }),
    ev({ kind: 'tool_start', tool: 'Edit', toolKind: 'edit', toolUseId: 'a', status: 'running', title: 'Edit orders/app/db.py', paths: ['orders/app/db.py'], board: hit('orders/app/db.py') }),
    ev({ kind: 'tool_end', tool: 'Edit', toolKind: 'edit', toolUseId: 'a', title: 'Edit orders/app/db.py', paths: ['orders/app/db.py'], board: hit('orders/app/db.py'), tokens: 420 }),
    ev({ kind: 'subagent_start', agentId: 'sub', title: 'Explore', status: 'running' }),
    ev({ kind: 'tool_start', agentId: 'sub', tool: 'Bash', toolKind: 'execute', toolUseId: 'b', status: 'running', title: 'Bash: run tests' }),
    ev({ kind: 'tool_end', agentId: 'sub', tool: 'Bash', toolKind: 'execute', toolUseId: 'b', status: 'failed', title: 'Bash: run tests' }),
    ev({ kind: 'subagent_stop', agentId: 'sub', title: 'Explore' }),
    /* An end whose start never arrived (async PreToolUse lost the race). */
    ev({ kind: 'tool_end', tool: 'Write', toolKind: 'edit', toolUseId: 'c', title: 'Write orders/app/models.py', paths: ['orders/app/models.py'], board: hit('orders/app/models.py') }),
    ev({ kind: 'stop' }),
  ];
}

describe('agent tree fold', () => {
  it('session ─ turn ─ calls, with the subagent and its call under the turn', () => {
    const t = emptyTree();
    for (const e of session()) foldEvent(t, e);
    const byId = t.nodes;
    expect(byId.get('session:s1')?.status).toBe('completed');
    expect(byId.get('turn:s1:1')?.parentId).toBe('session:s1');
    expect(byId.get('tool:s1:a')).toMatchObject({ parentId: 'turn:s1:1', status: 'completed', tokens: 420, stepKind: 'edit' });
    expect(byId.get('agent:s1:sub')).toMatchObject({ parentId: 'turn:s1:1', kind: 'subagent', status: 'completed', title: 'Explore' });
    expect(byId.get('tool:s1:b')).toMatchObject({ parentId: 'agent:s1:sub', status: 'failed' });
    expect(byId.get('tool:s1:c')?.status).toBe('completed');
    expect(byId.get('tool:s1:a')!.endedAt! - byId.get('tool:s1:a')!.startedAt).toBe(100);
  });
  it('a replayed event is folded once (reconnect)', () => {
    const store = createAgentStore(() => null);
    const evs = session();
    for (const e of evs) store.apply(e);
    for (const e of evs) store.apply(e);
    expect([...store.get().nodes.keys()].filter((k) => k.startsWith('turn:'))).toEqual(['turn:s1:1']);
  });
});

describe('AgentsPanel', () => {
  it('empty: one action, "Start Claude Code with hooks", and no command to copy by hand', async () => {
    render(<AgentsPanel store={createAgentStore(() => null)} />);
    expect((await screen.findByTestId('agents-start-hooks')).textContent).toBe('Start Claude Code with hooks');
    expect(screen.getByTestId('agents-empty').textContent).not.toMatch(/agentHookSettings\.js|<the file it prints>/);
  });

  it('round 7 (A5): the action writes the hook settings and runs the recorded launch in the panel\'s own terminal, with no project needed', async () => {
    const launched: (string | undefined)[] = [];
    let exit: (() => void) | undefined;
    const FakeTerminal = ((p: { launch?: string; onExit?: () => void }) => {
      launched.push(p.launch);
      exit = p.onExit;
      return <div data-testid="fake-terminal">{p.launch}</div>;
    }) as never;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ settingsFile: 'C:\\tmp\\s.json', command: 'claude --settings "C:\\tmp\\s.json"', launchId: 'L1' }), { status: 200 }));
    render(<StartWithHooks fetchImpl={fetchImpl} Terminal={FakeTerminal} />);
    fireEvent.click(screen.getByTestId('agents-start-hooks'));
    const said = await screen.findByTestId('agents-start-command');
    expect(fetchImpl).toHaveBeenCalledWith('/api/agent-hooks/claude', expect.objectContaining({ method: 'POST' }));
    expect(launched.at(-1)).toBe('L1');
    expect(said.getAttribute('data-phase')).toBe('running');
    expect((screen.getByTestId('agents-start-hooks') as HTMLButtonElement).disabled).toBe(true);
    act(() => exit?.());
    expect(screen.getByTestId('agents-start-command').getAttribute('data-phase')).toBe('ended');
    expect(screen.getByTestId('agents-start-hooks').textContent).toBe('Start Claude Code again');
  });

  it('round 7 (A5): a refused start says why, never that it is running', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'agent hooks are for a local server' }), { status: 403 }));
    render(<StartWithHooks fetchImpl={fetchImpl} />);
    fireEvent.click(screen.getByTestId('agents-start-hooks'));
    expect((await screen.findByTestId('agents-start-failed')).textContent).toBe('Could not start Claude Code: agent hooks are for a local server');
    expect(screen.queryByTestId('agents-start-command')).toBeNull();
  });

  it('roster: one row per agent and sub-agent, with status, current tool and elapsed', () => {
    const store = createAgentStore(() => null);
    for (const e of session()) store.apply(e);
    render(<AgentsPanel store={store} />);
    /* Round 9 (ask 28): the roster is the main agent; the sub-agent is counted, not listed. */
    const rows = screen.getAllByTestId('agents-roster-row');
    expect(rows.map((r) => r.getAttribute('data-status'))).toEqual(['completed']);
    expect(rows[0].textContent).toMatch(/Main agent.*Write/);
    expect(rows[0].textContent).toMatch(/\d+ms|\d+\.\ds/);
    expect(screen.getByTestId('agents-subnote').textContent).toBe('1 sub-agent, nested in its turn');
  });

  it('tree and timeline are two views of one model; selecting a step focuses it in the store', () => {
    const store = createAgentStore(() => null);
    for (const e of session()) store.apply(e);
    render(<AgentsPanel store={store} />);
    /* Round 9 (ask 28): the sub-agent starts collapsed, so its Bash call is not in the tree until it is opened. */
    expect(screen.queryByText(/Command failed: run tests/)).toBeNull();
    act(() => fireEvent.click(screen.getByText('Sub-agent: Explore')));
    const calls = screen.getAllByTestId('agents-tree-node').filter((b) => b.closest('li')?.getAttribute('data-kind') === 'tool_call');
    expect(calls.map((c) => c.querySelector('.ag-name')?.textContent)).toEqual(['Edited orders/app/db.py', 'Command failed: run tests', 'Edited orders/app/models.py']);
    /* One session: the tree opens on its turn, not on a second "Main agent" row. */
    const nodes = screen.getAllByTestId('agents-tree-node');
    expect(nodes[0].textContent).toMatch(/^.*Turn 1/);
    expect(screen.getByTestId('agents-tree').textContent).not.toMatch(/Main agent/);
    expect(nodes.find((n) => /Edited orders\/app\/db\.py/.test(n.textContent ?? ''))!.textContent).toMatch(/420 tok/);
    act(() => fireEvent.click(calls[0]));
    expect(store.get().focusId).toBe('tool:s1:a');
    expect(screen.getByTestId('agents-detail').textContent).toMatch(/orders\/app\/db\.py \(orders\)/);

    act(() => fireEvent.click(screen.getByRole('tab', { name: 'Timeline' })));
    const lanes = screen.getAllByTestId('agents-lane');
    expect(lanes).toHaveLength(2);
    const bars = screen.getAllByTestId('agents-bar');
    expect(bars.map((b) => b.getAttribute('data-step'))).toEqual(['edit', 'edit', 'execute']);
    expect(bars[0].getAttribute('aria-current')).toBe('true');
    expect(bars[2].getAttribute('data-status')).toBe('failed');
    act(() => fireEvent.click(bars[2]));
    expect(store.get().focusId).toBe('tool:s1:b');
  });

  it('the timeline has a time axis, one row per agent and sub-agent, and labels a bar on hover', () => {
    const store = createAgentStore(() => null);
    for (const e of session()) store.apply(e);
    render(<AgentsPanel store={store} initialView="timeline" />);
    /* Rows: the main agent and its sub-agent, by name. */
    expect(screen.getAllByTestId('agents-lane-name').map((n) => n.textContent)).toEqual(['Main agent', 'Explore']);
    /* The axis starts at 0s and counts up in one round step. Events are 100 ms
       apart from the first, so the span is 800 ms and the step 250 ms. */
    const ticks = screen.getAllByTestId('agents-tick').map((t) => t.textContent);
    expect(ticks).toEqual(['0s', '250ms', '500ms', '750ms']);
    /* No label until a bar is hovered; then its tool and duration, and its title. */
    expect(screen.queryByTestId('agents-bar-label')).toBeNull();
    const bars = screen.getAllByTestId('agents-bar');
    act(() => fireEvent.mouseEnter(bars[2]));
    /* Decision 49: no dot separators; a comma. */
    expect(screen.getByTestId('agents-bar-label').textContent).toBe('Bash, 100msBash: run tests');
    act(() => fireEvent.mouseLeave(bars[2]));
    expect(screen.queryByTestId('agents-bar-label')).toBeNull();
    /* Keyboard focus shows it too. */
    act(() => fireEvent.focus(bars[0]));
    expect(screen.getByTestId('agents-bar-label').textContent).toMatch(/^Edit, 100ms/);
  });

  it('axis ticks: six at most, in a round step, for any span', () => {
    expect(axisTicks(800)).toEqual([0, 250, 500, 750]);
    expect(axisTicks(60_000).length).toBeLessThanOrEqual(6);
    expect(axisTicks(60_000)).toEqual([0, 15_000, 30_000, 45_000, 60_000]);
    expect(tickLabel(90_000)).toBe('1m 30s');
    expect(tickLabel(1500)).toBe('1.5s');
  });
});

describe('a tool row names the command, not its shell (UX audit)', () => {
  it("codex's PowerShell launcher is stripped; a long command is cut from the left; the full title stays on hover", () => {
    const store = createAgentStore(() => null);
    const wrapped = String.raw`Run "C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe" -Command "npm test -- graph"`;
    const long = String.raw`Run "C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe" -Command "node scripts/check-every-package-in-the-workspace.mjs --strict --report packages/web2/report.json"`;
    for (const e of [
      ev({ kind: 'session_start', sessionId: 'sx', status: 'running' }),
      ev({ kind: 'tool_start', sessionId: 'sx', tool: 'shell', toolKind: 'execute', toolUseId: 'w1', status: 'running', title: wrapped }),
      ev({ kind: 'tool_start', sessionId: 'sx', tool: 'shell', toolKind: 'execute', toolUseId: 'w2', status: 'running', title: long }),
    ])
      store.apply(e);
    render(<AgentsPanel store={store} />);
    const names = screen.getAllByTestId('agents-tree-node').map((n) => n.querySelector('.ag-name')!);
    const short = names.find((n) => n.textContent === 'Running npm test -- graph');
    expect(short, names.map((n) => n.textContent).join(' | ')).toBeTruthy();
    expect(short!.getAttribute('title')).toBe(wrapped);
    const cut = names.find((n) => n.getAttribute('title') === long)!;
    expect(cut.textContent!.startsWith('Running …')).toBe(true);
    expect(cut.textContent!.endsWith('--report packages/web2/report.json')).toBe(true);
    expect(cut.textContent!.length).toBe('Running '.length + 72);
    expect(names.every((n) => !/powershell\.exe/i.test(n.textContent ?? ''))).toBe(true);
  });
});

describe('roster names each main agent by its chat (round 10)', () => {
  it('two chats with runs: each main-agent row carries its chat title; one chat keeps "Main agent"', () => {
    const store = createAgentStore(() => null);
    store.apply(ev({ kind: 'session_start', sessionId: 'a', status: 'running' }));
    store.apply(ev({ kind: 'session_start', sessionId: 'b', status: 'running' }));
    const chats = [
      { id: 'a', title: 'Fix orders' },
      { id: 'b', title: 'Refactor billing', titleEdited: true },
    ] as ChatLike[];
    const { unmount } = render(<AgentRoster state={store.get()} now={Date.now()} sessions={chats} />);
    const labels = screen.getAllByTestId('agents-roster-row').map((r) => r.querySelector('.ag-name')?.textContent);
    expect(labels).toEqual(['Fix orders', 'Refactor billing']);
    unmount();

    const one = createAgentStore(() => null);
    one.apply(ev({ kind: 'session_start', sessionId: 'a', status: 'running' }));
    render(<AgentRoster state={one.get()} now={Date.now()} sessions={chats} />);
    expect(screen.getAllByTestId('agents-roster-row').map((r) => r.querySelector('.ag-name')?.textContent)).toEqual(['Main agent']);
  });
});

describe('untitled chats get distinct headers (review fix)', () => {
  it('two untitled chats render two different chat headers, each with its start time', () => {
    const store = createAgentStore(() => null);
    store.apply(ev({ kind: 'session_start', sessionId: 'a', at: new Date(2026, 9, 8, 14, 2).getTime(), status: 'running' }));
    store.apply(ev({ kind: 'session_start', sessionId: 'b', at: new Date(2026, 9, 8, 15, 40).getTime(), status: 'running' }));
    const chats = [{ id: 'a', title: null }, { id: 'b', title: null }] as ChatLike[];
    render(<AgentTree state={store.get()} now={Date.now()} store={store} sessions={chats} />);
    const titles = screen.getAllByTestId('agents-chat-head').map((h) => h.querySelector('.ag-chat-title')?.textContent);
    expect(titles).toEqual(['New chat, 14:02', 'New chat, 15:40']);
  });
});

describe('roster tells untitled chats apart (review fix)', () => {
  it('two untitled chats get two different roster names; one untitled chat stays "Main agent"', () => {
    const store = createAgentStore(() => null);
    store.apply(ev({ kind: 'session_start', sessionId: 'a', at: new Date(2026, 9, 8, 14, 2).getTime(), status: 'running' }));
    store.apply(ev({ kind: 'session_start', sessionId: 'b', at: new Date(2026, 9, 8, 15, 40).getTime(), status: 'running' }));
    const chats = [{ id: 'a', title: null }, { id: 'b', title: null }] as ChatLike[];
    const { unmount } = render(<AgentRoster state={store.get()} now={Date.now()} sessions={chats} />);
    expect(screen.getAllByTestId('agents-roster-row').map((r) => r.querySelector('.ag-name')?.textContent)).toEqual(['New chat, 14:02', 'New chat, 15:40']);
    unmount();

    const one = createAgentStore(() => null);
    one.apply(ev({ kind: 'session_start', sessionId: 'a', status: 'running' }));
    render(<AgentRoster state={one.get()} now={Date.now()} sessions={[{ id: 'a', title: null }] as ChatLike[]} />);
    expect(screen.getAllByTestId('agents-roster-row').map((r) => r.querySelector('.ag-name')?.textContent)).toEqual(['Main agent']);
  });
});
