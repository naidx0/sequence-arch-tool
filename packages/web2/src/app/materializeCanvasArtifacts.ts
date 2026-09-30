/**
 * Place canvasDoc charts/blocks as SeqDraw artifact frames on the AI Canvas plane.
 *
 * Sizes are starting estimates — Whiteboard ResizeObserver grows the frame to
 * fit content so the freeform plane is not a 520×300 cage (owner walk 2026-09-16).
 */

import type { CanvasArtifactFrame, CanvasDoc } from '../state/types';
import type { WbArtifact } from '../whiteboard/whiteboardModel';
import { PLAN_SURFACE, surfaceOfBlock, surfaceOfChart } from './canvasSurfaces';

const CHART_W = 560;
const CHART_H = 340;
const BLOCK_W = 480;
const BLOCK_H = 280;
const GAP = 36;
const ORIGIN_X = 48;
const ORIGIN_Y = 48;
/** The Plan tab's text column — wider than a block, because it is the document. */
const PLAN_SPINE_W = 640;

/**
 * HOW MANY FRAMES ONE CANVAS MAY CARRY.
 *
 * A map this size is already far past what a reader can arrange by hand, and
 * the cap is what keeps a malformed or hostile document from making the
 * session file unbounded. It lives BESIDE the function that enforces it
 * rather than in `state/types.ts`, which by its own locked contract declares
 * types and lets no runtime value escape.
 */
export const MAX_CANVAS_FRAMES = 200;

/*
 * A STEPPED FLOW STARTS TALLER (2026-09-22). FlowStepper sits under the chart:
 * a row per step, the current step's detail, and the Prev / Play / Next row.
 * Without the room the first frame opened on the chart with its step list cut
 * off until the ResizeObserver caught up. Estimates, like every size here.
 */
const STEPPER_CHROME_H = 96;
const STEPPER_ROW_H = 24;

function stepperHeight(steps: readonly unknown[] | undefined): number {
  const n = Array.isArray(steps) ? steps.length : 0;
  return n === 0 ? 0 : STEPPER_CHROME_H + n * STEPPER_ROW_H;
}

/** Stable ids so agentItems append-by-id stays idempotent across re-renders. */
export function chartArtifactId(index: number): string {
  return `artifact:chart:${index}`;
}

export function blockArtifactId(blockId: string): string {
  return `artifact:block:${blockId}`;
}

/**
 * Cascade layout in board space. Existing positions are not recomputed here —
 * Whiteboard keeps human moves; this only proposes new frames by id.
 *
 * ── A STORED FRAME WINS (carrying-harness plan, wave B2) ────────────────────
 *
 * `doc.frames[id]` is where the reader last put that artifact, carried in the
 * DOCUMENT rather than in this origin's localStorage. When one is present it
 * is used verbatim and the cascade skips past it, so the arrangement a person
 * made survives a reload on a machine that has never seen their browser
 * storage. Without a frame the cascade is what it always was.
 *
 * The cascade's cursor advances only for artifacts it actually placed: a
 * stored frame may be anywhere on the plane, and letting it push the cursor
 * would scatter the unplaced ones around it rather than stacking them.
 */
export function materializeCanvasArtifacts(doc: CanvasDoc, surface?: string): WbArtifact[] {
  /* One tab's artifacts when a tab is named; every artifact when not. */
  const onTab = (s: string) => surface === undefined || s === surface;
  const out: WbArtifact[] = [];
  /*
   * THE PLAN TAB READS IN TWO COLUMNS (2026-09-22). A plan is a document with
   * pictures beside it: the Markdown spine down the left, and its diagrams —
   * the before-and-after, the decisions, the expected-effect charts — down the
   * right, level with the text they belong to. One cascade put every picture
   * under the whole document, where nobody scrolls. Every other tab keeps the
   * single cascade it always had.
   */
  const twoColumn = surface === PLAN_SURFACE;
  let y = ORIGIN_Y;
  let yRight = ORIGIN_Y;
  const frames = doc.frames ?? {};

  const place = (
    id: string,
    w: number,
    h: number,
    ref: WbArtifact['ref'],
    column: 'left' | 'right' = 'left',
  ): void => {
    const saved = frames[id];
    if (saved) {
      out.push({ kind: 'artifact', id, at: { x: saved.x, y: saved.y }, size: { w: saved.w, h: saved.h }, ref });
      return;
    }
    if (twoColumn && column === 'right') {
      out.push({ kind: 'artifact', id, at: { x: ORIGIN_X + PLAN_SPINE_W + GAP, y: yRight }, size: { w, h }, ref });
      yRight += h + GAP;
      return;
    }
    const width = twoColumn ? PLAN_SPINE_W : w;
    out.push({ kind: 'artifact', id, at: { x: ORIGIN_X, y }, size: { w: width, h }, ref });
    y += h + GAP;
  };

  const charts = doc.charts ?? [];
  for (let i = 0; i < charts.length; i += 1) {
    if (!onTab(surfaceOfChart(doc, i))) continue;
    place(chartArtifactId(i), CHART_W, CHART_H + stepperHeight(charts[i]?.steps), { type: 'chart', index: i }, 'right');
  }

  for (const block of doc.blocks) {
    if (block.status === 'pending') continue;
    if (!onTab(surfaceOfBlock(block))) continue;
    const tall = block.type === 'markdown' || block.type === 'html' || block.type === 'react';
    const h = tall ? Math.max(BLOCK_H, 320) : BLOCK_H;
    place(
      blockArtifactId(block.id),
      BLOCK_W,
      h,
      { type: 'block', blockId: block.id },
      block.type === 'markdown' ? 'left' : 'right',
    );
  }

  return out;
}

