import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/* The boot chunk has a byte ceiling: the kit (checkers, charts, diagrams) may only be reached by a dynamic import.
   The router too, even though it is small: the hint is computed when a message is sent. */
describe('the kit stays out of the boot chunk', () => {
  const src = path.resolve(__dirname, '..');
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(p);
    }
  };
  walk(src);
  it('no static import of the kit or the router', () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        const m = /^\s*import\s[^;]*from\s+'(@sequence\/schema\/dist\/visual\/[^']+)'/.exec(line);
        if (m) bad.push(`${path.relative(src, f)}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('the kit modules are reached by import() somewhere', () => {
    const all = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    expect(all).toContain("import('@sequence/schema/dist/visual/index.js')");
  });
});
