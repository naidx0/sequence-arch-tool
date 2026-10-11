import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { summary } from '../activity/fixtures';
import { requestAgentsView } from './agentsSection';

import { agentRuns, type AgentRun } from './agentRuns';
import { buildAgentsOverview } from './agentsOverview';
import { AgentsSurface } from './AgentsSurface';

const run = (over: Partial<AgentRun>): AgentRun =>
  ({ id: 'r', sessionId: 'a', agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: 'Why is the limiter wrong?', status: 'done', startedAt: 1_000, endedAt: 5_000, items: [], approvals: [], error: null, ...over }) as AgentRun;
const task = (over: Record<string, unknown> = {}) => ({ kind: 'tool', id: 'task', title: 'Task', toolKind: 'other', status: 'done', startedAt: 1_200, endedAt: 4_000, changes: [], diffs: [], output: null, subagent: 'Explore: find auth', ...over });
const step = { kind: 'tool', id: 's1', title: 'Read a.ts', toolKind: 'read', status: 'done', startedAt: 1_300, endedAt: 1_500, changes: [], diffs: [], output: null, parentId: 'task' };
const usage = (total: number) => ({ input: total - 10, output: 10, cacheRead: 0, cacheWrite: 0, thought: 0, total });

const runs: AgentRun[] = [
  run({ id: 'r1', sessionId: 'a', items: [task(), step] as never, turnUsage: usage(1200) }),
  run({ id: 'r2', sessionId: 'a', startedAt: 6_000, endedAt: 9_000, prompt: 'And the proxy?', turnUsage: usage(300) }),
  run({ id: 'r3', sessionId: 'b', startedAt: 2_000, endedAt: 3_000, prompt: 'Rename the store' }),
];

