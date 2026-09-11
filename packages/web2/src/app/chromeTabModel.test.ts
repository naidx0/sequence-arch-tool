import { describe, expect, it } from 'vitest';

import {
  INITIAL_CHROME_TABS,
  WORKSPACE_PILLS,
  WORKSPACE_PANE_MIN_PX,
  WORKSPACE_PANE_RESIZER_PX,
  WORKSPACE_PANE_STORAGE_KEY,
  clampWorkspacePaneWidths,
  closeTab,
  fitVisiblePanesToWidth,
  isVisible,
  minimizeTab,
  openTab,
  readWorkspacePaneWidths,
  resizeWorkspacePanesAt,
  resolveWorkspacePaneWidths,
  shouldOpenAiCanvas,
  syncFromWorkspaceSurface,
  toggleTab,
  visibleWorkspacePanes,
  workspacePaneCapacity,
  WORKSPACE_PANE_SEAT_PX,
  workspacePaneResizerTestId,
  workspacePaneWidthsToMap,
  workspaceSplit,
  workspaceSplitGridColumns,
  writeWorkspacePaneWidths,
} from './chromeTabModel';
import type { ChromeTabId } from './chromeTabModel';

describe('chrome tab workspace model', () => {
  it('boots with chat open only — sessions live in the left rail', () => {
    expect(INITIAL_CHROME_TABS.active).toBe('chat');
    expect(INITIAL_CHROME_TABS.tabs.map((t) => t.id)).toEqual(['chat']);
  });

  it('minimising active tab switches to another open tab', () => {
    const withArch = openTab(INITIAL_CHROME_TABS, 'architecture');
    const next = minimizeTab(withArch, 'chat');
    expect(next.tabs.find((t) => t.id === 'chat')?.minimized).toBe(true);
    expect(next.active).toBe('architecture');
  });

  it('minimised tab restores on toggle', () => {
    const withArch = openTab(INITIAL_CHROME_TABS, 'architecture');
    const min = minimizeTab(withArch, 'architecture');
    expect(min.tabs.find((t) => t.id === 'architecture')?.minimized).toBe(true);
    const restored = toggleTab(min, 'architecture');
    expect(restored.active).toBe('architecture');
    expect(restored.tabs.find((t) => t.id === 'architecture')?.minimized).toBe(false);
  });

  it('close is minimise — pills have no ×', () => {
    const next = closeTab(INITIAL_CHROME_TABS, 'chat');
    expect(next.tabs.some((t) => t.id === 'chat')).toBe(true);
    expect(next.tabs.find((t) => t.id === 'chat')?.minimized).toBe(true);
  });

  it('architecture tab opens on surface sync', () => {
    const next = syncFromWorkspaceSurface(INITIAL_CHROME_TABS, 'architecture');
    expect(next.active).toBe('architecture');
    expect(next.tabs.some((t) => t.id === 'architecture')).toBe(true);
  });

  it('ai-canvas tab opens on surface sync', () => {
    const next = syncFromWorkspaceSurface(INITIAL_CHROME_TABS, 'ai-canvas');
    expect(next.active).toBe('ai-canvas');
    expect(next.tabs.some((t) => t.id === 'ai-canvas')).toBe(true);
  });

  it('toggle: closed pill opens and focuses', () => {
    const next = toggleTab(INITIAL_CHROME_TABS, 'architecture');
    expect(next.active).toBe('architecture');
    expect(isVisible(next, 'architecture')).toBe(true);
  });

  it('toggle: open unfocused pill focuses without closing others', () => {
    const withArch = openTab(INITIAL_CHROME_TABS, 'architecture');
    const focused = toggleTab(withArch, 'chat');
    expect(focused.active).toBe('chat');
    expect(isVisible(focused, 'chat')).toBe(true);
    expect(isVisible(focused, 'architecture')).toBe(true);
  });

  it('toggle does not close the last visible pill', () => {
    expect(toggleTab(INITIAL_CHROME_TABS, 'chat')).toEqual(INITIAL_CHROME_TABS);
  });

  it('visibleWorkspacePanes keeps pill order for three visible tabs', () => {
    let state = openTab(INITIAL_CHROME_TABS, 'architecture');
    state = openTab(state, 'whiteboard');
    expect(visibleWorkspacePanes(state)).toEqual(['chat', 'architecture', 'whiteboard']);
    expect(workspaceSplit(state)).toBe(true);
  });

  it('split when only canvas tabs are visible (chat minimised)', () => {
    let state = minimizeTab(openTab(INITIAL_CHROME_TABS, 'architecture'), 'chat');
    state = openTab(state, 'whiteboard');
    expect(visibleWorkspacePanes(state)).toEqual(['architecture', 'whiteboard']);
    expect(workspaceSplit(state)).toBe(true);
  });

  it('all five workspace pills visible → five panes (incl. Terminal C1.3)', () => {
    let state = openTab(INITIAL_CHROME_TABS, 'architecture');
    state = openTab(state, 'whiteboard');
    state = openTab(state, 'ai-canvas');
    state = openTab(state, 'terminal');
    expect(visibleWorkspacePanes(state)).toEqual([
      'chat',
      'architecture',
      'whiteboard',
      'ai-canvas',
      'terminal',
    ]);
    expect(workspaceSplit(state)).toBe(true);
  });

  it('Terminal pill toggles like Architecture (C1.3)', () => {
    const next = toggleTab(INITIAL_CHROME_TABS, 'terminal');
    expect(next.active).toBe('terminal');
    expect(isVisible(next, 'terminal')).toBe(true);
    expect(visibleWorkspacePanes(next)).toEqual(['chat', 'terminal']);
  });

  it('toggle hides a visible tab when another stays open', () => {
    const withArch = openTab(INITIAL_CHROME_TABS, 'architecture');
    const focusChat = toggleTab(withArch, 'chat');
    expect(focusChat.active).toBe('chat');
    const focusArch = toggleTab(focusChat, 'architecture');
    expect(focusArch.active).toBe('architecture');
    const toggled = toggleTab(focusArch, 'architecture');
    expect(toggled.tabs.find((t) => t.id === 'architecture')?.minimized).toBe(true);
    expect(workspaceSplit(toggled)).toBe(false);
  });

  it('split when chat and architecture are both visible', () => {
    const withArch = openTab(INITIAL_CHROME_TABS, 'architecture');
    expect(workspaceSplit(withArch)).toBe(true);
  });

  it('split when chat and ai-canvas are both visible', () => {
    const withCanvas = openTab(INITIAL_CHROME_TABS, 'ai-canvas');
    expect(workspaceSplit(withCanvas)).toBe(true);
  });

  it('shouldOpenAiCanvas: opens on live/pending or canvas tool', () => {
    expect(
      shouldOpenAiCanvas({
        blocks: [{ id: 'b1', status: 'live' }],
        knownBlockIds: new Set(),
      }),
    ).toBe(true);
    expect(
      shouldOpenAiCanvas({
        blocks: [{ id: 'b1', status: 'landed' }],
        knownBlockIds: new Set(['b1']),
        canvasToolRunning: true,
      }),
    ).toBe(true);
  });

  it('shouldOpenAiCanvas: opens on newly landed block the seat has not seen', () => {
    expect(
      shouldOpenAiCanvas({
        blocks: [{ id: 'new', status: 'landed' }],
        knownBlockIds: new Set(['old']),
      }),
    ).toBe(true);
    expect(
      shouldOpenAiCanvas({
        blocks: [{ id: 'old', status: 'landed' }],
        knownBlockIds: new Set(['old']),
      }),
    ).toBe(false);
  });

  it('resolveWorkspacePaneWidths defaults to equal columns with resizer gutters', () => {
    const panes = ['chat', 'architecture'] as const;
    const widths = resolveWorkspacePaneWidths(panes, 808, {});
    expect(widths).toHaveLength(2);
    expect(widths[0]! + widths[1]! + WORKSPACE_PANE_RESIZER_PX).toBe(808);
    expect(widths[0]).toBe(widths[1]);
  });

  it('resizeWorkspacePanesAt moves the gutter and respects the floor', () => {
    const start = [400, 400];
    expect(resizeWorkspacePanesAt(start, 0, 50)).toEqual([450, 350]);
    expect(resizeWorkspacePanesAt(start, 0, -300)).toEqual(start);
  });

  it('workspaceSplitGridColumns interleaves panes and resizer tracks', () => {
    expect(workspaceSplitGridColumns([300, 500])).toBe('300px 8px 500px');
  });

  it('workspace pane widths round-trip through localStorage', () => {
    const map = workspacePaneWidthsToMap(['chat', 'architecture'], [420, 380]);
    writeWorkspacePaneWidths(map);
    expect(readWorkspacePaneWidths()).toEqual(map);
    window.localStorage.removeItem(WORKSPACE_PANE_STORAGE_KEY);
  });

  it('workspacePaneResizerTestId names the left pane', () => {
    expect(workspacePaneResizerTestId('chat')).toBe('shell-workspace-resizer-chat');
  });

  it('clampWorkspacePaneWidths never drops below the minimum', () => {
    const clamped = clampWorkspacePaneWidths([100, 100], 400);
    expect(clamped.every((w) => w >= WORKSPACE_PANE_MIN_PX)).toBe(true);
    expect(clamped.reduce((a, b) => a + b, 0)).toBe(400);
  });

  /* ── The frame's seating, and what happens when it runs out ─────────────
   *
   * The shell is overflow:hidden and the split track list is written inline in
   * px, so a pane past the container is not squeezed and is not scrollable —
   * it is painted OUTSIDE the window with the pill still reading ON. Measured
   * at 1152px the Browser pane sat entirely off screen. These two lock the
   * arithmetic that stops it. */

  it('workspacePaneCapacity seats exactly what the SEAT floor and gutters allow', () => {
    /* THE SEAT FLOOR, NOT THE DRAG FLOOR. The 2026-08-29 audit put five views
       in a 1440px window: every geometric check passed and every pane was an
       unusable sliver. Capacity now answers "how many USABLE columns", so the
       arithmetic below is in seat slots (280 + 8). */
    const slot = WORKSPACE_PANE_SEAT_PX + WORKSPACE_PANE_RESIZER_PX;
    /* n panes need n*280 + (n-1)*8; one pixel less seats one fewer. */
    expect(workspacePaneCapacity(4 * slot - WORKSPACE_PANE_RESIZER_PX)).toBe(4);
    expect(workspacePaneCapacity(4 * slot - WORKSPACE_PANE_RESIZER_PX - 1)).toBe(3);
    /* The audit's own frame: a 1440 window (body ≈ 1224) seats FOUR usable
       views — the fifth is refused into a pill, not rendered as a sliver. */
    expect(workspacePaneCapacity(1224)).toBe(4);
    /* And the widths the OLD floor called "three seats" now honestly seat one:
       three panes at 176px each was the melt, not a layout. */
    expect(workspacePaneCapacity(544)).toBe(1);
    /* Never zero, and never more pills than the bar has. */
    expect(workspacePaneCapacity(10)).toBe(1);
    expect(workspacePaneCapacity(6000)).toBe(6);
    /* Unmeasured is not the same as no room. */
    expect(workspacePaneCapacity(0)).toBe(6);
    expect(workspacePaneCapacity(Number.NaN)).toBe(6);
  });

  it('fitVisiblePanesToWidth minimises newest-first and never takes the focused pane', () => {
    let state = openTab(openTab(openTab(INITIAL_CHROME_TABS, 'architecture'), 'terminal'), 'browser');
    state = { ...state, active: 'chat' };
    expect(visibleWorkspacePanes(state)).toEqual(['chat', 'architecture', 'terminal', 'browser']);

    /* Three SEAT slots (3*280 + 2*8 = 856). The newest open (browser) is the
       one demoted. */
    const threeSeats = 3 * WORKSPACE_PANE_SEAT_PX + 2 * WORKSPACE_PANE_RESIZER_PX;
    const fitted = fitVisiblePanesToWidth(state, threeSeats);
    expect(visibleWorkspacePanes(fitted)).toEqual(['chat', 'architecture', 'terminal']);
    /* Demoted, not closed — the pill is still there to press. */
    expect(fitted.tabs.map((t) => t.id)).toEqual(['chat', 'architecture', 'terminal', 'browser']);

    /* The pane the reader is in survives even when it is the newest. */
    const twoSeats = 2 * WORKSPACE_PANE_SEAT_PX + WORKSPACE_PANE_RESIZER_PX;
    const onBrowser = fitVisiblePanesToWidth({ ...state, active: 'browser' }, twoSeats);
    expect(visibleWorkspacePanes(onBrowser)).toContain('browser');
    expect(visibleWorkspacePanes(onBrowser)).toHaveLength(2);

    /* Nothing to do → the same object, so the effect that calls this settles. */
    expect(fitVisiblePanesToWidth(state, 2000)).toBe(state);
    expect(fitVisiblePanesToWidth(state, 0)).toBe(state);
  });
});