/**
 * EVERY ARTIFACT ID THIS DOCUMENT HAS — from the same two functions that mint
 * them, so the set and the items can never disagree about a naming.
 *
 * It is what makes "is this frame mine?" answerable from the document rather
 * than from an identity comparison. See {@link framesFromDrawing}.
 */
export function artifactIdsOf(doc: CanvasDoc): Set<string> {
  const ids = new Set<string>();
  const charts = doc.charts ?? [];
  for (let i = 0; i < charts.length; i += 1) ids.add(chartArtifactId(i));
  for (const block of doc.blocks) {
    if (block.status === 'pending') continue;
    ids.add(blockArtifactId(block.id));
  }
  return ids;
}

/**
 * THE FRAMES A DRAWING CARRIES, read back out of the pad's document.
 *
 * The other direction of wave B2: the pad owns the live geometry (a drag
 * writes `wb/move`, a ResizeObserver writes `wb/resize`), and this is how that
 * geometry becomes part of the canvas document rather than staying in the
 * browser. Only `artifact` items are read — a person's own strokes and notes
 * are the drawing, not the arrangement of the agent's work.
 *
 * ── `ownedIds` IS THE REAL GUARD, AND IT IS A CONTENT ONE ───────────────────
 *
 * On a session switch the rail flips `activeId` and stamps a fresh empty
 * canvas with the new id in ONE dispatch, while the pad may spend a render
 * still reporting the previous thread's artifacts. An identity check
 * (`doc.forSession === activeId`) is true for both halves of that render and
 * so cannot see it — the frames of thread A land on thread B's empty canvas,
 * which is the same defect `CanvasDoc.forSession` was added for, one layer
 * down. Asking the DOCUMENT which artifacts are its own closes it: B's empty
 * canvas has no blocks and no charts, so nothing of A's is recorded.
 *
 * Returns `null` when the drawing carries no artifact this document owns, so a
 * caller can tell "nothing to record" from "an empty arrangement".
 */
export function framesFromDrawing(
  items: readonly { kind: string; id: string; at?: { x: number; y: number }; size?: { w: number; h: number } }[],
  ownedIds?: ReadonlySet<string>,
): Record<string, CanvasArtifactFrame> | null {
  const frames: Record<string, CanvasArtifactFrame> = {};
  let n = 0;
  for (const item of items) {
    if (item.kind !== 'artifact' || !item.at || !item.size) continue;
    if (ownedIds && !ownedIds.has(item.id)) continue;
    if (!Number.isFinite(item.at.x) || !Number.isFinite(item.at.y)) continue;
    if (!(item.size.w > 0) || !(item.size.h > 0)) continue;
    if (n >= MAX_CANVAS_FRAMES) break;
    frames[item.id] = {
      x: Math.round(item.at.x),
      y: Math.round(item.at.y),
      w: Math.round(item.size.w),
      h: Math.round(item.size.h),
    };
    n += 1;
  }
  return n === 0 ? null : frames;
}

/** True when two frame maps say the same thing — a guard against pointless writes. */
export function sameFrames(
  a: Record<string, CanvasArtifactFrame> | undefined,
  b: Record<string, CanvasArtifactFrame> | undefined,
): boolean {
  const ka = Object.keys(a ?? {}).sort();
  const kb = Object.keys(b ?? {}).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i += 1) {
    const key = ka[i]!;
    if (key !== kb[i]) return false;
    const x = a![key]!;
    const y = b![key]!;
    if (x.x !== y.x || x.y !== y.y || x.w !== y.w || x.h !== y.h) return false;
  }
  return true;
}
