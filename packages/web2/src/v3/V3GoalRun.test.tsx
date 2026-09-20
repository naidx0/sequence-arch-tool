import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoalRunState, PlanStep } from '@sequence/api-types';

import { createStore, StoreProvider, type Store } from '../state';
import type { SessionsClient, WireResult } from '../sessions/sessionsClient';
import { V3Chat } from './V3Chat';

/**
 * THE GOALBAR AS A DASHBOARD — rendered, against a fake sessions client.
 *
 * `goalRunVerdict.test.ts` covers the RULES with no DOM at all; this covers the
 * wiring those rules reach through — that the plan is drawn, that the button
 * calls the route it claims to, that a parked step shows its reason and can be
 * unparked, that the last run's verdict appears.
 *
 * NEW FILE, not an addition to `V3App.test.tsx`: that file's goalbar tests
 * describe the bar BEFORE it had a plan (the per-turn `update_todos` list, the
 * dismiss, the focus form), and they must keep passing unchanged. A session
 * with no plan still behaves exactly as it did, and mixing the two sets would
 * make the next reader guess which era a failure belongs to.
 */

const IDLE: GoalRunState = { running: false, turns: 0, cap: 24 };

function ok<T>(body: T): Promise<WireResult<T>> {
  return Promise.resolve({ outcome: 'ok', body });
}

interface FakeArgs {
  goal?: string;
  plan?: PlanStep[];
  run?: GoalRunState;
}

interface Fake {
  client: SessionsClient;
  started: Array<{ id: string; body: unknown }>;
  stopped: string[];
  updated: Array<{ id: string; patch: unknown }>;
  /** Swap what the next poll answers, the way a live run would. */
  setRun: (next: GoalRunState) => void;
  setPlan: (next: PlanStep[]) => void;
}

function fakeClient(args: FakeArgs = {}): Fake {
  let run = args.run ?? IDLE;
  let plan = args.plan ?? [];
  const f: Fake = {
    started: [],
    stopped: [],
    updated: [],
    setRun: (next) => {
      run = next;
    },
    setPlan: (next) => {
      plan = next;
    },
    client: {
      list: () => ok({ index: { version: 1, activeId: '', sessions: [] } }),
      create: () => ok({}),
      fork: () => ok({}),
      activate: () => ok({}),
      readSession: () =>
        ok({
          chat: { version: 1, sessionId: 's1', turns: [] },
          meta: {},
          ...(args.goal === undefined ? {} : { goal: args.goal }),
          plan,
        }),
      readChat: () => ok({}),
      writeChat: () => ok({}),
      writeBoardSeqd: () => ok({}),
      update: (id, patch) => {
        f.updated.push({ id, patch });
        if ((patch as { plan?: PlanStep[] }).plan) plan = (patch as { plan: PlanStep[] }).plan;
        return ok({ ok: true, index: { version: 1, activeId: id, sessions: [] } });
      },
      readGoalRun: () => ok(run),
      startGoalRun: (id, body) => {
        f.started.push({ id, body });
        run = { running: true, turns: 0, cap: 24 };
        return ok({ ok: true, state: run });
      },
      stopGoalRun: (id) => {
        f.stopped.push(id);
        run = { ...run, running: false, lastStopReason: 'stopped_by_hand', lastStopSentence: 'stopped by hand after 2 turns' };
        return ok({ ok: true, state: run });
      },
      remove: () => ok({}),
    } as unknown as SessionsClient,
  };
  return f;
}

function storeWith(opts: { title?: string; mode?: 'plan' | 'build' } = {}): Store {
  const store = createStore({});
  store.dispatch({
    type: 'session/index',
    sessions: [{ id: 's1', title: opts.title ?? 'Ship the goal run', pinned: false, updatedAt: '2026-01-01' }],
    activeId: 's1',
  } as never);
  /* Build is GATED until Settings enables it (`composer/permission-enabled`),
     so a bare `composer/permission` dispatch is a no-op and the bar would test
     Plan while claiming to test Build. Enable it first, exactly as the app does. */
  store.dispatch({ type: 'composer/permission-enabled', enabled: ['plan', 'build'] } as never);
  store.dispatch({ type: 'composer/permission', mode: opts.mode ?? 'build' } as never);
  return store;
}

function draw(store: Store, fake: Fake): void {
  render(
    <StoreProvider store={store}>
      <div className="v3-chat-col">
        <V3Chat goalRunClient={fake.client} />
      </div>
    </StoreProvider>,
  );
}

