import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seqdFromGraph } from '../../canvas';
import { LIVE_PILLS } from '../../app/chromeTabModel';
import { readShellPersisted, readShellTokens } from '../../shell';
import { createStore } from '../../state';
import { V3App } from '../../v3/V3App';
import { AsciiStage, HERO, roomTheme } from './AsciiStage';

/*
 * ROUND 8, item 7 (Jaden: the Bastion hero's ASCII "is the background behind
 * any surface that isn't open... If it's no surface open and it's just the
 * chat in the background, it's still blurred out and more opaque").
 * jsdom has no canvas, so the drawing itself is the checkpoint shots; this
 * locks which photo, where it shows, and that it is not on the boot path.
 */

const src = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

describe('the backdrop follows the room', () => {
  afterEach(() => document.documentElement.setAttribute('data-theme', 'dark'));

  it('the light room takes the day photo, the dark room the night one', async () => {
    expect(HERO.light.src).toMatch(/hero-day/);
    expect(HERO.dark.src).toMatch(/hero-night/);
    document.documentElement.setAttribute('data-theme', 'light');
    expect(roomTheme()).toBe('light');
    render(<AsciiStage mode="behind-chat" />);
    const el = screen.getByTestId('s2-ascii-backdrop');
    expect(el.getAttribute('data-theme-variant')).toBe('light');
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'dark');
      await Promise.resolve();
    });
    expect(el.getAttribute('data-theme-variant')).toBe('dark');
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('the port names its source and licence, and has no pointer lens', () => {
    const code = src('AsciiStage.tsx');
    expect(code).toMatch(/premai/);
    expect(code).toMatch(/components\/lab\/ascii-photo\.tsx/);
    expect(code).toMatch(/[Ll]icence/);
    expect(code).not.toMatch(/pointermove/);
    expect(src('SOURCE.txt')).toMatch(/Unsplash/);
  });
});

describe('where it shows, and when it loads', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  });

  it('is lazy: Shell2 imports it only through a dynamic import', () => {
    const shell = src('../Shell2.tsx');
    expect(shell).toMatch(/lazy\(\(\) => import\('\.\/backdrop\/AsciiStage'\)\)/);
    expect(shell).not.toMatch(/^import[^;]*backdrop\/AsciiStage/m);
  });

  it('with no surface open it is behind the centred chat; with one open it stays, as the lighter `under` ground', async () => {
    const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail), tokens: readShellTokens(document.documentElement), persisted: readShellPersisted() });
    render(<V3App appStore={store} />);
    for (const id of LIVE_PILLS) {
      const x = screen.queryByTestId(`v3-tab-close-${id}`);
      if (x) fireEvent.click(x);
    }
    expect(document.querySelector('.s2-row')?.getAttribute('data-stage')).toBe('none');
    const found = await screen.findByTestId('s2-ascii-backdrop', {}, { timeout: 3000 });
    expect(found.getAttribute('data-mode')).toBe('behind-chat');
    /* Round 9 ("the floating background overlaps"): the window's ground, under the cards and the status bar alike. */
    expect(found.parentElement?.getAttribute('data-testid')).toBe('shell');
    expect(found.nextElementSibling?.classList.contains('s2-row')).toBe(true);
    /* Round 11: one layer for the whole app. Opening a surface does not remove it, it dims it. */
    fireEvent.click(screen.getByTestId('s2-tab-architecture'));
    const still = screen.getByTestId('s2-ascii-backdrop');
    expect(still.getAttribute('data-mode')).toBe('under');
    expect(document.querySelectorAll('[data-testid="s2-ascii-backdrop"]')).toHaveLength(1);
  });

  it('is dimmed behind the chat, much dimmer under open surfaces (both rooms), and still under reduced motion', () => {
    const css = src('../shell2.css').replace(/\r\n/g, '\n');
    const op = (mode: string, light = false) =>
      Number(new RegExp(`${light ? ":root\\[data-theme='light'\\] " : ''}\\.s2-backdrop\\[data-drawn='true'\\]\\[data-mode='${mode}'\\] \\{\\s*opacity: ([\\d.]+);`).exec(css)?.[1]);
    expect(op('under')).toBeGreaterThan(0);
    expect(op('under')).toBeLessThanOrEqual(op('behind-chat') / 2);
    expect(op('under', true)).toBeGreaterThan(0);
    expect(op('under', true)).toBeLessThanOrEqual(op('behind-chat', true) / 2);
    expect(op('behind-chat')).toBeLessThan(0.5);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.s2-backdrop \{\s*transition: none;/);
    /* The blur is baked into the one draw, not a live filter on a large box. */
    expect(css.slice(css.indexOf('.s2-backdrop {'))).not.toMatch(/^[^@]*filter:\s*blur/);
  });
});
