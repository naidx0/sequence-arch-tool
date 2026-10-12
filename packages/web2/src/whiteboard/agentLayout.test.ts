import { describe, expect, it } from 'vitest';

import { boardWireToWbItem } from '../draw/seqDraw';
import { isAgentMark, layoutAgentBoard, layoutBounds, rectOf, type Rect } from './agentLayout';
import { measureLine, wrapLabel, type WbItem, type WbShape } from './whiteboardModel';

/* THE OWNER'S SCREENSHOT 3 (0.1.5), as data: five boxes in a row, 156 wide and 44 tall as the agent placed them, the
   words of "4 OBSERVE" too long for its box, connectors across 40-unit gaps carrying labels as loose words, and a long
   note typed as one line underneath. Every property below is measured from the placed marks. */
const LABELS: [string, string][] = [
  ['1 INPUT', 'User task and any files the user attached to the conversation'],
  ['2 THINK', 'Plan the next step'],
  ['3 ACT', 'Call a tool with arguments and wait for it to finish running'],
  ['4 OBSERVE', 'Read the tool result: stdout, files, errors, anything else the tool returned'],
  ['5 ANSWER', 'Reply'],
];

function agentDrawing(): WbItem[] {
  const items: WbItem[] = [];
  LABELS.forEach(([title, body], i) => {
    const x = 40 + i * 196;
    items.push({ kind: 'shape', id: `step${i}:box`, shape: 'rect', from: { x, y: 60 }, to: { x: x + 156, y: 104 } });
    items.push({ kind: 'text', id: `step${i}`, at: { x: x + 14, y: 86 }, text: `${title}\n${body}` });
  });
  const arrow = (id: string, x1: number, x2: number, label: string) => {
    items.push({ kind: 'shape', id, shape: 'arrow', from: { x: x1, y: 82 }, to: { x: x2, y: 82 } });
    items.push({ kind: 'text', id: `${id}-label`, at: { x: (x1 + x2) / 2 - measureLine(label, 12) / 2, y: 78 }, text: label });
  };
  for (let i = 0; i < 4; i += 1) arrow(`flow${i}`, 40 + i * 196 + 160, 40 + (i + 1) * 196 - 4, ['start', 'decide', 'result', 'loop 3-4 until done'][i]!);
  items.push({
    kind: 'text',
    id: 'memory-note',
    at: { x: 40, y: 112 },
    text: 'The agent keeps a running memory of everything it has seen in this loop, so the model can look back at earlier tool results.',
  });
  /* The agent's marks say so (the wire sets `by`, boardWireToWbItem): layout reads the marker, never the id. */
  return items.map((it) => ({ ...it, by: 'agent' as const }));
}

const boxesOf = (items: readonly WbItem[]): Rect[] => items.filter((i): i is WbShape => i.kind === 'shape' && i.shape === 'rect').map(rectOf);
const overlap = (a: Rect, b: Rect, pad = 0) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

