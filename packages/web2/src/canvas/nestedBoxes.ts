/* ══════════════════════════════════════════════════════════════════════════
   NESTED BOXES — where every card is, when some are inside a group
   packages/web2/src/canvas/nestedBoxes.ts

   Pure. A member of an expanded group is positioned RELATIVE TO ITS GROUP (it
   is what ELK returns for a compound node, and what @xyflow takes for a node
   with a `parentId`). The router, the fit and the hit regions want absolute
   boxes, so this is the one place the two are reconciled: absolute = the
   group's absolute corner + the member's own offset, walked up the nesting.
   A group's own size is ELK's answer; until ELK has answered it is the card's.
   ══════════════════════════════════════════════════════════════════════════ */

import type { LodRung } from '../state/types';
import type { AnatomyPanel } from './anatomy.js';
import { cardBox, type CardBox } from './cardBox.js';

/** An expanded group with no member drawn still needs a body row for its
 *  "N not drawn" line: the header (GROUP_PAD.top, 40) plus one 36px row.
 *  Not imported from layout.ts: that module carries the layout worker, and
 *  this one is on the board's render path. */
export const EMPTY_GROUP_H = 40 + 36;
import type { BoardNode } from './NodeCard.js';

type Point = { x: number; y: number };

export function nestedBoxes(
  nodes: readonly BoardNode[],
  positions: Readonly<Record<string, Point>>,
  sizes: Readonly<Record<string, { w: number; h: number }>>,
  place: (id: string, laid: Point) => Point,
  rung: LodRung,
  visual: boolean,
  anatomy: AnatomyPanel | null,
  /* The board's far-title scale ceiling on the far rungs (cardBox.ts). */
  farScale?: number,
): CardBox[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const abs = new Map<string, Point>();
  const absOf = (id: string, seen: Set<string>): Point => {
    const done = abs.get(id);
    if (done) return done;
    const node = byId.get(id);
    const own = place(id, positions[id] ?? { x: 0, y: 0 });
    const parent = node?.parentId && byId.has(node.parentId) && !seen.has(node.parentId) ? node.parentId : null;
    let out = own;
    if (parent) {
      seen.add(id);
      const at = absOf(parent, seen);
      out = { x: at.x + own.x, y: at.y + own.y };
    }
    abs.set(id, out);
    return out;
  };
  return nodes.map((node) => {
    const at = absOf(node.id, new Set());
    const box = cardBox(node, at, rung, visual, anatomy?.nodeId === node.id ? anatomy : null, undefined, farScale);
    if (!node.group) return box;
    const size = sizes[node.id] ?? (node.group.shown === 0 ? { w: box.w, h: Math.max(box.h, EMPTY_GROUP_H) } : undefined);
    return { ...box, ...(size ? { w: size.w, h: size.h } : {}), container: true };
  });
}

/** How deep a node is nested; @xyflow wants a parent before its members. */
export function depthOf(nodes: readonly BoardNode[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = new Map<string, number>();
  for (const node of nodes) {
    let d = 0;
    let cur = node.parentId;
    const seen = new Set<string>([node.id]);
    while (cur && byId.has(cur) && !seen.has(cur)) {
      d += 1;
      seen.add(cur);
      cur = byId.get(cur)!.parentId;
    }
    depth.set(node.id, d);
  }
  return depth;
}
