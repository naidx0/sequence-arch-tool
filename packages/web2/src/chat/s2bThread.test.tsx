import fs from 'node:fs';
import path from 'node:path';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SSE_GOLDEN, readGolden, replayFetch } from '../../test/support/replaySse';
import { createAgentRunStore } from '../agents/agentRuns';
import { AgentRunView } from './AgentRunThread';
import { planName, planSteps } from './cliPlan';
import { foldSummary, readableToolTitle, unwrapShell } from './commandLabel';

/*
 * S2b IN THE THREAD: readable command labels, runs of calls folded, and the
 * CLI's own plan in the plan card. The streams are what the real server sent
 * while recorded sessions replayed through it (fixtures/replay/sse and
 * sse-s2b); "not run live" where the fixture was built from protocol types.
 */

type Json = Record<string, unknown>;

const goldenIn = (dir: string, name: string): Json[] =>
  fs
    .readFileSync(path.join(SSE_GOLDEN, '..', dir, `${name}.sse.jsonl`), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Json);

async function runOf(events: Json[], intent: 'plan' | 'build' = 'build') {
  const { fetch } = replayFetch(events);
  return createAgentRunStore({ clock: () => 1000, fetch }).start({ question: 'replay', intent }, fetch);
}

describe('readable command labels (table)', () => {
  it.each([
    ['Run "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "npm test -- graph"', 'execute', 'npm test -- graph'],
    ['Run bash -lc "pnpm exec vitest run"', 'execute', 'pnpm exec vitest run'],
    ['Run cmd /c npx tsc -p .', 'execute', 'npx tsc -p .'],
    ['`npm test`', 'execute', 'npm test'],
    ['Run npm test', 'execute', 'npm test'],
    ['Edit src/a.ts', 'edit', 'Edit src/a.ts'],
    ['`not a command`', 'read', '`not a command`'],
  ])('%s', (title, kind, want) => {
    expect(readableToolTitle(title, kind)).toBe(want);
  });

  it('the live command-approval card reads as the command, not its shell', async () => {
    const run = await runOf(readGolden('command-approval'));
    render(<AgentRunView run={run} now={1000} repoRoot={null} onAnswer={() => {}} />);
    for (const t of screen.queryAllByTestId('agent-tool-fold-toggle')) fireEvent.click(t);
    const titles = [...document.querySelectorAll('[data-testid="agent-card-title"]')].map((t) => t.textContent);
    expect(titles.some((t) => t?.startsWith('node -e '))).toBe(true);
    expect(titles.some((t) => /powershell/i.test(t ?? ''))).toBe(false);
    expect(unwrapShell('"C:\\x\\pwsh.exe" -c "ls"')).toBe('ls');
  });
});

describe('runs of tool calls fold into one row', () => {
  it.each([
    [[{ toolKind: 'execute' }, { toolKind: 'execute' }, { toolKind: 'execute' }, { toolKind: 'edit', files: 2 }], 'Ran 3 commands, edited 2 files'],
    [[{ toolKind: 'read' }, { toolKind: 'execute' }], 'Read 1 file, ran 1 command'],
    [[{ toolKind: 'search' }, { toolKind: 'search' }], '2 searches'],
    [[{ toolKind: 'search' }, { toolKind: 'read' }, { toolKind: 'search' }, { toolKind: 'search' }], '3 searches, read 1 file'],
    [[{ toolKind: null }], 'Used 1 tool'],
  ] as const)('%j -> %s', (calls, want) => {
    expect(foldSummary(calls)).toBe(want);
  });

  it('always-prefix (not run live): three commands in a row, settled, are one row that opens onto them', async () => {
    const run = await runOf(goldenIn('sse-s1', 'always-prefix'));
    render(<AgentRunView run={run} now={1000} repoRoot={null} onAnswer={() => {}} />);
    expect(screen.getByTestId('agent-tool-fold-summary').textContent).toBe('Ran 3 commands');
    expect(screen.getByTestId('agent-tool-fold').textContent).toMatch(/1 failed/);
    expect(document.querySelectorAll('.s2-agcard')).toHaveLength(0);
    const toggle = screen.getByTestId('agent-tool-fold-toggle');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect([...document.querySelectorAll('[data-testid="agent-card-title"]')].map((t) => t.textContent)).toEqual(['npm test -- graph', 'npm test -- link', 'git checkout main']);
  });

  it('live edit-with-plan: the agent speaks between its calls, so each call stands alone (nothing folded across words)', async () => {
    const run = await runOf(readGolden('edit-with-plan'));
    render(<AgentRunView run={run} now={1000} repoRoot={null} onAnswer={() => {}} />);
    expect(screen.queryByTestId('agent-tool-fold')).toBeNull();
  });
});

