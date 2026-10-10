/* ROUND 7 — coordinator review of r7-board-1-drag (ML harness copy): edge
   tags overprinted each other and a connector, and the footer read
   "SERVI… ENT… TRACED 50". */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { BoardEdge } from './Board';
import type { CardBox } from './cardBox';
import { TAG_H, factCount, placeEdgeLabels, segmentHitsRect, tagWidth } from './edgeLabelPlace';
import { routeEdges } from './routes';
import { metaRowItems } from './visualMeta';
import { VisualMetaStrip } from './visual/VisualMetaStrip';
import type { BoardNode } from './NodeCard';

type Pt = { x: number; y: number };
const rect = (at: Pt, text: string) => {
  const w = tagWidth(text);
  return { x0: at.x - w / 2, y0: at.y - TAG_H / 2, x1: at.x + w / 2, y1: at.y + TAG_H / 2 };
};
const overlap = (a: ReturnType<typeof rect>, b: { x0: number; y0: number; x1: number; y1: number }) =>
  a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/** Every placed tag, checked against every other tag, every card and every
 *  other connector of the routed board. Returns the collisions found. */
function collisions(edges: ReturnType<typeof routeEdges>, boxes: readonly CardBox[]): string[] {
  const bad: string[] = [];
  const pathPts = (d: string): Pt[] => {
    const n = d.replace(/[ML]/g, ' ').trim().split(/[\s,]+/).map(Number);
    const out: Pt[] = [];
    for (let i = 0; i < n.length; i += 2) out.push({ x: n[i]!, y: n[i + 1]! });
    return out;
  };
  const tags = edges.filter((e) => e.data.label && e.data.labelAt).map((e) => ({ id: e.id, r: rect(e.data.labelAt!, e.data.label!) }));
  for (let i = 0; i < tags.length; i++) {
    for (let j = i + 1; j < tags.length; j++) if (overlap(tags[i]!.r, tags[j]!.r)) bad.push(`tag ${tags[i]!.id} x tag ${tags[j]!.id}`);
    for (const b of boxes) {
      if (b.container) continue;
      if (overlap(tags[i]!.r, { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h })) bad.push(`tag ${tags[i]!.id} x card ${b.id}`);
    }
    for (const e of edges) {
      if (e.id === tags[i]!.id) continue;
      const pts = pathPts(e.data.d);
      for (let k = 0; k < pts.length - 1; k++)
        if (segmentHitsRect(pts[k]!, pts[k + 1]!, tags[i]!.r)) {
          bad.push(`tag ${tags[i]!.id} x edge ${e.id}`);
          break;
        }
    }
  }
  return bad;
}

