/* ══════════════════════════════════════════════════════════════════════════
   THE CLI'S OWN PLAN, IN THE PLAN CARD (S2b)
   packages/web2/src/chat/cliPlan.tsx

   A local agent plans in its own words, and those words go into the same
   PlanApprovalCard Sequence's own Plan mode uses:
     codex      thread/goal/updated (this codex's plan: "Three-step plan:
                1) … 2) … 3) …"), carried as an ACP markdown plan_update
     Claude     ExitPlanMode, put to the person as a switch_mode permission
                request whose input carries the plan (markdown)
   Build means: switch the agent to Build (set_mode / codex's sandbox) and
   carry on in the same conversation. Keep planning leaves it in Plan.
   ══════════════════════════════════════════════════════════════════════════ */

import type { PlanStep } from '@sequence/api-types';

import { PlanApprovalCard } from '../v3/PlanApprovalCard';

/** The numbered or bulleted steps of a plan, in order; an inline "1) a, 2) b" too. */
export function planSteps(content: string): PlanStep[] {
  const lines = content.split(/\r?\n/);
  let steps = lines
    .map((l) => /^\s*(?:\d+[.)]|[-*])\s+(.+?)\s*$/.exec(l)?.[1])
    .filter((x): x is string => !!x);
  if (steps.length === 0) {
    /* One line with its steps inline: "Three-step plan: 1) inspect…, 2) add…, 3) create…". */
    const parts = content.split(/(?:^|[\s,;:])\d+\)\s+/).slice(1);
    steps = parts.map((p) => p.replace(/[,;]?\s*(?:and\s*)?$/, '').trim()).filter(Boolean);
  }
  return steps.map((text, i) => ({ id: `cli-${i + 1}`, text, status: 'open' as const }));
}

/** The plan's name: its first heading, or what comes before its inline steps. */
export function planName(content: string): string | null {
  const heading = /^\s*#+\s+(.+?)\s*$/m.exec(content)?.[1];
  if (heading) return heading;
  const lead = /^([^\n]*?):\s*1\)/.exec(content)?.[1];
  return lead ? lead.trim() : null;
}

export function CliPlanCard({
  content,
  busy = false,
  onBuild,
  onKeepPlanning,
}: {
  content: string;
  busy?: boolean;
  onBuild: () => void;
  onKeepPlanning: () => void;
}) {
  return (
    <div data-testid="agent-cli-plan">
      <PlanApprovalCard goalName={planName(content)} steps={planSteps(content)} hasDocument={false} busy={busy} onBuild={onBuild} onKeepPlanning={onKeepPlanning} />
    </div>
  );
}
