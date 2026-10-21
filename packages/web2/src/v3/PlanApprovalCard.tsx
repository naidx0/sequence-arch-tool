/**
 * ══ PLAN READY — ONE APPROVAL FLIPS IT INTO BUILD ═══════════════════════════
 *
 * Owner, 2026-09-22: "like cursor we can split modes harder, plan mode is more
 * thinking, reasoning, a bit of exploration and reading, the second a plan is
 * made and prepared in md, with a diagram example … then there is an approval
 * card to flip the model into build mode to put the plan in play, that plan
 * is the source of truth for the build mode as well … the goal is ready, to do
 * is ready, plan is ready, approval card pops up, and you can approve and
 * build the full thing without looking at anything except the actual plan."
 *
 * The run behind the button already existed — "Work on goal" works the plan's
 * steps down in Build, one turn per step — and the approved plan document now
 * rides into every one of those turns (goalPlan.ts, THE PLAN DOCUMENT). What
 * was missing was the moment: a Plan turn wrote a plan and nothing offered to
 * build it. This card is that moment, and its one button is the same act
 * `/goal` performs — switch to Build, start the run.
 */
import type { PlanStep } from '@sequence/api-types';

import { Icon } from '../chat/Icon';
import '../chat/editApprovalCard.css';

/** Steps shown before "+N more" — the whole plan is on the Plan tab. */
const SHOWN_STEPS = 6;

export interface PlanApprovalCardProps {
  goalName: string | null;
  steps: readonly PlanStep[];
  /** A plan document landed on the Plan tab this turn. */
  hasDocument: boolean;
  busy?: boolean;
  onBuild: () => void;
  onKeepPlanning: () => void;
  onOpenPlan?: () => void;
}

export function PlanApprovalCard({
  goalName,
  steps,
  hasDocument,
  busy = false,
  onBuild,
  onKeepPlanning,
  onOpenPlan,
}: PlanApprovalCardProps) {
  const open = steps.filter((s) => s.status === 'open');
  const shown = open.slice(0, SHOWN_STEPS);
  const more = open.length - shown.length;
  return (
    <section className="editapproval planready" role="region" aria-label="Plan ready" data-testid="v3-plan-ready">
      <header className="editapproval-hd">
        <Icon name="spark" size={14} />
        <h3 className="editapproval-title">Plan ready{goalName ? ` — ${goalName}` : ''}</h3>
        <span className="editapproval-count">
          {open.length} step{open.length === 1 ? '' : 's'}
        </span>
      </header>
      <ol className="planready-steps">
        {shown.map((s) => (
          <li key={s.id}>{s.text}</li>
        ))}
      </ol>
      {more > 0 ? <p className="editapproval-why">and {more} more</p> : null}
      <p className="editapproval-why">
        Build works these steps in order, one turn each, from the plan
        {hasDocument ? ' on the Plan tab' : ''}. You can stop it at any time.
      </p>
      <div className="editapproval-acts">
        <button
          type="button"
          className="editapproval-act editapproval-act-accept"
          data-testid="v3-plan-build"
          disabled={busy || open.length === 0}
          onClick={onBuild}
        >
          Build it
        </button>
        {hasDocument && onOpenPlan ? (
          <button type="button" className="editapproval-act" data-testid="v3-plan-open" onClick={onOpenPlan}>
            Open the plan
          </button>
        ) : null}
        <button type="button" className="editapproval-act" data-testid="v3-plan-keep" onClick={onKeepPlanning}>
          Keep planning
        </button>
      </div>
    </section>
  );
}