describe('edge tags never overprint (round 7)', () => {
  it('the reported shape: two routes sharing a corridor no longer stack their tags', () => {
    const a = { id: 'a', x: 0, y: 0, w: 160, h: 56 };
    const b = { id: 'b', x: 400, y: 300, w: 160, h: 56 };
    const r1 = [{ x: 160, y: 28 }, { x: 280, y: 28 }, { x: 280, y: 328 }, { x: 400, y: 328 }];
    const r2 = [{ x: 400, y: 320 }, { x: 290, y: 320 }, { x: 290, y: 20 }, { x: 160, y: 20 }];
    const labels = [
      { id: 'e1', points: r1, label: '/api/evidence?th… +17 more', full: 'x' },
      { id: 'e2', points: r2, label: '/… +2 more', full: 'p, q, r' },
    ];
    /* Each alone takes its longest segment's midpoint, and those two tags overlap. */
    const alone1 = placeEdgeLabels([labels[0]!], [], [a, b]).get('e1')!;
    const alone2 = placeEdgeLabels([labels[1]!], [], [a, b]).get('e2')!;
    expect(overlap(rect(alone1.at, alone1.text), rect(alone2.at, alone2.text))).toBe(true);
    /* Placed together, they do not overlap each other, a card, or the other line. */
    const both = placeEdgeLabels(labels, [{ id: 'e1', points: r1 }, { id: 'e2', points: r2 }], [a, b]);
    const p1 = both.get('e1')!;
    const p2 = both.get('e2')!;
    const r1Box = rect(p1.at, p1.text);
    const r2Box = rect(p2.at, p2.text);
    expect(overlap(r1Box, r2Box)).toBe(false);
    for (let k = 0; k < r2.length - 1; k++) expect(segmentHitsRect(r2[k]!, r2[k + 1]!, r1Box)).toBe(false);
    for (let k = 0; k < r1.length - 1; k++) expect(segmentHitsRect(r1[k]!, r1[k + 1]!, r2Box)).toBe(false);
  });

  it('a tag with no room becomes a "+N" chip carrying the whole label, and with no room at all it moves to the hover', () => {
    expect(factCount('/… +2 more', 'a, b, c')).toBe(3);
    expect(factCount('84 imports')).toBe(1);
    const tight: CardBox[] = [
      { id: 's0', x: 0, y: 0, w: 160, h: 56 },
      { id: 's1', x: 200, y: 0, w: 160, h: 56 },
    ];
    const [chip] = routeEdges([{ id: 'e', source: 's0', target: 's1', proof: 'traced', label: 'GET /api/runs +3 more', labelFull: 'a, b, c, d' }], tight);
    expect(chip!.data.labelMode).toBe('chip');
    expect(chip!.data.label).toBe('+4');
    expect(chip!.data.labelFull).toBe('a, b, c, d');
    const touching: CardBox[] = [
      { id: 's0', x: 0, y: 0, w: 160, h: 100 },
      { id: 's1', x: 0, y: 103, w: 160, h: 100 },
    ];
    const [gone] = routeEdges([{ id: 'e', source: 's0', target: 's1', proof: 'traced', label: '84 imports' }], touching);
    expect(gone!.data.label).toBeUndefined();
    expect(gone!.data.labelHidden).toBe('84 imports');
  });

  it('on a whole routed board (derived: every tag against every tag, card and line)', () => {
    const boxes: CardBox[] = Array.from({ length: 12 }, (_, i) => ({
      id: `n${i}`,
      x: (i % 4) * 260,
      y: Math.floor(i / 4) * 180,
      w: 160 + (i % 3) * 12,
      h: 64,
    }));
    const edges: BoardEdge[] = [];
    for (let i = 0; i < 12; i++) {
      for (const j of [(i + 1) % 12, (i + 5) % 12]) {
        edges.push({ id: `e${i}-${j}`, source: `n${i}`, target: `n${j}`, proof: 'traced', label: i % 2 ? `GET /api/item${i} +${j} more` : `${i * 7} imports`, labelFull: i % 2 ? Array.from({ length: j + 1 }, (_, k) => `p${k}`).join(', ') : undefined });
      }
    }
    const routed = routeEdges(edges, boxes);
    const drawn = routed.filter((e) => e.data.label).length;
    expect(drawn).toBeGreaterThan(0);
    expect(collisions(routed, boxes)).toEqual([]);
    /* Nothing silently lost: every label is a tag, a chip or on the hover. */
    for (const e of routed) expect(Boolean(e.data.label) || Boolean(e.data.labelHidden)).toBe(true);
  });
});

describe('the card footer never cuts a word (round 7)', () => {
  const frontend: BoardNode = {
    id: 'svc:frontend',
    label: 'Frontend',
    subtitle: null,
    present: { kind: 'service', entry: true },
    schemaKind: 'service',
    provenance: 'traced',
    count: { value: '50', label: '50 parts' },
    cardW: 167,
  } as unknown as BoardNode;

  it('kind, one status and the count when they fit; the kind alone when not', () => {
    expect(metaRowItems({ kind: 'Service', provenance: 'traced', count: { value: '50', label: '' } }, 167)).toBe('all');
    expect(metaRowItems({ kind: 'Datastore', provenance: 'declared', count: { value: '1234', label: '' } }, 120)).toBe('kind');
  });

  it('the reported card (ML harness Frontend, an entry service) reads SERVICE TRACED 50, with no ellipsis', () => {
    const { container } = render(<div className="board-scope"><div className="node"><VisualMetaStrip node={frontend} /></div></div>);
    const row = container.querySelector('[data-testid="board-node-meta"]')!;
    expect(row.textContent).not.toMatch(/…|\.\.\./);
    expect(row.textContent).not.toMatch(/entry/i);
    expect(container.querySelector('[data-testid="board-node-provenance"]')?.textContent).toBe('Traced');
    expect(container.querySelector('[data-testid="board-node-count"]')?.textContent).toBe('50');
    const narrow = render(<VisualMetaStrip node={{ ...frontend, cardW: 110 } as BoardNode} />);
    expect(narrow.container.querySelector('[data-testid="board-node-provenance"]')).toBeNull();
    expect(narrow.container.querySelector('.nd-meta-kind')?.textContent).toBe('Service');
  });
});
