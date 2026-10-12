import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuns } from '../agents/agentRuns';
import { resolvedModel } from '../agents/activeModel';
import { StoreProvider, createStore } from '../state';
import { StatusBar } from './StatusBar';

/* H4: [state] | [model icon + model name] | [context circle button] | [workspace]. */

function mount(opts: { agent?: string; model?: string; windowTokens?: number | null } = {}) {
  const store = createStore({});
  store.dispatch({ type: 'composer/model', model: { model: opts.model ?? 'claude-sonnet-5-5', origin: 'api-key' } });
  store.dispatch({ type: 'composer/context-window', tokens: opts.windowTokens === undefined ? null : opts.windowTokens });
  store.dispatch({ type: 'session/index', sessions: [{ id: 'c1', title: 'a', pinned: false, updatedAt: '2026-01-01' }], activeId: 'c1' } as never);
  act(() => agentRuns.patch((s) => ({ ...s, runs: opts.agent ? [{ id: 'a', sessionId: 'c1', agentRef: opts.agent, nodeId: null, nodeLabel: null, prompt: 'q', status: 'done', startedAt: 1, endedAt: 2, items: [], approvals: [], error: null, usage: null } as never] : [], agents: opts.agent ? { c1: opts.agent } : {} })));
  return render(
    <StoreProvider store={store}>
      <StatusBar />
    </StoreProvider>,
  );
}

const words = (): string => {
  const c = screen.getByTestId('s2-status').cloneNode(true) as HTMLElement;
  c.querySelectorAll('svg, [role="dialog"]').forEach((n) => n.remove());
  return c.textContent ?? '';
};

