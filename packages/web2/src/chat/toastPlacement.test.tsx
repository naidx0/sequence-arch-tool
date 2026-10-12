import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentRunStore, type AgentRunStore } from '../agents/agentRuns';
import { AgentRunsList } from './AgentRunThread';
import { AgentToasts } from './AgentToasts';
import { TOAST_AVOID_ATTR, TOAST_INSET, toastBottom } from './toastPlacement';

/* An IntersectionObserver the test drives: `seeAll(true)` reports every
   observed element as on screen. */
let observers: { cb: IntersectionObserverCallback; els: Set<Element> }[] = [];
class FakeIO {
  private rec: { cb: IntersectionObserverCallback; els: Set<Element> };
  constructor(cb: IntersectionObserverCallback) {
    this.rec = { cb, els: new Set() };
    observers.push(this.rec);
  }
  observe(el: Element) {
    this.rec.els.add(el);
  }
  unobserve(el: Element) {
    this.rec.els.delete(el);
  }
  disconnect() {
    this.rec.els.clear();
  }
  takeRecords() {
    return [];
  }
}
function seeAll(on: boolean) {
  for (const o of observers) {
    o.cb(
      [...o.els].map((target) => ({ target, isIntersecting: on, intersectionRatio: on ? 1 : 0 }) as unknown as IntersectionObserverEntry),
      o as unknown as IntersectionObserver,
    );
  }
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal('IntersectionObserver', FakeIO);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.querySelectorAll(`[${TOAST_AVOID_ATTR}]`).forEach((e) => e.remove());
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

function withPendingApproval(): AgentRunStore {
  const store = createAgentRunStore({ fetch: async () => new Response('{}') });
  void store.start({ agentRef: 'codex', question: 'q' }, () => new Promise<Response>(() => {}));
  const id = store.get().runs[0]!.id;
  store.apply(id, { type: 'acp:update', update: { sessionId: 's', update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Edit a.ts', kind: 'edit', status: 'in_progress' } } });
  store.apply(id, {
    type: 'acp:permission',
    toolCallId: 't1',
    requestId: 'q1',
    pending: true,
    decision: null,
    toolKind: 'edit',
    title: 'Edit a.ts',
    proposal: { proposalId: 'q1', title: 'Edit a.ts', rationale: null, files: [{ path: 'a.ts', diff: '+x\n' }] },
  });
  return store;
}

function Page({ store, withChat }: { store: AgentRunStore; withChat: boolean }) {
  return (
    <>
      {withChat ? <AgentRunsList runs={store.get().runs} repoRoot={null} onAnswer={() => {}} /> : null}
      <AgentToasts store={store} repoRoot={null} />
    </>
  );
}

describe('a toast shows only while its chat card cannot be seen', () => {
  it('the card on screen: no toast; scrolled away: the toast; window hidden: the toast', async () => {
    const store = withPendingApproval();
    await act(async () => {
      await Promise.resolve();
    });
    render(<Page store={store} withChat />);
    await act(async () => {
      await Promise.resolve();
    });
    /* Observed, nothing reported yet: shown (the safe side). */
    expect(screen.getAllByTestId('agent-toast')).toHaveLength(1);
    act(() => seeAll(true));
    expect(screen.queryByTestId('agent-toast')).toBeNull();
    act(() => seeAll(false));
    expect(screen.getAllByTestId('agent-toast')).toHaveLength(1);
    act(() => seeAll(true));
    expect(screen.queryByTestId('agent-toast')).toBeNull();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.getAllByTestId('agent-toast')).toHaveLength(1);
  });

  it('no chat card in the page (another view is open): the toast', async () => {
    const store = withPendingApproval();
    render(<Page store={store} withChat={false} />);
    await act(async () => {
      await Promise.resolve();
    });
    act(() => seeAll(true));
    expect(screen.getAllByTestId('agent-toast')).toHaveLength(1);
  });

  it('the toast finds the merged tool card by its approval id', async () => {
    const store = withPendingApproval();
    render(<Page store={store} withChat />);
    await act(async () => {
      await Promise.resolve();
    });
    const watched = observers.flatMap((o) => [...o.els]);
    expect(watched.map((e) => e.getAttribute('data-approval-id'))).toContain('q1');
  });
});

describe('the toast stack sits above the board toolbar, never over it', () => {
  it('toastBottom: its inset alone, or clear of an obstacle it overlaps', () => {
    expect(toastBottom({ left: 1000, right: 1320 }, [], 900)).toBe(TOAST_INSET);
    /* A 36 px strip at the window's bottom, under the stack. */
    expect(toastBottom({ left: 1000, right: 1320 }, [{ left: 600, right: 1440, top: 864, bottom: 900 }], 900)).toBe(44);
    /* Off to the side: no effect. */
    expect(toastBottom({ left: 1000, right: 1320 }, [{ left: 0, right: 900, top: 864, bottom: 900 }], 900)).toBe(TOAST_INSET);
  });

  it('a marked strip lifts the stack', async () => {
    const strip = document.createElement('div');
    strip.setAttribute(TOAST_AVOID_ATTR, '');
    strip.getBoundingClientRect = () => ({ left: 0, right: 2000, top: window.innerHeight - 36, bottom: window.innerHeight, width: 2000, height: 36, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(strip);
    const store = withPendingApproval();
    render(<Page store={store} withChat={false} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('agent-toasts').style.bottom).toBe('44px');
  });
});
