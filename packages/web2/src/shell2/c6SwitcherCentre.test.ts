import { describe, expect, it } from 'vitest';
import css from './shell2.css?raw';

const flat = css.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
const body = (sel: string): string => {
  const at = flat.indexOf(`
${sel} {`);
  if (at < 0) throw new Error(`no rule for ${sel}`);
  return flat.slice(at, flat.indexOf('}', at));
};

/* 0.1.6 C6 item 3 (owner: "make sure chat/workspace is properly centered"): a three-column row whose outer columns are
   equal, so the switcher sits on the row's centre whatever sits at either side. The browser lock is e2e/b4-narrow-switcher.mjs. */
describe('the narrow Chat / Workspace switcher is centred on its row', () => {
  it('the bar is three columns with equal outer ones, not space-between', () => {
    const b = body('.s2-narrowbar');
    expect(b).toMatch(/display:\s*grid;/);
    expect(b).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\);/);
    expect(b).not.toMatch(/space-between/);
  });
  it('the switcher takes the middle column whatever number of siblings the bar has, and its segments are one width', () => {
    const s = body('.s2-narrow-switch');
    expect(s).toMatch(/grid-column:\s*2;/);
    expect(s).toMatch(/justify-self:\s*center;/);
    expect(s).toMatch(/grid-auto-columns:\s*1fr;/);
    expect(body('.s2-narrow-switch > button')).toMatch(/text-align:\s*center;/);
    expect(body('.s2-narrowbar > :first-child')).toMatch(/grid-column:\s*1;/);
    expect(body('.s2-narrowbar > :not(:first-child):not(.s2-narrow-switch)')).toMatch(/grid-column:\s*3;/);
  });
});
