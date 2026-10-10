import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { quietWhenHidden } from './quietWhenHidden';

/* S4 (Part 7 R13): nothing animates while the window is hidden. */

const setVisibility = (state: 'hidden' | 'visible') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

afterEach(() => {
  document.documentElement.removeAttribute('data-hidden');
});

describe('quiet when hidden', () => {
  it('marks the root while the page is hidden and clears it when shown, until stopped', () => {
    const stop = quietWhenHidden();
    setVisibility('hidden');
    expect(document.documentElement.hasAttribute('data-hidden')).toBe(true);
    setVisibility('visible');
    expect(document.documentElement.hasAttribute('data-hidden')).toBe(false);
    stop();
    setVisibility('hidden');
    expect(document.documentElement.hasAttribute('data-hidden')).toBe(false);
  });

  it('the token sheet pauses every animation under that mark', () => {
    const css = readFileSync(resolve(__dirname, '../tokens/graphite.css'), 'utf8').replace(/\r\n/g, '\n');
    expect(css).toMatch(/:root\[data-hidden\] \*,\n:root\[data-hidden\] \*::before,\n:root\[data-hidden\] \*::after \{\n\s*animation-play-state: paused !important;/);
  });
});