/**
 * THE PLAN LIST IS CLOSED UNTIL SOMEBODY OPENS IT (walk-4-white-glass-plan.md
 * §2), so every test that reads a STEP has to say so — which is the point. The
 * owner's narrow-window screenshot had the bar, the list and a `Last run:` row
 * stacked over the composer; the list is a thing you open while you are working
 * the plan, not a thing that sits between you and the box you type in.
 */
async function openPlan(): Promise<void> {
  const disclosure = await screen.findByTestId('v3-goalbar-disclosure');
  expect(disclosure.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(disclosure);
  await waitFor(() => expect(screen.getByTestId('v3-goal-steps')).toBeTruthy());
}

const PLAN: PlanStep[] = [
  { id: 's1', text: 'Read the parser', status: 'done' },
  { id: 's2', text: 'Add the guard', status: 'open' },
  { id: 's3', text: 'Measure the baseline', status: 'parked', why: 'no benchmark script exists' },
];

describe('the goalbar as a goal dashboard', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('shows the session GOAL, not only the rail title', async () => {
    const fake = fakeClient({ goal: 'make weak models finish long jobs' });
    draw(storeWith({ title: 'Ship the goal run' }), fake);
    await waitFor(() => {
      expect(screen.getByTestId('v3-goalbar').textContent).toMatch(/make weak models finish long jobs/);
    });
  });

  it('DRAWS NO BAR WHEN THERE IS NO GOAL — a title is not an objective', async () => {
    /*
     * This test used to assert the opposite: "falls back to the title … no
     * empty bar, no migration". Owner, 2026-09-17, walking the installed app
     * and reading a bar that said `session 7316 · working towards this focus`:
     * a session TITLE shown as a goal is meaningless. The server re-derives
     * that title from the transcript on every chat write, so the bar was
     * quoting a label back at him, calling it his objective, and reporting
     * progress toward it.
     *
     * An empty bar was never the failure. A bar that is WRONG is. A goal now
     * exists only when someone states one — `/goal …` or the New goal form.
     */
    draw(storeWith({ title: 'Ship the goal run' }), fakeClient());
    await waitFor(() => expect(screen.getByTestId('composer-field')).toBeTruthy());
    expect(screen.queryByTestId('v3-goalbar')).toBeNull();
    expect(screen.queryByText(/Ship the goal run/)).toBeNull();
  });

  it('draws every step with its state, and marks the one a run would resume at', async () => {
    draw(storeWith(), fakeClient({ goal: 'work the plan', plan: PLAN }));
    await openPlan();

    expect(screen.getByTestId('v3-goal-step-s1').getAttribute('data-state')).toBe('done');
    expect(screen.getByTestId('v3-goal-step-s2').getAttribute('data-state')).toBe('open');
    expect(screen.getByTestId('v3-goal-step-s3').getAttribute('data-state')).toBe('parked');
    expect(screen.getByTestId('v3-goal-step-s2').getAttribute('data-next')).toBe('yes');
    expect(screen.getByTestId('v3-goal-step-s1').getAttribute('data-next')).toBeNull();
  });

  it('counts done over total with parked in the DENOMINATOR', async () => {
    draw(storeWith(), fakeClient({ goal: 'work the plan', plan: PLAN }));
    await waitFor(() => expect(screen.getByTestId('v3-goalbar-progress').textContent).toBe('1/3'));
  });

  it('a parked step shows its reason and can be put back with Unpark', async () => {
    const fake = fakeClient({ goal: 'work the plan', plan: PLAN });
    draw(storeWith(), fake);
    await openPlan();
    expect(screen.getByTestId('v3-goal-why-s3').textContent).toMatch(/no benchmark script exists/);

    fireEvent.click(screen.getByTestId('v3-goal-unpark-s3'));
    await waitFor(() => expect(fake.updated).toHaveLength(1));
    const sent = (fake.updated[0]!.patch as { plan: PlanStep[] }).plan;
    expect(sent.find((s) => s.id === 's3')).toEqual({ id: 's3', text: 'Measure the baseline', status: 'open' });
    /* The reason is DROPPED on unpark — it described a step that is no longer
       parked, and keeping it would make the next park's reason ambiguous. */
    expect(sent.find((s) => s.id === 's3')).not.toHaveProperty('why');
  });
});

