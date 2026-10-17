import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GoalRunState, PlanStep } from '@sequence/api-types';

import { createStore, StoreProvider } from '../state';
import type { SessionsClient, WireResult } from '../sessions/sessionsClient';
import { V3Chat } from './V3Chat';

/**
 * A GOAL START THAT SAYS WHERE THE RUN WORKS (audit P1-11, the agent half).
 *
 * The server answers a start with `worktree` when a second agent run on the repo was cut its own branch, and with
 * `warning` when it could not be. The chat says so in one plain line; a plain start says nothing.
 */

const IDLE: GoalRunState = { running: false, turns: 0, cap: 24 };
const PLAN: PlanStep[] = [{ id: 's1', text: 'Add the guard', status: 'open' }];
const ok = <T,>(body: T): Promise<WireResult<T>> => Promise.resolve({ outcome: 'ok', body });

function draw(startExtra: Record<string, unknown>): void {
  let run = IDLE;
  const client = {
    list: () => ok({ index: { version: 1, activeId: '', sessions: [] } }),
    readSession: () => ok({ chat: { version: 1, sessionId: 's1', turns: [] }, meta: {}, goal: 'work the plan', plan: PLAN }),
    readGoalRun: () => ok(run),
    startGoalRun: () => {
      run = { running: true, turns: 0, cap: 24 };
      return ok({ ok: true, state: run, ...startExtra });
    },
    update: () => ok({}),
  } as unknown as SessionsClient;
  const store = createStore({});
  store.dispatch({ type: 'session/index', sessions: [{ id: 's1', title: 't', pinned: false, updatedAt: '2026-01-01' }], activeId: 's1' } as never);
  store.dispatch({ type: 'composer/permission-enabled', enabled: ['plan', 'build'] } as never);
  store.dispatch({ type: 'composer/permission', mode: 'build' } as never);
  render(
    <StoreProvider store={store}>
      <div className="v3-chat-col">
        <V3Chat goalRunClient={client} />
      </div>
    </StoreProvider>,
  );
}

async function press(): Promise<void> {
  const work = await screen.findByTestId('v3-goalbar-work');
  await waitFor(() => expect((work as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(work);
}

describe('the goalbar says where a started run works', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.clear();
  });

  it('names the worktree branch when the start response carries one', async () => {
    draw({ worktree: { path: '/tmp/wt/ab12cd34', branch: 'sequence/goal-fix-the-parser-ab12' } });
    await press();
    const note = await screen.findByTestId('v3-goal-notice');
    expect(note.textContent).toBe('This run works in its own branch sequence/goal-fix-the-parser-ab12, listed under Worktrees.');
    expect(note.getAttribute('data-kind')).toBe('worktree');
  });

  it('shows the warning text when the start response carries one', async () => {
    const warning = 'Another run is already working in this project and this one could not get its own worktree (not a git repository). Both write to the same files and may overlap.';
    draw({ warning });
    await press();
    const note = await screen.findByTestId('v3-goal-notice');
    expect(note.textContent).toBe(warning);
    expect(note.getAttribute('data-kind')).toBe('warning');
  });

  it('says nothing on a plain start', async () => {
    draw({});
    await press();
    await waitFor(() => expect(screen.getByTestId('v3-goalbar-work').getAttribute('data-action')).toBe('stop'));
    expect(screen.queryByTestId('v3-goal-notice')).toBeNull();
  });
});
