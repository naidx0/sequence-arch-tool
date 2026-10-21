import { describe, expect, it } from 'vitest';
import type { PlanStep } from '@sequence/api-types';

import { MAX_PLAN_STEPS, MAX_PLAN_STEP_CHARS, addStep, editStep, nextStepId, removeStep } from './goalPlanEdit';

const plan = (...rows: Array<[string, PlanStep['status']]>): PlanStep[] =>
  rows.map(([text, status], i) => ({ id: `s${i + 1}`, text, status, ...(status === 'parked' ? { why: 'x' } : {}) }));

describe('goalPlanEdit', () => {
  it('adds an open step with an id nobody has', () => {
    const base = plan(['Read it', 'done'], ['Fix it', 'open']);
    expect(addStep(base, '  Test   it  ')).toEqual([...base, { id: 's3', text: 'Test it', status: 'open' }]);
    /* an id past a gap, never a reused one */
    expect(nextStepId([{ id: 's7', text: 'a', status: 'open' }])).toBe('s8');
    expect(nextStepId([{ id: 'x', text: 'a', status: 'open' }, { id: 's2', text: 'b', status: 'open' }])).toBe('s3');
  });

  it('refuses nothing-words and a plan at its limit, and cuts a long step at the server\'s length', () => {
    expect(addStep([], '   ')).toBeNull();
    const full = Array.from({ length: MAX_PLAN_STEPS }, (_, i) => ({ id: `s${i + 1}`, text: `step ${i}`, status: 'open' as const }));
    expect(addStep(full, 'one more')).toBeNull();
    expect(addStep([], 'x'.repeat(MAX_PLAN_STEP_CHARS + 50))![0]!.text).toHaveLength(MAX_PLAN_STEP_CHARS);
  });

  it('edits the words of an open step in place; a parked one comes back open without its reason; a done one is not rewritten', () => {
    const base = plan(['A', 'done'], ['B', 'open'], ['C', 'parked']);
    expect(editStep(base, 's2', 'B2')![1]).toEqual({ id: 's2', text: 'B2', status: 'open' });
    expect(editStep(base, 's3', 'C2')![2]).toEqual({ id: 's3', text: 'C2', status: 'open' });
    expect(editStep(base, 's1', 'A2')).toBeNull();
    expect(editStep(base, 's2', 'B')).toBeNull();
    expect(editStep(base, 's2', ' ')).toBeNull();
    expect(editStep(base, 'nope', 'x')).toBeNull();
  });

  it('removes a step by id, leaving the others and their ids alone', () => {
    const base = plan(['A', 'open'], ['B', 'open'], ['C', 'open']);
    expect(removeStep(base, 's2')!.map((s) => s.id)).toEqual(['s1', 's3']);
    expect(removeStep(base, 'nope')).toBeNull();
    expect(removeStep(plan(['A', 'open']), 's1')).toEqual([]);
  });
});