describe('an agent drawing lands readable (screenshot 3)', () => {
  const layout = layoutAgentBoard(agentDrawing());

  it('CONTROL: the raw drawing is the mess (a box too small for its words, labels on borders)', () => {
    const raw = agentDrawing();
    const small = rectOf(raw[0] as WbShape);
    expect(small.h).toBe(44);
    /* "4 OBSERVE" needs more than 44 units of height at 156 wide. */
    const need = wrapLabel('4 OBSERVE\nRead the tool result: stdout, files, errors, anything else the tool returned', 156 - 28).length * 18 + 24;
    expect(need).toBeGreaterThan(44);
  });

  it('every box is tall enough for every wrapped line of its words, and no box overlaps another', () => {
    for (const [id, label] of layout.labels) {
      const box = layout.items.find((i) => i.id === id) as WbShape;
      expect(rectOf(box).h, id).toBeGreaterThanOrEqual(label.lines.length * 18 + 24);
      for (const line of label.lines) expect(measureLine(line, 13), `${id}: ${line}`).toBeLessThanOrEqual(rectOf(box).w - 28 + 0.5);
    }
    const boxes = boxesOf(layout.items);
    expect(boxes).toHaveLength(5);
    boxes.forEach((a, i) => boxes.forEach((b, j) => i < j && expect(overlap(a, b), `${i} vs ${j}`).toBe(false)));
  });

  it('the words that sat on the box are its label now: no loose copy is drawn over it', () => {
    for (let i = 0; i < 5; i += 1) expect(layout.items.some((it) => it.id === `step${i}`)).toBe(false);
    expect(layout.labels.get('step3:box')!.lines.join(' ')).toContain('OBSERVE');
  });

  it('ARROW LABELS ARE OFF THE BOX BORDERS: each is on a backing that touches no box and no other label', () => {
    expect(layout.edgeLabels.size).toBe(4);
    const boxes = boxesOf(layout.items);
    const placed = [...layout.edgeLabels.values()].map((e) => ({ x: e.x - e.w / 2, y: e.y - e.h / 2, w: e.w, h: e.h }));
    for (const r of placed) for (const b of boxes) expect(overlap(r, b), JSON.stringify(r)).toBe(false);
    placed.forEach((a, i) => placed.forEach((b, j) => i < j && expect(overlap(a, b)).toBe(false)));
    /* The labels' words were consumed (drawn on the backing, not loose on the line). */
    for (let i = 0; i < 4; i += 1) expect(layout.items.some((it) => it.id === `flow${i}-label`)).toBe(false);
  });

  it('a label wider than the gap is lifted clear of the boxes rather than drawn across them', () => {
    const wide = [...layout.edgeLabels.entries()].find(([, e]) => e.text.startsWith('loop'))!;
    expect(wide[1].w).toBeGreaterThan(40);
    const arrow = layout.items.find((i) => i.id === wide[0]) as WbShape;
    /* Not on the line: moved off it by at least half its own height. */
    expect(Math.abs(wide[1].y - arrow.from.y)).toBeGreaterThanOrEqual(wide[1].h / 2);
  });

  it('a long free note is wrapped to a readable measure and sits below the boxes, not on them', () => {
    const note = layout.items.find((i) => i.id === 'memory-note')!;
    const lines = layout.noteLines.get('memory-note')!;
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measureLine(l, 13)).toBeLessThanOrEqual(260);
    const foot = { x: (note as { at: { x: number } }).at.x, y: (note as { at: { y: number } }).at.y - 13, w: 260, h: lines.length * 18 };
    for (const b of boxesOf(layout.items)) expect(overlap(foot, b)).toBe(false);
  });

  it('everything is inside the reported bounds (what Fit frames), labels included', () => {
    const bounds = layoutBounds(layout)!;
    for (const b of boxesOf(layout.items)) {
      expect(b.x).toBeGreaterThanOrEqual(bounds.x);
      expect(b.x + b.w).toBeLessThanOrEqual(bounds.x + bounds.w + 0.01);
      expect(b.y + b.h).toBeLessThanOrEqual(bounds.y + bounds.h + 0.01);
    }
    for (const e of layout.edgeLabels.values()) {
      expect(e.y - e.h / 2).toBeGreaterThanOrEqual(bounds.y - 0.01);
      expect(e.x + e.w / 2).toBeLessThanOrEqual(bounds.x + bounds.w + 0.01);
    }
  });
});

describe('a box that grows pushes the one under it down, and connectors follow', () => {
  const items: WbItem[] = [
    { kind: 'shape', id: 'top:box', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 156, y: 44 } },
    { kind: 'text', id: 'top', at: { x: 14, y: 26 }, text: 'A long label that needs several lines to fit in a box this narrow, honestly' },
    { kind: 'shape', id: 'under:box', shape: 'rect', from: { x: 0, y: 70 }, to: { x: 156, y: 114 } },
    { kind: 'text', id: 'under', at: { x: 14, y: 96 }, text: 'Below' },
    { kind: 'shape', id: 'link', shape: 'arrow', from: { x: 78, y: 48 }, to: { x: 78, y: 70 }, fromId: 'top:box', toId: 'under:box' },
  ];
  const layout = layoutAgentBoard(items.map((it) => ({ ...it, by: 'agent' as const })));

  it('the boxes keep clear space and the bound arrow runs between them', () => {
    const [top, under] = ['top:box', 'under:box'].map((id) => rectOf(layout.items.find((i) => i.id === id) as WbShape));
    expect(top!.h).toBeGreaterThan(44);
    expect(under!.y).toBeGreaterThanOrEqual(top!.y + top!.h + 16 - 0.01);
    const arrow = layout.items.find((i) => i.id === 'link') as WbShape;
    expect(arrow.from.y).toBeGreaterThanOrEqual(top!.y + top!.h - 0.01);
    expect(arrow.to.y).toBeLessThanOrEqual(under!.y + 0.01);
  });
});

