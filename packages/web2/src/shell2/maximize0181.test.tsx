import { readFileSync } from 'node:fs';
import path from 'node:path';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fitViewport, FOCUS_MIN_ZOOM, SHOW_INSIDE_MIN_ZOOM } from '../canvas/camera';
import { createStore } from '../state';
import { GOAL_COMMAND_HINT } from '../v3/goalCopy';
import { V3App } from '../v3/V3App';
import { FULL_PANE_KEY } from './Shell2';

/*
 * 0.1.8.1 C8 (audit P2-5, P2-7, P2-6). Maximize hides the sidebar and keeps the tab strip, and is remembered; "Show
 * inside" opens fitted at no less than 80 %; /goal's words come from one constant.
 */

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('v3.railCollapsed', '0');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

const railShut = () => document.querySelector('.v3-rail-slot')?.getAttribute('data-collapsed') === 'true';

describe('maximize (C8, P2-5)', () => {
  it('hides the sidebar, keeps every surface name in the strip, and is remembered across a reload', () => {
    render(<V3App appStore={createStore({})} />);
    act(() => {
      fireEvent.click(screen.getByTestId('s2-tab-whiteboard'));
    });
    expect(railShut()).toBe(false);
    act(() => {
      fireEvent.click(screen.getByTestId('s2-pane-full-whiteboard'));
    });
    expect(railShut()).toBe(true);
    for (const id of ['architecture', 'files', 'whiteboard', 'terminal', 'agents']) expect(screen.getByTestId(`s2-tab-${id}`)).toBeTruthy();
    expect(localStorage.getItem(FULL_PANE_KEY)).toBe('whiteboard');
    /* The reader's own sidebar choice was not changed: it stands aside while maximized. */
    expect(localStorage.getItem('v3.railCollapsed')).toBe('0');

    cleanup();
    render(<V3App appStore={createStore({})} />);
    expect(screen.getByTestId('s2-pane-full-whiteboard').getAttribute('aria-pressed')).toBe('true');
    expect(railShut()).toBe(true);
    act(() => {
      fireEvent.click(screen.getByTestId('s2-pane-full-whiteboard'));
    });
    expect(railShut()).toBe(false);
    expect(localStorage.getItem(FULL_PANE_KEY)).toBeNull();
  });
});

describe('Show inside opens readable (C8, P2-7)', () => {
  it('a node far bigger than the pane is framed at no less than 80 %', () => {
    expect(SHOW_INSIDE_MIN_ZOOM).toBe(0.8);
    const v = fitViewport({ x: 0, y: 0, width: 4000, height: 3000 }, { width: 900, height: 700 }, null, null, Math.max(FOCUS_MIN_ZOOM, SHOW_INSIDE_MIN_ZOOM));
    expect(v!.zoom).toBeGreaterThanOrEqual(0.8);
  });
  it('the Show inside gesture asks the board to frame the node NOW, not at the next automatic fit', () => {
    const src = readFileSync(path.join(__dirname, '../canvas/ConnectedBoard.tsx'), 'utf8');
    expect(src).toMatch(/setFocusRequest\(\(r\) => \(\{ id: nodeId, seq: \(r\?\.seq \?\? 0\) \+ 1, now: true \}\)\)/);
    const board = readFileSync(path.join(__dirname, '../canvas/Board.tsx'), 'utf8');
    expect(board).toMatch(/minZoom: Math\.max\(FOCUS_MIN_ZOOM, SHOW_INSIDE_MIN_ZOOM\)/);
  });
});

describe('/goal says one thing everywhere (C8, P2-6)', () => {
  it('the slash menu, the New goal row and the goal chip read one constant', () => {
    expect(GOAL_COMMAND_HINT).toBe('Describe the goal; the agent writes the plan and works through it');
    const src = readFileSync(path.join(__dirname, '../v3/V3Chat.tsx'), 'utf8');
    expect(src).toMatch(/goal: GOAL_COMMAND_HINT,/);
    expect(src).toMatch(/New goal<span>\{GOAL_COMMAND_HINT\}<\/span>/);
    /* The goal form shows it as a line of its own (data-testid goal-chip, which the release smoke reads). */
    expect(src).toMatch(/data-testid="goal-chip">\s*\{GOAL_COMMAND_HINT\}/);
    for (const old of ['Set a goal and let the agent work it down', 'Set the focus for this chat', 'Name what this chat is for']) expect(src).not.toContain(old);
  });
});