describe('the Agents overview folds runs into a tree with honest tokens', () => {
  it('lists chats, runs and subagents, with steps counted', () => {
    const o = buildAgentsOverview(runs, [{ id: 'a', title: 'Rate limiter' }], 10_000);
    expect(o.chats.map((c) => c.sessionId).sort()).toEqual(['a', 'b']);
    const a = o.chats.find((c) => c.sessionId === 'a')!;
    expect(a.title).toBe('Rate limiter');
    expect(a.runs).toHaveLength(2);
    expect(a.runs[0]!.subagents).toMatchObject([{ name: 'Explore', description: 'find auth', steps: 1 }]);
  });
  it('tokens: a run with no usage is null, never zero; the totals ignore what is unknown', () => {
    const o = buildAgentsOverview(runs, [], 10_000);
    expect(o.chats.find((c) => c.sessionId === 'b')!.output).toBeNull();
    expect(o.chats.find((c) => c.sessionId === 'b')!.runs[0]!.output).toBeNull();
    expect(o.chats.find((c) => c.sessionId === 'a')!.runs.map((r) => r.processed)).toEqual([1200, 300]);
    expect(o.chats.find((c) => c.sessionId === 'a')!.runs.map((r) => r.output)).toEqual([10, 10]);
    expect(buildAgentsOverview([runs[2]!], [], 10_000).totalOutput).toBeNull();
    expect(buildAgentsOverview([runs[2]!], [], 10_000).context).toBeNull();
  });
  it('nine turns that each re-send a ~100k context do not read as ~900k: the headline is context and output', () => {
    const turns = Array.from({ length: 9 }, (_, i) =>
      run({ id: `t${i}`, sessionId: 'big', startedAt: 1_000 + i * 1_000, endedAt: 1_500 + i * 1_000, turnUsage: { input: 8_000 + i * 100, cacheRead: 92_000, cacheWrite: 0, output: 2_000, thought: 0, total: 102_000 + i * 100 } }),
    );
    const o = buildAgentsOverview(turns, [], 20_000);
    expect(o.context).toBe(8_800 + 92_000 + 0);
    expect(o.totalOutput).toBe(18_000);
    expect(o.totalProcessed).toBeGreaterThan(900_000);
    expect(o.reportedTurns).toBe(9);
    act(() => agentRuns.patch((s) => ({ ...s, runs: turns })));
    render(<AgentsSurface />);
    const head = screen.getByTestId('agents-surface-total');
    expect(screen.getByTestId('agents-surface-context').textContent).toBe('101k');
    expect(screen.getByTestId('agents-surface-output').textContent).toBe('18k');
    expect(head.textContent).not.toMatch(/9\d\dk|9\.\dM/);
    expect(head.getAttribute('title')).toMatch(/Input processed across 9 turns: 9\d\dk/);
    act(() => agentRuns.patch((s) => ({ ...s, runs: [] })));
  });
  it('Codex: turn usage is the sum of its requests, so context comes from usage_update, not from the summed input', () => {
    /* The last acp:usage and usage_update of packages/acp edit-with-plan.sse.jsonl. */
    const codex = run({ id: 'cx', sessionId: 'cx', turnUsage: { input: 142_328, output: 1_147, cacheRead: 114_432, cacheWrite: 0, thought: 542, total: 143_475 }, usage: { used: 24_528, size: 258_400, cost: null } });
    const o = buildAgentsOverview([codex], [], 10_000);
    expect(o.context).toBe(24_528);
    expect(o.chats[0]!.runs[0]!.context).toBe(24_528);
    /* Without usage_update the formula is the fallback. */
    expect(buildAgentsOverview([{ ...codex, usage: null }], [], 10_000).context).toBe(142_328);
  });
  it('a turn that reported only tokens has no context figure of its own', () => {
    const t = run({ id: 'tk', sessionId: 'tk', tokens: { scope: 'turn', inputTokens: 900, outputTokens: 50, cachedReadTokens: 80_000, cachedWriteTokens: 0 } });
    const o = buildAgentsOverview([t], [], 10_000);
    expect(o.chats[0]!.runs[0]!.context).toBeNull();
    expect(o.context).toBeNull();
    expect(o.chats[0]!.runs[0]!.output).toBe(50);
  });
  it('a chat with a running run is running and sorts first', () => {
    const o = buildAgentsOverview([...runs, run({ id: 'r4', sessionId: 'c', status: 'running', endedAt: null })], [], 10_000);
    expect(o.chats[0]).toMatchObject({ sessionId: 'c', status: 'running', endedAt: null });
  });
});

describe('the Agents surface', () => {
  afterEach(() => act(() => agentRuns.patch((s) => ({ ...s, runs: [] }))));

  it('says so when nothing has run', () => {
    render(<AgentsSurface />);
    expect(screen.getByTestId('agents-surface-empty')).toBeTruthy();
    expect(screen.getByTestId('agents-surface-total').textContent).toContain('—');
  });

  it('draws two chats as a tree, with "—" where tokens are unknown and a total where known', () => {
    act(() => agentRuns.patch((s) => ({ ...s, runs })));
    render(<AgentsSurface />);
    const chats = screen.getAllByTestId('agents-surface-chat');
    expect(chats).toHaveLength(2);
    expect(screen.getAllByTestId('agents-surface-chat-tokens').map((n) => n.textContent)).toContain('—');
    expect(screen.getByTestId('agents-surface-output').textContent).toBe('20');
    expect(screen.getByTestId('agents-surface-context').textContent).toBe('290');
    expect(within(chats[0]!).queryAllByTestId('agents-surface-subagent').length + within(chats[1]!).queryAllByTestId('agents-surface-subagent').length).toBe(1);
  });

  it('a running run shows the ASCII spinner and a shimmering label; the timeline is a twist on each row (round 13), not a tab', () => {
    act(() => agentRuns.patch((s) => ({ ...s, runs: [run({ id: 'r9', sessionId: 'z', status: 'running', endedAt: null })] })));
    const { container } = render(<AgentsSurface />);
    expect(screen.getAllByTestId('s2-ascii-spinner').length).toBeGreaterThan(0);
    expect(container.querySelector('.ags-label.shimmer-text')).not.toBeNull();
    expect(screen.queryByRole('tab', { name: 'Timeline' })).toBeNull();
    expect(screen.queryByTestId('agents-surface-detail')).toBeNull();
    fireEvent.click(screen.getAllByTestId('agents-surface-twist')[0]!);
    expect(screen.getAllByTestId('agents-surface-detail')).toHaveLength(1);
    expect(screen.getByTestId('agents-surface-detail').textContent).toMatch(/Started/);
    fireEvent.click(screen.getAllByTestId('agents-surface-twist')[0]!);
    expect(screen.queryByTestId('agents-surface-detail')).toBeNull();
  });
});