describe('a box pushed by two growers in one pass: its connector follows what the box actually moved', () => {
  /* 0.1.5 review: the push loop moved B from a stale snapshot, so the second push overwrote the first while the
     arrow's shift summed both (B moved 340, the arrow 518, detached). */
  const long = 'a long label that needs several lines inside this small box to be read at all, really quite long';
  const rect = (id: string, x: number, y: number, w: number, h: number, label?: string): WbShape => ({
    kind: 'shape', id, by: 'agent', shape: 'rect', from: { x, y }, to: { x: x + w, y: y + h }, ...(label ? { label } : {}),
  });
  const src: WbItem[] = [
    rect('grow-a', 0, 0, 100, 40, long),
    rect('grow-b', 120, 0, 100, 40, `${long} and more words to make it taller than the first one by a good margin indeed`),
    rect('wide', 0, 60, 220, 40, 'B'),
    { kind: 'shape', id: 'into-wide', by: 'agent', shape: 'arrow', from: { x: 300, y: 80 }, to: { x: 215, y: 80 } },
  ];
  const out = layoutAgentBoard(src);
  const get = (id: string) => out.items.find((i) => i.id === id) as WbShape;

  it('the wide box clears BOTH growers, and the arrow end moved by exactly what the box moved', () => {
    const wide = rectOf(get('wide'));
    for (const g of ['grow-a', 'grow-b']) {
      const r = rectOf(get(g));
      expect(wide.y, g).toBeGreaterThanOrEqual(r.y + r.h + 16 - 0.01);
    }
    expect(get('into-wide').to.y - 80).toBeCloseTo(wide.y - 60, 3);
  });
});

describe("a person's own marks are left exactly as drawn", () => {
  it('text on a person-drawn box, and a loose person label near a line, are not adopted, moved or wrapped', () => {
    const mine: WbItem[] = [
      { kind: 'shape', id: 'r1', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 100, y: 40 } },
      { kind: 'text', id: 't1', at: { x: 10, y: 20 }, text: 'my note that is fairly long and runs on past the measure of a note, so it would wrap if it were the agent' },
      { kind: 'shape', id: 'a1', shape: 'arrow', from: { x: 0, y: 100 }, to: { x: 200, y: 100 } },
      { kind: 'text', id: 't2', at: { x: 90, y: 96 }, text: 'calls' },
    ];
    const out = layoutAgentBoard(mine);
    expect(out.items.map((i) => i.id)).toEqual(['r1', 't1', 'a1', 't2']);
    expect(out.items.find((i) => i.id === 't1')).toEqual(mine[1]);
    expect(out.noteLines.size).toBe(0);
    expect(out.edgeLabels.size).toBe(0);
  });
});

describe('whose mark it is comes from an explicit marker, never from the shape of its id', () => {
  /* 0.1.5 review: isAgentMark treated any id that was not the board counter's as the agent's, so a person's box with an
     older or pasted id was pushed and relabelled by agent rules. */
  const long = 'a long label that needs several lines inside this small box to be read at all, really quite long';
  const box = (id: string, y: number, label: string, by?: 'agent' | 'person'): WbShape => ({
    kind: 'shape', id, shape: 'rect', from: { x: 0, y }, to: { x: 100, y: y + 40 }, label, ...(by ? { by } : {}),
  });

  it("a person's box with a non-counter id is left exactly where it was drawn", () => {
    const out = layoutAgentBoard([box('r1', 0, long), box('box-from-paste-1', 50, 'mine')]);
    expect(rectOf(out.items.find((i) => i.id === 'box-from-paste-1') as WbShape).y).toBe(50);
    expect(isAgentMark(box('box-from-paste-1', 0, 'x'))).toBe(false);
    expect(isAgentMark(box('agent-step-3', 0, 'x'))).toBe(false);
  });

  it("what arrives on the agent's wire carries the agent's marker, so it is still laid out by agent rules", () => {
    const wire = boardWireToWbItem({ kind: 'shape', id: 'step-2', shape: 'rect', from: { x: 0, y: 50 }, to: { x: 100, y: 90 } });
    expect(wire.by).toBe('agent');
    expect(boardWireToWbItem({ kind: 'text', id: 'n', at: { x: 0, y: 0 }, text: 'hi' }).by).toBe('agent');
    const out = layoutAgentBoard([box('grow', 0, long, 'agent'), wire]);
    expect(rectOf(out.items.find((i) => i.id === 'step-2') as WbShape).y).toBeGreaterThan(50);
  });
});

describe('sticky notes are as tall as their words', () => {
  it('a long sticky grows; a short one keeps the default', () => {
    const long = 'The agent keeps a running memory of everything it has seen in this loop, so the model can look back at earlier tool results when it decides what to do next.';
    const out = layoutAgentBoard([
      { kind: 'text', id: 's-long', sticky: true, at: { x: 0, y: 0 }, text: long },
      { kind: 'text', id: 's-short', sticky: true, at: { x: 300, y: 0 }, text: 'ok' },
    ]);
    const get = (id: string) => out.items.find((i) => i.id === id) as { h?: number };
    expect(get('s-long').h).toBeGreaterThan(110);
    expect(get('s-short').h).toBeUndefined();
  });
});
