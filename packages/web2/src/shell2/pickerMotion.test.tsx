import { act, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StoreProvider, createStore } from '../state';
import { ModelMenu, exitMotionAllowed } from './ModelMenu';

/*
 * 0.1.5 G1: "the model picker, let's add like an animation, like a smoothing
 * animation". The popup rises into place and, on close, stays on the page
 * just long enough to sink away (not a menu while it does), then goes. With
 * reduced motion, or where nothing animates, it goes at once as before.
 */

function ui(open: boolean) {
  return (
    <StoreProvider store={createStore({})}>
      <ModelMenu
        wrapRef={createRef<HTMLDivElement>()}
        open={open}
        onTrigger={() => {}}
        onClose={() => {}}
        sessionId="s"
        agentRun={undefined}
        profiles={[{ id: '1', nickname: 'claude-sonnet-5-5', model: 'claude-sonnet-5-5', provider: 'anthropic', active: true, reasoningEffort: undefined }] as never}
        pickModel={vi.fn()}
        modelErr={null}
        effort="medium"
        effortRows={[{ key: 'medium', label: 'Medium', description: 'Medium' }]}
        pickEffort={() => {}}
        modelChip="Sonnet 5.5"
        modelChipShort="Sonnet 5.5"
        modelChipTitle="Sonnet 5.5"
        effortLabel="Medium"
        modes={[]}
        currentMode="ask"
        onMode={() => {}}
      />
    </StoreProvider>
  );
}

function motion(reduce: boolean) {
  (Element.prototype as unknown as { getAnimations?: () => unknown[] }).getAnimations = () => [];
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
}

afterEach(() => {
  vi.useRealTimers();
  delete (Element.prototype as unknown as { getAnimations?: unknown }).getAnimations;
  vi.unstubAllGlobals();
});

describe('the picker opens and closes smoothly', () => {
  it('exit motion only where the browser animates and motion is not reduced', () => {
    expect(exitMotionAllowed()).toBe(false);
    motion(false);
    expect(exitMotionAllowed()).toBe(true);
    motion(true);
    expect(exitMotionAllowed()).toBe(false);
  });

  it('closing keeps the menu for its exit, hidden and not a menu, then removes it', () => {
    /* Fake timers, not a 320 ms sleep against a 260 ms cap: the exit's own clock, stepped. */
    vi.useFakeTimers();
    motion(false);
    const r = render(ui(true));
    expect(screen.getByTestId('s2-model-menu').getAttribute('data-state')).toBe('open');
    r.rerender(ui(false));
    expect(screen.queryByTestId('s2-model-menu')).toBeNull();
    const closing = screen.getByTestId('s2-model-menu-closing');
    expect(closing.getAttribute('data-state')).toBe('closing');
    expect(closing.getAttribute('aria-hidden')).toBe('true');
    expect(closing.getAttribute('role')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(259);
    });
    expect(screen.getByTestId('s2-model-menu-closing')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('s2-model-menu-closing')).toBeNull();
  });

  it('the exit ends on the menu\'s own animationend, before the cap', () => {
    vi.useFakeTimers();
    motion(false);
    const r = render(ui(true));
    r.rerender(ui(false));
    const closing = screen.getByTestId('s2-model-menu-closing');
    act(() => {
      closing.dispatchEvent(new Event('animationend'));
    });
    expect(screen.queryByTestId('s2-model-menu-closing')).toBeNull();
  });

  it('reopening during the exit brings the live menu straight back', () => {
    motion(false);
    const r = render(ui(true));
    r.rerender(ui(false));
    r.rerender(ui(true));
    expect(screen.getByTestId('s2-model-menu').getAttribute('data-state')).toBe('open');
    expect(screen.queryByTestId('s2-model-menu-closing')).toBeNull();
  });

  it('with reduced motion it closes at once', () => {
    motion(true);
    const r = render(ui(true));
    r.rerender(ui(false));
    expect(screen.queryByTestId('s2-model-menu')).toBeNull();
    expect(screen.queryByTestId('s2-model-menu-closing')).toBeNull();
  });

  it('the stylesheet uses existing motion tokens and turns every new animation off under reduced motion', () => {
    const css = fs.readFileSync(path.join(__dirname, 'modelMenu.css'), 'utf8');
    expect(css).toMatch(/\.s2-menu-up\.s2-menu-model,\s*\.s2-menu-up\.s2-menu-modes \{\s*animation: s2-rise var\(--dur-3\) var\(--ease-enter\);/);
    expect(css).toMatch(/\[data-state='closing'\] \{\s*animation: s2-sink var\(--dur-2\) var\(--ease-exit\) forwards;/);
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    for (const s of ["[data-state='closing']", "svg[data-icon='check']", '.s2-menu-up.s2-menu-model,']) expect(reduced).toContain(s);
    expect(reduced).toMatch(/animation: none/);
    expect(reduced).toMatch(/transition: none/);
  });
});
