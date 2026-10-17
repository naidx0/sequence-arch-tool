/* ══════════════════════════════════════════════════════════════════════════
   A SCENE, SMALL: the inline preview
   packages/web2/src/whiteboard/SceneStage.tsx

   The chat card for a drawing (BoardTurnCard) shows a scene as a small stage that plays on a loop, with Play/Pause and
   "Open on surface". It draws the same poses the board does (`scenePoses`), with a light renderer of its own: this is
   a preview, the Space is where it is edited. With `prefers-reduced-motion` it shows the FIRST frame and a Play button,
   and moves only when the reader presses Play.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useRef, useState } from 'react';

import { hostedSvg } from './svgItem';
import { asWbColor, asWbFill, WB_COLOR_TOKEN } from './palette';
import { poseTransform, safeDuration, scenePoses, type Pose } from './scene';
import type { WbItem, WbScene } from './whiteboardModel';

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const tokenOf = (name: string | undefined, fill: boolean): string | undefined => {
  const n = fill ? asWbFill(name) : asWbColor(name);
  if (!n) return undefined;
  return n === 'none' ? 'transparent' : `var(${WB_COLOR_TOKEN[n]})`;
};

/** One item, drawn plainly in stage coordinates. */
function Mark({ item, pose }: { item: WbItem; pose: Pose | undefined }) {
  const stroke = tokenOf(pose?.stroke ?? (item.kind === 'text' ? item.color : (item.kind === 'shape' || item.kind === 'stroke') ? (item.stroke ?? item.color) : undefined), false) ?? 'var(--ink-1)';
  const fill = tokenOf(pose?.fill ?? (item.kind === 'shape' ? item.fill : undefined), true) ?? 'none';
  const style = { stroke, fill, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let body: React.ReactNode = null;
  if (item.kind === 'shape') {
    const xs = [item.from.x, item.to.x, ...(item.points ?? []).map((p) => p.x)];
    const ys = [item.from.y, item.to.y, ...(item.points ?? []).map((p) => p.y)];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(...xs) - x;
    const h = Math.max(...ys) - y;
    const label = pose?.text ?? item.label;
    const words = label ? (
      <text x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="central" style={{ fill: 'var(--ink-1)', fontSize: 'var(--t-13)', stroke: 'none' }}>
        {label}
      </text>
    ) : null;
    if (item.shape === 'ellipse') body = <><ellipse style={style} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} />{words}</>;
    else if (item.shape === 'diamond') body = <><polygon style={style} points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`} />{words}</>;
    else if (item.shape === 'line' || item.shape === 'arrow' || item.shape === 'path') {
      const pts = item.shape === 'path' && item.points && item.points.length > 1 ? item.points : [item.from, item.to];
      body = <polyline style={{ ...style, fill: 'none' }} points={pts.map((p) => `${p.x},${p.y}`).join(' ')} />;
    } else body = <><rect style={style} x={x} y={y} width={w} height={h} rx={item.shape === 'frame' ? 10 : 8} />{words}</>;
  } else if (item.kind === 'text') {
    const text = pose?.text ?? item.text;
    body = item.sticky ? (
      <>
        <rect style={{ ...style, fill: 'var(--surface-2)' }} x={item.at.x} y={item.at.y} width={item.w ?? 180} height={item.h ?? 110} rx={10} />
        <text x={item.at.x + 12} y={item.at.y + 22} style={{ fill: 'var(--ink-1)', fontSize: 'var(--t-13)' }}>{text}</text>
      </>
    ) : (
      <text x={item.at.x} y={item.at.y} style={{ fill: stroke, fontSize: 'var(--t-14)' }}>{text}</text>
    );
  } else if (item.kind === 'stroke') {
    body = <polyline style={{ ...style, fill: 'none' }} points={item.points.map((p) => `${p.x},${p.y}`).join(' ')} />;
  } else if (item.kind === 'svg') {
    const drawn = hostedSvg(item.svg ?? item.markup ?? '', item.at, { w: item.w, h: item.h });
    body = drawn.ok ? <g style={{ color: 'var(--ink-1)' }} dangerouslySetInnerHTML={{ __html: drawn.html }} /> : null;
  }
  const transform = pose ? poseTransform(pose) : undefined;
  return (
    <g transform={transform} opacity={pose && pose.opacity < 1 ? pose.opacity : undefined} data-mark={item.id}>
      {body}
    </g>
  );
}

/** The stage at one moment: the board's items inside the scene's frame, posed by its keyframes. */
export function SceneFrame({ scene, items, t }: { scene: WbScene; items: readonly WbItem[]; t: number }) {
  const real = useMemo(() => items.filter((i) => i.kind !== 'scene' && i.kind !== 'artifact'), [items]);
  const poses = useMemo(() => scenePoses(real, scene, t), [real, scene, t]);
  return (
    <svg
      viewBox={`${scene.at.x} ${scene.at.y} ${scene.w} ${scene.h}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={scene.title ?? 'Scene'}
      data-testid="scene-preview-stage"
      style={{ display: 'block', background: 'var(--board-ground)', borderRadius: 10 }}
    >
      {real.map((it) => (
        <Mark key={it.id} item={it} pose={poses.get(it.id)} />
      ))}
    </svg>
  );
}

/**
 * The chat card's scene: plays on a loop, Pause/Play, Open on surface. `onOpen` takes the reader to the Space.
 * Reduced motion: the first frame, paused, with Play.
 */
export function SceneInlinePreview({ scene, items, onOpen }: { scene: WbScene; items: readonly WbItem[]; onOpen?: () => void }) {
  const [reduced] = useState(prefersReducedMotion);
  const [playing, setPlaying] = useState(!reduced);
  const [t, setT] = useState(0);
  const clock = useRef(0);
  useEffect(() => {
    if (!playing || typeof requestAnimationFrame !== 'function') return undefined;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      clock.current = (clock.current + (now - last)) % safeDuration(scene.duration);
      last = now;
      setT(clock.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, scene.duration]);
  return (
    <div className="scene-preview" data-testid="scene-preview" data-playing={playing ? 'true' : 'false'} data-reduced={reduced ? 'true' : 'false'} data-t={Math.round(t)}>
      <SceneFrame scene={scene} items={items} t={t} />
      <div className="scene-preview-bar" style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" className="s2-chipbtn" data-testid="scene-preview-toggle" aria-pressed={playing} onClick={() => setPlaying((p) => !p)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        {onOpen ? (
          <button type="button" className="s2-chipbtn" data-testid="scene-preview-open" onClick={onOpen}>
            Open on surface
          </button>
        ) : null}
      </div>
    </div>
  );
}
