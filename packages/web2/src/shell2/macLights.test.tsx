import { describe, expect, it } from 'vitest';

import cssRaw from './shell2.css?raw';

const css = cssRaw.replace(/\r\n/g, '\n');
const body = (sel: string) => {
  const i = css.indexOf(`${sel} {`);
  expect(i, `rule ${sel}`).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf('}', i));
};

/* 0.1.8 C1: the macOS traffic lights stay clear of the Sequence title (owner). main.ts places them; this is the web half. */
describe('macOS traffic lights (C1)', () => {
  it('reserves a strip for them, on mac only', () => {
    expect(css).toMatch(/:root \{\n  --mac-lights-w: 78px;/);
    expect(css).toMatch(/--mac-lights-row: 24px;/);
    expect(body(".s2[data-platform='mac'] .s2-ph")).toMatch(/padding-top:\s*var\(--mac-lights-row\)/);
    expect(css).not.toMatch(/\.s2 \.s2-ph \{[^}]*--mac-lights-row/);
  });
  it('the folded-sidebar chat header and the narrow bar leave the strip too', () => {
    expect(css).toContain(
      ".s2[data-platform='mac']:has(.s2-panel-slot[data-collapsed='true']):not(:has(.s2-iconrail)) .s2-ch,\n.s2[data-platform='mac'] .s2-narrowbar {\n  padding-left: var(--mac-lights-w);",
    );
    /* With the icon rail showing the header is not at the window edge: the rail's buttons drop below the lights instead
       (measured in the real app by e2e/c1-mac-lights.mjs). */
    expect(body(".s2[data-platform='mac'] .s2-iconrail")).toMatch(/padding-top:\s*var\(--mac-lights-rail\)/);
    expect(css).toMatch(/--mac-lights-rail: 32px;/);
  });
});
