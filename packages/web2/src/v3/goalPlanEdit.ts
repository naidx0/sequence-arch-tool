/**
 * WRITING THE GOAL'S PLAN BY HAND — pure.
 *
 * The goal runner can end `no_plan_written` and its sentence points at the plan list; the server already stores a plan
 * (`PUT /api/sessions/:id { plan }`) and the list could only Unpark. These three moves are the whole editor: add a step,
 * change a step's words, remove a step. Each returns the NEW plan (or null when it would change nothing or break a limit),
 * and the caller saves it through the one write the Unpark button already uses.
 *
 * The limits are the server's (`goalPlan.ts`: MAX_PLAN_STEPS, MAX_PLAN_STEP_CHARS), mirrored because web2 does not import
 * the analyzer. An edit past them would be refused by the server with a message nobody reads; stopping it here keeps the
 * input honest.
 */
import type { PlanStep } from '@sequence/api-types';

export const MAX_PLAN_STEPS = 40;
export const MAX_PLAN_STEP_CHARS = 300;

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, MAX_PLAN_STEP_CHARS);

/** A step id no step in the plan has: `s<n>` one past the largest `s<n>` there. */
export function nextStepId(plan: readonly PlanStep[]): string {
  let max = 0;
  for (const s of plan) {
    const m = /^s(\d+)$/.exec(s.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let n = Math.max(max, plan.length) + 1;
  while (plan.some((s) => s.id === `s${n}`)) n += 1;
  return `s${n}`;
}

export function addStep(plan: readonly PlanStep[], text: string): PlanStep[] | null {
  const t = clean(text);
  if (t === '' || plan.length >= MAX_PLAN_STEPS) return null;
  return [...plan, { id: nextStepId(plan), text: t, status: 'open' }];
}

/** New words for a step. A done step is a claim already made and is not rewritten; a parked step comes back open (its reason described the old words). */
export function editStep(plan: readonly PlanStep[], id: string, text: string): PlanStep[] | null {
  const t = clean(text);
  const at = plan.find((s) => s.id === id);
  if (!at || t === '' || at.status === 'done' || t === at.text) return null;
  return plan.map((s) => (s.id === id ? { id: s.id, text: t, status: 'open' as const } : s));
}

export function removeStep(plan: readonly PlanStep[], id: string): PlanStep[] | null {
  if (!plan.some((s) => s.id === id)) return null;
  return plan.filter((s) => s.id !== id);
}
