import { describe, expect, it } from 'vitest';
import { markCut, SOFT_EDGE_SELECTOR } from './softEdge';
import css from './shell2.css?raw';
import statusSrc from './StatusBar.tsx?raw';

/* 0.1.6 C6 item 2: a cut name fades; a name that fits is never masked. Browser lock: e2e/c6-soft-edges.mjs. */
const el = (cls: string, scroll: number, client: number): HTMLElement => {
  const e = document.createElement('span');
  e.className = cls;
  Object.defineProperty(e, 'scrollWidth', { value: scroll, configurable: true });
  Object.defineProperty(e, 'clientWidth', { value: client, configurable: true });
  return e;
};

describe('markCut', () => {
  it('marks a name wider than its box (positive control) and leaves one that fits alone (negative control)', () => {
    const root = document.createElement('div');
    const cut = el('s2-crumb-p', 220, 100);
    const fits = el('s2-sb-state', 40, 40);
    const rounding = el('s2-branch-l', 101, 100);
    root.append(cut, fits, rounding);
    markCut(root);
    expect(cut.getAttribute('data-cut')).toBe('true');
    expect(fits.hasAttribute('data-cut')).toBe(false);
    expect(rounding.hasAttribute('data-cut')).toBe(false);
  });
  it('clears the mark when the name later fits', () => {
    const root = document.createElement('div');
    const e = el('s2-crumb-p', 220, 100);
    root.append(e);
    markCut(root);
    expect(e.getAttribute('data-cut')).toBe('true');
    Object.defineProperty(e, 'scrollWidth', { value: 90, configurable: true });
    markCut(root);
    expect(e.hasAttribute('data-cut')).toBe(false);
  });
  it('covers every status item and the crumb (derived from the stylesheet, not hand-listed)', () => {
    const flat = css.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
    const masked = [...flat.matchAll(/([^{}]+)\{[^{}]*mask-image:\s*linear-gradient\(90deg, black calc\(100% - 18px\)[^{}]*\}/g)].flatMap((m) => m[1]!.split(','));
    expect(masked.length).toBeGreaterThanOrEqual(6);
    for (const part of masked) {
      expect(part).toMatch(/\[data-cut='true'\]/);
    }
    expect(SOFT_EDGE_SELECTOR).toContain('.s2-crumb-p');
    /* The pill's own box is never the masked element: a mask there erases its border. The text inside it is. */
    expect(SOFT_EDGE_SELECTOR.split(', ')).not.toContain('.s2-crumb');
    expect(flat).not.toMatch(/\.s2-crumb\[data-cut/);
    expect(flat).toMatch(/\.s2-crumb-p \{[^}]*flex:\s*0 1 auto;[^}]*min-width:\s*0;/);
    expect(SOFT_EDGE_SELECTOR).toContain('.s2-sb-state');
  });
  /* contract change (0.1.8.4): the observer's mark is queued (one frame for every caller); the layout-effect mark stays synchronous so first paint is right. */
  it('the status bar marks on a resize and when a name changes, never on every render', () => {
    expect(statusSrc).toMatch(/new ResizeObserver\(\(\) => \{\s*fitBranch\(bar\);\s*queueMarkCut\(bar\);/);
    expect(statusSrc).toMatch(/markCut\(bar\);\s*\}, \[branch, workspace, worktree\?\.branch, stateWord, model, agentName\]\);/);
    /* every useLayoutEffect that calls markCut has a dependency list */
    for (const m of statusSrc.matchAll(/useLayoutEffect\(\(\) => \{[\s\S]*?\n {2}\}(, \[[^\]]*\])?\);/g)) {
      if (/markCut/.test(m[0])) expect(m[1]).toBeTruthy();
    }
  });
});
