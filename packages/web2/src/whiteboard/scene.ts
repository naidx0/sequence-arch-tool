/* ══════════════════════════════════════════════════════════════════════════
   A SCENE — keyframes over the items of a Space
   packages/web2/src/whiteboard/scene.ts

   Owner: "a space where it can make a remotion video: you prompt it the same way, different keyframes, pause, etc. It
   works in line, very simply." A `scene` item is a stage frame on the board plus a timeline. Each keyframe names ONE
   other item of the board (`target`) and what it should look like at time `t` (ms): its position, scale, opacity,
   colour name or text. Between keyframes the numbers are eased; colour names and text step.

   THE BASE IS THE IMPLICIT KEYFRAME AT t = 0. An item with its first keyframe at 2000 ms sits where the board has it
   until then, so a paused scene at 0 is the board as drawn (the "first frame"), and a person who moves an item at
   t = 0 moves the item, not a keyframe.

   PURE: values in, values out, no DOM. The player (Whiteboard.tsx) and the inline preview (SceneStage.tsx) draw
   `scenePoses`; `remotionSource` turns the same data into a self-contained Remotion composition, with no dependency
   on Remotion added here: the text is only generated.

   THE STORED SHAPE (for the backend, kind "scene"):
     { "kind":"scene", "id":"sc1", "at":{"x":0,"y":0}, "w":480, "h":300,            // the stage frame
       "duration":4000, "fps":30, "easing":"ease-in-out", "title":"Intro",         // ms; fps/easing/title optional
       "keyframes":[ {"t":1500,"target":"api","x":300,"y":120,"scale":1.2,"opacity":1,
                      "stroke":"danger","fill":"surface","text":"Done","easing":"ease-out"} ] }
   `x`,`y` are the target's NEW top-left in board coordinates; every keyframe field except `t` and `target` is optional.
   ══════════════════════════════════════════════════════════════════════════ */

import { itemBox } from '../canvas/boards/boardsModel';
import type { WbItem } from './whiteboardModel';

