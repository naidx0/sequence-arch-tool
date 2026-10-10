import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { BoardEdge } from './Board';
import { BoardControls } from './BoardControls';
import { CARD_MAX_W, CARD_MIN_W, CARD_W, CHIP_INSET, FAR_FIT_ZOOM, cardHeight, cardWidth, type CardBox } from './cardBox';
import { mergeSamePair, proofFromScan, sourceReadPairs } from './edgeLines';
import { farLabelsToYield } from './farLabels';
import { GroupFrame } from './GroupFrame';
import {
  elkGraphFor,
  fitZoomFor,
  pickLayout,
  placeOrphanRow,
  routeCrossings,
  routesFrom,
  splitOrphans,
  type ElkPoint,
} from './layout';
import { EMPTY_GROUP_H, nestedBoxes } from './nestedBoxes';
import type { BoardNode } from './NodeCard';
import { fitRouteToBoxes, onBorder, routeEdges } from './routes';
import type { ArchGraph } from '@sequence/schema';

/* STREAM 3b, SLICE A — the board gaps and the owner's review of the stream 3
   screenshots. Each describe locks one fix; each would fail on the code before
   it (85bb6171). */

const node = (id: string, label = id, extra: Partial<BoardNode> = {}): BoardNode => ({
  id,
  label,
  subtitle: null,
  present: { kind: 'service', entry: false },
  schemaKind: 'service',
  provenance: null,
  count: null,
  ...extra,
});
const box = (id: string, x: number, y: number, w = 160, h = 45): CardBox => ({ id, x, y, w, h });
const edge = (source: string, target: string, extra: Partial<BoardEdge> = {}): BoardEdge => ({
  id: `${source}->${target}:${extra.label ?? extra.proof ?? 'e'}`,
  source,
  target,
  proof: 'traced',
  ...extra,
});

/* A measurer with a known face: 8 units a character. */
const mono = (text: string) => text.length * 8;

describe('a card is as wide as its name (owner: "Postgres data..." cut off)', () => {
  it('keeps the floor for a short name, and the fixed width where nothing can be measured', () => {
    /* Decision 49: a measured card is never narrower than CARD_MIN_W, the
       picked mix's card with room for a definition. */
    expect(cardWidth('api', mono)).toBe(CARD_MIN_W);
    expect(cardWidth('a very long service name indeed', () => Number.NaN)).toBe(CARD_W);
  });

  it('grows for its name beside the icon chip, on the 8px grain (Decision 49)', () => {
    /* The card holds the chip and its gap (CHIP_INSET, 40), the pads (22),
       the dot slack (8) and the name on one line at 100%.
       "Notifications": 13 chars = 104 units; 104 + 70 = 174 -> 176.
       "Shipping": 8 chars = 64 units; 64 + 70 = 134 -> the 168 floor.
       A longer name stops at CARD_MAX_W (184) and takes its second line. */
    expect(CHIP_INSET).toBe(40);
    expect(CARD_MIN_W).toBe(168);
    expect(cardWidth('Shipping', mono)).toBe(168);
    const w = cardWidth('Notifications', mono);
    expect(w).toBe(176);
    expect(w - 22 - CHIP_INSET).toBeGreaterThanOrEqual(104);
    expect(cardWidth('Notifications service', mono)).toBe(CARD_MAX_W);
    expect(CARD_MAX_W).toBe(184);
    /* The far scale is still capped where the name must still fit. */
    expect(FAR_FIT_ZOOM).toBe(0.45);
  });

  it('stops at CARD_MAX_W, past which the title wraps (the last resort)', () => {
    expect(cardWidth('Redis (cache and message queue) for every service', mono)).toBe(CARD_MAX_W);
  });

  it('the height wraps the title at the card own width, not the fixed one', () => {
    /* 25 chars = 200 units: two lines at 138 wide, one at 218 (a 240 card). */
    const label = 'abcdefghij abcdefghij abc';
    expect(cardWidth(label, mono)).toBe(CARD_MAX_W);
    const h = cardHeight(node('n', label), 1, false, null, mono);
    const fixed = cardHeight(node('n', 'abcdefghij'), 1, false, null, mono);
    expect(h).toBe(fixed);
  });
});

