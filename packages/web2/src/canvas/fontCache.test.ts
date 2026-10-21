import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { glanceFont, resetFontCache, titleFont } from './textFit';

/*
 * THE FONT STRINGS ARE READ ONCE PER ROOM, NOT ONCE PER MEASUREMENT.
 *
 * Zoom re-fits every card title, and every measurement used to resolve three
 * tokens through getComputedStyle (a style recalculation each). The cache must
 * not outlive the room it was read in: a theme switch, a typeface choice and an
 * inline token rewrite all change what the faces are.
 */
const root = document.documentElement;

function setRamp(ui: string, t14 = '14px', t11 = '11px', fw = '600') {
  root.style.setProperty('--font-ui', ui);
  root.style.setProperty('--t-14', t14);
  root.style.setProperty('--t-11', t11);
  root.style.setProperty('--fw-head', fw);
}

beforeEach(() => {
  root.removeAttribute('style');
  root.removeAttribute('data-theme');
  root.removeAttribute('data-font');
  resetFontCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  root.removeAttribute('style');
  root.removeAttribute('data-theme');
  root.removeAttribute('data-font');
  resetFontCache();
});

describe('titleFont / glanceFont cache', () => {
  it('composes the faces from the live tokens', () => {
    setRamp('Inter');
    expect(titleFont()).toBe('600 14px Inter');
    expect(glanceFont()).toBe('11px Inter');
  });

  it('asks the cascade once, however many times it is read', () => {
    setRamp('Inter');
    const spy = vi.spyOn(window, 'getComputedStyle');
    titleFont();
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    glanceFont(); // the same room read serves both faces
    const afterGlance = spy.mock.calls.length;
    for (let i = 0; i < 200; i++) {
      titleFont();
      glanceFont();
    }
    expect(spy.mock.calls.length).toBe(afterGlance);
  });

  it('is re-read when the theme changes', () => {
    root.dataset.theme = 'dark';
    setRamp('Inter');
    expect(titleFont()).toBe('600 14px Inter');
    /* The theme switch rewrites the ramp (here: through the inline style a theme writes). */
    root.dataset.theme = 'light';
    root.style.setProperty('--font-ui', 'Georgia');
    expect(titleFont()).toBe('600 14px Georgia');
    expect(glanceFont()).toBe('11px Georgia');
  });

  it('is re-read when the typeface choice changes', () => {
    setRamp('Inter');
    root.dataset.font = 'inter';
    expect(titleFont()).toBe('600 14px Inter');
    root.dataset.font = 'mono';
    root.style.setProperty('--font-ui', 'Menlo');
    expect(titleFont()).toBe('600 14px Menlo');
  });

  it('never keeps the fallbacks: a read before the ramp loads is retried', () => {
    /* No tokens yet (stylesheet still loading). */
    expect(titleFont()).toBe('600 14px sans-serif');
    setRamp('Inter', '15px');
    expect(titleFont()).toBe('600 15px Inter');
  });
});
