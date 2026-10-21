import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Skills > Components: a row's source badge sat beside the name on some rows and on its own line under it on others,
 * because the row wrapped whenever the one-line blurb was wider than the room. The row holds one line: the text
 * shrinks (its blurb ends in an ellipsis) and the badge never wraps or shrinks.
 */
const css = readFileSync(resolve(__dirname, 'settings.css'), 'utf8').replace(/\r\n/g, '\n');
const ruleOf = (sel: string) => {
  const m = css.match(new RegExp(String.raw`${sel.replace(/[.>]/g, (c) => String.fromCharCode(92) + c)}\s*\{([^}]*)\}`));
  expect(m, sel).toBeTruthy();
  return m![1]!;
};

describe('a component row keeps its source badge on the row', () => {
  it('the row does not wrap', () => {
    expect(ruleOf('.settings-scope .sb-comp')).toMatch(/flex-wrap:\s*nowrap/);
  });
  it('the badge does not shrink', () => {
    expect(ruleOf('.settings-scope .sb-comp > .sb-badge')).toMatch(/flex:\s*none/);
  });
  it('the text may shrink below its blurb width', () => {
    expect(ruleOf('.settings-scope .sb-comp .sb-row-txt')).toMatch(/min-width:\s*0/);
  });
});
