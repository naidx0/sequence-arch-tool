import { describe, expect, it } from 'vitest';

import script from '../../../e2e/audit-reverify.mjs?raw';

/* 0.1.8.4 perf: the Bastion backdrop draws at the first input or idle moment (AsciiStage), not at boot. The audit
   re-verify script reads data-drawn, so it must give the page that input before it waits. A static check: the e2e
   itself is a browser run the orchestrator owes. */
describe('audit-reverify waits for the deferred backdrop', () => {
  const at = script.indexOf('ASCII backdrop is drawn');
  const block = script.slice(at, script.indexOf('});', script.indexOf('waitFor', at)));
  it('finds the backdrop check', () => {
    expect(at).toBeGreaterThan(-1);
    expect(block).toContain('data-drawn="true"');
  });
  it('sends one key input before it waits for data-drawn, and waits for it', () => {
    const press = block.search(/page\.keyboard\.press\(/);
    const wait = block.search(/data-drawn="true"[\s\S]*waitFor\(/);
    expect(press).toBeGreaterThan(-1);
    expect(wait).toBeGreaterThan(press);
  });
});