describe('a far title never paints past its card', () => {
  it('collides only within the card width (maxW), so wide labels stop yielding to far neighbours', () => {
    const long = 'x'.repeat(40);
    const a = { id: 'a', cx: 0, cy: 0, text: long, degree: 1, selected: false };
    const b = { id: 'b', cx: 260, cy: 0, text: long, degree: 0, selected: false };
    expect(farLabelsToYield([a, b], 0.5).has('b')).toBe(true);
    expect(farLabelsToYield([{ ...a, maxW: 138 }, { ...b, maxW: 138 }], 0.5).size).toBe(0);
  });
});

describe('the board toolbar is a strip above the pane, so no card can sit under it', () => {
  const css = readFileSync(resolve(__dirname, 'board.css'), 'utf8').replace(/\r\n/g, '\n');
  const tokens = readFileSync(resolve(__dirname, '../tokens/graphite.css'), 'utf8');
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  };

  it('the pills float over the top-left, and the fit is banded under them (Decision 49)', () => {
    /* B's view pills sit on the dotted ground rather than in a strip; the
       board's fit reads their bottom edge as its top band (Board.tsx
       chromeBands), so no card is laid under them. */
    expect(css).not.toMatch(/\.board-scope\.board-stack:has\(> \.board-controls\)/);
    const bar = rule('.board-scope .board-controls');
    expect(bar).toMatch(/position:\s*absolute;/);
    expect(bar).toMatch(/top:\s*var\(--sp-12\);/);
    expect(bar).toMatch(/left:\s*var\(--sp-12\);/);
    /* The top-right corner is the shell's pane head's. */
    expect(bar).toMatch(/right:\s*\d+px;/);
    expect(bar).not.toMatch(/flex-direction:\s*column/);
    const board = readFileSync(resolve(__dirname, 'Board.tsx'), 'utf8');
    expect(board).toMatch(/querySelector\(':scope > \.board-controls'\)/);
    /* A view's content starts below the pills too. */
    const views = readFileSync(resolve(__dirname, 'views/views.css'), 'utf8');
    expect(views).toMatch(/\.board-view \{[^}]*padding-top:\s*calc\(var\(--sp-12\) \* 2 \+ 30px/);
  });

  it('marks a changed box on the Map with the Diff glyphs in their tokens: + added, ~ changed, − removed', () => {
    const glyph = (status: string) => rule(`.board-scope .nd-change.is-${status}::before`);
    expect(glyph('added')).toMatch(/content: '\+'; color: var\(--fits\)/);
    expect(glyph('changed')).toMatch(/content: '~'; color: var\(--spills\)/);
    expect(glyph('removed')).toMatch(/content: '\\2212'; color: var\(--wont\)/);
  });

  it('holds the view dropdown, Find and the +N groups chip in one row, More last', () => {
    render(
      <BoardControls
        {...({} as never)}
        query=""
        onQuery={() => {}}
        matches={null}
        onFitMatches={() => {}}
        viewMenu={<span data-testid="vs">views</span>}
        extra={<button data-testid="board-more-groups">+8 groups</button>}
      />,
    );
    const row = screen.getByTestId('board-controls');
    const order = [...row.children].map((c) => c.getAttribute('data-testid') ?? c.className);
    expect(order).toEqual(['vs', 'bfind', 'board-more-groups', 'bc-morewrap']);
    expect(row.lastElementChild!.querySelector('[data-testid="board-controls-toggle"]')).not.toBeNull();
  });
});

describe('one line per pair, proof from the scan (owner: dashed everywhere, thick bundles)', () => {
  it('merges every edge between the same source and target into one line, strongest proof, counted', () => {
    const merged = mergeSamePair([
      edge('a', 'b', { proof: 'declared', label: '2 http' }),
      edge('a', 'b', { proof: 'derived', label: '14 imports', imports: true }),
      edge('b', 'a', { proof: 'declared' }),
    ]);
    expect(merged).toHaveLength(2);
    const ab = merged.find((e) => e.source === 'a')!;
    expect(ab.proof).toBe('declared');
    expect(ab.merged).toBe(2);
    expect(ab.title).toBe('2 http, 14 imports');
    expect(ab.imports).toBeUndefined();
    expect(merged.find((e) => e.source === 'b')!.title).toBe('call');
  });

  it('a declared edge the scan read in source code is traced (drawn solid)', () => {
    const graph = {
      nodes: [
        { id: 'svc:a', kind: 'service' },
        { id: 'svc:b', kind: 'service' },
        { id: 'f:a', kind: 'file', parentId: 'svc:a' },
      ],
      edges: [
        { id: 'x', srcId: 'f:a', dstId: 'svc:b', kind: 'http', instrument: 'source', evidence: [] },
        { id: 'y', srcId: 'svc:b', dstId: 'svc:a', kind: 'http', instrument: 'config', evidence: [] },
      ],
    } as unknown as ArchGraph;
    const read = sourceReadPairs(graph, ['svc:a', 'svc:b']);
    expect([...read]).toEqual(['svc:a->svc:b']);
    const out = proofFromScan([edge('svc:a', 'svc:b', { proof: 'declared' }), edge('svc:b', 'svc:a', { proof: 'declared' })], read);
    expect(out.map((e) => e.proof)).toEqual(['traced', 'declared']);
  });
});

