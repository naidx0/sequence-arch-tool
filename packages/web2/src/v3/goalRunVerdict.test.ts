import { describe, expect, it } from 'vitest';
import type { GoalRunState, PlanStep } from '@sequence/api-types';

import {
  goalPlanProgress,
  goalRunButton,
  goalRunLastLine,
  goalRunNowLine,
  goalRunRestLine,
  goalRunTone,
} from './goalRunVerdict';

/**
 * THE VERDICT MODULE — every branch, without rendering anything.
 *
 * That is the point of it existing. A stop rule inside a component can only be
 * checked by rendering the component, so the states nobody thought to render
 * are the states nobody checks — the run that ended while the tab was closed,
 * the mode switched mid-run, the plan with nothing left open.
 */

function plan(...rows: Array<[string, PlanStep['status'], string?]>): PlanStep[] {
  return rows.map(([text, status, why], i) => ({
    id: `s${i + 1}`,
    text,
    status,
    ...(why === undefined ? {} : { why }),
  }));
}

const idle: GoalRunState = { running: false, turns: 0, cap: 24 };
const live: GoalRunState = { running: true, turns: 3, cap: 24 };

describe('goalRunButton', () => {
  it('offers Work on goal when Build is on and a step is open', () => {
    const b = goalRunButton({ mode: 'build', plan: plan(['Read the parser', 'open']), run: idle });
    expect(b).toMatchObject({ label: 'Work on goal', disabled: false, action: 'start' });
    expect(b.title).toMatch(/Read the parser/);
  });

  it('disables in Plan mode and says to switch to Build — the one move that fixes it', () => {
    const b = goalRunButton({ mode: 'plan', plan: plan(['Read the parser', 'open']), run: idle });
    expect(b.disabled).toBe(true);
    expect(b.action).toBe('none');
    expect(b.title).toMatch(/Switch to Build/i);
  });

  it('disables in Teach mode too — a lesson is not a run', () => {
    expect(goalRunButton({ mode: 'teach', plan: plan(['Read it', 'open']), run: idle }).disabled).toBe(true);
  });

  it('a bare goal is workable: no plan yet enables the button and says the run will write one', () => {
    const b = goalRunButton({ mode: 'build', plan: [], run: idle });
    expect(b.disabled).toBe(false);
    expect(b.action).toBe('start');
    expect(b.title).toMatch(/no plan yet/i);
  });

  it('disables when every step is ticked or parked', () => {
    const b = goalRunButton({
      mode: 'build',
      plan: plan(['Read it', 'done'], ['Measure it', 'parked', 'no benchmark']),
      run: idle,
    });
    expect(b.disabled).toBe(true);
    expect(b.title).toMatch(/nothing for a run to work down/i);
  });

  it('every disabled state carries a reason — a greyed control with no why is a bug report', () => {
    for (const b of [
      goalRunButton({ mode: 'plan', plan: plan(['x', 'open']), run: idle }),
      goalRunButton({ mode: 'build', plan: plan(['x', 'done']), run: idle }),
    ]) {
      expect(b.disabled).toBe(true);
      expect(b.title.length).toBeGreaterThan(20);
    }
  });

  it('becomes Stop while running, and Stop is NEVER disabled by the mode control', () => {
    for (const mode of ['plan', 'build', 'teach'] as const) {
      const b = goalRunButton({ mode, plan: plan(['Read it', 'open']), run: live });
      expect(b).toMatchObject({ label: 'Stop', disabled: false, action: 'stop' });
    }
  });

  it('Stop says where the run is, so pressing it is an informed choice', () => {
    expect(goalRunButton({ mode: 'build', plan: plan(['x', 'open']), run: live }).title).toMatch(
      /turn 3 of 24/,
    );
  });
});

describe('goalRunLastLine', () => {
  it('is null for a session that has never run', () => {
    expect(goalRunLastLine(idle)).toBeNull();
  });

  it('is null WHILE a run is live — a previous verdict under a live bar reads as this one', () => {
    expect(
      goalRunLastLine({ ...live, lastStopReason: 'plan_worked_down', lastStopSentence: 'plan worked down · 3 done' }),
    ).toBeNull();
  });

  it('shows the SERVER\'s sentence, never one composed here', () => {
    const line = goalRunLastLine({
      ...idle,
      lastStopReason: 'plan_worked_down',
      lastStopSentence: 'plan worked down · 3 done, 1 parked',
    });
    expect(line).toEqual({ text: 'plan worked down · 3 done, 1 parked', tone: 'done' });
  });

  it('is null when the row has a reason but no sentence — it does not invent one', () => {
    expect(goalRunLastLine({ ...idle, lastStopReason: 'turn_cap' })).toBeNull();
  });
});

