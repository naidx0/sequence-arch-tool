import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '../state';
import { V3App } from './V3App';

/*
 * RENDERS PER KEYSTROKE, COUNTED PER COMPONENT (perf 0.1.8.4, profile costs #2 and #3).
 *
 * The profiler found 176 component renders and 3 commits per key in real Chrome: the whole-state store woke every
 * useAppState() reader on a draft change. The Profiler API only counts commits, so this walks React's fiber tree
 * after each commit. A component rendered in that commit when its fiber has PerformedWork (flag 1) AND is not the
 * same fiber object as in the previous snapshot: a bailed-out fiber is reused as is (same object), a cloned one has
 * its flag cleared, and only a render leaves both.
 */
type Fiber = { tag: number; flags: number; type: unknown; child: Fiber | null; sibling: Fiber | null };
const COMPONENT_TAGS = new Set([0, 11, 14, 15]);

function nameOf(f: Fiber): string {
  const t = f.type as { displayName?: string; name?: string; type?: { displayName?: string; name?: string }; render?: { displayName?: string; name?: string } } | null;
  if (!t) return 'Anonymous';
  if (typeof t === 'function') return t.displayName || t.name || 'Anonymous';
  return t.displayName || t.type?.displayName || t.type?.name || t.render?.displayName || t.render?.name || 'Anonymous';
}

function rootFiber(container: HTMLElement): Fiber {
  const key = Object.keys(container).find((k) => k.startsWith('__reactContainer$'));
  if (!key) throw new Error('no React root on the container');
  const host = (container as unknown as Record<string, { stateNode: { current: Fiber } }>)[key]!;
  return host.stateNode.current;
}

function snapshot(root: Fiber, counts?: Map<string, number>, before?: Set<Fiber>): Set<Fiber> {
  const now = new Set<Fiber>();
  const walk = (first: Fiber | null): void => {
    for (let n = first; n; n = n.sibling) {
      now.add(n);
      if (counts && before && COMPONENT_TAGS.has(n.tag) && (n.flags & 1) !== 0 && !before.has(n)) {
        const name = nameOf(n);
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      walk(n.child);
    }
  };
  walk(root);
  return now;
}

afterEach(() => vi.unstubAllGlobals());

function mount() {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  const store = createStore({});
  store.dispatch({
    type: 'session/index',
    sessions: [{ id: 's-typing', title: 'Typing', pinned: false, updatedAt: '2026-01-01' }],
    activeId: 's-typing',
  } as never);
  for (let i = 0; i < 8; i++) {
    store.dispatch({ type: 'composer/draft', text: `question ${i} about the gateway` });
    store.dispatch({ type: 'turn/send', at: 10 * i + 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'delta', text: `Answer ${i}: the gateway calls orders.` }, at: 10 * i + 2 } as never);
    store.dispatch({ type: 'turn/stopped', at: 10 * i + 3 } as never);
  }
  const view = render(<V3App appStore={store} />);
  return { store, container: view.container };
}

describe('a keystroke re-renders only the composer', () => {
  it('counts renders per keystroke by component', async () => {
    const { container } = mount();
    await act(async () => {});
    const field = screen.getByTestId('composer-field') as HTMLTextAreaElement;
    // The transcript is really there, so a row re-rendering would show.
    expect(document.querySelectorAll('[data-turn-id]').length).toBeGreaterThanOrEqual(8);
    const root = (): Fiber => rootFiber(container);
    let before = snapshot(root());
    const counts = new Map<string, number>();
    const text = 'what calls orders';
    for (let i = 1; i <= text.length; i++) {
      act(() => {
        fireEvent.change(field, { target: { value: text.slice(0, i) } });
      });
      before = snapshot(root(), counts, before);
    }
    const keys = text.length;
    const per = (name: string): number => (counts.get(name) ?? 0) / keys;
    const total = [...counts.values()].reduce((a, b) => a + b, 0) / keys;
    if (process.env.TYPING_RENDERS_LOG) console.log('TYPING_RENDERS ' + JSON.stringify({ total, ...Object.fromEntries([...counts].map(([k, v]) => [k, v / keys])) }));
    expect(field.value).toBe(text);
    // The measurement sees renders at all: the composer's owner renders once per key.
    expect(per('V3Chat')).toBe(1);
    // Everything that does not show the draft does not render.
    expect(per('SessionPanel')).toBe(0);
    expect(per('StatusBar')).toBe(0);
    expect(per('MessageBlock')).toBe(0);
    expect(per('ChatTranscript')).toBe(0);
    expect(per('Shell2')).toBe(0);
    expect(per('ConnectedBoard')).toBe(0);
    // The whole tree: 105 components rendered per key before, 9 after (V3Chat, its menus and icons).
    expect(total).toBeLessThanOrEqual(10);
  }, 60_000);
});
