/*
 * A BOARD DRAWING THE TURN MADE, AS A LITTLE DIAGRAM IN THE CHAT. The board stays
 * the source of truth: this is a read-only sketch of the marks the turn added
 * (boxes, arrows, labels), drawn in the app's tokens, and Open goes to the board.
 */
import { useId, useMemo } from 'react';

import { SceneInlinePreview } from '../whiteboard/SceneStage';
import { sanitizeScene } from '../whiteboard/scene';
import type { WbItem, WbScene } from '../whiteboard/whiteboardModel';
import { VisualCard } from './VisualCard';
import { CardAction } from './VisualActions';

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boundsOf(items: readonly WbItem[]): Box {
  const b: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number): void => {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x);
    b.maxY = Math.max(b.maxY, y);
  };
  for (const it of items) {
    if (it.kind === 'shape') {
      add(it.from.x, it.from.y);
      add(it.to.x, it.to.y);
    } else if (it.kind === 'stroke') it.points.forEach((p) => add(p.x, p.y));
    else if (it.kind === 'text') {
      add(it.at.x, it.at.y);
      add(it.at.x + (it.w ?? it.text.length * 7), it.at.y + (it.h ?? 18));
    } else if (it.kind === 'noderef') {
      add(it.at.x, it.at.y);
      add(it.at.x + it.label.length * 7 + 20, it.at.y + 28);
    } else if (it.kind === 'svg' || it.kind === 'scene' || it.kind === 'video') {
      add(it.at.x, it.at.y);
      add(it.at.x + it.w, it.at.y + it.h);
    } else {
      add(it.at.x, it.at.y);
      add(it.at.x + it.size.w, it.at.y + it.size.h);
    }
  }
  if (!Number.isFinite(b.minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 60 };
  return b;
}

export function BoardTurnCard({ items, onOpen }: { items: readonly WbItem[]; onOpen?: () => void }) {
  const view = useMemo(() => {
    const b = boundsOf(items);
    const pad = 16;
    return { x: b.minX - pad, y: b.minY - pad, w: Math.max(40, b.maxX - b.minX + pad * 2), h: Math.max(40, b.maxY - b.minY + pad * 2) };
  }, [items]);
  const head = `bt-head-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const marks = items.filter((i) => i.kind !== 'artifact');
  /* A SCENE the turn made plays here, small, on a loop: the card shows the scene, not its still marks. */
  const rawScene = items.find((i): i is WbScene => i.kind === 'scene');
  /* The card is a boundary: a scene off the wire is made safe before anything draws it (a null keyframe must not take the transcript down). */
  const scene = rawScene ? sanitizeScene(rawScene) : undefined;
  if (scene) {
    return (
      <VisualCard
        kind="board"
        state="drawn"
        label="Scene"
        source={`board:${items.map((i) => i.id).join(',')}`}
        resizable
        scaled
        /* ONE Open on surface: the preview's own button (a second one on the card was a duplicate). */
        actions={null}
      >
        <div className="dgm-art" data-testid="chat-board-inline" data-scene="true">
          <SceneInlinePreview scene={scene} items={items} {...(onOpen ? { onOpen } : {})} />
        </div>
      </VisualCard>
    );
  }
  return (
    <VisualCard
      kind="board"
      state="drawn"
      label="Board drawing"
      source={`board:${items.map((i) => i.id).join(',')}`}
      resizable
      scaled
      actions={onOpen ? <CardAction icon="open" testId="chat-board-open" tip="Open on surface" onClick={onOpen} /> : null}
    >
      <div className="dgm-art" data-testid="chat-board-inline">
        <svg viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} role="img" aria-label={`A board drawing of ${marks.length} marks`} style={{ fontFamily: 'var(--font-sans)' }}>
          <defs>
            <marker id={head} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L8 4L0 8z" style={{ fill: 'var(--ink-2)' }} />
            </marker>
          </defs>
          {marks.map((it) => {
            if (it.kind === 'shape') {
              const x = Math.min(it.from.x, it.to.x);
              const y = Math.min(it.from.y, it.to.y);
              const w = Math.abs(it.to.x - it.from.x);
              const h = Math.abs(it.to.y - it.from.y);
              const box = { fill: 'var(--surface-1)', stroke: 'var(--edge-strong)', strokeWidth: 1.5 } as const;
              const label = it.label ? (
                <text x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="central" fontSize={13} style={{ fill: 'var(--ink-1)' }}>
                  {it.label}
                </text>
              ) : null;
              if (it.shape === 'rect')
                return (
                  <g key={it.id}>
                    <rect x={x} y={y} width={w} height={h} rx={8} style={box} />
                    {label}
                  </g>
                );
              if (it.shape === 'ellipse')
                return (
                  <g key={it.id}>
                    <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} style={box} />
                    {label}
                  </g>
                );
              if (it.shape === 'diamond')
                return (
                  <g key={it.id}>
                    <polygon points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`} style={box} />
                    {label}
                  </g>
                );
              return <line key={it.id} x1={it.from.x} y1={it.from.y} x2={it.to.x} y2={it.to.y} markerEnd={it.shape === 'arrow' ? `url(#${head})` : undefined} style={{ stroke: 'var(--ink-2)', strokeWidth: 1.5 }} />;
            }
            if (it.kind === 'stroke')
              return <polyline key={it.id} points={it.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" style={{ stroke: 'var(--ink-2)', strokeWidth: Math.max(1, it.width) }} />;
            if (it.kind === 'text')
              return (
                <text key={it.id} x={it.at.x} y={it.at.y + 14} fontSize={13} style={{ fill: 'var(--ink-1)' }}>
                  {it.text}
                </text>
              );
            if (it.kind === 'svg' || it.kind === 'video') return <rect key={it.id} x={it.at.x} y={it.at.y} width={it.w} height={it.h} rx={8} fill="none" style={{ stroke: 'var(--edge-strong)', strokeDasharray: '4 3' }} />;
            if (it.kind === 'scene' || it.kind !== 'noderef') return null;
            return (
              <g key={it.id}>
                <rect x={it.at.x} y={it.at.y} width={it.label.length * 7 + 20} height={28} rx={8} style={{ fill: 'var(--surface-2)', stroke: 'var(--edge-strong)', strokeWidth: 1 }} />
                <text x={it.at.x + 10} y={it.at.y + 18} fontSize={13} style={{ fill: 'var(--ink-1)' }}>
                  {it.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </VisualCard>
  );
}

export default BoardTurnCard;
