/* ══════════════════════════════════════════════════════════════════════════
   A SCENE AS A REMOTION COMPOSITION, as text
   packages/web2/src/whiteboard/sceneRemotion.ts

   Split out of scene.ts: the keyframe maths (scene.ts) is on the boot path through the
   board model, this export text is not. Only exportScene.ts imports it, so it loads with
   the Space chunk instead of the entry chunk (~11 KB). See scene.ts for the model.
   ══════════════════════════════════════════════════════════════════════════ */

import { WB_COLOR_TOKEN } from './palette';
import { DEFAULT_EASING, DEFAULT_FPS, MAX_STAGE, finite, isEasing, safeDuration, sanitizeScene, type Easing, type SceneSpec } from './scene';
import type { WbItem } from './whiteboardModel';

/* ── export as a Remotion composition ──────────────────────────────────── */

/**
 * THE COLOURS OF AN EXPORT ARE THE READER'S OWN, READ WHEN THEY EXPORT. There is no theme inside a Remotion file, so
 * each palette name is resolved here from the live CSS variable the board draws it with (`WB_COLOR_TOKEN`), and the
 * file carries the resulting value. A name whose variable is not set draws as `currentColor` (a line, a word) or
 * `transparent` (a fill); no colour is written into this source.
 */
export type ColorResolver = (name: string) => string | undefined;

