import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgentsPanel } from './AgentsPanel.js';
import { createAgentStore } from './agentStream.js';
import type { AgentEvent } from './agentTypes.js';

/* The focused step under the agents window: what it was, what it printed and
   what it touched are three facts on three lines. No agent, no server. */

let seq = 0;
const ev = (e: Partial<AgentEvent> & Pick<AgentEvent, 'kind'>): AgentEvent => ({
  id: `e${++seq}`,
  at: 1000 + seq * 100,
  source: 'acp',
  sessionId: 'chat',
  paths: [],
  status: 'done',
  ...e,
});
const hit = (p: string) => ({ path: p, fileNodeId: null, moduleId: null, serviceId: null, serviceLabel: null, touchedEdgeIds: [], liftedEdges: [] });

describe('the focused step under the agents window', () => {
  const LONG = JSON.stringify({ rows: Array.from({ length: 6 }, (_, i) => ({ id: i, path: `src/module-${i}.ts` })) });

  it('keeps the step\'s output on its own line, whole on the hover, and out of the step\'s own sentence', () => {
    const store = createAgentStore(() => null);
    store.apply(ev({ kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 'a', status: 'running', title: 'Read a.ts', board: [hit('a.ts')] }));
    store.apply(ev({ kind: 'tool_end', tool: 'Read', toolKind: 'read', toolUseId: 'a', title: 'Read a.ts', board: [hit('a.ts')], result: LONG }));
    render(<AgentsPanel store={store} />);
    act(() => fireEvent.click(screen.getByText('Read a.ts')));
    const line = screen.getByTestId('agents-detail-line');
    expect(line.textContent).toBe('Read a.ts, done, 100ms');
    expect(line.textContent).not.toContain('rows');
    const out = screen.getByTestId('agents-detail-result');
    expect(out.textContent).toBe(LONG);
    expect(out.getAttribute('title')).toBe(LONG);
  });

  it('names a few paths and counts the rest', () => {
    const store = createAgentStore(() => null);
    store.apply(
      ev({
        kind: 'tool_start',
        tool: 'Edit',
        toolKind: 'edit',
        toolUseId: 'a',
        status: 'running',
        title: 'Edit a.ts',
        board: [hit('a.ts'), hit('b.ts'), hit('c.ts'), hit('d.ts'), hit('e.ts')],
      }),
    );
    store.apply(ev({ kind: 'tool_end', tool: 'Edit', toolKind: 'edit', toolUseId: 'a', title: 'Edit a.ts', board: [hit('a.ts'), hit('b.ts'), hit('c.ts'), hit('d.ts'), hit('e.ts')] }));
    render(<AgentsPanel store={store} />);
    act(() => fireEvent.click(screen.getByText('Edited a.ts')));
    const paths = screen.getByTestId('agents-detail-paths');
    expect(paths.textContent).toContain('a.ts');
    expect(paths.textContent).toContain('and 2 more paths');
    expect(paths.getAttribute('title')).toBe('a.ts, b.ts, c.ts, d.ts, e.ts');
  });
});
