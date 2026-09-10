/**
 * AI Canvas document persistence — mirrors chatMemory.ts shape for canvas.json.
 */

import type { SeqChart } from '@sequence/schema';

import type { CanvasDoc, CanvasDocBlock, CanvasStoryRoute } from '../state/types';

export interface CanvasMemoryShape {
  version: 1;
  sessionId: string;
  blocks: CanvasDocBlock[];
  storyRoute?: CanvasStoryRoute;
  /**
   * THE CHARTS WERE DROPPED ON THE WAY TO DISK, IN THREE PLACES AT ONCE.
   *
   * A teach turn on the real product proposed a derived chart, `chat.json`
   * recorded it as a work row ("Drew a chart", from `chart:proposal`), and the
   * AI Canvas showed its empty placeholder with `canvas.json` holding
   * `blocks: []`. The chart reached the store and never reached the file: this
   * shape had no `charts`, `toCanvasMemory` did not send it, `fromCanvasMemory`
   * did not restore it, and `worthPersistingCanvas` did not even count a
   * chart-only canvas as worth writing.
   *
   * So the one number the derived visual is measured by — 14 of 21 — was
   * invisible on the route users drive, and the surface that renders it looked
   * broken rather than empty.
   */
  charts?: SeqChart[];
}

function parseBlock(raw: unknown): CanvasDocBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.payload !== 'string') return null;
  const type = o.type;
  if (
    type !== 'markdown' &&
    type !== 'mermaid' &&
    type !== 'html' &&
    type !== 'react' &&
    type !== 'svg'
  ) {
    return null;
  }
  const status = o.status === 'live' ? 'live' : 'landed';
  return {
    id: o.id,
    type,
    payload: o.payload,
    status,
    ...(typeof o.title === 'string' ? { title: o.title } : {}),
  };
}

export function toCanvasMemory(sessionId: string, doc: CanvasDoc): CanvasMemoryShape {
  return {
    version: 1,
    sessionId,
    blocks: doc.blocks
      .filter((b) => b.status !== 'pending')
      .map((b) => ({
        ...b,
        status: b.status === 'live' ? 'landed' : b.status,
      })),
    ...(doc.storyRoute ? { storyRoute: doc.storyRoute } : {}),
    ...(doc.charts && doc.charts.length > 0 ? { charts: doc.charts } : {}),
  };
}

export function fromCanvasMemory(raw: unknown): CanvasDoc {
  if (!raw || typeof raw !== 'object') return { blocks: [] };
  const o = raw as {
    version?: unknown;
    blocks?: unknown;
    storyRoute?: unknown;
    charts?: unknown;
  };
  if (o.version !== 1 || !Array.isArray(o.blocks)) return { blocks: [] };
  const blocks: CanvasDocBlock[] = [];
  for (const entry of o.blocks) {
    const block = parseBlock(entry);
    if (block) blocks.push(block);
  }
  const storyRoute = parseStoryRoute(o.storyRoute);
  /*
   * Charts are stored as the server validated them and are NOT re-validated
   * here: every `nodeId` was checked against the real graph before the
   * `chart:proposal` event existed, and this client's `session.graph` may be a
   * staler scan — re-checking would refuse charts the server accepted, which is
   * the worse failure. Shape only: an array of objects.
   */
  const charts = Array.isArray(o.charts)
    ? (o.charts.filter((c) => c !== null && typeof c === 'object') as SeqChart[])
    : [];
  return {
    blocks,
    ...(storyRoute ? { storyRoute } : {}),
    ...(charts.length > 0 ? { charts } : {}),
  };
}

function parseStoryRoute(raw: unknown): CanvasStoryRoute | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as { title?: unknown; steps?: unknown };
  if (typeof o.title !== 'string' || !Array.isArray(o.steps) || o.steps.length === 0) return undefined;
  const steps: CanvasStoryRoute['steps'] = [];
  for (const entry of o.steps) {
    if (!entry || typeof entry !== 'object') continue;
    const s = entry as { blockId?: unknown; caption?: unknown };
    if (typeof s.blockId === 'string' && typeof s.caption === 'string') {
      steps.push({ blockId: s.blockId, caption: s.caption });
    }
  }
  if (steps.length === 0) return undefined;
  return { title: o.title, steps };
}

export function worthPersistingCanvas(doc: CanvasDoc): boolean {
  /* A canvas whose only content is a chart IS worth persisting — that is the
     whole teach-mode case, and omitting it here meant a lesson's picture was
     never written even once the shape could carry it. */
  return doc.blocks.length > 0 || doc.storyRoute !== undefined || (doc.charts?.length ?? 0) > 0;
}