/*
 * THE TRACK TOTAL CAN NEVER EXCEED THE FRAME.
 *
 * The pane work claimed "with the cap the track total is provably <= the container".
 * It was not: clampWorkspacePaneWidths returned n * MIN whenever the frame was below the
 * floor, so a 544px frame holding four panes produced 4*160 + 3*8 = 664 and painted 120px
 * past the right edge — the offscreen defect arriving by a second road. This sweep is the
 * lock: over every pane count and a range of frames that straddles the floor, the resolved
 * tracks plus their gutters must fit. It fails on the pre-fix code at the narrow widths.
 */
describe('workspace pane widths never overflow the frame', () => {
  it('resolved tracks + gutters fit the container at every width and pane count', () => {
    const ids: ChromeTabId[] = [...WORKSPACE_PILLS];
    for (let n = 1; n <= ids.length; n += 1) {
      const panes = ids.slice(0, n);
      for (let container = 120; container <= 2200; container += 37) {
        const widths = resolveWorkspacePaneWidths(panes, container, {});
        expect(widths).toHaveLength(n);
        const gutters = (n - 1) * WORKSPACE_PANE_RESIZER_PX;
        const total = widths.reduce((a, b) => a + b, 0) + gutters;
        // Sub-pixel tolerance only — never a whole pixel past the frame.
        expect(total).toBeLessThanOrEqual(container + 0.001);
        for (const w of widths) expect(w).toBeGreaterThan(0);
      }
    }
  });

  it('clampWorkspacePaneWidths always sums to the usable width, floor or not', () => {
    for (let n = 1; n <= 6; n += 1) {
      const asked = Array.from({ length: n }, (_v, i) => 100 + i * 90);
      for (const usable of [40, 120, n * 160 - 1, n * 160, n * 160 + 1, 900, 1800]) {
        const out = clampWorkspacePaneWidths(asked, usable);
        const sum = out.reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(usable, 6);
      }
    }
  });
});