describe('the Work on goal button', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.clear();
  });

  it('starts a run in Build, and sends the permission the person is actually in', async () => {
    const fake = fakeClient({ goal: 'work the plan', plan: PLAN });
    draw(storeWith({ mode: 'build' }), fake);
    await waitFor(() => expect(screen.getByTestId('v3-goalbar-work')).toBeTruthy());

    const button = screen.getByTestId('v3-goalbar-work') as HTMLButtonElement;
    expect(button.textContent).toBe('Work on goal');
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    await waitFor(() => expect(fake.started).toHaveLength(1));
    expect(fake.started[0]).toMatchObject({ id: 's1', body: { permission: 'build' } });
  });

  it('is DISABLED in Plan mode and the tooltip says the one move that fixes it', async () => {
    const fake = fakeClient({ goal: 'work the plan', plan: PLAN });
    draw(storeWith({ mode: 'plan' }), fake);
    await waitFor(() => expect(screen.getByTestId('v3-goalbar-work')).toBeTruthy());

    const button = screen.getByTestId('v3-goalbar-work') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toMatch(/Switch to Build/i);
    fireEvent.click(button);
    expect(fake.started).toHaveLength(0);
  });

  it('is DISABLED with no open step, and says why', async () => {
    const fake = fakeClient({
      goal: 'work the plan',
      plan: [{ id: 's1', text: 'Read the parser', status: 'done' }],
    });
    draw(storeWith({ mode: 'build' }), fake);
    await waitFor(() => expect(screen.getByTestId('v3-goalbar-work')).toBeTruthy());

    const button = screen.getByTestId('v3-goalbar-work') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toMatch(/nothing for a run to work down/i);
  });

  it('becomes Stop while a run is live, and stopping calls the stop route', async () => {
    const fake = fakeClient({ goal: 'work the plan', plan: PLAN, run: { running: true, turns: 2, cap: 24 } });
    draw(storeWith({ mode: 'build' }), fake);
    await waitFor(() => {
      expect((screen.getByTestId('v3-goalbar-work') as HTMLButtonElement).textContent).toBe('Stop');
    });

    /* The bar says where IN THE PLAN the run is, so pressing Stop is an
       informed choice — and the 24-turn safety ceiling is in the tooltip and
       NOT in the line, where it read as the plan's length (owner, 2026-09-18). */
    const nowLine = screen.getByTestId('v3-goalbar-run');
    expect(nowLine.textContent).toBe('Working · step 2 of 3 · Add the guard · turn 3');
    expect(nowLine.textContent).not.toMatch(/of 24/);
    expect(nowLine.getAttribute('title')).toBe('stops by itself after 24 turns');
    expect(screen.getByTestId('v3-goalbar-status').getAttribute('data-status')).toBe('running');

    fireEvent.click(screen.getByTestId('v3-goalbar-work'));
    await waitFor(() => expect(fake.stopped).toEqual(['s1']));
  });

  it('a live run hides the previous run\'s verdict — it would read as this run\'s', async () => {
    const fake = fakeClient({
      goal: 'work the plan',
      plan: PLAN,
      run: {
        running: true,
        turns: 1,
        cap: 24,
        lastStopReason: 'plan_worked_down',
        lastStopSentence: 'plan worked down · 3 done',
      },
    });
    draw(storeWith({ mode: 'build' }), fake);
    await waitFor(() => expect(screen.getByTestId('v3-goalbar-run')).toBeTruthy());
    /* The live line is the ONLY line: no `Finished · …` beside it, and the row
       that used to carry the last verdict does not exist any more. */
    expect(screen.queryByTestId('v3-goalbar-step')).toBeNull();
    expect(screen.queryByTestId('v3-goal-last')).toBeNull();
    expect(screen.getByTestId('v3-goalbar').textContent).not.toMatch(/plan worked down/);
  });
});

describe('the plan list is a disclosure', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.clear();
  });

  it('is CLOSED by default, and the bar still says where the plan stands', async () => {
    draw(storeWith(), fakeClient({ goal: 'work the plan', plan: PLAN }));
    await waitFor(() => expect(screen.getByTestId('v3-goalbar-disclosure')).toBeTruthy());
    expect(screen.queryByTestId('v3-goal-steps')).toBeNull();
    expect(screen.getByTestId('v3-goalbar-disclosure').getAttribute('aria-expanded')).toBe('false');
    /* A CLOSED LIST MUST COST THE READER NOTHING. The count and the step a run
       would start at are both in the bar's own second line. */
    expect(screen.getByTestId('v3-goalbar-step').textContent).toBe(
      '1 of 3 done, 1 parked · Next: Add the guard',
    );
  });

  it('opens on a click, closes on the next one, and REMEMBERS which per session', async () => {
    draw(storeWith(), fakeClient({ goal: 'work the plan', plan: PLAN }));
    const disclosure = await screen.findByTestId('v3-goalbar-disclosure');

    fireEvent.click(disclosure);
    await waitFor(() => expect(screen.getByTestId('v3-goal-steps')).toBeTruthy());
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(localStorage.getItem('sequence.goal.open.s1')).toBe('1');

    fireEvent.click(disclosure);
    await waitFor(() => expect(screen.queryByTestId('v3-goal-steps')).toBeNull());
    expect(localStorage.getItem('sequence.goal.open.s1')).toBeNull();
  });

  it('opens straight away for a session that was left open', async () => {
    localStorage.setItem('sequence.goal.open.s1', '1');
    draw(storeWith(), fakeClient({ goal: 'work the plan', plan: PLAN }));
    await waitFor(() => expect(screen.getByTestId('v3-goal-steps')).toBeTruthy());
  });

  it('is not a disclosure at all when there is no plan under it', async () => {
    draw(storeWith(), fakeClient({ goal: 'work the plan' }));
    await waitFor(() => expect(screen.getByTestId('v3-goalbar')).toBeTruthy());
    expect(screen.queryByTestId('v3-goalbar-disclosure')).toBeNull();
  });
});