describe('the Workflows section (the old Activity overlay, inside the Agents surface)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists workflow runs with their states, and Start a workflow opens the launch form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/api/program/runs')
          ? new Response(JSON.stringify({ runs: [summary({ runId: 'run-a', status: 'running' }), summary({ runId: 'run-b', programName: 'Docs pass', status: 'completed' })] }), { status: 200, headers: { 'content-type': 'application/json' } })
          : new Response('{}', { status: 404 }),
      ),
    );
    render(<AgentsSurface />);
    fireEvent.click(screen.getByTestId('agents-surface-tab-workflows'));
    /* The section's chunk is awaited, not raced. */
    await act(async () => {
      await import('../activity/ConnectedActivity');
    });
    const rows = await screen.findAllByTestId('activity-row', undefined, { timeout: 5000 });
    expect(rows).toHaveLength(2);
    expect(screen.getAllByTestId('activity-row-state').map((n) => n.textContent?.toLowerCase()).join(' ')).toMatch(/running/);
    expect(screen.getByTestId('activity-new-run').textContent).toBe('Start a workflow');
    fireEvent.click(screen.getByTestId('activity-new-run'));
    expect(await screen.findByTestId('activity-author')).toBeTruthy();
  });

  it('an outside request (the palette, the + menu) switches a mounted surface to Workflows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    render(<AgentsSurface />);
    expect(screen.getByTestId('agents-surface-tab-tree').getAttribute('aria-selected')).toBe('true');
    act(() => requestAgentsView('workflows'));
    await waitFor(() => expect(screen.getByTestId('agents-surface-tab-workflows').getAttribute('aria-selected')).toBe('true'));
  });
});

describe('round 12: the tabs fold to icons under 1200px, and the running colour is neutral', () => {
  it('each tab has an icon, a word, an aria-label and a tooltip', () => {
    render(<AgentsSurface />);
    for (const [v, word] of [['tree', 'Tree'], ['workflows', 'Workflows']] as const) {
      const b = screen.getByTestId(`agents-surface-tab-${v}`);
      expect(b.getAttribute('aria-label')).toBe(word);
      expect(b.getAttribute('title')).toBe(word);
      expect(b.querySelector('svg.ags-seg-ico')).toBeTruthy();
      expect(b.querySelector('.ags-seg-t')!.textContent).toBe(word);
    }
  });

  it('the stylesheet hides the word and shows the glyph under 1200px, with no accent on running marks', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(`${__dirname}/agentsSurface.css`, 'utf8');
    expect(css).toMatch(/@media \(max-width: 1199px\)[\s\S]*\.ags-seg-ico \{ display: block; \}[\s\S]*\.ags-seg-t \{[\s\S]*clip-path/);
    expect(css).not.toMatch(/\.ags-bar\[data-state='running'\] \{\s*background: var\(--b-acc\)/);
    expect(css).toMatch(/\.ags \.ags-label\.shimmer-text \{\s*background-image: linear-gradient\([^;]*var\(--b-ink1\)/);
    expect(css).not.toMatch(/\.ags[^{]*shimmer-text[^{]*\{[^}]*accent/);
  });
});
