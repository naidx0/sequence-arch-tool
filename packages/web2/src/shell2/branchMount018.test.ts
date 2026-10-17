import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/* 0.1.8: the crumb's branch is drawn by one named mount point, so BranchSwitcher can replace it in one line. */
const src = readFileSync(resolve(__dirname, 'Shell2.tsx'), 'utf8').replace(/\r\n/g, '\n');

describe('the branch crumb mount point', () => {
  it('is one named component, used once in the crumb, rendering today\'s static branch text', () => {
    expect(src.match(/<BranchSwitcherMount branch=\{branch\} \/>/g)).toHaveLength(1);
    const def = src.slice(src.indexOf('function BranchSwitcherMount'));
    const body = def.slice(0, def.indexOf('\n}\n'));
    expect(body).toContain('className="s2-branch s2-crumb-b"');
    expect(body).toContain('<span className="s2-branch-l">{branch}</span>');
    expect(body).toContain('data-testid="s2-branch-mount"');
  });
});
