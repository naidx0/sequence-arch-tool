import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The status bar's project and branch names that do not fit end in an ellipsis. The soft-edge fade (0.1.6) left the
 * last letters half-masked, so "wip/0184-integration" read as "wip/0184-integrati". The full name is on the title.
 */
const css = readFileSync(resolve(__dirname, 'shell2.css'), 'utf8').replace(/\r\n/g, '\n');
const status = readFileSync(resolve(__dirname, 'StatusBar.tsx'), 'utf8').replace(/\r\n/g, '\n');

describe('status bar project and branch names end in an ellipsis', () => {
  for (const id of ['s2-status-workspace', 's2-status-branch']) {
    it(`${id}: a cut name has an ellipsis and no fade mask`, () => {
      /* The last matching rule wins the cascade (the soft-edge rule above it is the one being overridden). */
      const hits = [...css.matchAll(new RegExp(String.raw`\[data-testid='${id}'\]\[data-cut='true'\][^{}]*\{([^}]*)\}`, 'g'))];
      expect(hits.length, `a data-cut rule for ${id}`).toBeGreaterThan(0);
      const rule = hits[hits.length - 1]![1]!;
      expect(rule).toMatch(/text-overflow:\s*ellipsis/);
      expect(rule).toMatch(/mask-image:\s*none/);
    });
  }

  it('each row carries the full name as its title', () => {
    expect(status).toMatch(/key: 'branch', title: `Branch \$\{branch\}`/);
    expect(status).toMatch(/title: worktree \? `Worktree \$\{worktree\.branch\}` : \(repoRoot \?\? 'Home workspace'\)/);
  });
});
