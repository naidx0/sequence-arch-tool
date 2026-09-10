import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it } from 'vitest';

import { elkGraphFor, frameAspect, positionsFrom, circularLayoutPositions, elkDirectionFor } from './layout';
import { cardBox } from './cardBox';
import { VISUAL_STRIP_H } from './visualMeta';
import { projectDocument } from './project';
import { presentationFor } from './kinds';
import type { BoardNode } from './NodeCard';
import type { SeqDiagramV1 } from '@sequence/schema';

/**
 * ITEM canvas-fixes 2 — THE LAYOUT IS ELK'S, AND IT IS SHAPED BY THE FRAME.
 *
 * WHAT THIS FILE EXISTS BECAUSE OF. `project.ts` carried its own layout and its
 * own confession — "THE LAYOUT IS A STAND-IN" — and the elkjs worker lifted in
 * item 3.2 was imported by nothing. On THIS repository the two facts compose
 * into a visible defect: the board draws no edges (every scanned edge is an
 * `import`, and `packages/export/src/project.ts:124` skips those), so the
 * stand-in's depth walk gives every node depth 0 and all ten stack into one
 * 160px column against a ~640px canvas.
 *
 * WHY elkjs IS RUN FOR REAL HERE RATHER THAN MOCKED. The claim being locked is
 * not "we passed elk.aspectRatio" — that is the expression. The claim is "the
 * board is not a column", and only the layout engine can answer it. A mock that
 * returns positions is a test of the mock. elkjs is pure arithmetic with no DOM
 * in it, so it runs in this environment the same way it runs in the worker; the
 * worker exists for the frame budget, not for correctness.
 *
 * THE STAND-IN IS ASSERTED ALONGSIDE, not deleted from the test. It is still
 * the seed the board paints before ELK answers and the fallback where there is
 * no Worker, so "the stand-in gives one column on an edgeless graph" is a fact
 * about the product that has to stay true and stay known — the fix is that it
 * is no longer the final word.
 */

/** Ten nodes, no edges — the shape this repository actually produces. */
function edgelessDoc(count: number): SeqDiagramV1 {
  return {
    version: 1,
    id: 'test',
    title: 'edgeless',
    origin: 'scan',
    nodes: Array.from({ length: count }, (_, i) => ({
      id: `svc:${i}`,
      label: `service-${i}`,
      kind: 'service' as const,
      role: 'participant' as const,
    })),
    edges: [],
    grounded: { scopeNodeIds: [] },
  } as unknown as SeqDiagramV1;
}

function boardNode(id: string, label: string): BoardNode {
  return {
    id,
    label,
    subtitle: null,
    present: presentationFor({ id, label, kind: 'service' } as never),
    schemaKind: 'service',
    provenance: null,
    count: null,
  };
}

const COUNT = 10;

