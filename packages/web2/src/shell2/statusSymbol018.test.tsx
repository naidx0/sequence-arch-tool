/**
 * 0.1.8 D2 (Jaden: "status bar spacing needs a little bit of help ... the status symbol like idle working"). The idle dot and the
 * working loader are different widths, so the word moved between states and a long word was cut mid-word. One slot for the symbol,
 * and the state's word keeps its whole text.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { agentRuns } from '../agents/agentRuns';
import { StoreProvider, createStore } from '../state';
import { StatusBar } from './StatusBar';

const css = readFileSync(resolve(__dirname, 'shell2.css'), 'utf8').replace(/\r\n/g, '\n');

function mount(status: 'running' | 'done') {
  const store = createStore({});
  store.dispatch({ type: 'session/index', sessions: [{ id: 'c1', title: 'a', pinned: false, updatedAt: '2026-01-01' }], activeId: 'c1' } as never);
  act(() => agentRuns.patch((s) => ({ ...s, runs: status === 'running' ? [{ id: 'a', sessionId: 'c1', agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: 'q', status: 'running', startedAt: 1, endedAt: null, items: [], approvals: [{ id: 'p', decision: null }], error: null, usage: null } as never] : [], agents: { c1: 'claude' } })));
  return render(
    <StoreProvider store={store}>
      <StatusBar />
    </StoreProvider>,
  );
}

describe('D2: the state symbol has one slot in every state, and the word is never cut', () => {
  afterEach(() => {
    cleanup();
    act(() => agentRuns.patch((s) => ({ ...s, runs: [], agents: {} })));
  });

  it('idle and working put the symbol in the same slot, directly before the word', () => {
    for (const status of ['done', 'running'] as const) {
      mount(status);
      const slot = screen.getByTestId('s2-status-symbol');
      expect(slot.className).toBe('s2-sb-sym');
      expect(slot.nextElementSibling).toBe(screen.getByTestId('s2-status-state'));
      expect(slot.querySelector('.s2-sb-dot, [data-testid="s2-ascii-spinner"]')).toBeTruthy();
      cleanup();
    }
  });

  it('the slot is one fixed 12px box that never shrinks or clips, and the state box keeps a 20ch word whole', () => {
    const slot = /\n\.s2-sb-sym \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(slot).toMatch(/flex:\s*none/);
    expect(slot).toMatch(/width:\s*var\(--sp-12\)/);
    expect(slot).toMatch(/justify-content:\s*center/);
    expect(css).toMatch(/span\.s2-sb-sym:not\(\.s2-sb-dot\)[^{]*\{[^}]*overflow:\s*visible/);
    const at = css.lastIndexOf('.s2-status > .s2-sb-x:has(.s2-sb-state) {');
    expect(css.slice(at, css.indexOf('}', at))).toMatch(/flex:\s*0 0 auto;[\s\S]*max-width:\s*20ch/);
  });
});