describe('goalRunRestLine — the second line when nothing is running', () => {
  /*
   * THE LINE THAT REPLACED A ROW. The `Last run: …` row under the plan is gone
   * (walk-4-white-glass-plan.md §2) and the plan list is closed by default, so
   * this one line is the whole of what a reader sees about a plan they have not
   * opened. Both of its shapes are locked to the character.
   */
  it('folds the outcome in, count first and the reason from the server last', () => {
    expect(
      goalRunRestLine(
        { ...idle, lastStopReason: 'stopped_by_hand', lastStopSentence: 'stopped by hand' },
        plan(['Add the guard', 'open']),
      ),
    ).toEqual({ text: 'Finished · 0 of 1 done · stopped by hand', tone: 'neutral' });
  });

  it('carries the tone, so the stylesheet never re-derives why it ended', () => {
    expect(
      goalRunRestLine(
        {
          ...idle,
          lastStopReason: 'the_model_only_narrated',
          lastStopSentence: '4 turns in a row announced a move and called no tool',
        },
        plan(['Add the guard', 'open']),
      )?.tone,
    ).toBe('failed');
  });

  it('names the step a run would START at when there is no outcome to fold', () => {
    expect(
      goalRunRestLine(idle, plan(['Read the parser', 'done'], ['Add the guard', 'open'])),
    ).toEqual({ text: '1 of 2 done · Next: Add the guard', tone: 'neutral' });
  });

  it('counts parked in the denominator, and says so, when nothing has run', () => {
    expect(
      goalRunRestLine(
        idle,
        plan(['Read the parser', 'done'], ['Add the guard', 'open'], ['Measure', 'parked', 'no script']),
      )?.text,
    ).toBe('1 of 3 done, 1 parked · Next: Add the guard');
  });

  it('is null WHILE a run is live — goalRunNowLine owns the line then', () => {
    expect(goalRunRestLine(live, plan(['Add the guard', 'open']))).toBeNull();
  });

  it('is null with no plan at all — a count of nothing is not a fact', () => {
    expect(goalRunRestLine(idle, [])).toBeNull();
  });
});

describe('goalRunTone', () => {
  it('separates "the plan was the problem" from "the model was"', () => {
    expect(goalRunTone('plan_worked_down')).toBe('done');
    for (const r of ['parked_more_than_it_did', 'nothing_could_be_worked', 'the_plan_could_not_be_worked'] as const) {
      expect(goalRunTone(r)).toBe('attention');
    }
    for (const r of ['provider_failed', 'the_model_stopped_answering', 'the_model_only_narrated', 'turn_failed'] as const) {
      expect(goalRunTone(r)).toBe('failed');
    }
    /* The audited endings (wave A4): a verdict, not a boundary — never neutral. */
    expect(goalRunTone('audited_pass')).toBe('done');
    expect(goalRunTone('audited_partial')).toBe('attention');
    expect(goalRunTone('audited_fail')).toBe('failed');
    for (const r of ['turn_cap', 'stopped_by_hand', 'engine_restarted'] as const) {
      expect(goalRunTone(r)).toBe('neutral');
    }
    expect(goalRunTone(undefined)).toBe('neutral');
  });
});

describe('goalPlanProgress', () => {
  it('counts a parked step in the total and not in the done', () => {
    const p = goalPlanProgress(
      plan(['a', 'done'], ['b', 'done'], ['c', 'done'], ['d', 'parked', 'no tool'], ['e', 'open']),
    );
    expect(p).toMatchObject({ done: 3, parked: 1, open: 1, total: 5, label: '3/5' });
    expect(p.fraction).toBeCloseTo(0.6);
  });

  it('an empty plan is 0/0 and not a divide by zero', () => {
    expect(goalPlanProgress([])).toMatchObject({ label: '0/0', fraction: 0 });
  });
});

describe('goalRunNowLine', () => {
  it('is null when nothing is running', () => {
    expect(goalRunNowLine(idle, plan(['x', 'open']))).toBeNull();
  });

  it('leads with the position IN THE PLAN, then the bare turn count', () => {
    expect(
      goalRunNowLine(
        live,
        plan(['Read it', 'done'], ['Add the guard', 'open'], ['Test it', 'open'], ['Land it', 'open']),
      ),
    ).toEqual({
      text: 'Working · step 2 of 4 · Add the guard · turn 4',
      title: 'stops by itself after 24 turns',
    });
  });

  it('NEVER prints the safety cap as a denominator — it reads as the plan length', () => {
    const line = goalRunNowLine(live, plan(['Read it', 'done'], ['Add the guard', 'open']))!;
    expect(line.text).toBe('Working · step 2 of 2 · Add the guard · turn 4');
    expect(line.text).not.toMatch(/of 24/);
    /* The ceiling is reachable, in the tooltip and only there. */
    expect(line.title).toBe('stops by itself after 24 turns');
  });

  it('says Planning, against the bound that IS real, while no plan exists', () => {
    expect(goalRunNowLine({ running: true, turns: 0, cap: 24 }, [])).toEqual({
      text: 'Planning · turn 1 of 3',
      title: 'stops by itself after 24 turns',
    });
    expect(goalRunNowLine({ running: true, turns: 2, cap: 24 }, [])!.text).toBe(
      'Planning · turn 3 of 3',
    );
  });

  it('still says where the run is when no step is open', () => {
    expect(goalRunNowLine(live, plan(['Read it', 'done']))).toEqual({
      text: 'Working · turn 4',
      title: 'stops by itself after 24 turns',
    });
  });
});