describe('item canvas-fixes 2 — the ELK layout', () => {
  const doc = edgelessDoc(COUNT);
  const projection = projectDocument(doc);
  const boxes = projection.nodes.map((node) =>
    cardBox(node, projection.positions[node.id]!, 1),
  );

  it('the stand-in gives ONE column on an edgeless graph — the defect, stated', () => {
    // Not a regression guard on the stand-in; the record of why ELK is wired.
    // With no edge there is no depth to walk, so depth() returns 0 for every
    // node and every card lands on x = 0.
    const columns = new Set(Object.values(projection.positions).map((p) => p.x));
    expect(columns.size).toBe(1);
    expect(projection.edges).toHaveLength(0);
  });

  it('packs an edgeless graph into more than one column, at a landscape frame', async () => {
    // The three-pane shell at 1280 x 800 gives the canvas roughly this.
    const frame = { width: 640, height: 756 };
    const laid = await new ELK().layout(elkGraphFor(boxes, projection.edges, frame));
    const positions = positionsFrom(laid as never);

    expect(Object.keys(positions)).toHaveLength(COUNT);
    const columns = new Set(Object.values(positions).map((p) => Math.round(p.x)));
    expect(columns.size, `ELK put all ${COUNT} cards in one column`).toBeGreaterThan(1);
  });

  it('is shaped by the FRAME — a wider pane gets more columns, §08.1', async () => {
    /*
     * The invariant, not the option. "The budget is the frame, not a node
     * count" is a claim that the shape of the answer follows the shape of the
     * space, so the test changes the space and reads the answer — it does not
     * assert that a string called elk.aspectRatio was set.
     */
    const elk = new ELK();
    const columnsAt = async (width: number, height: number) => {
      const laid = await elk.layout(elkGraphFor(boxes, projection.edges, { width, height }));
      return new Set(Object.values(positionsFrom(laid as never)).map((p) => Math.round(p.x))).size;
    };

    const narrow = await columnsAt(400, 900);
    const wide = await columnsAt(1600, 700);
    expect(wide, `narrow gave ${narrow} columns, wide gave ${wide}`).toBeGreaterThan(narrow);
  });

  it('keeps a layered graph left to right, so wiring ELK did not change the reading', async () => {
    // `project.ts`'s stand-in was written to be "the same picture at lower
    // fidelity" as elk.direction RIGHT. A chain must still run left to right.
    const chain = {
      ...edgelessDoc(3),
      edges: [
        { id: 'e1', from: 'svc:0', to: 'svc:1', family: 'http' },
        { id: 'e2', from: 'svc:1', to: 'svc:2', family: 'http' },
      ],
    } as unknown as SeqDiagramV1;
    const chained = projectDocument(chain);
    const chainBoxes = chained.nodes.map((n) => cardBox(n, chained.positions[n.id]!, 1));
    const laid = await new ELK().layout(
      elkGraphFor(chainBoxes, chained.edges, { width: 900, height: 600 }, { direction: 'LR' }),
    );
    const positions = positionsFrom(laid as never);
    expect(positions['svc:0']!.x).toBeLessThan(positions['svc:1']!.x);
    expect(positions['svc:1']!.x).toBeLessThan(positions['svc:2']!.x);
  });

  it('layers a chain top-down when direction is TD', async () => {
    const chain = {
      ...edgelessDoc(3),
      edges: [
        { id: 'e1', from: 'svc:0', to: 'svc:1', family: 'http' },
        { id: 'e2', from: 'svc:1', to: 'svc:2', family: 'http' },
      ],
      layout: { engine: 'layered-flow', direction: 'TD' },
    } as unknown as SeqDiagramV1;
    const chained = projectDocument(chain);
    const chainBoxes = chained.nodes.map((n) => cardBox(n, chained.positions[n.id]!, 1));
    expect(elkDirectionFor('TD')).toBe('DOWN');
    const laid = await new ELK().layout(
      elkGraphFor(chainBoxes, chained.edges, { width: 900, height: 600 }, { direction: 'TD' }),
    );
    const positions = positionsFrom(laid as never);
    expect(positions['svc:0']!.y).toBeLessThan(positions['svc:1']!.y);
    expect(positions['svc:1']!.y).toBeLessThan(positions['svc:2']!.y);
  });

  it('places agent-loop nodes on a circle', () => {
    const loop = {
      ...edgelessDoc(4),
      kind: 'agent-workflow',
      edges: [
        { id: 'e1', from: 'svc:0', to: 'svc:1', family: 'control' },
        { id: 'e2', from: 'svc:1', to: 'svc:2', family: 'control' },
        { id: 'e3', from: 'svc:2', to: 'svc:3', family: 'control' },
        { id: 'e4', from: 'svc:3', to: 'svc:0', family: 'control' },
      ],
      layout: { engine: 'circular-loop', direction: 'LR' },
    } as unknown as SeqDiagramV1;
    const projected = projectDocument(loop);
    const boxes = projected.nodes.map((n) => cardBox(n, projected.positions[n.id]!, 1));
    const positions = circularLayoutPositions(boxes, projected.edges, { width: 640, height: 756 });
    const xs = Object.values(positions).map((p) => p.x);
    const ys = Object.values(positions).map((p) => p.y);
    expect(new Set(xs).size).toBeGreaterThan(2);
    expect(new Set(ys).size).toBeGreaterThan(2);
  });
});

