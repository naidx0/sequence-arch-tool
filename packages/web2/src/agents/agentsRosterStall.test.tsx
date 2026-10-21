import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgentsPanel } from './AgentsPanel.js';
import { createAgentStore } from './agentStream.js';

/* The roster in the agents window: it says what is stuck, not only that
   something is. No agent, no server, no binary. */

describe('the roster in the agents window', () => {
  it('names the step that has stalled, not only the word', () => {
    const store = createAgentStore(() => null);
    const start = Date.now() - 2 * 60_000;
    store.apply({ id: 'x1', at: start, source: 'acp', sessionId: 'chat', paths: [], status: 'running', kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 'r', title: 'Read big.log' });
    render(<AgentsPanel store={store} />);
    const row = screen.getByTestId('agents-roster-row');
    expect(row.getAttribute('data-flag')).toBe('stalled');
    expect(row.querySelector('.ag-tool')?.textContent).toBe('Read, stalled');
  });
});