export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
export const EASINGS: readonly Easing[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out'];

export interface SceneKeyframe {
  /** Milliseconds from the scene's start. */
  t: number;
  /** The id of another item on the board. */
  target: string;
  x?: number;
  y?: number;
  scale?: number;
  opacity?: number;
  /** A palette name (palette.ts). */
  stroke?: string;
  fill?: string;
  text?: string;
  /** How the numbers arrive AT this keyframe. */
  easing?: Easing;
}

export interface SceneSpec {
  duration: number;
  fps?: number;
  easing?: Easing;
  keyframes: readonly SceneKeyframe[];
}

export const DEFAULT_EASING: Easing = 'ease-in-out';
export const DEFAULT_FPS = 30;

export const EASE: Record<Easing, (p: number) => number> = {
  linear: (p) => p,
  'ease-in': (p) => p * p * p,
  'ease-out': (p) => 1 - (1 - p) ** 3,
  'ease-in-out': (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2),
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A duration the player can use: a finite positive number of ms, else one second. */
export const MIN_DURATION = 1000;
/** The longest scene: ten minutes. */
export const MAX_DURATION = 600_000;
export const MAX_KEYFRAMES = 500;
export const MAX_STAGE = 8192;
export function safeDuration(d: unknown): number {
  return typeof d === 'number' && Number.isFinite(d) && d > 0 ? Math.min(MAX_DURATION, d) : MIN_DURATION;
}

export const isEasing = (v: unknown): v is Easing => typeof v === 'string' && (EASINGS as readonly string[]).includes(v);
export const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * A scene read from storage or the wire, made safe to play and to export: a duration the player can use, an easing in
 * the list, a stage of at least 1 x 1, and ONLY the keyframes that are well formed (an object, a finite time of 0 or
 * more, a string target, an easing in the list if it has one). A bad numeric or string field is dropped from its keyframe.
 */
export function sanitizeScene<T extends { w: number; h: number; duration: number; keyframes: unknown }>(sc: T): T {
  const out = { ...sc } as T & { easing?: unknown; fps?: unknown; title?: unknown; keyframes: SceneKeyframe[] };
  out.duration = safeDuration(sc.duration);
  out.w = Math.min(MAX_STAGE, Math.max(1, finite(sc.w) ? sc.w : 1));
  out.h = Math.min(MAX_STAGE, Math.max(1, finite(sc.h) ? sc.h : 1));
  if (out.easing !== undefined && !isEasing(out.easing)) delete out.easing;
  if (out.fps !== undefined) {
    if (finite(out.fps) && out.fps > 0) out.fps = Math.min(120, Math.max(1, out.fps));
    else delete out.fps;
  }
  if (out.title !== undefined && typeof out.title !== 'string') delete out.title;
  /* At most MAX_KEYFRAMES, taken from the front: a scene is not a place to park an unbounded list. */
  const raw = Array.isArray(sc.keyframes) ? (sc.keyframes as unknown[]).slice(0, MAX_KEYFRAMES) : [];
  out.keyframes = raw.flatMap((k): SceneKeyframe[] => {
    if (typeof k !== 'object' || k === null) return [];
    const o = k as Record<string, unknown>;
    if (!finite(o.t) || o.t < 0 || typeof o.target !== 'string' || o.target === '') return [];
    if (o.easing !== undefined && !isEasing(o.easing)) return [];
    const kf: SceneKeyframe = { t: o.t, target: o.target };
    for (const p of ['x', 'y', 'scale', 'opacity'] as const) if (finite(o[p])) kf[p] = o[p] as number;
    for (const p of ['stroke', 'fill', 'text'] as const) if (typeof o[p] === 'string') kf[p] = o[p] as string;
    if (o.easing !== undefined) kf.easing = o.easing as Easing;
    return [kf];
  });
  return out;
}

type NumProp = 'x' | 'y' | 'scale' | 'opacity';

/** One numeric property of one target at time `t`; `base` is its value on the board (the implicit keyframe at 0). */
export function trackAt(spec: SceneSpec, target: string, prop: NumProp, time: number, base: number): number {
  const t = Math.max(0, time);
  const frames = spec.keyframes
    .filter((k) => k.target === target && typeof k[prop] === 'number')
    .sort((a, b) => a.t - b.t);
  if (frames.length === 0) return base;
  const pts: { t: number; v: number; easing: Easing }[] = [];
  if (frames[0]!.t > 0) pts.push({ t: 0, v: base, easing: 'linear' });
  for (const k of frames) pts.push({ t: k.t, v: k[prop] as number, easing: k.easing ?? spec.easing ?? DEFAULT_EASING });
  if (t <= pts[0]!.t) return pts[0]!.v;
  const last = pts[pts.length - 1]!;
  if (t >= last.t) return last.v;
  for (let i = 1; i < pts.length; i += 1) {
    const b = pts[i]!;
    if (t <= b.t) {
      const a = pts[i - 1]!;
      const span = b.t - a.t;
      const p = span <= 0 ? 1 : clamp01((t - a.t) / span);
      return a.v + (b.v - a.v) * EASE[b.easing](p);
    }
  }
  return last.v;
}

/** A stepped property (a colour name, a text): the value of the last keyframe at or before `t`, else undefined (the board's own). */
export function stepAt(spec: SceneSpec, target: string, prop: 'stroke' | 'fill' | 'text', time: number): string | undefined {
  const t = Math.max(0, time);
  let out: string | undefined;
  let at = -1;
  for (const k of spec.keyframes) {
    if (k.target !== target || typeof k[prop] !== 'string' || k.t > t || k.t < at) continue;
    out = k[prop];
    at = k.t;
  }
  return out;
}

export interface Pose {
  dx: number;
  dy: number;
  scale: number;
  opacity: number;
  /** The scale is about this point: the target's centre. */
  cx: number;
  cy: number;
  stroke?: string;
  fill?: string;
  text?: string;
}

/** The pose of every keyframed target at time `t`. Items the scene does not name are not in the map. */
export function scenePoses(items: readonly WbItem[], spec: SceneSpec, t: number): Map<string, Pose> {
  const targets = new Set(spec.keyframes.map((k) => k.target));
  const out = new Map<string, Pose>();
  for (const it of items) {
    if (!targets.has(it.id) || it.kind === 'scene') continue;
    const box = itemBox(it);
    if (!box) continue;
    const x = trackAt(spec, it.id, 'x', t, box.x);
    const y = trackAt(spec, it.id, 'y', t, box.y);
    const pose: Pose = {
      dx: x - box.x,
      dy: y - box.y,
      scale: trackAt(spec, it.id, 'scale', t, 1),
      opacity: clamp01(trackAt(spec, it.id, 'opacity', t, 1)),
      cx: box.x + box.w / 2,
      cy: box.y + box.h / 2,
    };
    const stroke = stepAt(spec, it.id, 'stroke', t);
    const fill = stepAt(spec, it.id, 'fill', t);
    const text = stepAt(spec, it.id, 'text', t);
    if (stroke !== undefined) pose.stroke = stroke;
    if (fill !== undefined) pose.fill = fill;
    if (text !== undefined) pose.text = text;
    out.set(it.id, pose);
  }
  return out;
}

/** The SVG transform for a pose (translate, then scale about the centre). */
export function poseTransform(p: Pose): string | undefined {
  if (p.dx === 0 && p.dy === 0 && p.scale === 1) return undefined;
  return `translate(${p.dx},${p.dy}) translate(${p.cx},${p.cy}) scale(${p.scale}) translate(${-p.cx},${-p.cy})`;
}

/** Insert or update the keyframe for (target, t): a drag at 1.5 s writes x and y there and leaves its other fields. */
export function upsertKeyframe(spec: SceneSpec, key: SceneKeyframe): SceneKeyframe[] {
  const at = spec.keyframes.findIndex((k) => k.target === key.target && Math.abs(k.t - key.t) < 1);
  if (at < 0) return [...spec.keyframes, key].sort((a, b) => a.t - b.t);
  return spec.keyframes.map((k, i) => (i === at ? { ...k, ...key, t: k.t } : k));
}

export const clampTime = (t: number, duration: number): number => {
  const d = safeDuration(duration);
  return Number.isFinite(t) ? Math.min(d, Math.max(0, t)) : 0;
};

export function formatTime(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}