describe("the CLI's plan in the plan card", () => {
  it('planSteps reads codex\'s inline goal and a markdown list', () => {
    const goal = 'Three-step plan: 1) inspect the target file, 2) add ping() returning "pong", 3) create NOTES.md containing "ping added" and verify both.';
    expect(planSteps(goal).map((s) => s.text)).toEqual(['inspect the target file', 'add ping() returning "pong"', 'create NOTES.md containing "ping added" and verify both.']);
    expect(planName(goal)).toBe('Three-step plan');
    expect(planSteps('## Plan\n\n1. a\n2. b\n- c').map((s) => s.text)).toEqual(['a', 'b', 'c']);
    expect(planName('## Plan\n\n1. a')).toBe('Plan');
  });

  it('live edit-with-plan in Plan: the goal is the plan; Build calls back, Keep planning dismisses; usage and limits are on the run', async () => {
    const run = await runOf(readGolden('edit-with-plan'), 'plan');
    expect(run.cliPlan?.content).toMatch(/^Three-step plan/);
    expect(run.usage).toEqual({ used: 24_528, size: 258_400, cost: null });
    expect(run.limits?.primary?.usedPercent).toBe(52);
    const onBuild = vi.fn();
    const view = render(<AgentRunView run={run} now={1000} repoRoot={null} onAnswer={() => {}} onBuild={onBuild} />);
    const card = screen.getByTestId('agent-cli-plan');
    expect(within(card).getAllByRole('listitem').map((l) => l.textContent)).toHaveLength(3);
    fireEvent.click(within(card).getByTestId('v3-plan-build'));
    expect(onBuild).toHaveBeenCalledWith(run);
    expect(screen.queryByTestId('agent-cli-plan')).toBeNull();
    view.unmount();
    /* In Build the same run offers nothing to approve. */
    const built = await runOf(readGolden('edit-with-plan'), 'build');
    render(<AgentRunView run={built} now={1000} repoRoot={null} onAnswer={() => {}} onBuild={onBuild} />);
    expect(screen.queryByTestId('agent-cli-plan')).toBeNull();
  });

  it('claude-plan-mode (not run live): ExitPlanMode waits as the plan card; Build answers allow, Keep planning deny', async () => {
    const events = goldenIn('sse-s2b', 'claude-plan-mode');
    const upTo = events.findIndex((e) => e.type === 'acp:permission' && e.pending === true);
    const run = await runOf(events.slice(0, upTo + 1), 'plan');
    const onAnswer = vi.fn();
    render(<AgentRunView run={run} now={1000} repoRoot={null} onAnswer={onAnswer} />);
    const card = screen.getByTestId('agent-cli-plan');
    expect(within(card).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['Add `ping()` to orders/app/main.py returning "pong"', 'Route GET /ping to it', 'Add a test for /ping']);
    fireEvent.click(within(card).getByTestId('v3-plan-build'));
    fireEvent.click(within(card).getByTestId('v3-plan-keep'));
    expect(onAnswer.mock.calls.map((c) => c[2])).toEqual(['allow', 'deny']);
    /* Its todos and usage reached the run too. */
    expect(run.items.find((i) => i.kind === 'plan')).toBeTruthy();
    expect(run.usage).toEqual({ used: 41_000, size: 200_000, cost: { amount: 0.04, currency: 'USD' } });
  });

  it('claude-plan-mode, as it streams: the card drawn at the tool call opens when the ExitPlanMode question arrives', async () => {
    const events = goldenIn('sse-s2b', 'claude-plan-mode');
    const call = events.findIndex((e) => (e.update as { update?: { sessionUpdate?: string } } | undefined)?.update?.sessionUpdate === 'tool_call');
    const upTo = events.findIndex((e) => e.type === 'acp:permission' && e.pending === true);
    expect(call).toBeLessThan(upTo);
    const before = await runOf(events.slice(0, call + 1), 'plan');
    const { rerender } = render(<AgentRunView run={before} now={1000} repoRoot={null} onAnswer={vi.fn()} />);
    expect(screen.queryByTestId('agent-cli-plan')).toBeNull();
    const asked = await runOf(events.slice(0, upTo + 1), 'plan');
    rerender(<AgentRunView run={{ ...asked, id: before.id }} now={1000} repoRoot={null} onAnswer={vi.fn()} />);
    expect(screen.getByTestId('agent-cli-plan')).toBeTruthy();
  });
});
