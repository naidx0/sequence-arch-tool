/**
 * SeqDraw — Sequence's own agent-drawing protocol (not tldraw).
 * packages/web2/src/draw/seqDraw.ts
 *
 * Port of the tldraw *agent action* idea: closed create/update/delete ops,
 * validated shapes, blurry/focused read-half. The canvas itself reuses the
 * native Whiteboard SVG model — no tldraw licence, no watermark.
 */

import type { BoardWireItem } from '@sequence/api-types';

import { sanitizeSvg } from '../chat/svgSanitize';
import { sanitizeScene } from '../whiteboard/scene';
import { IMAGE_EXT, cleanMediaPath } from '../whiteboard/videoItem';
import type { WbItem, WbScene, WhiteboardDoc } from '../whiteboard/whiteboardModel';
import { EMPTY_WHITEBOARD, whiteboardEdit } from '../whiteboard/whiteboardModel';

/**
 * A wire item of a kind this build may not have in its types yet (the backend adds svg, scene and video to
 * `BoardWireItem`): read loosely, every field checked before it is used.
 */
type LooseWire = { kind: string; id: string } & Record<string, unknown>;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const at = (v: unknown): { x: number; y: number } | null => {
  const p = v as { x?: unknown; y?: unknown } | null;
  return p && num(p.x) && num(p.y) ? { x: p.x, y: p.y } : null;
};
const side = (n: number) => Math.min(8192, Math.max(1, n));

/** The whiteboard item for a wire svg, scene or video, made safe; null when it is not usable (it then falls back like any unknown kind). */
function loosewireToWbItem(raw: LooseWire): WbItem | null {
  const pos = at(raw.at);
  if (!pos || typeof raw.id !== 'string') return null;
  if (raw.kind === 'svg') {
    if (typeof raw.svg !== 'string' || raw.svg.length > 120_000 || !num(raw.w) || !num(raw.h)) return null;
    const clean = sanitizeSvg(raw.svg);
    if (!clean.ok) return null;
    return { kind: 'svg', id: raw.id, by: 'agent', at: pos, w: side(raw.w), h: side(raw.h), svg: clean.svg, ...(typeof raw.label === 'string' ? { label: raw.label } : {}) };
  }
  if (raw.kind === 'scene') {
    if (!num(raw.w) || !num(raw.h) || !num(raw.duration)) return null;
    return sanitizeScene({
      kind: 'scene',
      id: raw.id,
      by: 'agent',
      at: pos,
      w: raw.w,
      h: raw.h,
      duration: raw.duration,
      keyframes: raw.keyframes,
      ...(raw.easing !== undefined ? { easing: raw.easing } : {}),
      ...(raw.fps !== undefined ? { fps: raw.fps } : {}),
      ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
    } as unknown as WbScene);
  }
  if (raw.kind === 'video') {
    const src = cleanMediaPath(raw.src);
    if (src === null || !num(raw.w) || !num(raw.h)) return null;
    const poster = raw.poster === undefined ? null : cleanMediaPath(raw.poster, IMAGE_EXT);
    return { kind: 'video', id: raw.id, by: 'agent', at: pos, w: side(raw.w), h: side(raw.h), src, ...(poster ? { poster } : {}), ...(typeof raw.label === 'string' ? { label: raw.label } : {}) };
  }
  return null;
}

/** Everything on the board wire is the agent's: it says so on the mark (`by`), which the board stores and a reload keeps. */
export function boardWireToWbItem(wire: BoardWireItem | LooseWire): WbItem {
  const loose = loosewireToWbItem(wire as LooseWire);
  if (loose) return loose;
  /* svg, scene and video were handled loosely above, so what is left is text, shape or a node reference. */
  const item = wire as Exclude<BoardWireItem, { kind: 'svg' | 'scene' | 'video' }>;
  if (item.kind === 'text') {
    return { kind: 'text', id: item.id, by: 'agent', at: { ...item.at }, text: item.text };
  }
  if (item.kind === 'shape') {
    return {
      kind: 'shape',
      id: item.id,
      by: 'agent',
      shape: item.shape,
      from: { ...item.from },
      to: { ...item.to },
    };
  }
  return {
    kind: 'noderef',
    id: item.id,
    by: 'agent',
    at: { ...item.at },
    nodeId: String(item.nodeId ?? item.id),
    label: String(item.label ?? item.id),
    ...(item.path ? { path: item.path } : {}),
    ...(item.lines ? { lines: { ...item.lines } } : {}),
    ...(item.excerpt ? { excerpt: item.excerpt } : {}),
  };
}

