import { afterEach, describe, expect, it, vi } from 'vitest';
import { markCut, queueMarkCut } from './softEdge';

/* 0.1.8.4 P3: chat switches read layout between attribute writes (274 ms self over 5 switches at x4). Every read of a
   frame now comes before the first write. The probe logs the order of scrollWidth reads and data-cut writes. */

function names(n: number, scroll: number, client: number, log: string[]): { root: HTMLElement; els: HTMLElement[] } {
  const root = document.createElement('div');
  const els: HTMLElement[] = [];
  for (let i = 0; i < n; i++) {
    const e = document.createElement('span');
    e.className = 's2-crumb-p';
    Object.defineProperty(e, 'scrollWidth', { get: () => (log.push('read'), scroll), configurable: true });
    Object.defineProperty(e, 'clientWidth', { get: () => client, configurable: true });
    const set = e.setAttribute.bind(e);
    e.setAttribute = (k: string, v: string) => { log.push('write'); set(k, v); };
    root.append(e);
    els.push(e);
  }
  return { root, els };
}
const noWriteBeforeRead = (log: string[]) => {
  const firstWrite = log.indexOf('write');
  return firstWrite === -1 || log.lastIndexOf('read') < firstWrite;
};

describe('softEdge batches reads before writes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('markCut on N cut names does every read before the first write', () => {
    const log: string[] = [];
    const { root, els } = names(6, 220, 100, log);
    markCut(root);
    expect(log.filter((x) => x === 'read')).toHaveLength(6);
    expect(log.filter((x) => x === 'write')).toHaveLength(6);
    expect(noWriteBeforeRead(log)).toBe(true);
    expect(els.every((e) => e.getAttribute('data-cut') === 'true')).toBe(true);
  });

  it('N queued calls in one frame read everything first, write after, in one animation frame', () => {
    const frames: (() => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
    const log: string[] = [];
    const groups = [names(3, 220, 100, log), names(3, 220, 100, log), names(3, 220, 100, log)];
    for (const g of groups) queueMarkCut(g.root);
    for (const g of groups) queueMarkCut(g.root); /* the same root twice in a frame is one measure */
    expect(frames).toHaveLength(1);
    expect(log).toHaveLength(0);
    frames[0]!();
    expect(log.filter((x) => x === 'read')).toHaveLength(9);
    expect(log.filter((x) => x === 'write')).toHaveLength(9);
    expect(noWriteBeforeRead(log)).toBe(true);
    for (const g of groups) expect(g.els.every((e) => e.getAttribute('data-cut') === 'true')).toBe(true);
  });

  it('a name already marked is not written again (negative control: the spy does see a write on a fresh mark)', () => {
    const log: string[] = [];
    const { root } = names(2, 220, 100, log);
    markCut(root);
    log.length = 0;
    markCut(root);
    expect(log.filter((x) => x === 'write')).toHaveLength(0);
  });
});
