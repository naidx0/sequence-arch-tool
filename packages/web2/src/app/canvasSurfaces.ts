/**
 * ══ THE AI CANVAS HAS TABS ══════════════════════════════════════════════════
 *
 * Owner, 2026-09-22: "have the AI canvas make … one big free form, but in the
 * canvas you can switch between multiple free form surfaces. So in that AI
 * canvas surface, there is like Chrome tabs, like default surface, plan
 * surface, etc."
 *
 * A SURFACE IS A NAME ON A BLOCK, not a second document. Every block and chart
 * still lives in the one `canvasDoc` the session already persists; each
 * carries the name of the tab it was drawn on, absent meaning the default
 * `canvas`. So a canvas written before tabs existed is simply all `canvas`,
 * the settled PUT and the hydrate path need no second file, and "what is on
 * the Plan tab" is a filter rather than a sync between two stores.
 *
 * Each tab is its OWN SeqDraw pad: the default keeps the key it always had
 * (so nobody's existing drawing moves), and every other tab gets a suffixed
 * key.
 */
import type { CanvasDoc, CanvasDocBlock } from '../state/types';
import { seqDrawKey } from '../whiteboard/whiteboardModel';

export const DEFAULT_SURFACE = 'canvas';
export const PLAN_SURFACE = 'plan';
const MAX_SURFACE_CHARS = 24;
/** A tab strip past this is a list nobody can read; a hostile doc is bounded. */
export const MAX_SURFACES = 12;

/** A surface name as it is stored: lower case, letters, digits, space and dash. */
export function normaliseSurfaceName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 -]+/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_SURFACE_CHARS)
    .trim();
  return name === '' ? null : name;
}

export function surfaceOfBlock(block: Pick<CanvasDocBlock, 'surface'>): string {
  return normaliseSurfaceName(block.surface) ?? DEFAULT_SURFACE;
}

export function surfaceOfChart(doc: Pick<CanvasDoc, 'chartSurfaces'>, index: number): string {
  return normaliseSurfaceName(doc.chartSurfaces?.[index]) ?? DEFAULT_SURFACE;
}

/**
 * The tabs, in order: the default first, Plan second when it has anything or
 * was opened, then every tab the person added, then any a block names that no
 * list does (a doc from a newer build must still show its content).
 */
export function canvasSurfaces(doc: CanvasDoc): string[] {
  const out: string[] = [DEFAULT_SURFACE];
  const add = (s: string | null) => {
    if (s && !out.includes(s) && out.length < MAX_SURFACES) out.push(s);
  };
  const named = [
    ...doc.blocks.map((b) => surfaceOfBlock(b)),
    ...(doc.charts ?? []).map((_, i) => surfaceOfChart(doc, i)),
  ];
  if (named.includes(PLAN_SURFACE) || (doc.surfaces ?? []).includes(PLAN_SURFACE)) add(PLAN_SURFACE);
  for (const s of doc.surfaces ?? []) add(normaliseSurfaceName(s));
  for (const s of named) add(s);
  return out;
}

/** The tab on screen: the doc's choice when it still exists, else the default. */
export function activeSurface(doc: CanvasDoc): string {
  const want = normaliseSurfaceName(doc.activeSurface);
  return want && canvasSurfaces(doc).includes(want) ? want : DEFAULT_SURFACE;
}

export function surfaceLabel(surface: string): string {
  return surface.replace(/(^|[ -])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

/** The next free "Surface N" name. */
export function nextSurfaceName(existing: readonly string[]): string {
  for (let n = 2; ; n += 1) {
    const name = `surface ${n}`;
    if (!existing.includes(name)) return name;
  }
}

/** The pad key: the default keeps the key it always had. */
export function seqDrawKeyFor(sessionId: string | null, surface: string): string {
  const base = seqDrawKey(sessionId);
  return surface === DEFAULT_SURFACE ? base : `${base}#${surface}`;
}
