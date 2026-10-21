import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { agentRuns } from './agentRuns';
import { AgentsPanel } from './AgentsPanel.js';
import { createAgentStore, type AgentStore } from './agentStream.js';
import { foldSteps, FOLD_MIN, KEEP_LIVE } from './agentFold';
import type { AgentNode } from './agentTypes.js';
import { fromSavedRun } from './savedRuns';

/* ══════════════════════════════════════════════════════════════════════════
   A LONG RUN, READABLE, IN THE AGENTS WINDOW
   packages/web2/src/agents/agentsLongRun.test.tsx

   A turn of forty steps was forty rows. Runs of finished steps of one kind
   fold into one row that says what they did ("Read 24 files") and opens onto
   them; a failed step, the step in flight and the focused step are never
   folded away. While the turn runs, the newest finished steps of the run at
   its end stay as rows, so a step finishing grows the fold and the rows under
   it stay where they were. The roster above the scroll names the agent's
   mark and what it is on, so the status never scrolls away.
   ══════════════════════════════════════════════════════════════════════════ */

const node = (i: number, over: Partial<AgentNode> = {}): AgentNode => ({
  id: `t${i}`, sessionId: 's', parentId: 'turn', rootId: 'root', kind: 'tool_call', status: 'completed', title: `Read f${i}.ts`,
  toolKind: 'Read', stepKind: 'read', locations: [], startedAt: i * 1000, endedAt: i * 1000 + 400, ...over,
});
const reads = (n: number, from = 0): AgentNode[] => Array.from({ length: n }, (_, i) => node(from + i));
const shape = (rows: ReturnType<typeof foldSteps>): string => rows.map((r) => (r.kind === 'fold' ? `F${r.nodes.length}` : 'n')).join(' ');

describe('foldSteps (pure)', () => {
  it('folds a finished run of one kind, and says what it did from the steps behind it', () => {
    const rows = foldSteps(reads(12), { running: false, focusId: null, held: () => false });
    expect(shape(rows)).toBe('F12');
    const fold = rows[0]!;
    expect(fold.kind === 'fold' && fold.text).toBe('Read 12 files');
    expect(fold.kind === 'fold' && fold.id).toBe('fold:t0');
  });
  it('leaves a short run alone', () => {
    expect(shape(foldSteps(reads(FOLD_MIN - 1), { running: false, focusId: null, held: () => false }))).toBe(Array(FOLD_MIN - 1).fill('n').join(' '));
  });
  it('never folds away a failed step, the step in flight, a held (stalled) step or the focused one', () => {
    const steps = [...reads(5), node(5, { status: 'failed', error: 'ENOENT' }), ...reads(5, 6), node(11, { id: 'focus' }), ...reads(5, 12), node(17, { id: 'stuck' }), node(18, { id: 'live', status: 'running', endedAt: null })];
    const rows = foldSteps(steps, { running: true, focusId: 'focus', held: (n) => n.id === 'stuck' });
    expect(shape(rows)).toBe('F5 n F5 n F5 n n');
    const ids = rows.flatMap((r) => (r.kind === 'node' ? [r.node.id] : []));
    expect(ids).toEqual(['t5', 'focus', 'stuck', 'live']);
  });
  it('different kinds do not fold together', () => {
    const mixed = [...reads(4), ...Array.from({ length: 4 }, (_, i) => node(10 + i, { stepKind: 'execute', toolKind: 'Bash', title: `pnpm t${i}` }))];
    expect(shape(foldSteps(mixed, { running: false, focusId: null, held: () => false }))).toBe('F4 F4');
    expect(foldSteps(mixed, { running: false, focusId: null, held: () => false }).map((r) => r.kind === 'fold' && r.text)).toEqual(['Read 4 files', 'Ran 4 commands']);
  });
  it('while the turn runs the newest finished steps at its end stay rows, so one more finishing changes no row count', () => {
    const live = (n: number): string => shape(foldSteps([...reads(n), node(n, { status: 'running', endedAt: null })], { running: true, focusId: null, held: () => false }));
    const a = live(10);
    const b = live(11);
    expect(a).toBe(`F${10 - KEEP_LIVE} ${Array(KEEP_LIVE).fill('n').join(' ')} n`);
    expect(a.split(' ').length).toBe(b.split(' ').length);
  });
});

function longStore(sessionId = 'chat'): AgentStore {
  const store = createAgentStore(() => null);
  const at = Date.now() - 600_000;
  let k = 0;
  const ev = (over: Record<string, unknown>) => store.apply({ id: `e${k++}`, at: at + k * 1000, source: 'acp', sessionId, paths: [], status: 'done', ...over } as never);
  ev({ kind: 'session_start', status: 'running', title: 'Long run' });
  for (let i = 0; i < 30; i++) {
    ev({ kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: `r${i}`, status: 'running', title: `Read src/m${i}.ts` });
    ev({ kind: 'tool_end', tool: 'Read', toolKind: 'read', toolUseId: `r${i}`, title: `Read src/m${i}.ts` });
  }
  ev({ kind: 'tool_start', tool: 'Bash', toolKind: 'execute', toolUseId: 'b', status: 'running', title: 'pnpm test' });
  ev({ kind: 'tool_end', tool: 'Bash', toolKind: 'execute', toolUseId: 'b', status: 'failed', title: 'pnpm test', error: 'FAIL' });
  return store;
}

describe('the agents window with a long run', () => {
  it('forty-odd steps read as a fold row, the failed command and the turn, not as forty rows', () => {
    render(<AgentsPanel store={longStore()} />);
    const nodes = screen.getAllByTestId('agents-tree-node');
    expect(nodes.length).toBeLessThanOrEqual(4);
    const fold = screen.getByTestId('agents-step-fold');
    expect(fold.textContent).toContain('Read 30 files');
    expect(screen.getByText(/pnpm test/)).toBeTruthy();
  });
  it('the fold opens onto its steps and shuts again', () => {
    render(<AgentsPanel store={longStore()} />);
    const toggle = within(screen.getByTestId('agents-step-fold')).getByTestId('agents-step-fold-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const before = screen.getAllByTestId('agents-tree-node').length;
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByTestId('agents-tree-node').length).toBe(before + 30);
    fireEvent.click(toggle);
    expect(screen.getAllByTestId('agents-tree-node').length).toBe(before);
  });
  it('the roster names the agent by its mark when the chat is known, and draws none when it is not', () => {
    const run = fromSavedRun({ id: 't0', agentRef: 'codex', prompt: 'p', text: 'x', status: 'done', startedAt: 1, endedAt: 2, tools: [] }, 'chat')!;
    agentRuns.hydrate('chat', [run]);
    const { unmount } = render(<AgentsPanel store={longStore()} />);
    expect(screen.getByTestId('agents-roster-row').querySelector('[data-brand="codex"]')).not.toBeNull();
    unmount();
    render(<AgentsPanel store={longStore('nobody-knows-this-chat')} />);
    expect(screen.getByTestId('agents-roster-row').querySelector('[data-brand]')).toBeNull();
  });
});