describe('ELK routes the lines, with room between parallel ones', () => {
  const boxes = [box('a', 0, 0), box('b', 0, 200), box('c', 300, 0)];
  const edges = [edge('a', 'b'), edge('a', 'c')];

  it('asks ELK for edge-edge and edge-node spacing, routing left orthogonal (A5)', () => {
    const g = elkGraphFor(boxes, edges, { width: 900, height: 600 });
    /* Tightened at Decision 49, with the lines still separate and routed
       clear of boxes: board-legibility counts 0 label and box overlaps. */
    expect(g.layoutOptions['elk.spacing.edgeEdge']).toBe('6');
    expect(g.layoutOptions['elk.spacing.edgeNode']).toBe('10');
    expect(g.layoutOptions['elk.edgeRouting']).toBeUndefined();
  });

  it('reads ELK routes back in absolute coordinates, adding each container offset', () => {
    const routes = routesFrom({
      children: [
        {
          id: 'G',
          x: 12,
          y: 12,
          children: [{ id: 'a' }, { id: 'b' }],
          edges: [{ id: 'ab', sources: ['a'], targets: ['b'], sections: [{ startPoint: { x: 66, y: 55 }, endPoint: { x: 86, y: 55 } }] }],
        },
      ],
      edges: [
        { id: 'Gc', sources: ['G'], targets: ['c'], sections: [{ startPoint: { x: 164, y: 55 }, bendPoints: [{ x: 170, y: 55 }], endPoint: { x: 184, y: 55 } }] },
        { id: 'lifted@G', sources: ['a'], targets: ['c'], sections: [{ startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } }] },
      ],
    });
    expect(routes.ab).toEqual([{ x: 78, y: 67 }, { x: 98, y: 67 }]);
    expect(routes.Gc).toHaveLength(3);
    expect(routes['lifted@G']).toBeUndefined();
  });

  it('the board draws ELK route while it still meets both cards, and routes afresh after a drag', () => {
    const a = box('a', 0, 0);
    const b = box('b', 300, 0);
    const elk = { e: [{ x: 160, y: 20 }, { x: 230, y: 20 }, { x: 230, y: 30 }, { x: 300, y: 30 }] };
    const drawn = routeEdges([{ id: 'e', source: 'a', target: 'b', proof: 'traced' }], [a, b], true, elk);
    expect(drawn[0]!.data.d).toBe('M160 20 L230 20 L230 30 L300 30');
    expect(drawn[0]!.data.pair).toBe('a->b');
    const dragged = routeEdges([{ id: 'e', source: 'a', target: 'b', proof: 'traced' }], [a, box('b', 300, 400)], true, elk);
    expect(dragged[0]!.data.d).not.toBe('M160 20 L230 20 L230 30 L300 30');
  });

  it('pulls a route end back onto a card a far rung drew shorter, keeping it orthogonal', () => {
    const src = box('s', 0, 0, 160, 45);
    const dst = box('t', 300, 0, 160, 45);
    /* ELK laid the target out 68 tall; the end sits at y=60 on its left side. */
    const fitted = fitRouteToBoxes([{ x: 160, y: 20 }, { x: 230, y: 20 }, { x: 230, y: 60 }, { x: 300, y: 60 }], src, dst)!;
    expect(fitted[3]).toEqual({ x: 300, y: 22.5 });
    expect(fitted[2]).toEqual({ x: 230, y: 22.5 });
    expect(onBorder(fitted[3]!, dst)).toBe(true);
    /* A straight two-point line cannot be bent; it is routed afresh. */
    expect(fitRouteToBoxes([{ x: 160, y: 60 }, { x: 300, y: 60 }], src, dst)).toBeNull();
  });
});