describe('H4: the status bar under the composer', () => {
  beforeEach(() => agentRuns.patch((s) => ({ ...s, runs: [], agents: {} })));
  afterEach(() => {
    cleanup();
    act(() => resolvedModel.set(null));
  });

  it('with an agent that has not named its model there is no "<Agent> default" segment', () => {
    mount({ agent: 'claude' });
    expect(words()).not.toMatch(/Claude|default$/i);
    expect(screen.getByTestId('s2-status-model').textContent).toBe('Default model');
  });

  it('names the model, never the provider, and has no "No context" text', () => {
    mount({ windowTokens: 1_000_000 });
    expect(screen.getByTestId('s2-status-model').textContent).toBe('Sonnet 5.5');
    expect(words()).not.toMatch(/Claude|No context/);
    expect(screen.queryByTestId('s2-status-context-empty')).toBeNull();
  });

  it('with no window and no usage the circle still renders as a button and its panel says nothing was sent', () => {
    mount({ windowTokens: null });
    const ring = screen.getByTestId('composer-context');
    expect(ring.tagName).toBe('BUTTON');
    expect(ring.getAttribute('data-fraction')).toBe('0.000');
    expect(screen.queryByTestId('composer-context-breakdown')).toBeNull();
    fireEvent.focus(ring);
    const panel = screen.getByTestId('composer-context-breakdown');
    expect(panel.textContent).toMatch(/Nothing sent yet/);
    expect(panel.textContent).not.toMatch(/—/);
  });

  it('hover opens the breakdown after the pause and leaving closes it', () => {
    vi.useFakeTimers();
    try {
      mount({ windowTokens: 200_000 });
      const ring = screen.getByTestId('composer-context');
      const anchor = ring.parentElement!;
      expect(anchor.className).toContain('ctxring-anchor');
      expect(ring.getAttribute('aria-label')).toMatch(/nothing sent yet/i);
      fireEvent.mouseEnter(anchor);
      expect(screen.queryByTestId('composer-context-breakdown')).toBeNull();
      act(() => void vi.advanceTimersByTime(300));
      expect(screen.getByTestId('composer-context-breakdown').textContent).toMatch(/Window holds 200k tokens/);
      fireEvent.mouseLeave(anchor);
      expect(screen.queryByTestId('composer-context-breakdown')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Escape closes the panel however it was opened: focus, hover or click', () => {
    vi.useFakeTimers();
    try {
      mount({ windowTokens: 200_000 });
      const ring = screen.getByTestId('composer-context');
      const open = () => screen.queryByTestId('composer-context-breakdown');
      act(() => ring.focus());
      expect(open()).not.toBeNull();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(open()).toBeNull();
      expect(document.activeElement).toBe(ring);
      fireEvent.mouseEnter(ring.parentElement!);
      act(() => void vi.advanceTimersByTime(300));
      expect(open()).not.toBeNull();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(open()).toBeNull();
      fireEvent.click(ring);
      expect(ring.getAttribute('data-open')).toBe('pinned');
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(open()).toBeNull();
      /* Control: another key leaves it open. */
      fireEvent.click(ring);
      fireEvent.keyDown(document, { key: 'a' });
      expect(open()).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the hover title is the model name only, never the provider', () => {
    mount({ windowTokens: 1_000_000 });
    const x = screen.getByTestId('s2-status-model').closest('.s2-sb-x') as HTMLElement;
    expect(x.getAttribute('title')).toBe('Sonnet 5.5');
  });

  it('an agent whose model is a "default" placeholder shows the model its description names', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/model', model: { model: 'claude-sonnet-5-5', origin: 'api-key' } });
    store.dispatch({ type: 'session/index', sessions: [{ id: 'c1', title: 'a', pinned: false, updatedAt: '2026-01-01' }], activeId: 'c1' } as never);
    act(() =>
      agentRuns.patch((st) => ({
        ...st,
        runs: [{ id: 'a', sessionId: 'c1', agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: 'q', status: 'done', startedAt: 1, endedAt: 2, items: [], approvals: [], error: null, usage: null } as never],
        agents: { c1: 'claude' },
        caps: { claude: { models: [{ id: 'default', name: 'Default (recommended)', description: 'Opus 4.5 - Most capable for complex work', efforts: [] }], efforts: [], commands: [], skills: [] } },
        chatConfig: { c1: { model: 'default' } },
      })),
    );
    render(
      <StoreProvider store={store}>
        <StatusBar />
      </StoreProvider>,
    );
    expect(screen.getByTestId('s2-status-model').textContent).toBe('Opus 4.5');
    /* A placeholder whose description names nothing: the neutral label, never "Default (recommended)". */
    act(() => agentRuns.patch((st) => ({ ...st, caps: { claude: { models: [{ id: 'default', name: 'Default (recommended)', efforts: [] }], efforts: [], commands: [], skills: [] } } })));
    expect(screen.getByTestId('s2-status-model').textContent).toBe('Default model');
    act(() => agentRuns.patch((st) => ({ ...st, caps: undefined, chatConfig: undefined })));
    expect(screen.getByTestId('s2-status-model').textContent).toBe('Default model');
  });
});

describe('0.1.7 R1: a long model name is capped at 12ch and fades, never an ellipsis', () => {
  const css = () => readFileSync(resolve(__dirname, 'shell2.css'), 'utf8').replace(/\r\n/g, '\n');
  const chipCss = () => readFileSync(resolve(__dirname, 'modelMenu.css'), 'utf8').replace(/\r\n/g, '\n');
  it('the status bar model name has max-width 12ch, clips, and takes the soft-edge fade when cut', () => {
    const base = css().match(/\.s2-sb-x \[data-testid='s2-status-model'\] \{([^}]*)\}/);
    expect(base).not.toBeNull();
    expect(base![1]).toMatch(/max-width:\s*12ch/);
    expect(base![1]).toMatch(/text-overflow:\s*clip/);
    expect(base![1]).not.toMatch(/ellipsis/);
    /* The model is in the shared soft-edge rule that draws the mask, and nothing turns the mask back off. */
    const fade = css().match(/(\.s2-sb-state\[data-cut='true'\],[^{]*)\{([^}]*)\}/);
    expect(fade![1]).toContain("[data-testid='s2-status-model'][data-cut='true']");
    expect(fade![2]).toMatch(/mask-image:\s*linear-gradient/);
    expect(css()).not.toMatch(/s2-status-model'\]\[data-cut='true'\]:not[^{]*\{[^}]*mask-image:\s*none/);
    const strong = css().match(/\.s2-status \.s2-sb-x > span\[data-testid='s2-status-model'\]:not\(\.s2-sb-dot\):not\(\.s2-sb-icon\):not\(\.s2-sb-ring\) \{([^}]*)\}/);
    expect(strong![1]).toMatch(/text-overflow:\s*clip/);
  });
  it('the composer chip name has the same cap and fade, marked only when cut', () => {
    const rule = chipCss().match(/\.s2-pill-model \.s2-pill-l \{([^}]*)\}/);
    expect(rule![1]).toMatch(/max-width:\s*12ch/);
    expect(rule![1]).toMatch(/text-overflow:\s*clip/);
    expect(rule![1]).not.toMatch(/ellipsis/);
    const fade = chipCss().match(/\.s2-pill-model \.s2-pill-l\[data-cut='true'\] \{([^}]*)\}/);
    expect(fade![1]).toMatch(/mask-image:\s*linear-gradient/);
    /* The empty state keeps its whole label. */
    const connect = chipCss().match(/\.s2-pill-model\[data-action='connect'\] \.s2-pill-l \{([^}]*)\}/);
    expect(connect![1]).toMatch(/max-width:\s*none/);
  });
  it('the mode glyph in the chip has no colour of its own: the chip ink, no accent anywhere on it', () => {
    const c = chipCss();
    const glyph = c.match(/\.s2-mode-ico \{([^}]*)\}/);
    expect(glyph![1]).toMatch(/color:\s*var\(--b-ink1\)/);
    const rules = [...c.matchAll(/([^{}]*(?:s2-mode-ico|s2-pb-mode)[^{}]*)\{([^}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(2);
    for (const m of rules) expect(m[2]).not.toMatch(/accent|--b-acc|tint|color-mix/);
    expect(c).not.toMatch(/\[data-mode=[^\]]*\][^{]*\{[^}]*color:/);
  });
});

describe('H4: the breakdown panel does not open over the composer controls', () => {
  it('the status-bar panel grows left from the ring (right: 0), not rightwards over the chip and send', () => {
    const css = readFileSync(resolve(__dirname, 'shell2.css'), 'utf8').replace(/\r\n/g, '\n');
    const rule = css.match(/\.s2-status \.s2-ctx \.ctxring-panel \{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/right:\s*0;/);
    expect(rule![1]).toMatch(/left:\s*auto;/);
  });
});
