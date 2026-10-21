/* A saved workflow as board items, then the board renderer: the chat shows the loop inline,
   in the same style as a drawing on a Space. Blocks left to right (rows of six), a titled
   frame around each loop's body with a dashed arrow back. Deterministic. */

import { BLOCK_INFO, loopBodies, type WorkflowDoc } from '@sequence/schema';
import type { BoardItem } from './boardStore.js';
import { edgePoint } from './compose.js';
import { renderItemsSvg, type RenderResult } from './boardRender.js';

const COLS = 6;
const W = 168;
const H = 64;
const GAP = 56;
const ROW_GAP = 96;
const LOOP_PAD = 16;

interface Slot {
  id: string;
  label: string;
  shape: 'rect' | 'ellipse' | 'diamond';
  stroke?: string;
  dash?: 'dashed';
  loop?: number;
}

/** Items for a workflow: Start, each block (loops grouped), Finish, and the arrows between. */
export function workflowItems(doc: Pick<WorkflowDoc, 'id' | 'name' | 'blocks'>): BoardItem[] {
  const group = `wf-${doc.id}`;
  const blocks = doc.blocks.filter((b) => b.kind !== 'finish');
  const finish = doc.blocks.find((b) => b.kind === 'finish');
  const bodies = loopBodies(blocks);
  const inBody = new Map<number, number>();
  for (const [i, body] of bodies) for (const j of body) inBody.set(j, i);
  const slots: Slot[] = [{ id: 'start', label: 'Start', shape: 'ellipse' }];
  const loopOf = new Map<number, number>();
  blocks.forEach((b, i) => {
    if (b.kind === 'loop') return;
    const owner = inBody.get(i);
    const kind = BLOCK_INFO[b.kind].label;
    slots.push({
      id: b.id,
      label: `${kind}: ${b.title}`,
      shape: b.kind === 'checker' ? 'diamond' : 'rect',
      ...(b.kind === 'checker' ? { stroke: 'warning' } : {}),
      ...(b.kind === 'test' ? { dash: 'dashed' as const } : {}),
      ...(owner !== undefined ? { loop: owner } : {}),
    });
    if (owner !== undefined) loopOf.set(slots.length - 1, owner);
  });
  slots.push({ id: finish?.id ?? 'end', label: finish?.title ?? 'Finish', shape: 'ellipse', stroke: 'positive' });
  /* A loop and its body stay on ONE row, so its frame is one box and its way back is one path: a loop that would
     cross the end of a row starts the next one, and a body longer than a row widens the rows. */
  const lens = new Map<number, number>();
  for (const s of slots) if (s.loop !== undefined) lens.set(s.loop, (lens.get(s.loop) ?? 0) + 1);
  const cols = Math.max(COLS, ...lens.values());
  const cell: number[] = [];
  let at = 0;
  slots.forEach((s, k) => {
    if (s.loop !== undefined && slots[k - 1]?.loop !== s.loop) {
      const len = lens.get(s.loop)!;
      if ((at % cols) + len > cols) at += cols - (at % cols);
    }
    cell.push(at);
    at += 1;
  });
  const pos = slots.map((_, k) => ({ x: (cell[k]! % cols) * (W + GAP), y: Math.floor(cell[k]! / cols) * (H + ROW_GAP) }));
  const items: BoardItem[] = [];
  /* Loop frames first, so they sit behind their blocks. */
  const loopSlots = new Map<number, number[]>();
  slots.forEach((s, k) => {
    if (s.loop !== undefined) loopSlots.set(s.loop, [...(loopSlots.get(s.loop) ?? []), k]);
  });
  for (const [li, ks] of [...loopSlots].sort((a, b) => a[0] - b[0])) {
    const loop = blocks[li]!;
    const x1 = Math.min(...ks.map((k) => pos[k]!.x)) - LOOP_PAD;
    const y1 = Math.min(...ks.map((k) => pos[k]!.y)) - LOOP_PAD - 24;
    const x2 = Math.max(...ks.map((k) => pos[k]!.x + W)) + LOOP_PAD;
    const y2 = Math.max(...ks.map((k) => pos[k]!.y + H)) + LOOP_PAD + 28;
    items.push({
      kind: 'shape',
      shape: 'frame',
      id: `wf-loop-${loop.id}`,
      group,
      from: { x: x1, y: y1 },
      to: { x: x2, y: y2 },
      label: `${loop.title} · repeat up to ${loop.maxIterations ?? 3}x until the checker passes`,
      stroke: 'accent',
    });
  }
  slots.forEach((s, k) => {
    const p = pos[k]!;
    items.push({
      kind: 'shape',
      shape: s.shape,
      id: `wf-${s.id}`,
      group,
      from: { x: p.x, y: p.y },
      to: { x: p.x + W, y: p.y + H },
      label: s.label,
      ...(s.stroke ? { stroke: s.stroke } : {}),
      ...(s.dash ? { dash: s.dash } : {}),
    });
  });
  const box = (k: number) => ({ x: pos[k]!.x, y: pos[k]!.y, w: W, h: H });
  for (let k = 0; k + 1 < slots.length; k += 1) {
    const a = box(k);
    const b = box(k + 1);
    const s = edgePoint(a, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
    const e = edgePoint(b, { x: a.x + a.w / 2, y: a.y + a.h / 2 });
    items.push({ kind: 'shape', shape: 'arrow', id: `wf-edge-${k}`, group, from: s, to: e, fromId: `wf-${slots[k]!.id}`, toId: `wf-${slots[k + 1]!.id}`, arrowEnd: 'arrow' });
  }
  /* The way back: from the last block of each loop, under the row, to the first. */
  for (const [li, ks] of [...loopSlots].sort((a, b) => a[0] - b[0])) {
    const first = pos[ks[0]!]!;
    const last = pos[ks[ks.length - 1]!]!;
    const yb = first.y + H + LOOP_PAD + 14;
    items.push({
      kind: 'shape',
      shape: 'path',
      id: `wf-back-${blocks[li]!.id}`,
      group,
      from: { x: 0, y: 0 },
      to: { x: 0, y: 0 },
      points: [
        { x: last.x + W / 2, y: last.y + H },
        { x: last.x + W / 2, y: yb },
        { x: first.x + W / 2, y: yb },
        { x: first.x + W / 2, y: first.y + H },
      ],
      dash: 'dashed',
      arrowEnd: 'arrow',
      stroke: 'accent',
      label: 'not passed: again',
    });
  }
  return items;
}

export function renderWorkflowSvg(doc: Pick<WorkflowDoc, 'id' | 'name' | 'blocks'>): RenderResult {
  return renderItemsSvg(workflowItems(doc), { title: `Workflow: ${doc.name}` });
}