describe('the board picks the direction that fits the pane larger', () => {
  const routes: Record<string, ElkPoint[]> = {};
  it('takes the larger fit, and fewer crossings when the two are within 5%', () => {
    const crossing = { x: [{ x: 0, y: 5 }, { x: 10, y: 5 }], y: [{ x: 5, y: 0 }, { x: 5, y: 10 }] };
    expect(routeCrossings(crossing)).toBe(1);
    expect(pickLayout({ direction: 'LR', zoom: 0.5, routes }, { direction: 'TD', zoom: 0.7, routes }).direction).toBe('TD');
    expect(pickLayout({ direction: 'LR', zoom: 0.7, routes: crossing }, { direction: 'TD', zoom: 0.69, routes }).direction).toBe('TD');
    expect(pickLayout({ direction: 'LR', zoom: 0.7, routes }, { direction: 'TD', zoom: 0.69, routes }).direction).toBe('LR');
  });

  it('measures the fit on the top-level boxes inside the inset frame', () => {
    const z = fitZoomFor([box('a', 0, 0, 100, 50), box('m', 0, 0, 10, 10)], { a: { x: 0, y: 0 }, m: { x: 5, y: 5 } }, {}, { m: 'a' }, { width: 248, height: 148 });
    expect(z).toBe(2);
  });
});

describe('a card no line touches goes in a "Not connected" row (owner: Redis floating)', () => {
  it('splits orphans only when something is connected, never a group or its member', () => {
    const boxes = [box('a', 0, 0), box('b', 0, 0), box('lone', 0, 0), box('g', 0, 0), box('m', 0, 0)];
    const split = splitOrphans(boxes, [edge('a', 'b')], { m: 'g' });
    expect(split.orphans.map((b) => b.id)).toEqual(['lone']);
    expect(splitOrphans(boxes, [], { m: 'g' }).orphans).toEqual([]);
  });

  it('places them in a row under the connected board, labelled, wrapping at its width', () => {
    const connected = [box('a', 0, 0), box('b', 0, 0)];
    const orphans = [box('x', 0, 0), box('y', 0, 0), box('z', 0, 0), box('w', 0, 0)];
    const row = placeOrphanRow(connected, orphans, { a: { x: 10, y: 0 }, b: { x: 200, y: 100 } }, {}, {});
    expect(row.label).toEqual({ x: 10, y: 145 + 40, count: 4, ids: ['x', 'y', 'z', 'w'] });
    const ys = new Set(orphans.map((o) => row.positions[o.id]!.y));
    expect(Math.min(...ys)).toBe(145 + 40 + 24);
    expect(row.positions.x!.x).toBe(10);
    expect(ys.size).toBe(2);
  });
});

describe('an expanded group with nothing drawable reads as a row (all-expanded stress view)', () => {
  it('says how many are not drawn and offers Focus, in the frame body', () => {
    render(
      <GroupFrame
        node={node('svc:mcp', 'mcp', { group: { shown: 0, total: 23 } })}
        selected={false}
        dimmed={false}
        onSelect={() => {}}
        onFocus={() => {}}
      />,
    );
    expect(screen.getByTestId('board-group-empty').textContent).toContain('23 not drawn');
    expect(screen.getByTestId('board-group-empty-focus')).not.toBeNull();
  });

  it('keeps room for that row in the frame box', () => {
    const [frame] = nestedBoxes([node('g', 'g', { group: { shown: 0, total: 5 } })], { g: { x: 0, y: 0 } }, {}, (_id, p) => p, 1, false, null);
    /* Never shorter than the row; a card's own floor may be taller. */
    expect(frame!.h).toBeGreaterThanOrEqual(EMPTY_GROUP_H);
  });
});

/* B's MENU BEHAVIOUR on the board's More panel (UX audit, 2026-10-06: it did
   not close on Esc or on an outside click, 4 of 4 runs). */
describe('the More panel closes like a menu', () => {
  function controls() {
    return render(
      <div>
        <button data-testid="outside">elsewhere</button>
        <BoardControls {...({} as never)} query="" onQuery={() => {}} matches={null} onFitMatches={() => {}} />
      </div>,
    );
  }

  it('closes on Escape and gives focus back to More', async () => {
    controls();
    const more = screen.getByTestId('board-controls-toggle');
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(more);
  });

  it('closes on a press outside the toolbar, and not on a press inside it', () => {
    controls();
    const more = screen.getByTestId('board-controls-toggle');
    fireEvent.click(more);
    fireEvent.pointerDown(screen.getByTestId('board-search'));
    expect(more.getAttribute('aria-expanded')).toBe('true');
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(more.getAttribute('aria-expanded')).toBe('false');
  });
});