describe('item canvas-fixes 2 — what the layout refuses to invent', () => {
  it('drops an edge whose endpoints are not both on the board', () => {
    // ELK creates a node for any id an edge names. An edge to a node the board
    // is not drawing would therefore add a card the analyzer never found — the
    // one thing the board may never do.
    const boxes = [cardBox(boardNode('a', 'a'), { x: 0, y: 0 }, 1)];
    const graph = elkGraphFor(
      boxes,
      [
        { id: 'e1', source: 'a', target: 'ghost', proof: 'traced' },
        { id: 'e2', source: 'a', target: 'a', proof: 'traced' },
      ],
      { width: 800, height: 600 },
    );
    expect(graph.edges.map((e) => e.id)).toEqual(['e2']);
    expect(graph.children.map((c) => c.id)).toEqual(['a']);
  });

  it('leaves an unplaced child OUT rather than defaulting it to the origin', () => {
    // A silent 0,0 is how every node the engine could not place ends up in one
    // pile in the corner, looking like a layout that ran.
    expect(
      positionsFrom({
        children: [
          { id: 'a', width: 1, height: 1, x: 5, y: 6 },
          { id: 'b', width: 1, height: 1 },
          { id: 'c', width: 1, height: 1, x: Number.NaN, y: 0 },
        ],
      }),
    ).toEqual({ a: { x: 5, y: 6 } });
  });

  it('uses owner P2.6 spacing so edgeless graphs do not clump on attach', () => {
    const doc = edgelessDoc(COUNT);
    const proj = projectDocument(doc);
    const boxes = proj.nodes.map((node) => cardBox(node, proj.positions[node.id]!, 1));
    const edgeless = elkGraphFor(boxes, [], { width: 640, height: 756 });
    expect(edgeless.layoutOptions?.['elk.spacing.nodeNode']).toBe('48');

    const chained = projectDocument({
      ...edgelessDoc(3),
      edges: [{ id: 'e1', from: 'svc:0', to: 'svc:1', family: 'http' }],
    } as unknown as SeqDiagramV1);
    const chainBoxes = chained.nodes.map((n) => cardBox(n, chained.positions[n.id]!, 1));
    const layered = elkGraphFor(chainBoxes, chained.edges, { width: 900, height: 600 });
    expect(layered.layoutOptions?.['elk.spacing.nodeNode']).toBe('48');
    expect(layered.layoutOptions?.['elk.layered.spacing.nodeNodeBetweenLayers']).toBe('72');
  });

  it('quantises the aspect to quarter steps, so a resizer drag does not re-pack', () => {
    // A layout that re-packs on every pixel of a drag moves cards under the
    // reader's hand. The shape has to change, not the size.
    expect(frameAspect(640, 756)).toBe(frameAspect(641, 756));
    expect(frameAspect(1600, 800)).toBe(2);
    expect(frameAspect(800, 800)).toBe(1);
    // Never zero, never Infinity, never NaN — those reach ELK as a layout that
    // silently produces nothing.
    expect(frameAspect(0, 0)).toBe(1);
    expect(frameAspect(10, 0)).toBe(1);
    expect(frameAspect(1, 10000)).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   MADR A4 — THE VISUAL LAYOUT PROFILE, RUN RATHER THAN READ
   docs/decisions/visual-board-mode-madr.md §0, amendment A4. Max, 2026-09-02:
   "it's important that it doesn't randomly generate this every time. It has to
   be actually consistent with our design format."

   WHAT THIS EXISTS BECAUSE OF. The wave that added the profile locked A4 with a
   `<Board>` render over `projectDocument`'s SEED positions — so `elkGraphFor`
   with `visual: true` was never called by any test in the package, and deleting
   `considerModelOrder`, flipping it to PREFER_EDGES, or replacing VISUAL_PITCH
   with a per-call random number left all 25 tests in the wave green. The claim
   A4 rests on was untested for the half of the pipeline the wave changed.

   IT RUNS ELK FOR REAL, for the reason the top of this file already gives: "the
   claim being locked is not 'we passed elk.aspectRatio' — that is the
   expression." A4's claim is that the same spec draws the same picture and that
   the tie-break is the spec's own order, and only the solver can answer either.
   ══════════════════════════════════════════════════════════════════════════ */

/** Two components with nothing connecting them — the shape A4's tie-break rule
 *  is about. `first` is authored first, so it must be drawn first. */
function twoComponents(first: string, second: string): SeqDiagramV1 {
  return {
    version: 1,
    id: 'test',
    title: 'components',
    origin: 'scan',
    nodes: [`${first}:0`, `${first}:1`, `${second}:0`, `${second}:1`].map((id) => ({
      id,
      label: id,
      kind: 'service' as const,
      role: 'participant' as const,
    })),
    edges: [
      { id: `${first}-e`, from: `${first}:0`, to: `${first}:1`, family: 'http' },
      { id: `${second}-e`, from: `${second}:0`, to: `${second}:1`, family: 'http' },
    ],
    grounded: { scopeNodeIds: [] },
  } as unknown as SeqDiagramV1;
}

async function layVisual(doc: SeqDiagramV1) {
  const projected = projectDocument(doc);
  const boxes = projected.nodes.map((n) => cardBox(n, projected.positions[n.id]!, 1, true));
  const laid = await new ELK().layout(
    elkGraphFor(boxes, projected.edges, { width: 900, height: 700 }, {
      direction: 'LR',
      visual: true,
    }),
  );
  return positionsFrom(laid as never);
}

describe('MADR A4 — the Visual layout profile', () => {
  const doc = edgelessDoc(COUNT);
  const projection = projectDocument(doc);
  const chained = projectDocument({
    ...edgelessDoc(3),
    edges: [{ id: 'e1', from: 'svc:0', to: 'svc:1', family: 'http' }],
  } as unknown as SeqDiagramV1);
  const chainBoxes = chained.nodes.map((n) => cardBox(n, chained.positions[n.id]!, 1, true));

  it('grows both gaps by exactly the row the CARD grew by', () => {
    /* Graphite law 4 — never invent a number. The Visual gaps are the plain
       gaps plus `VISUAL_STRIP_H`, so a gap somebody liked the look of, or a
       strip height that moved without the gaps, is red here. */
    const layered = elkGraphFor(chainBoxes, chained.edges, { width: 900, height: 600 }, {
      direction: 'LR',
      visual: true,
    });
    const plain = elkGraphFor(chainBoxes, chained.edges, { width: 900, height: 600 }, {
      direction: 'LR',
    });

    expect(Number(layered.layoutOptions['elk.spacing.nodeNode'])).toBe(
      Number(plain.layoutOptions['elk.spacing.nodeNode']) + VISUAL_STRIP_H,
    );
    expect(Number(layered.layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'])).toBe(
      Number(plain.layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers']) + VISUAL_STRIP_H,
    );
    /* The edgeless branch takes the same pitch, or a board with no edges would
       be laid out at the plain spacing while its cards were the taller ones. */
    const boxes = projection.nodes.map((n) => cardBox(n, projection.positions[n.id]!, 1, true));
    expect(
      Number(
        elkGraphFor(boxes, [], { width: 640, height: 756 }, { visual: true }).layoutOptions[
          'elk.spacing.nodeNode'
        ],
      ),
    ).toBe(Number(elkGraphFor(boxes, [], { width: 640, height: 756 }).layoutOptions[
      'elk.spacing.nodeNode'
    ]) + VISUAL_STRIP_H);
  });

  it('breaks ties on the model order, and only in the Visual profile', () => {
    const visual = elkGraphFor(chainBoxes, chained.edges, { width: 900, height: 600 }, {
      direction: 'LR',
      visual: true,
    }).layoutOptions;
    expect(visual['elk.layered.considerModelOrder.strategy']).toBe('NODES_AND_EDGES');
    expect(visual['elk.layered.considerModelOrder.components']).toBe('MODEL_ORDER');

    /* MADR decision 9 scopes this to the PROFILE; changing how the plain board
       arranges itself was not that wave's to do. */
    const plain = elkGraphFor(chainBoxes, chained.edges, { width: 900, height: 600 }, {
      direction: 'LR',
    }).layoutOptions;
    expect(plain['elk.layered.considerModelOrder.strategy']).toBeUndefined();
    expect(plain['elk.layered.considerModelOrder.components']).toBeUndefined();

    /* ORTHOGONAL is untouched: A5 keeps the SPLINES rejection and the elbow law
       is a sheet rule that would need its own GRAPHITE-DECISIONS entry. */
    expect(visual['elk.edgeRouting']).toBeUndefined();
  });

  it('places the FIRST-AUTHORED component first, whichever way the spec is written', async () => {
    /* The half of the promise `considerModelOrder.strategy` does not keep on its
       own: `.strategy` orders nodes WITHIN a component, and
       `elk.separateConnectedComponents` is on, so without `.components` the
       packer chooses. Measured against this repo's elkjs 0.11.1 with the option
       removed: [a…, z…] placed the a-component at y=166 under the z-component
       at y=12, so a rescan that found one new unconnected package could move
       every island already on the board. */
    const ab = await layVisual(twoComponents('aaa', 'zzz'));
    expect(ab['aaa:0']!.y).toBeLessThan(ab['zzz:0']!.y);

    const ba = await layVisual(twoComponents('zzz', 'aaa'));
    expect(ba['zzz:0']!.y).toBeLessThan(ba['aaa:0']!.y);
  });

  it('lays the same spec out to the same coordinates, twice', async () => {
    /* A4 in its plainest form, one level below the pixels the wave's other lock
       covers: ELK itself, on the Visual profile, given the same document. */
    const doc2 = twoComponents('aaa', 'zzz');
    expect(await layVisual(doc2)).toEqual(await layVisual(doc2));
  });
});
