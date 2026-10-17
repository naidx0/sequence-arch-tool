import { describe, expect, it } from 'vitest';

import {
  BLOCK_MAX,
  architectureReference,
  buildReference,
  referenceChip,
  referenceSummary,
  whiteboardReference,
  type WbRefItem,
} from './askReference';

/* The agentic loop the owner drew to plan with: Model, Tool call, loop. */
const LOOP: WbRefItem[] = [
  { id: 'r1', kind: 'shape', shape: 'rect', label: 'Model' },
  { id: 'r2', kind: 'shape', shape: 'rect', label: 'Tool call' },
  { id: 'a1', kind: 'shape', shape: 'arrow', fromId: 'r1', toId: 'r2' },
  { id: 'a2', kind: 'shape', shape: 'arrow', fromId: 'r2', toId: 'r1', label: 'loop' },
  { id: 't1', kind: 'text', text: 'loop', sticky: true },
  { id: 'n1', kind: 'noderef', label: 'ask pipeline', nodeId: 'svc:ask', path: 'src/ask.ts' },
  { id: 's1', kind: 'stroke' },
];
const labelOf = (i: WbRefItem) => i.label ?? i.text ?? '';

describe('the chip says what was pointed at', () => {
  it('names one thing by its label', () => {
    expect(referenceSummary(['Model'])).toBe('Model');
  });
  it('counts several and names the first three', () => {
    expect(referenceSummary(['Model', 'Tool call', 'loop'])).toBe('3 items: Model, Tool call, loop');
  });
  it('says how many more when there are more than three', () => {
    expect(referenceSummary(['a', 'b', 'c', 'd', 'e'])).toBe('5 items: a, b, c, +2 more');
  });
  it('is empty for nothing', () => {
    expect(referenceSummary([])).toBe('');
  });
});

describe('a whiteboard selection, as the agent receives it', () => {
  it('carries each id, kind, label and its connections', () => {
    const ref = whiteboardReference(LOOP, ['r1', 'r2', 'a2'], labelOf)!;
    expect(ref.surface).toBe('whiteboard');
    expect(ref.summary).toBe('3 items: Model, Tool call, loop');
    // the connections of a box are the arrows bound to it, named with their labels
    const r1 = ref.targets.find((t) => t.id === 'r1')!;
    expect(r1.links).toEqual(['to r2 (Tool call)', 'from r2 (Tool call)']);
    expect(ref.block).toContain('r1 | rect | "Model" | to r2 (Tool call); from r2 (Tool call)');
    const r2 = ref.targets.find((t) => t.id === 'r2')!;
    expect(r2.links).toEqual(['from r1 (Model)', 'to r1 (Model)']);
  });

  it('names an arrow by what it joins', () => {
    const ref = whiteboardReference(LOOP, ['a1'], labelOf)!;
    expect(ref.targets[0]).toMatchObject({ id: 'a1', kind: 'arrow', links: ['from r1 (Model)', 'to r2 (Tool call)'] });
    expect(ref.block).toContain('a1 | arrow | (no label) | from r1 (Model); to r2 (Tool call)');
  });

  it('keeps a code card file path and tells a sticky from a note', () => {
    const ref = whiteboardReference(LOOP, ['n1', 't1', 's1'], labelOf)!;
    expect(ref.targets.map((t) => [t.id, t.kind])).toEqual([
      ['n1', 'node-ref'],
      ['t1', 'sticky'],
      ['s1', 'stroke'],
    ]);
    expect(ref.targets[0]!.paths).toEqual(['src/ask.ts']);
  });

  it('is null when no selected id is on the board', () => {
    expect(whiteboardReference(LOOP, ['gone'], labelOf)).toBeNull();
    expect(whiteboardReference(LOOP, [], labelOf)).toBeNull();
  });

  it('opens with a header the prompt can anchor on and closes the block', () => {
    const ref = whiteboardReference(LOOP, ['r1'], labelOf)!;
    const lines = ref.block.split('\n');
    expect(lines[0]).toMatch(/^\[whiteboard selection: 1 item /);
    expect(lines[lines.length - 1]).toBe('[/selection]');
  });
});

describe('an architecture selection, as the agent receives it', () => {
  const NODES = [
    { id: 'svc:gateway', label: 'gateway', kind: 'service', paths: ['src/gateway.ts'] },
    { id: 'svc:checkout', label: 'checkout', kind: 'service', paths: ['src/checkout.ts', 'src/cart.ts'] },
    { id: 'db:orders', label: 'orders', kind: 'datastore' },
  ];
  const EDGES = [{ id: 'e1', source: 'svc:gateway', target: 'svc:checkout', label: 'calls' }];

  it('carries node ids, names, kinds and file paths', () => {
    const ref = architectureReference(NODES, EDGES, ['svc:gateway', 'svc:checkout'], [])!;
    expect(ref.surface).toBe('architecture');
    expect(ref.summary).toBe('2 items: gateway, checkout');
    expect(ref.block).toContain('svc:gateway | service | "gateway" | src/gateway.ts');
    expect(ref.block).toContain('svc:checkout | service | "checkout" | src/checkout.ts, src/cart.ts');
  });

  it('carries an edge by its endpoints', () => {
    const ref = architectureReference(NODES, EDGES, [], ['e1'])!;
    expect(ref.targets[0]).toMatchObject({ id: 'e1', kind: 'edge', label: 'gateway to checkout' });
    expect(ref.block).toContain('e1 | edge | "gateway to checkout" | from svc:gateway; to svc:checkout; labelled calls');
  });

  it('a mixed selection lists nodes then edges', () => {
    const ref = architectureReference(NODES, EDGES, ['db:orders'], ['e1'])!;
    expect(ref.targets.map((t) => t.id)).toEqual(['db:orders', 'e1']);
  });

  it('is null for ids the board does not have', () => {
    expect(architectureReference(NODES, EDGES, ['nope'], ['nope'])).toBeNull();
  });
});

describe('the block is bounded and says so', () => {
  it('lists at most BLOCK_MAX targets and counts the rest', () => {
    const many = Array.from({ length: BLOCK_MAX + 5 }, (_, i) => ({ id: `x${i}`, kind: 'rect', label: `n${i}` }));
    const ref = buildReference('whiteboard', many)!;
    expect(ref.block.split('\n').filter((l) => l.startsWith('- x')).length).toBe(BLOCK_MAX);
    expect(ref.block).toContain('(+5 more not listed)');
  });
});

describe('the composer chip', () => {
  it('is a board-ref whose label is the summary and whose detail is the block', () => {
    const ref = whiteboardReference(LOOP, ['r1', 'r2'], labelOf)!;
    const chip = referenceChip(ref);
    expect(chip).toMatchObject({ kind: 'board-ref', ref: 'board-ref:whiteboard:r1,r2', label: '2 items: Model, Tool call', nodeKind: null });
    expect(chip.detail).toBe(ref.block);
    expect(chip.id).toBe('board-ref:whiteboard:r1,r2');
  });
});