/** Append wire items by id; never replace the whole doc. */
export function appendAgentItems(doc: WhiteboardDoc, wire: readonly BoardWireItem[]): WhiteboardDoc {
  if (wire.length === 0) return doc;
  const have = new Set(doc.items.map((i) => i.id));
  const fresh = wire.map(boardWireToWbItem).filter((i) => !have.has(i.id));
  if (fresh.length === 0) return doc;
  return { ...doc, items: [...doc.items, ...fresh] };
}

/** Blurry overview for the agent prompt — labels + kinds + coarse positions. */
export function blurryBoardSummary(doc: WhiteboardDoc, limit = 40): string {
  const items = doc.items.slice(0, limit);
  if (items.length === 0) return '(empty SeqDraw canvas)';
  const lines = items.map((i) => {
    if (i.kind === 'text') return `- text "${i.text.slice(0, 48)}" @(${Math.round(i.at.x)},${Math.round(i.at.y)}) id=${i.id}`;
    if (i.kind === 'shape') {
      return `- ${i.shape} (${Math.round(i.from.x)},${Math.round(i.from.y)})→(${Math.round(i.to.x)},${Math.round(i.to.y)}) id=${i.id}`;
    }
    if (i.kind === 'noderef') {
      return `- card "${i.label}" node=${i.nodeId} @(${Math.round(i.at.x)},${Math.round(i.at.y)}) id=${i.id}`;
    }
    if (i.kind === 'artifact') {
      const ref =
        i.ref.type === 'chart' ? `chart#${i.ref.index}` : `block:${i.ref.blockId}`;
      return `- artifact ${ref} @(${Math.round(i.at.x)},${Math.round(i.at.y)}) ${Math.round(i.size.w)}x${Math.round(i.size.h)} id=${i.id}`;
    }
    if (i.kind === 'video') {
      return `- video ${i.src} ${Math.round(i.w)}x${Math.round(i.h)} id=${i.id}`;
    }
    if (i.kind === 'scene') {
      return `- scene ${Math.round(i.w)}x${Math.round(i.h)} ${i.duration}ms keyframes=${i.keyframes.length} id=${i.id}`;
    }
    if (i.kind === 'svg') {
      return `- svg @(${Math.round(i.at.x)},${Math.round(i.at.y)}) ${Math.round(i.w)}x${Math.round(i.h)} id=${i.id}`;
    }
    return `- stroke id=${i.id} pts=${i.points.length}`;
  });
  const more = doc.items.length > limit ? `\n…+${doc.items.length - limit} more` : '';
  return lines.join('\n') + more;
}

/** Build a campus-map style demo doc — used by locking tests. */
export function buildCampusMapDemo(): WhiteboardDoc {
  let doc: WhiteboardDoc = EMPTY_WHITEBOARD;
  const adds: Parameters<typeof whiteboardEdit>[1][] = [
    { type: 'wb/add', item: { kind: 'text', id: 'camp-title', at: { x: 200, y: 40 }, text: 'Bot campus map' } },
    { type: 'wb/add', item: { kind: 'shape', id: 'camp-dorm', shape: 'rect', from: { x: 40, y: 100 }, to: { x: 200, y: 220 } } },
    { type: 'wb/add', item: { kind: 'text', id: 'camp-dorm-l', at: { x: 70, y: 140 }, text: 'Dorm / memory' } },
    { type: 'wb/add', item: { kind: 'shape', id: 'camp-lab', shape: 'rect', from: { x: 280, y: 100 }, to: { x: 460, y: 220 } } },
    { type: 'wb/add', item: { kind: 'text', id: 'camp-lab-l', at: { x: 320, y: 140 }, text: 'Lab / tools' } },
    { type: 'wb/add', item: { kind: 'shape', id: 'camp-gate', shape: 'ellipse', from: { x: 180, y: 280 }, to: { x: 320, y: 360 } } },
    { type: 'wb/add', item: { kind: 'text', id: 'camp-gate-l', at: { x: 210, y: 310 }, text: 'Gate / API' } },
    {
      type: 'wb/add',
      item: {
        kind: 'shape',
        id: 'camp-a1',
        shape: 'arrow',
        from: { x: 200, y: 160 },
        to: { x: 280, y: 160 },
      },
    },
    {
      type: 'wb/add',
      item: {
        kind: 'shape',
        id: 'camp-a2',
        shape: 'arrow',
        from: { x: 250, y: 220 },
        to: { x: 250, y: 280 },
      },
    },
  ];
  for (const edit of adds) doc = whiteboardEdit(doc, edit);
  return doc;
}
