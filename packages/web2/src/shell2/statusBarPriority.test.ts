import { describe, expect, it } from 'vitest';

import shell2 from './shell2.css?raw';
import { BRANCH_MIN_PX, fitBranch } from './StatusBar';

/* WHAT THIS READS: the stylesheet's text (jsdom has no layout). The measured half is the built app in
   headless Chromium at a 420px chat column: workspace >= 12 characters, branch shown when there is room. */
function lastRule(raw: string, selector: string): string {
  const css = raw.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
  const at = css.lastIndexOf(`${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
}
const shrink = (r: string) => Number(/flex:\s*0\s+(\d+)\s+auto/.exec(r)?.[1] ?? NaN);

describe('status bar priority: state and model, then the workspace, the branch last', () => {
  const state = lastRule(shell2, ".s2-status > .s2-sb-x:has(.s2-sb-state)");
  const ws = lastRule(shell2, ".s2-status > .s2-sb-x:has([data-testid='s2-status-workspace'])");
  const branch = lastRule(shell2, ".s2-status > .s2-sb-x:has([data-testid='s2-status-branch'])");
  const model = lastRule(shell2, ".s2-status > .s2-sb-x:has([data-testid='s2-status-model'])");
  it('the model never shrinks; the branch shrinks first; the workspace keeps about 12 characters', () => {
    expect(model).toMatch(/flex:\s*0\s+0\s+auto/);
    expect(shrink(branch)).toBeGreaterThan(shrink(ws));
    expect(shrink(branch)).toBeGreaterThan(shrink(state));
    expect(ws).toMatch(/min-width:\s*calc\((1[2-9]|[2-9]\d)ch/);
    /* 0.1.8: the state's word keeps its whole text up to 20ch ("Waiting on you", "Running a subagent"), never cut mid-word. */
    expect(state).toMatch(/flex:\s*0 0 auto/);
    expect(state).toMatch(/max-width:\s*(1[89]|[2-9]\d)ch/);
    expect(state).not.toMatch(/min\(max-content/);
  });
  it('a branch narrower than the faded minimum is hidden with its divider, never drawn as a stub', () => {
    const hide = lastRule(shell2, ".s2-status[data-nobranch] > .s2-sb-x:has([data-testid='s2-status-branch']),\n.s2-status[data-nobranch] > .s2-vb:has(+ .s2-sb-x [data-testid='s2-status-branch'])");
    expect(hide).toMatch(/display:\s*none/);
  });
  it('fitBranch sets and clears the flag from what the branch text measures', () => {
    const bar = document.createElement('footer');
    bar.innerHTML = '<span data-testid="s2-status-branch">wip/shell3</span>';
    const t = bar.firstElementChild as HTMLElement;
    const size = (sw: number, cw: number) => {
      Object.defineProperty(t, 'scrollWidth', { configurable: true, value: sw });
      Object.defineProperty(t, 'clientWidth', { configurable: true, value: cw });
    };
    size(60, 0);
    fitBranch(bar);
    expect(bar.getAttribute('data-nobranch')).toBe('true');
    /* a stub narrower than the faded minimum is hidden; one that is cut but wide enough stays and fades */
    size(60, BRANCH_MIN_PX - 1);
    fitBranch(bar);
    expect(bar.getAttribute('data-nobranch')).toBe('true');
    size(60, BRANCH_MIN_PX);
    fitBranch(bar);
    expect(bar.hasAttribute('data-nobranch')).toBe(false);
    size(60, 60);
    fitBranch(bar);
    expect(bar.hasAttribute('data-nobranch')).toBe(false);
  });
  it('the shrunk items still end in an ellipsis, and the full values are in the titles', () => {
    expect(shell2).toMatch(/\.s2-sb-state,\s*\n\.s2-status \.s2-sb-x > span[^{]*\{[^}]*text-overflow:\s*ellipsis/);
  });
});
