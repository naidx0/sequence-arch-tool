/* The run's program as a graph (round 12): steps top to bottom, a loop's body kept in one column with its exit beside it,
   the return drawn as an arc down the left side around a tinted region, each step carrying the state the run's log gave it. */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { NodeStatus, Program } from '@sequence/schema';

import { NODE_STATES } from './activityModel';
import { GRAPH_COL_KIND, GRAPH_LOOP_LANE, GRAPH_NODE_H, GRAPH_PAD, layoutWorkflow, type GraphEdge, type GraphNode } from './workflowLayout';

const DEFAULT_WIDTH = 400;

/* Down from the foot of a step into the top of the next (an S-curve when they sit in different columns). */
function forwardPath(a: GraphNode, b: GraphNode): string {
  /* whole pixels, so a straight run (the 2px rule) fills two pixel columns instead of smearing over three */
  const x1 = Math.round(a.x + a.w / 2);
  const y1 = a.y + GRAPH_NODE_H;
  const x2 = Math.round(b.x + b.w / 2);
  const y2 = b.y;
  const mid = (y1 + y2) / 2;
  return `M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`;
}

/* Out of the left side of the step that returns, along the lane, back into the left side of the loop. */
function backPath(a: GraphNode, b: GraphNode, laneX: number): string {
  const y1 = a.y + GRAPH_NODE_H / 2;
  const y2 = b.y + GRAPH_NODE_H / 2;
  const r = 6;
  const dir = y2 < y1 ? -1 : 1;
  return `M${a.x} ${y1} H${laneX + r} Q${laneX} ${y1} ${laneX} ${y1 + dir * r} V${y2 - dir * r} Q${laneX} ${y2} ${laneX + r} ${y2} H${b.x - 1}`;
}

export function WorkflowGraph({ program, nodeStates }: { program: Pick<Program, 'nodes' | 'edges'>; nodeStates: Readonly<Record<string, NodeStatus>> }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    const read = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth(w);
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const g = useMemo(() => layoutWorkflow(program, { width }), [program, width]);
  const uid = useId().replace(/:/g, '');
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const originX = GRAPH_PAD + g.loops * GRAPH_LOOP_LANE;
  const laneX = (e: GraphEdge) => originX - 8 - e.lane * GRAPH_LOOP_LANE;
  return (
    <div className="ac-graph-scroll" data-testid="activity-graph-scroll" ref={host}>
      {g.nodes.length === 0 ? null : (
        <div className="ac-graph" data-testid="activity-graph" data-loops={g.loops} data-cols={g.cols} style={{ width: g.width, height: g.height }} role="group" aria-label={`Workflow graph, ${g.nodes.length} steps${g.loops ? `, ${g.loops} ${g.loops === 1 ? 'loop' : 'loops'}` : ''}`}>
          <svg className="ac-graph-edges" width={g.width} height={g.height} aria-hidden="true" focusable="false">
            <defs>
              <marker id={`${uid}-a`} viewBox="0 0 14 14" refX="12" refY="7" markerWidth="14" markerHeight="14" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                <path d="M2 2 12 7 2 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </marker>
            </defs>
            {g.regions.map((r) => (
              <rect key={r.edgeId} className="ac-region" data-testid="activity-graph-region" data-nodes={r.nodeIds.join(' ')} x={r.x} y={r.y} width={r.w} height={r.h} rx="10" />
            ))}
            {g.edges.map((e) => {
              const a = byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              if (!e.back) {
                return (
                  <g key={e.id} className="ac-edge" data-testid="activity-graph-edge" data-edge-kind={e.kind}>
                    <path d={forwardPath(a, b)} markerEnd={`url(#${uid}-a)`} />
                  </g>
                );
              }
              const lx = laneX(e);
              const cap = b.cap ?? a.cap;
              const word = e.label ?? (cap !== null ? `repeat, up to ${cap}` : 'repeat');
              const my = (a.y + b.y) / 2 + GRAPH_NODE_H / 2;
              return (
                <g key={e.id} className="ac-edge ac-edge-loop" data-testid="activity-graph-loop" data-edge-id={e.id}>
                  <path d={backPath(a, b, lx)} markerEnd={`url(#${uid}-a)`} />
                  <text className="ac-edge-word" transform={`rotate(-90 ${lx - 5} ${my})`} x={lx - 5} y={my} textAnchor="middle">{word}</text>
                </g>
              );
            })}
          </svg>
          {g.nodes.map((n) => {
            const status = nodeStates[n.id];
            const tone = status === undefined ? 'neutral' : NODE_STATES[status].tone;
            return (
              <div
                key={n.id}
                className="ac-gnode"
                data-testid="activity-graph-node"
                data-node-id={n.id}
                data-node-status={status ?? 'none'}
                data-tone={tone}
                data-kind={n.kind}
                data-narrow={n.w < GRAPH_COL_KIND ? 'true' : undefined}
                style={{ left: n.x, top: n.y, width: n.w, height: GRAPH_NODE_H }}
                title={`${n.title} (${n.kind}): ${status === undefined ? 'no event in the log' : NODE_STATES[status].word}`}
              >
                <span className="ac-dot" aria-hidden="true" />
                <span className="ac-gnode-t">{n.title}</span>
                {n.w >= GRAPH_COL_KIND ? <span className="ac-gnode-k mono">{n.kind}</span> : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