export function cssColorResolver(): ColorResolver {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return () => undefined;
  const cs = getComputedStyle(document.documentElement);
  return (name) => {
    const token = WB_COLOR_TOKEN[name as keyof typeof WB_COLOR_TOKEN];
    if (token === undefined) return undefined;
    if (token === 'transparent') return 'transparent';
    const raw = cs.getPropertyValue(token).trim();
    if (!raw) return undefined;
    /* A token that is itself a var() or color-mix() means nothing outside this page: let the browser compute it. */
    return /\b(var|color-mix)\(/.test(raw) ? computedColor(token) ?? undefined : raw;
  };
}

function computedColor(token: string): string | null {
  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).color.trim();
  probe.remove();
  return value && !/\b(var|color-mix)\(/.test(value) ? value : null;
}

const EXPORT_NAMES = [...Object.keys(WB_COLOR_TOKEN)];

/** The board's own ground, for the video's background: the `--board-ground` variable, else nothing (transparent). */
function resolveBackground(_resolve: ColorResolver): string | undefined {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return undefined;
  return getComputedStyle(document.documentElement).getPropertyValue('--board-ground').trim() || undefined;
}

/** JSON for embedding in source: the two line separators JSON leaves raw are escaped, so no string ends a line early. */
const lit = (v: unknown): string => JSON.stringify(v).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function ident(id: string): string {
  const s = id.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
  return /^[A-Za-z]/.test(s) ? s : `Scene${s}`;
}

/** A plain item for the export: only what the generated component draws. */
function plain(it: WbItem): Record<string, unknown> | null {
  switch (it.kind) {
    case 'shape':
      return {
        id: it.id,
        kind: it.shape,
        from: it.from,
        to: it.to,
        ...(it.points ? { points: it.points } : {}),
        ...(it.label ? { label: it.label } : {}),
        ...(it.stroke ?? it.color ? { stroke: it.stroke ?? it.color } : {}),
        ...(it.fill ? { fill: it.fill } : {}),
        ...(it.strokeWidth ? { strokeWidth: it.strokeWidth } : {}),
        ...(it.dash ? { dash: it.dash } : {}),
        ...(it.arrowEnd ? { arrowEnd: it.arrowEnd } : it.shape === 'arrow' ? { arrowEnd: 'arrow' } : {}),
        ...(it.arrowStart ? { arrowStart: it.arrowStart } : {}),
      };
    case 'text':
      return { id: it.id, kind: it.sticky ? 'sticky' : 'text', at: it.at, text: it.text, ...(it.color ? { stroke: it.color } : {}), ...(it.sticky ? { w: it.w ?? 180, h: it.h ?? 110 } : {}) };
    case 'stroke':
      return { id: it.id, kind: 'path', from: it.points[0], to: it.points[it.points.length - 1], points: it.points, ...(it.stroke ?? it.color ? { stroke: it.stroke ?? it.color } : {}) };
    default:
      return null;
  }
}

export interface ExportInput {
  scene: { id: string; at: { x: number; y: number }; w: number; h: number; title?: string } & SceneSpec;
  items: readonly WbItem[];
  /** How a palette name becomes a colour; the live CSS variables by default. */
  resolveColor?: ColorResolver;
}

/**
 * A SELF-CONTAINED REMOTION COMPOSITION, as text. It imports only `react` and `remotion`; the items and the keyframes
 * are data in the file; the component re-implements the same easing and the same "base is the keyframe at 0" rule
 * as `scenePoses`, with Remotion's `interpolate` and `Easing`. Drop it in a Remotion project and register
 * `RemotionRoot` (or just use `SceneComposition` and `sceneConfig`). Nothing here is rendered or installed.
 */
export function remotionSource({ scene, items, resolveColor }: ExportInput): string {
  const resolve = resolveColor ?? cssColorResolver();
  /* Strokes and words fall back to currentColor, fills to transparent. */
  const colors = Object.fromEntries(EXPORT_NAMES.map((n) => [n, resolve(n) ?? 'currentColor']));
  const fills = Object.fromEntries(EXPORT_NAMES.map((n) => [n, resolve(n) ?? 'transparent']));
  const ground = resolveBackground(resolve) ?? 'transparent';
  const fps = finite(scene.fps) && scene.fps > 0 ? Math.min(120, Math.max(1, scene.fps)) : DEFAULT_FPS;
  const duration = safeDuration(scene.duration);
  const easing: Easing = isEasing(scene.easing) ? scene.easing : DEFAULT_EASING;
  const width = Math.min(MAX_STAGE, Math.max(1, Math.round(finite(scene.w) ? scene.w : 1)));
  const height = Math.min(MAX_STAGE, Math.max(1, Math.round(finite(scene.h) ? scene.h : 1)));
  const frames = Math.max(1, Math.round((duration / 1000) * fps));
  const drawn = items.map(plain).filter((p): p is Record<string, unknown> => p !== null);
  /* A title that is not a string (a wire value) is no title. */
  const label = typeof scene.title === 'string' && scene.title !== '' ? scene.title : String(scene.id);
  const name = `${ident(label)}Composition`;
  const json = (v: unknown) => JSON.stringify(v, null, 2).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const keyframes = sanitizeScene({ w: width, h: height, duration, keyframes: scene.keyframes }).keyframes;
  const title = label.replace(/[\r\n\u2028\u2029*/]/g, ' ');
  const tokens = Object.fromEntries(EXPORT_NAMES.map((k) => [k, WB_COLOR_TOKEN[k as keyof typeof WB_COLOR_TOKEN] ?? k]));
  return `// Generated by Sequence from the scene "${title}". Self-contained: needs only react and remotion.
// Colours are palette names, resolved when this was exported from the theme in use (COLORS for lines and words, FILLS for fills).
import React from 'react';
import { AbsoluteFill, Composition, Easing, interpolate, useCurrentFrame } from 'remotion';

export const sceneConfig = {
  id: ${lit(ident(label))},
  fps: ${fps},
  durationInFrames: ${frames},
  width: ${width},
  height: ${height},
};

/** The stage's top-left on the Sequence board: every item is drawn relative to it. */
const ORIGIN = { x: ${finite(scene.at.x) ? scene.at.x : 0}, y: ${finite(scene.at.y) ? scene.at.y : 0} };

const COLORS: Record<string, string> = ${json(colors)};
const FILLS: Record<string, string> = ${json(fills)};
// token each name stands for in Sequence: ${lit(tokens).replace(/\*\//g, '* /')}

type Easing_ = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
type Keyframe = {
  t: number;
  target: string;
  x?: number;
  y?: number;
  scale?: number;
  opacity?: number;
  stroke?: string;
  fill?: string;
  text?: string;
  easing?: Easing_;
};
type Item = {
  id: string;
  kind: string;
  from?: { x: number; y: number };
  to?: { x: number; y: number };
  at?: { x: number; y: number };
  points?: { x: number; y: number }[];
  w?: number;
  h?: number;
  text?: string;
  label?: string;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  dash?: string;
  arrowEnd?: string;
  arrowStart?: string;
};

const DEFAULT_EASING: Easing_ = ${lit(easing)};
const EASINGS: Record<Easing_, (p: number) => number> = {
  linear: (p) => p,
  'ease-in': Easing.in(Easing.cubic),
  'ease-out': Easing.out(Easing.cubic),
  'ease-in-out': Easing.inOut(Easing.cubic),
};

const ITEMS: Item[] = ${json(drawn)};

const KEYFRAMES: Keyframe[] = ${json(keyframes)};

/** The box an item covers, for the position keyframes (which name a new top-left) and for scaling about the centre. */
function boxOf(it: Item): { x: number; y: number; w: number; h: number } {
  const pts = [it.from, it.to, it.at, ...(it.points ?? [])].filter((p): p is { x: number; y: number } => !!p);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: it.w ?? Math.max(...xs) - x, h: it.h ?? Math.max(...ys) - y };
}

/** One numeric property over time; the board's own value is the keyframe at 0. */
function track(target: string, prop: 'x' | 'y' | 'scale' | 'opacity', ms: number, base: number): number {
  const frames = KEYFRAMES.filter((k) => k.target === target && typeof k[prop] === 'number').sort((a, b) => a.t - b.t);
  if (frames.length === 0) return base;
  const pts = [...(frames[0].t > 0 ? [{ t: 0, v: base, e: 'linear' as Easing_ }] : []), ...frames.map((k) => ({ t: k.t, v: k[prop] as number, e: k.easing ?? DEFAULT_EASING }))];
  if (ms <= pts[0].t) return pts[0].v;
  for (let i = 1; i < pts.length; i += 1) {
    if (ms <= pts[i].t) {
      return interpolate(ms, [pts[i - 1].t, pts[i].t], [pts[i - 1].v, pts[i].v], {
        easing: EASINGS[pts[i].e],
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
    }
  }
  return pts[pts.length - 1].v;
}

function step(target: string, prop: 'stroke' | 'fill' | 'text', ms: number): string | undefined {
  let out: string | undefined;
  let at = -1;
  for (const k of KEYFRAMES) {
    if (k.target === target && typeof k[prop] === 'string' && k.t <= ms && k.t >= at) {
      out = k[prop];
      at = k.t;
    }
  }
  return out;
}

const paint = (name: string | undefined, table: Record<string, string>, fallback: string): string => (name ? (table[name] ?? name) : fallback);

function Mark({ it, ms }: { it: Item; ms: number }) {
  const box = boxOf(it);
  const dx = track(it.id, 'x', ms, box.x) - box.x;
  const dy = track(it.id, 'y', ms, box.y) - box.y;
  const scale = track(it.id, 'scale', ms, 1);
  const opacity = Math.min(1, Math.max(0, track(it.id, 'opacity', ms, 1)));
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const stroke = paint(step(it.id, 'stroke', ms) ?? it.stroke, COLORS, COLORS.ink);
  const fill = paint(step(it.id, 'fill', ms) ?? it.fill, FILLS, 'none');
  const text = step(it.id, 'text', ms) ?? it.text ?? it.label;
  const dash = it.dash === 'dashed' ? '6 4' : it.dash === 'dotted' ? '1.5 4' : undefined;
  const common = { stroke, fill, strokeWidth: it.strokeWidth ?? 2, strokeDasharray: dash };
  const x = box.x;
  const y = box.y;
  let body: React.ReactNode = null;
  if (it.kind === 'rect' || it.kind === 'frame' || it.kind === 'sticky') {
    body = <rect {...common} fill={it.kind === 'sticky' ? paint(step(it.id, 'fill', ms) ?? it.fill, FILLS, FILLS.surface) : fill} x={x} y={y} width={box.w} height={box.h} rx={8} />;
  } else if (it.kind === 'ellipse') {
    body = <ellipse {...common} cx={x + box.w / 2} cy={y + box.h / 2} rx={box.w / 2} ry={box.h / 2} />;
  } else if (it.kind === 'diamond') {
    body = <polygon {...common} points={\`\${x + box.w / 2},\${y} \${x + box.w},\${y + box.h / 2} \${x + box.w / 2},\${y + box.h} \${x},\${y + box.h / 2}\`} />;
  } else if (it.kind === 'path' || it.kind === 'line' || it.kind === 'arrow') {
    const pts = it.points && it.points.length > 1 ? it.points : [it.from!, it.to!];
    body = <polyline {...common} fill="none" points={pts.map((p) => \`\${p.x},\${p.y}\`).join(' ')} />;
  }
  const words = text && it.kind !== 'line' && it.kind !== 'arrow' && it.kind !== 'path' ? (
    <text x={it.kind === 'text' ? x : x + box.w / 2} y={it.kind === 'text' ? y + 14 : y + box.h / 2} textAnchor={it.kind === 'text' ? 'start' : 'middle'} dominantBaseline={it.kind === 'text' ? 'auto' : 'central'} fill={it.kind === 'text' ? stroke : COLORS.ink} fontFamily="sans-serif" fontSize={14}>
      {text}
    </text>
  ) : null;
  return (
    <g opacity={opacity} transform={\`translate(\${dx},\${dy}) translate(\${cx},\${cy}) scale(\${scale}) translate(\${-cx},\${-cy})\`}>
      {body}
      {words}
    </g>
  );
}

export const ${name}: React.FC = () => {
  const frame = useCurrentFrame();
  const ms = (frame / sceneConfig.fps) * 1000;
  return (
    <AbsoluteFill style={{ backgroundColor: ${lit(ground)} }}>
      <svg width={sceneConfig.width} height={sceneConfig.height} viewBox={\`\${ORIGIN.x} \${ORIGIN.y} \${sceneConfig.width} \${sceneConfig.height}\`}>
        {ITEMS.map((it) => (
          <Mark key={it.id} it={it} ms={ms} />
        ))}
      </svg>
    </AbsoluteFill>
  );
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id={sceneConfig.id}
    component={${name}}
    durationInFrames={sceneConfig.durationInFrames}
    fps={sceneConfig.fps}
    width={sceneConfig.width}
    height={sceneConfig.height}
  />
);
`;
}
