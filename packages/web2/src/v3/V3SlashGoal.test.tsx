import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GoalRunState, PlanStep } from '@sequence/api-types';

import { createStore, StoreProvider, type Store } from '../state';
import type { SessionsClient, WireResult } from '../sessions/sessionsClient';
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

describe('the goalbar shows a GOAL, never the session title', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.setAttribute('data-platform', 'win');
  });

  it('draws no bar for a session that only has a title', async () => {
    const store = storeWith('Session 7316');
    const fake = fakeClient();
    draw(store, fake);
    await waitFor(() => expect(fake.updated).toHaveLength(0));
    expect(screen.queryByTestId('v3-goalbar')).toBeNull();
    /* And it does not smuggle the title in under another name. */
    expect(screen.queryByText(/Session 7316/)).toBeNull();
  });

  it('draws the bar as soon as the session has a real goal', async () => {
    const store = storeWith('Session 7316');
    const fake = fakeClient({ goal: 'make the gateway idempotent' });
    draw(store, fake);
    await waitFor(() => {
      expect(screen.getByTestId('v3-goalbar').getAttribute('aria-label')).toBe(
        'Goal: make the gateway idempotent',
      );
    });
  });
});

describe('/ opens the command menu in the V3 composer', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('lists the derived registry, goal included', () => {
    draw(storeWith(), fakeClient());
    typeDraft('/');
    const names = screen
      .getAllByTestId('v3-slash-item')
      .map((row) => row.getAttribute('data-command'));
    expect(names).toContain('goal');
    /* Still the ONE derived registry — a toolbelt item and a mode are here too. */
    expect(names).toContain('breakdown');
    expect(names).toContain('plan');
  });

  it('DOES NOT OPEN ON A PATH', () => {
    draw(storeWith(), fakeClient());
    typeDraft('what is in packages/web2/src');
    expect(screen.queryByTestId('v3-slash')).toBeNull();
  });

  it('filters as the reader types, and Enter runs the row instead of sending it', () => {
    const store = storeWith();
    draw(store, fakeClient());
    const field = typeDraft('/bui');
    const names = screen
      .getAllByTestId('v3-slash-item')
      .map((row) => row.getAttribute('data-command'));
    expect(names[0]).toBe('build');

    fireEvent.keyDown(field, { key: 'Enter' });
    expect(store.getState().composer.permission.mode).toBe('build');
    /* Never posted as prose — that is the whole reason the menu owns Enter. */
    expect(store.getState().session.turns).toHaveLength(0);
    expect(store.getState().composer.draft).toBe('');
  });
});

describe('/goal <text> sets the goal and begins the long-running task', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores the goal, switches to Build, and starts the run', async () => {
    const store = storeWith();
    const fake = fakeClient();
    draw(store, fake);

    const field = typeDraft('/goal ship the parser guard');
    /* The menu is CLOSED — a space ends the command name — so Enter is the
       invocation, not a pick. */
    expect(screen.queryByTestId('v3-slash')).toBeNull();
    fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => expect(fake.started).toHaveLength(1));

    /* 1. The goal is stored as a goal. The title follows only because nobody
          has renamed this thread by hand. */
    expect(fake.updated[0].patch).toMatchObject({
      goal: 'ship the parser guard',
      title: 'ship the parser guard',
    });
    /* 2. Picking Build is the enabling act, and the run needs it. */
    expect(store.getState().composer.permission.mode).toBe('build');
    /* 3. The run is started, under the mode the enabling act just set — not
          the one this render was still holding. */
    expect(fake.started[0]).toMatchObject({ id: 's1', body: { permission: 'build' } });

    /* And nothing was posted to the model as a question. */
    expect(store.getState().session.turns).toHaveLength(0);
    expect(store.getState().composer.draft).toBe('');

    await waitFor(() =>
      expect(screen.getByTestId('v3-goalbar').getAttribute('aria-label')).toBe(
        'Goal: ship the parser guard',
      ),
    );
  });

  it('leaves a thread the reader renamed alone — goal yes, title no', async () => {
    const store = createStore({});
    store.dispatch({
      type: 'session/index',
      sessions: [
        { id: 's1', title: 'My thread', titleEdited: true, pinned: false, updatedAt: '2026-01-01' },
      ],
      activeId: 's1',
    } as never);
    const fake = fakeClient();
    draw(store, fake);

    const field = typeDraft('/goal ship the parser guard');
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(fake.updated).toHaveLength(1));
    expect(fake.updated[0].patch).toEqual({ goal: 'ship the parser guard' });
  });

  it('bare /goal opens the focus form and starts nothing', async () => {
    const store = storeWith();
    const fake = fakeClient();
    draw(store, fake);

    const field = typeDraft('/goal');
    /* The menu IS open on a bare name, and the highlighted row is goal. */
    expect(screen.getByTestId('v3-slash')).toBeTruthy();
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(screen.getByTestId('v3-focus-form')).toBeTruthy();
    expect(screen.getByTestId('v3-focus-input')).toBeTruthy();
    await waitFor(() => expect(fake.started).toHaveLength(0));
    expect(fake.updated).toHaveLength(0);
  });

  it('keeps "New goal" in the toolbelt as a second door to the same form', () => {
    draw(storeWith(), fakeClient());
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    fireEvent.click(screen.getByTestId('v3-new-goal'));
    expect(screen.getByTestId('v3-focus-form')).toBeTruthy();
  });
});
