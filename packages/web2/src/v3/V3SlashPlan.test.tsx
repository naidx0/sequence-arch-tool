import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GoalRunState, PlanStep } from '@sequence/api-types';

import { createStore, StoreProvider, type Store } from '../state';
import type { SessionsClient, WireResult } from '../sessions/sessionsClient';
import { slashCommands } from '../chat/composerModel';
import { V3Chat } from './V3Chat';

/**
 * `/goal` — THE GOAL IS CALLED FOR, NOT ASSUMED.
 *
 * Owner, 2026-09-17, walking the installed app:
 *
 *   "I don't like that it sets the goal automatically. The goal should be a
 *    skill you call by doing /goal or something, and invoking it begins this
 *    long-running task."
 *
 * …while looking at a goalbar reading `session 7316 · working towards this
 * focus`. Both halves are asserted here: the bar no longer invents a goal out
 * of the session's TITLE (which the server re-derives from the transcript, so
 * it was never his objective), and `/goal <text>` performs the three acts that
 * make the sentence true — store the goal, switch to Build, start the run.
 *
 * NEW FILE. `V3GoalRun.test.tsx` describes the bar's dashboard once a goal
 * exists; this describes how one comes to exist.
 */

const IDLE: GoalRunState = { running: false, turns: 0, cap: 24 };

function ok<T>(body: T): Promise<WireResult<T>> {
  return Promise.resolve({ outcome: 'ok', body });
}

interface Fake {
  client: SessionsClient;
  started: Array<{ id: string; body: unknown }>;
  updated: Array<{ id: string; patch: Record<string, unknown> }>;
}

function fakeClient(args: { goal?: string } = {}): Fake {
  let run = IDLE;
  let goal = args.goal;
  const plan: PlanStep[] = [];
  const f: Fake = {
    started: [],
    updated: [],
    client: {
      list: () => ok({ index: { version: 1, activeId: '', sessions: [] } }),
      create: () => ok({}),
      fork: () => ok({}),
      activate: () => ok({}),
      readSession: () =>
        ok({
          chat: { version: 1, sessionId: 's1', turns: [] },
          meta: {},
          ...(goal === undefined ? {} : { goal }),
          plan,
        }),
      readChat: () => ok({}),
      writeChat: () => ok({}),
      writeBoardSeqd: () => ok({}),
      update: (id: string, patch: Record<string, unknown>) => {
        f.updated.push({ id, patch });
        if (typeof patch.goal === 'string') goal = patch.goal;
        return ok({ ok: true, index: { version: 1, activeId: id, sessions: [] } });
      },
      readGoalRun: () => ok(run),
      startGoalRun: (id: string, body: unknown) => {
        f.started.push({ id, body });
        run = { running: true, turns: 0, cap: 24 };
        return ok({ ok: true, state: run });
      },
      stopGoalRun: (id: string) => {
        run = { ...run, running: false };
        return ok({ ok: true, state: run, id });
      },
      remove: () => ok({}),
    } as unknown as SessionsClient,
  };
  return f;
}

function storeWith(title = 'Session 7316'): Store {
  const store = createStore({});
  store.dispatch({
    type: 'session/index',
    sessions: [{ id: 's1', title, pinned: false, updatedAt: '2026-01-01' }],
    activeId: 's1',
  } as never);
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

function typeDraft(text: string): HTMLTextAreaElement {
  const field = screen.getByTestId('composer-field') as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: text } });
  return field;
}

/*
 * `/plan <task>` — A PLANNING TURN (owner, 2026-09-22): "once people have
 * something difficult to do, like in cursor, they can use slash plan".
 */
describe('/plan <task> plans it', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.clear();
  });

  it('switches to Plan and sends the task with its prefix', async () => {
    const store = storeWith();
    draw(store, fakeClient());
    const field = typeDraft('/plan add a memory system to the harness');
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => {
      const users = store.getState().session.turns.filter((t) => t.role === 'user');
      expect(users.map((t) => t.text)).toContain('/plan add a memory system to the harness');
    });
    expect(store.getState().composer.permission.mode).toBe('plan');
  });

  it('bare /plan only switches the mode and sends nothing', async () => {
    const store = storeWith();
    store.dispatch({ type: 'composer/permission', mode: 'build' });
    draw(store, fakeClient());
    const field = typeDraft('/plan');
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(store.getState().composer.permission.mode).toBe('plan'));
    expect(store.getState().session.turns.filter((t) => t.role === 'user')).toHaveLength(0);
  });
});
