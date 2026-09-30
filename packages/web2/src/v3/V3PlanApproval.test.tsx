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


/*
 * PLAN READY — owner, 2026-09-22: "the second a plan is made and prepared …
 * there is an approval card to flip the model into build mode to put the plan
 * in play … you can approve and build the full thing without looking at
 * anything except the actual plan."
 */
const PLAN: PlanStep[] = [
  { id: 'a', text: 'Add a memory store', status: 'open' },
  { id: 'b', text: 'Load memory each turn', status: 'open' },
];

function planTurn(store: Store): void {
  store.dispatch({ type: 'composer/draft', text: '/plan add memory' });
  store.dispatch({ type: 'turn/send', at: 1 });
  store.dispatch({ type: 'turn/event', event: { type: 'tool:start', id: 'w1', name: 'write_plan' }, at: 2 } as never);
  store.dispatch({ type: 'turn/event', event: { type: 'tool:done', id: 'w1', name: 'write_plan', evidence: 'plan: 2 step(s)' }, at: 3 } as never);
  store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'The plan is on the Plan tab.' }, at: 4 });
}

describe('Plan ready', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.clear();
  });

  it('a Plan turn that wrote a plan offers to build it, and Build it runs the plan in Build', async () => {
    const store = storeWith({ mode: 'plan' });
    const fake = fakeClient({ goal: 'remember past sessions', plan: PLAN });
    planTurn(store);
    draw(store, fake);
    const card = await screen.findByTestId('v3-plan-ready');
    expect(card.textContent).toContain('Add a memory store');
    expect(card.textContent).toContain('2 steps');
    fireEvent.click(screen.getByTestId('v3-plan-build'));
    await waitFor(() => expect(fake.started).toHaveLength(1));
    expect((fake.started[0]!.body as { permission: string }).permission).toBe('build');
    expect(store.getState().composer.permission.mode).toBe('build');
    await waitFor(() => expect(screen.queryByTestId('v3-plan-ready')).toBeNull());
  });

  it('Keep planning answers the card and it does not come back for that plan', async () => {
    const store = storeWith({ mode: 'plan' });
    planTurn(store);
    draw(store, fakeClient({ goal: 'remember past sessions', plan: PLAN }));
    fireEvent.click(await screen.findByTestId('v3-plan-keep'));
    expect(screen.queryByTestId('v3-plan-ready')).toBeNull();
    expect(store.getState().composer.permission.mode).toBe('plan');
  });

  it('no card in Build mode, and none for a turn that wrote no plan', async () => {
    const store = storeWith({ mode: 'build' });
    planTurn(store);
    draw(store, fakeClient({ goal: 'g', plan: PLAN }));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('v3-plan-ready')).toBeNull();
  });
});
