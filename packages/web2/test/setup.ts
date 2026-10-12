import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import { installResizeObserver } from '../src/canvas/testResizeObserver';
import { loadKatex } from '../src/chat/MathText';

/**
 * Unmount every tree between tests.
 *
 * Render tests share one jsdom document for the whole file. Without this, the
 * second test in a file sees the first test's DOM still mounted, every
 * getByTestId that should be unique throws "found multiple elements", and the
 * usual reaction is to loosen the query rather than to clean up. Cleaning up is
 * the fix.
 */
afterEach(() => {
  cleanup();
});

/**
 * A ResizeObserver, because jsdom has none and the app now needs one.
 *
 * ADDED BY WAVE 3, AND HERE IS WHY IT IS A SETUP CONCERN RATHER THAN A BOARD
 * ONE. Mounting the board into `App.tsx` put @xyflow/react in the app's mount
 * path, and it constructs a ResizeObserver unconditionally at mount
 * (`dist/esm/index.js:1298`). jsdom does not implement one, so nine tests that
 * had nothing to do with the board — `test/boot.test.tsx` and
 * `test/font.test.tsx`, which render <App/> — went red on a missing web API.
 * That is an ENVIRONMENT gap, and this file is where environment gaps are
 * filled; leaving it in the board's own test files would have fixed the board's
 * tests and left the app's broken.
 *
 * THE STUB NEVER FIRES, AND NOTHING MAY BE ASSERTED THROUGH IT. jsdom has no
 * layout at all, so every box is 0 x 0 and a real observer would have nothing
 * to report. It exists so a component that constructs one can mount — never so
 * a measurement can be faked. Every size question on this board is asked in
 * `src/canvas/boardRendered.test.ts`, in a real browser.
 *
 * One implementation, imported rather than restated, so this file and the board
 * lane cannot end up with two stubs that behave differently.
 */
installResizeObserver();

/**
 * KaTeX, loaded before any test renders.
 *
 * `chat/MathText.tsx` loads katex on first use so it is not a boot cost; the
 * first formula a session renders shows its source for a frame and then
 * typesets. Render tests assert the typeset result synchronously, and in the
 * app every formula after the first does typeset synchronously, so the tests
 * start from that state. The not-yet-loaded path has its own test in
 * `src/chat/ProseMath.test.tsx`, which resets this.
 */
await loadKatex();

/*
 * THE BOARD'S CLICK-ONLY PARTS (node menu, edge evidence) and the agent
 * overlay load after boot in the app (src/canvas/preloadable.tsx, perf
 * ratchet). The board preloads them when idle, so a right-click finds its
 * menu ready; the tests start from that state too. The not-yet-loaded path
 * has its own test in `src/canvas/preloadable.test.tsx`.
 */
const { preloadBoardExtras } = await import('../src/canvas/preloadable');
await preloadBoardExtras();
