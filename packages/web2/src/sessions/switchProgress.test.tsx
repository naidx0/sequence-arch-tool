import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BootTransport } from '../boot';
import { scanningOf } from '../boot/bootSequence';
import { SwitchProgress } from './SwitchProgress';
import { getSwitchProgress, resetSwitchProgressForTest, withAttachProgress } from './attachProgress';

/*
 * 019-progress: while a switch's POST /api/attach is pending, the page polls GET /api/status for the additive
 * `attaching` field and shows "Reading N of M files…"; a refusal is a plain sentence.
 */

afterEach(() => {
  cleanup();
  resetSwitchProgressForTest();
  vi.useRealTimers();
});

const ok = <T,>(body: T) => ({ outcome: 'ok' as const, status: 200, body });

describe('the switch view reads attaching', () => {
  it('renders "N of M files" from /api/status attaching while the attach is pending, and clears after', async () => {
    vi.useFakeTimers();
    let n = 0;
    const steps = [
      { attached: true, attaching: { path: '/work/big', phase: 'preparing', done: 0, total: 0, startedAt: 1 } },
      { attached: true, attaching: { path: '/work/big', phase: 'scanning', done: 1204, total: 3010, startedAt: 1 } },
      { attached: true, attaching: { path: '/work/big', phase: 'scanning', done: 2000, total: 3010, startedAt: 1 } },
    ];
    const transport = { status: vi.fn(async () => ok(steps[Math.min(n++, steps.length - 1)])) } as unknown as BootTransport;
    render(<SwitchProgress />);
    expect(screen.queryByTestId('switch-progress')).toBeNull();

    let release: () => void = () => {};
    let pending: Promise<string> = Promise.resolve('');
    await act(async () => {
      pending = withAttachProgress(transport, '/work/big', () => new Promise<string>((r) => (release = () => r('done'))), 100);
    });
    expect(screen.getByTestId('switch-progress').textContent).toContain('Opening big');
    expect(screen.getByTestId('switch-progress-line').textContent).toBe('Counting files…');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(screen.getByTestId('switch-progress-line').textContent).toBe('Reading 2,000 of 3,010 files…');
    expect((screen.getByRole('status').querySelector('progress') as HTMLProgressElement).value).toBeCloseTo(2000 / 3010);

    await act(async () => {
      release();
      await pending;
    });
    expect(getSwitchProgress()).toBeNull();
    expect(screen.queryByTestId('switch-progress')).toBeNull();
  });

  it('a boot page opened mid-switch reads the same field when nothing is attached yet', () => {
    expect(scanningOf({ attached: false, attaching: { path: '/work/big', phase: 'scanning', done: 5, total: 50, startedAt: 1 } })).toEqual({ done: 5, total: 50, path: '/work/big' });
    expect(scanningOf({ attached: false })).toBeNull();
    // `scanning` (the startup attach) still wins and still means what it meant.
    expect(scanningOf({ attached: false, scanning: { done: 1, total: 2, path: '/s' }, attaching: { path: '/a', done: 9, total: 9 } })?.path).toBe('/s');
  });
});

describe('switchWorkspaceInPlace shows the attach progress', () => {
  const mk = (attach: BootTransport['attach']) => {
    const statusBody = { attached: true, root: '/work/a', attaching: { path: '/work/big', phase: 'scanning', done: 30, total: 120, startedAt: 1 } };
    return {
      transport: { status: vi.fn(async () => ok(statusBody)), attach, detach: vi.fn(async () => ok({})) } as unknown as BootTransport,
      sessions: { list: vi.fn(async () => ({ outcome: 'error', message: 'x' })), activate: vi.fn(async () => ok({})) } as unknown as import('./sessionsClient').SessionsClient,
    };
  };

  it('the panel reads "30 of 120 files" while the attach is pending', async () => {
    const { switchWorkspaceInPlace } = await import('./workspaceSwitch');
    const { createStore } = await import('../state');
    const { readShellPersisted, readShellTokens } = await import('../shell');
    const { seqdFromGraph } = await import('../canvas/seqdFromGraph');
    const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail), tokens: readShellTokens(document.documentElement), persisted: readShellPersisted() });
    let finish: () => void = () => {};
    const f = mk(() => new Promise((r) => (finish = () => r(ok({}) as never))));
    render(<SwitchProgress />);
    const run = switchWorkspaceInPlace({ store, transport: f.transport, sessions: f.sessions, leave: async () => {}, boot: async () => ({ kind: 'unattached', platform: { reachable: true, detail: '', at: 1 } }) }, '/work/big', 'b1');
    await vi.waitFor(() => expect(screen.getByTestId('switch-progress-line').textContent).toBe('Reading 30 of 120 files…'), { timeout: 3000 });
    finish();
    await run;
    expect(screen.queryByTestId('switch-progress')).toBeNull();
  });

  it('a refused attach is a plain message', async () => {
    const { switchWorkspaceInPlace } = await import('./workspaceSwitch');
    const { createStore } = await import('../state');
    const { readShellPersisted, readShellTokens } = await import('../shell');
    const { seqdFromGraph } = await import('../canvas/seqdFromGraph');
    const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail), tokens: readShellTokens(document.documentElement), persisted: readShellPersisted() });
    const f = mk(async () => ({ outcome: 'error', status: 400, body: { error: 'that folder cannot be opened' } }) as never);
    render(<SwitchProgress />);
    const r = await switchWorkspaceInPlace({ store, transport: f.transport, sessions: f.sessions, leave: async () => {} }, '/work/big', 'b1');
    expect(r.outcome).toBe('refused');
    expect(screen.getByTestId('switch-progress-failed').textContent).toContain('Could not open big');
    expect(screen.getByTestId('switch-progress-failed').textContent).toContain('that folder cannot be opened');
  });
});

describe('the corner panel gives way to the Open project dialog (019-rescan-ui)', () => {
  it('is not drawn a second time while the dialog is open, and is drawn when the dialog is not', async () => {
    const { createStore } = await import('../state');
    const { StoreProvider } = await import('../state/connect');
    const store = createStore({});
    const transport = { status: vi.fn(async () => ok({ attached: true })) } as unknown as BootTransport;
    render(
      <StoreProvider store={store}>
        <SwitchProgress />
      </StoreProvider>,
    );
    let release: () => void = () => {};
    await act(async () => {
      void withAttachProgress(transport, '/work/big', () => new Promise<string>((r) => (release = () => r('done'))), 100);
    });
    expect(screen.getByTestId('switch-progress')).toBeTruthy();
    act(() => store.dispatch({ type: 'shell/overlay', overlay: { kind: 'attach' } }));
    expect(screen.queryByTestId('switch-progress')).toBeNull();
    act(() => store.dispatch({ type: 'shell/overlay', overlay: null }));
    expect(screen.getByTestId('switch-progress')).toBeTruthy();
    await act(async () => release());
  });
});
