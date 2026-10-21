import { describe, expect, it } from 'vitest';

import { traceStatus, traceSummary } from './agentTrace.js';
import type { AgentNode } from './agentTypes.js';

/* The trace's words are counted from the steps behind them, never guessed. */

const node = (over: Partial<AgentNode>): AgentNode => ({
  id: 'x',
  sessionId: 's',
  parentId: null,
  rootId: 'r',
  kind: 'tool_call',
  status: 'completed',
  title: 't',
  toolKind: null,
  stepKind: null,
  locations: [],
  startedAt: 0,
  endedAt: 1,
  ...over,
});

describe('the trace summary', () => {
  it('counts the steps it has, in the order the words read', () => {
    const steps = [
      node({ stepKind: 'search', title: 'Grep foo' }),
      node({ stepKind: 'read', title: 'Read a.ts' }),
      node({ stepKind: 'read', title: 'Read b.ts' }),
      node({ stepKind: 'execute', title: 'Bash: pnpm test' }),
    ];
    expect(traceSummary(steps)).toBe('searched 1 time, read 2 files, ran 1 command');
  });

  it('says one file, one command: the singular is not a guess', () => {
    expect(traceSummary([node({ stepKind: 'read', title: 'Read a.ts' })])).toBe('read 1 file');
    expect(traceSummary([node({ stepKind: 'execute', title: 'Bash: ls' })])).toBe('ran 1 command');
  });

  it('counts a step that failed: the trace lists it, so the summary counts it', () => {
    expect(traceSummary([node({ stepKind: 'read', status: 'failed', title: 'Read a.ts' })])).toBe('read 1 file');
  });

  it('does not count thinking: deciding is not work', () => {
    expect(traceSummary([node({ stepKind: 'think', title: 'Thinking' }), node({ stepKind: 'read', title: 'Read a.ts' })])).toBe('read 1 file');
  });

  it('a turn with no steps says nothing at all', () => {
    expect(traceSummary([])).toBeNull();
  });
});

describe('the trace status line', () => {
  it('names the step in flight while the turn runs', () => {
    const steps = [node({ stepKind: 'read', status: 'running', title: 'Read a.ts' })];
    expect(traceStatus(steps, true)).toEqual({ kind: 'step', text: 'Reading a.ts' });
  });

  it('says the agent is working when no step is open yet', () => {
    expect(traceStatus([node({ stepKind: 'read', status: 'completed', title: 'Read a.ts' })], true)).toEqual({ kind: 'working', text: 'Working on it' });
  });

  it('names what the turn did once it is done', () => {
    const steps = [node({ stepKind: 'read', title: 'Read a.ts' }), node({ stepKind: 'execute', title: 'Bash: ls' })];
    expect(traceStatus(steps, false)).toEqual({ kind: 'done', text: 'read 1 file, ran 1 command' });
  });
});