describe('how the last run ended', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.clear();
  });

  /*
   * THE `Last run: ...` ROW IS GONE (walk-4-white-glass-plan.md section 2). The
   * owner read the bar in a narrow window and the row was a third line under a
   * list he had not asked to see. The outcome moved up into the bar's own
   * second line, which is where the eye already is - and these are the old
   * row's tests, moved with it rather than deleted, so the claim is still
   * checked.
   */
  it('folds the outcome into the bar, and the row does not exist', async () => {
    const fake = fakeClient({
      goal: 'work the plan',
      plan: [{ id: 's1', text: 'Add the guard', status: 'open' }],
      run: {
        running: false,
        turns: 1,
        cap: 24,
        lastStopReason: 'stopped_by_hand',
        lastStopSentence: 'stopped by hand',
      },
    });
    draw(storeWith(), fake);
    await waitFor(() => expect(screen.getByTestId('v3-goalbar-step')).toBeTruthy());
    expect(screen.getByTestId('v3-goalbar-step').textContent).toBe(
      'Finished · 0 of 1 done · stopped by hand',
    );
    expect(screen.queryByTestId('v3-goal-last')).toBeNull();
    expect(screen.getByTestId('v3-goal').textContent).not.toMatch(/Last run/);
  });

  it('prints the sentence from the server and tones it by what went wrong', async () => {
    const fake = fakeClient({
      goal: 'work the plan',
      plan: PLAN,
      run: {
        running: false,
        turns: 6,
        cap: 24,
        lastStopReason: 'plan_worked_down',
        lastStopSentence: 'plan worked down · 3 done, 1 parked',
      },
    });
    draw(storeWith(), fake);
    await waitFor(() => expect(screen.getByTestId('v3-goalbar-step')).toBeTruthy());
    expect(screen.getByTestId('v3-goalbar-step').textContent).toBe(
      'Finished · 1 of 3 done · plan worked down · 3 done, 1 parked',
    );
    expect(screen.getByTestId('v3-goalbar-step').getAttribute('data-tone')).toBe('done');
  });

  it('separates "the plan was the problem" from "the model was"', async () => {
    const fake = fakeClient({
      goal: 'work the plan',
      plan: PLAN,
      run: {
        running: false,
        turns: 6,
        cap: 24,
        lastStopReason: 'the_model_only_narrated',
        lastStopSentence: '4 turns in a row announced a move and called no tool',
      },
    });
    draw(storeWith(), fake);
    await waitFor(() => expect(screen.getByTestId('v3-goalbar-step')).toBeTruthy());
    expect(screen.getByTestId('v3-goalbar-step').getAttribute('data-tone')).toBe('failed');
  });

  it('says nothing about a run for a session that has never had one', async () => {
    draw(storeWith(), fakeClient({ goal: 'work the plan', plan: PLAN }));
    await waitFor(() => expect(screen.getByTestId('v3-goalbar-step')).toBeTruthy());
    expect(screen.getByTestId('v3-goalbar-step').textContent).not.toMatch(/Finished/);
    expect(screen.queryByTestId('v3-goal-last')).toBeNull();
  });
});

describe('New goal', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.clear();
  });

  it('sets the GOAL, and the title too while the title is still ours', async () => {
    const fake = fakeClient();
    draw(storeWith({ title: 'Untitled' }), fake);
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    fireEvent.click(screen.getByTestId('v3-new-goal'));
    fireEvent.change(screen.getByTestId('v3-focus-input'), {
      target: { value: 'make weak models finish long jobs' },
    });
    fireEvent.click(screen.getByTestId('v3-focus-save'));

    await waitFor(() => expect(fake.updated).toHaveLength(1));
    expect(fake.updated[0]!.patch).toEqual({
      goal: 'make weak models finish long jobs',
      title: 'make weak models finish long jobs',
    });
  });
});
