/*
 * A WORKFLOW LOOP, INLINE (B12): the loop's steps as a node diagram with the
 * loop-back edge, in the drawing card's chrome. Run and Open in Workflows go
 * through the paths the + menu already uses (the prefilled author form on the
 * Agents surface's Workflows tab), so there is no second way to start work.
 */
import { useId } from 'react';

import { setActivityLaunch } from '../activity/activityLaunch';
import { openWorkflows } from '../agents/agentsSection';
import { useStoreIfAny } from '../state/connect';
import { workflowInstruction, type WorkflowLoopSpec } from './workflowFence';
import { VisualCard } from './VisualCard';
import { CardAction } from './VisualActions';

const NW = 112;
const NH = 34;
const GAP = 34;

export function WorkflowLoopCard({ spec }: { spec: WorkflowLoopSpec }) {
  const arrowId = `wf-arrow-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const store = useStoreIfAny();
  const n = spec.steps.length;
  const vertical = n > 3;
  const pos = (i: number) => (vertical ? { x: 16, y: 16 + i * (NH + GAP) } : { x: 16 + i * (NW + GAP), y: 16 });
  const w = vertical ? 16 + NW + 260 : 16 + n * NW + (n - 1) * GAP + 16;
  const h = vertical ? 16 + n * NH + (n - 1) * GAP + 16 : 16 + NH + 70;
  const ids = spec.steps.map((s) => s.id);
  const from = spec.loop ? ids.indexOf(spec.loop.from) : -1;
  const to = spec.loop ? ids.indexOf(spec.loop.to) : -1;

  let loopPath = '';
  let loopLabel: { x: number; y: number; anchor: 'middle' | 'start' } | null = null;
  if (spec.loop) {
    const a = pos(from);
    const b = pos(to);
    if (vertical) {
      const x = 16 + NW;
      const y1 = a.y + NH / 2;
      const y2 = b.y + NH / 2;
      loopPath = `M ${x} ${y1} C ${x + 60} ${y1}, ${x + 60} ${y2}, ${x + 4} ${y2}`;
      loopLabel = { x: x + 48, y: (y1 + y2) / 2, anchor: 'start' };
    } else {
      const x1 = a.x + NW / 2;
      const x2 = b.x + NW / 2;
      const y = a.y + NH;
      loopPath = `M ${x1} ${y} C ${x1} ${y + 44}, ${x2} ${y + 44}, ${x2} ${y + 4}`;
      loopLabel = { x: (x1 + x2) / 2, y: y + 48, anchor: 'middle' };
    }
  }
  const loopText = spec.loop ? (spec.loop.until ? `until ${spec.loop.until}` : 'repeat') : '';

  const run = (): void => {
    if (!store) return;
    setActivityLaunch({ name: spec.name, instruction: workflowInstruction(spec) });
    openWorkflows(store);
  };
  const open = (): void => {
    if (store) openWorkflows(store);
  };

  return (
    <VisualCard
      kind="workflow"
      state="drawn"
      label="Workflow"
      source={`workflow:${spec.name}:${ids.join(',')}`}
      titleHint={spec.name}
      resizable
      scaled
      actions={
        store ? (
          <>
            <CardAction icon="play" testId="chat-workflow-run" tip="Run" onClick={run} />
            <CardAction icon="open" testId="chat-workflow-open" tip="Open in Workflows" onClick={open} />
          </>
        ) : null
      }
    >
      <div className="dgm-art" data-testid="chat-workflow-inline" data-layout={vertical ? 'vertical' : 'horizontal'}>
        <svg viewBox={`0 0 ${w} ${h}`} width={w} role="img" aria-label={`Workflow ${spec.name}: ${spec.steps.map((s) => s.label).join(', ')}`} style={{ maxWidth: '100%', height: 'auto' }}>
          <defs>
            <marker id={arrowId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 8 4 0 8z" fill="var(--ink-3)" />
            </marker>
          </defs>
          {spec.steps.map((s, i) => {
            const p = pos(i);
            const next = i < n - 1 ? pos(i + 1) : null;
            return (
              <g key={s.id} data-testid="chat-workflow-step">
                <rect x={p.x} y={p.y} width={NW} height={NH} rx={8} fill="var(--surface-1)" stroke="var(--edge-strong)" strokeWidth={1.2} />
                <text x={p.x + NW / 2} y={p.y + NH / 2 + 4} textAnchor="middle" fontSize={12} fill="var(--ink-1)" fontFamily="var(--font-sans)">
                  {s.label.length > 17 ? `${s.label.slice(0, 16)}…` : s.label}
                </text>
                {next ? (
                  <line
                    x1={vertical ? p.x + NW / 2 : p.x + NW}
                    y1={vertical ? p.y + NH : p.y + NH / 2}
                    x2={vertical ? next.x + NW / 2 : next.x - 2}
                    y2={vertical ? next.y - 2 : next.y + NH / 2}
                    stroke="var(--ink-3)"
                    strokeWidth={1.2}
                    markerEnd={`url(#${arrowId})`}
                  />
                ) : null}
              </g>
            );
          })}
          {spec.loop ? (
            <g data-testid="chat-workflow-loop">
              <path d={loopPath} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="4 3" markerEnd={`url(#${arrowId})`} />
              {loopLabel ? (
                <text x={loopLabel.x} y={loopLabel.y} textAnchor={loopLabel.anchor} fontSize={11} fill="var(--ink-2)" fontFamily="var(--font-sans)">
                  {loopText.length > 40 ? `${loopText.slice(0, 39)}…` : loopText}
                </text>
              ) : null}
            </g>
          ) : null}
        </svg>
      </div>
    </VisualCard>
  );
}

export default WorkflowLoopCard;
