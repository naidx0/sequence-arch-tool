import { describe, expect, it } from 'vitest';

import { workRow } from './fixtures';
import {
  deriveTopologySteps,
  filterTopologyTheaterRows,
  isTopologyWorkRow,
  topologyStreamPhase,
  topologyTheaterActive,
  TOPOLOGY_STEP_LABELS,
  TOPOLOGY_THEATER_TITLE,
} from './topologyTheaterModel';

describe('topologyStreamPhase', () => {
  it('detects nodes and edges in partial propose_topology JSON', () => {
    expect(topologyStreamPhase('{"name":"propose_topology","args":{')).toBe('called');
    expect(
      topologyStreamPhase(
        '{"name":"propose_topology","args":{"nodes":[{"id":"a","label":"A"}',
      ),
    ).toBe('nodes');
    expect(
      topologyStreamPhase(
        '{"name":"propose_topology","args":{"nodes":[],"edges":[{"id":"e1"',
      ),
    ).toBe('edges');
  });

  it('detects bare process-sequence dumps without a tool name', () => {
    expect(
      topologyStreamPhase(
        '{"kind":"process-sequence","title":"Harness","nodes":[{"id":"proposal:a"}',
      ),
    ).toBe('nodes');
  });

  it('returns none for unrelated text', () => {
    expect(topologyStreamPhase('plain answer')).toBe('none');
  });
});

describe('topologyTheaterActive', () => {
  it('is live while propose_topology tool row is running', () => {
    const rows = [
      workRow('t1', {
        from: 'tool:start',
        verb: 'Called propose_topology',
        status: 'running',
      }),
    ];
    expect(topologyTheaterActive(rows, { streaming: true })).toBe(true);
  });

  it('is not live after topology proposal lands while streaming', () => {
    const rows = [
      workRow('t1', {
        from: 'tool:start',
        verb: 'Called propose_topology',
        status: 'done',
      }),
      workRow('t2', { from: 'topology:proposal', verb: 'Proposed architecture', opens: 'canvas' }),
    ];
    expect(topologyTheaterActive(rows, { streaming: true })).toBe(false);
  });

  it('stays visible on settled turns with propose_topology / proposal work', () => {
    const rows = [
      workRow('t1', {
        from: 'tool:start',
        verb: 'Called propose_topology',
        status: 'done',
      }),
      workRow('t2', { from: 'topology:proposal', verb: 'Proposed architecture', opens: 'canvas' }),
    ];
    expect(topologyTheaterActive(rows, { streaming: false })).toBe(true);
  });

  it('is live for orphan propose_topology in streaming prose', () => {
    expect(
      topologyTheaterActive([], {
        streaming: true,
        hasOrphanTool: true,
        streamText: '{"name":"propose_topology","args":{',
      }),
    ).toBe(true);
  });

  it('shows landed theater for settled orphan process-sequence dump', () => {
    expect(
      topologyTheaterActive([], {
        streaming: false,
        hasOrphanTool: true,
        streamText:
          '{"kind":"process-sequence","title":"Harness","nodes":[{"id":"proposal:a"}]}',
      }),
    ).toBe(true);
  });
});

describe('deriveTopologySteps', () => {
  it('starts with called running when only stream hints exist', () => {
    const steps = deriveTopologySteps([], {
      streamText: '{"name":"propose_topology","args":{',
    });
    expect(steps.map((s) => s.status)).toEqual(['running', 'pending', 'pending', 'pending']);
    expect(steps[0]?.label).toBe(TOPOLOGY_STEP_LABELS.called);
  });

  it('advances to building nodes while tool row runs', () => {
    const rows = [
      workRow('t1', {
        from: 'tool:start',
        verb: 'Called propose_topology',
        status: 'running',
      }),
    ];
    const steps = deriveTopologySteps(rows);
    expect(steps.map((s) => s.status)).toEqual(['done', 'running', 'pending', 'pending']);
    expect(steps[1]?.label).toBe('Building nodes…');
  });

  it('advances through edges then checking as tool completes', () => {
    const running = deriveTopologySteps([
      workRow('t1', {
        from: 'tool:start',
        verb: 'Called propose_topology',
        status: 'running',
      }),
    ], {
      streamText: '{"name":"propose_topology","args":{"nodes":[],"edges":[',
    });
    expect(running.map((s) => s.status)).toEqual(['done', 'done', 'running', 'pending']);

    const done = deriveTopologySteps([
      workRow('t1', {
        from: 'tool:start',
        verb: 'Called propose_topology',
        status: 'done',
      }),
    ]);
    expect(done.map((s) => s.status)).toEqual(['done', 'done', 'done', 'running']);
  });

  it('marks all steps done when topology proposal row exists', () => {
    const steps = deriveTopologySteps([
      workRow('t1', { from: 'topology:proposal', verb: 'Proposed architecture' }),
    ]);
    expect(steps.every((s) => s.status === 'done')).toBe(true);
    expect(steps.map((s) => s.label)).toEqual([
      TOPOLOGY_STEP_LABELS.called,
      TOPOLOGY_STEP_LABELS.nodes,
      TOPOLOGY_STEP_LABELS.edges,
      TOPOLOGY_STEP_LABELS.checking,
    ]);
  });

  it('marks all steps done when landed (settled topology seat)', () => {
    const steps = deriveTopologySteps([], { landed: true });
    expect(steps.every((s) => s.status === 'done')).toBe(true);
  });

  it('advances on bare process-sequence stream without propose_topology name', () => {
    const steps = deriveTopologySteps([], {
      streamText:
        '{"kind":"process-sequence","title":"Harness","nodes":[{"id":"proposal:a"}],"edges":[',
    });
    expect(steps.map((s) => s.status)).toEqual(['done', 'done', 'running', 'pending']);
  });
});
describe('filterTopologyTheaterRows', () => {
  it('removes topology narration rows but keeps canvas affordance', () => {
    const rows = [
      workRow('t1', {
        from: 'tool:start',
        verb: 'Called propose_topology',
        status: 'running',
      }),
      workRow('t2', {
        from: 'topology:proposal',
        verb: 'Proposed architecture',
        opens: 'canvas',
      }),
    ];
    const filtered = filterTopologyTheaterRows(rows);
    expect(filtered.map((r) => r.id)).toEqual(['t2']);
    expect(isTopologyWorkRow(rows[0]!)).toBe(true);
  });
});

describe('TOPOLOGY_THEATER_TITLE', () => {
  it('matches toolCardTitle / liveLabelFor surface name', () => {
    expect(TOPOLOGY_THEATER_TITLE).toBe('Drawing on Architecture');
  });
});
