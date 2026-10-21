/**
 * SystemBoard layout + materialize locking tests.
 */
import { validateSystemBoard, type SystemBoardV0 } from '@sequence/schema';
import { describe, expect, it } from 'vitest';

import { layoutSystemBoard } from './systemBoardLayout';
import { materializeSystemBoard } from './systemBoardMaterialize';
import { boardWireToWbItem } from './seqDraw';

/** Tasmap-shaped fixture — tracks, roles, pin, issue card, grounded store node. */
export function tasmapFixture(): SystemBoardV0 {
  return {
    version: 0,
    title: 'Search fan-out → focus coordination',
    layoutProfile: 'lane',
    nodes: [
      {
        id: 'gw',
        role: 'component',
        track: '1-search',
        label: 'Gateway',
        bullets: ['routes /search', 'auth gate'],
      },
      {
        id: 'fan',
        role: 'action',
        track: '1-search',
        label: 'Fan-out',
        bullets: ['parallel index queries'],
      },
      {
        id: 'focus',
        role: 'runtime',
        track: '2-focus',
        label: 'Focus coordinator',
      },
      {
        id: 'idx',
        role: 'store',
        track: '2-focus',
        label: 'Index',
        evidence: { nodeId: 'svc:index', path: 'packages/index/main.ts', lines: { start: 1, end: 40 } },
      },
      {
        id: 'debt',
        role: 'note',
        track: '3-debt',
        label: 'Architecture debt',
        bullets: ['no cache layer'],
      },
    ],
    edges: [
      { id: 'e-gw-fan', from: 'gw', to: 'fan', pin: 'P1' },
      { id: 'e-fan-focus', from: 'fan', to: 'focus' },
      { id: 'e-focus-idx', from: 'focus', to: 'idx', pin: 'P3' },
    ],
    issues: [
      { id: 'i-cache', priority: 'P1', title: 'Missing cache', detail: 'No TTL on hot path' },
      { id: 'i-retry', priority: 'P3', title: 'Retry storm', detail: 'Unbounded fan-out' },
    ],
  };
}

describe('SystemBoard IR', () => {
  it('validates the Tasmap fixture', () => {
    const res = validateSystemBoard(tasmapFixture(), {
      knownNodeIds: new Set(['svc:index']),
    });
    expect(res.ok).toBe(true);
  });

  it('refuses invented evidence.nodeId', () => {
    const res = validateSystemBoard(tasmapFixture(), {
      knownNodeIds: new Set(['svc:gateway']),
    });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('svc:index'))).toBe(true);
  });
});

describe('SystemBoard layout', () => {
  it('same IR twice yields identical geometry', () => {
    const a = layoutSystemBoard(tasmapFixture());
    const b = layoutSystemBoard(tasmapFixture());
    expect(a).toEqual(b);
  });

  it('places nodes in sorted track order with integer coords', () => {
    const layout = layoutSystemBoard(tasmapFixture());
    // Nodes within a track are laid out by sorted id (fan before gw).
    expect(layout.nodes.gw?.at.x).toBe(layout.nodes.fan?.at.x! + 168);
    expect(Number.isInteger(layout.nodes.idx?.at.x)).toBe(true);
    expect(Object.keys(layout.trackFrames).sort()).toEqual(['1-search', '2-focus', '3-debt']);
  });
});

describe('SystemBoard materialize', () => {
  it('emits frames, legend, arrows, issues, and a grounded card', () => {
    const wire = materializeSystemBoard(tasmapFixture());
    expect(wire.some((i) => i.id === 'sb-legend-frame')).toBe(true);
    expect(wire.some((i) => i.kind === 'shape' && i.id.startsWith('sb-track-'))).toBe(true);
    expect(wire.filter((i) => i.kind === 'shape' && i.shape === 'arrow')).toHaveLength(3);
    expect(wire.some((i) => i.kind === 'noderef' && i.nodeId === 'svc:index')).toBe(true);
    expect(wire.some((i) => i.id === 'sb-issue-i-cache')).toBe(true);
    expect(wire.some((i) => i.id === 'sb-edge-pin-e-gw-fan' && i.text === 'P1')).toBe(true);
  });

  it('materialize is deterministic', () => {
    const a = materializeSystemBoard(tasmapFixture());
    const b = materializeSystemBoard(tasmapFixture());
    expect(a).toEqual(b);
  });

  it('converts to WbItem-compatible marks', () => {
    const wire = materializeSystemBoard(tasmapFixture());
    const items = wire.map(boardWireToWbItem);
    expect(items.every((i) => typeof i.id === 'string')).toBe(true);
    const card = items.find((i) => i.kind === 'noderef' && i.nodeId === 'svc:index');
    expect(card).toMatchObject({
      kind: 'noderef',
      path: 'packages/index/main.ts',
      lines: { from: 1, to: 40 },
    });
  });
});
