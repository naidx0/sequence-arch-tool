import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoalRunState, PlanStep } from '@sequence/api-types';

import { createStore, StoreProvider, type Store } from '../state';
import type { SessionsClient, WireResult } from '../sessions/sessionsClient';
import { V3Chat } from './V3Chat';

/**
 * B4 (P0-6 lite): ONE-CLICK RESUME after the engine's restart ended a run. Fixture copied from
 * V3GoalRun.test.tsx (the goalbar against a fake sessions client).
 *
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
  goalName?: string;
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
          ...(args.goalName === undefined ? {} : { goalName: args.goalName }),
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
  { id: 's2', text: 'Add the guard', status: 'done' },
  { id: 's3', text: 'Lock it with a test', status: 'open' },
  { id: 's4', text: 'Wire the route', status: 'open' },
];

const RESTARTED: GoalRunState = {
  running: false,
  turns: 2,
  cap: 24,
  lastStopReason: 'engine_restarted',
  lastStopSentence: 'the engine stopped while this run was working',
  agentRef: 'claude',
  jobMode: 'code',
};

describe('Resume goal (B4)', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('a run the restart ended shows Resume goal, even in Plan mode, and ONE click starts it again on the agent and mode it ran on', async () => {
    const fake = fakeClient({ goal: 'harden the parser', plan: PLAN, run: RESTARTED });
    draw(storeWith({ mode: 'plan' }), fake);
    const btn = await screen.findByTestId('v3-goalbar-work');
    await waitFor(() => expect(btn.textContent).toBe('Resume goal'));
    expect(btn.getAttribute('data-action')).toBe('resume');
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    expect(btn.getAttribute('title')).toContain('Lock it with a test');
    fireEvent.click(btn);
    await waitFor(() => expect(fake.started).toHaveLength(1));
    expect(fake.started[0]).toEqual({ id: 's1', body: { permission: 'build', jobMode: 'code', agentRef: 'claude' } });
  });

  for (const reason of ['stopped_by_hand', 'turn_cap', 'provider_failed'] as const) {
    it(`no Resume for a run that ended ${reason}`, async () => {
      const fake = fakeClient({ goal: 'harden the parser', plan: PLAN, run: { ...RESTARTED, lastStopReason: reason } });
      draw(storeWith({ mode: 'build' }), fake);
      const btn = await screen.findByTestId('v3-goalbar-work');
      await waitFor(() => expect(btn.textContent).toBe('Work on goal'));
      expect(btn.getAttribute('data-action')).not.toBe('resume');
    });
  }

  it('no Resume when the restarted run left nothing open', async () => {
    const done = PLAN.map((s) => ({ ...s, status: 'done' as const }));
    const fake = fakeClient({ goal: 'harden the parser', plan: done, run: RESTARTED });
    draw(storeWith({ mode: 'build' }), fake);
    const btn = await screen.findByTestId('v3-goalbar-work');
    await waitFor(() => expect(btn.getAttribute('data-action')).toBe('none'));
    expect(btn.textContent).not.toBe('Resume goal');
  });
});
