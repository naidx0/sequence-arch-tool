import { act, render } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createStore } from '../state';
import { StoreProvider } from '../state/connect';
import { BenchOverlayBlock } from './BenchOverlayBlock';

/* The test-only overlay-open block hook (tools/bench/client negative control): off unless
   localStorage 'sequence.bench.blockMs' holds a number, and then it holds the main thread for about that long.
   It must stay off the boot chunk (perf ratchet, bootJsBytes), so only LateHosts, a lazy chunk, may import it. */

afterEach(() => localStorage.removeItem('sequence.bench.blockMs'));

function openOverlayMs(): number {
  const store = createStore({});
  render(
    <StoreProvider store={store}>
      <BenchOverlayBlock />
    </StoreProvider>,
  );
  const t0 = performance.now();
  act(() => store.dispatch({ type: 'shell/overlay', overlay: { kind: 'sessions' } } as never));
  return performance.now() - t0;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe('overlay bench block hook', () => {
  it('blocks the open for the configured time when the key is set (positive control)', () => {
    localStorage.setItem('sequence.bench.blockMs', '120');
    expect(openOverlayMs()).toBeGreaterThanOrEqual(115);
  });

  it('does not block when the key is absent', () => {
    expect(localStorage.getItem('sequence.bench.blockMs')).toBeNull();
    expect(openOverlayMs()).toBeLessThan(100);
  });

  it('ignores a non-numeric value', () => {
    localStorage.setItem('sequence.bench.blockMs', 'abc');
    expect(openOverlayMs()).toBeLessThan(100);
  });

  it('stays off the boot chunk: the overlay host does not carry it and only LateHosts imports it', () => {
    const src = join(process.cwd(), 'src');
    expect(readFileSync(join(src, 'v3/V3OverlayHost.tsx'), 'utf8')).not.toMatch(/bench/i);
    const importers = sourceFiles(src)
      .filter((f) => /from '\.{1,2}\/(?:shell\/)?BenchOverlayBlock'/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(src.length + 1).split('\\').join('/'));
    expect(importers).toEqual(['shell/LateHosts.tsx']);
  });
});
