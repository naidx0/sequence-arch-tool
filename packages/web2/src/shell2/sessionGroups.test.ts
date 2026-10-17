import { describe, expect, it } from 'vitest';

import type { SessionIndexEntry } from '@sequence/api-types';

import { groupSessions } from './sessionGroups';

const now = new Date(2026, 9, 6, 15, 0, 0);
const at = (d: number, h = 10) => new Date(2026, 9, d, h, 0, 0).toISOString();
const wt = (removed = false) => ({ id: 'w', path: '/w', branch: 'sequence/x', baseCommit: 'a', baseBranch: 'main', createdAt: at(1), ...(removed ? { removedAt: at(2) } : {}) });
const row = (id: string, updatedAt: string, extra: Record<string, unknown> = {}) =>
  ({ id, title: id, createdAt: updatedAt, updatedAt, ...extra }) as SessionIndexEntry;

describe('the session panel groups (Decision 49)', () => {
  it('puts a live worktree under Worktrees whatever its age, then splits the rest on the local day', () => {
    const groups = groupSessions(
      [row('old', at(1)), row('new', at(6, 9)), row('tree', at(1), { worktree: wt() }), row('gone', at(6, 8), { worktree: wt(true) })],
      now,
    );
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ['Today', ['new', 'gone']],
      ['Worktrees', ['tree']],
      ['Earlier', ['old']],
    ]);
  });

  it('returns no empty group, and a pinned chat leads its group', () => {
    const groups = groupSessions([row('a', at(6, 9)), row('b', at(6, 8), { pinned: true })], now);
    expect(groups.map((g) => g.key)).toEqual(['today']);
    expect(groups[0]!.rows.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('is derived from every row it is given: no row is dropped or doubled', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`r${i}`, at((i % 6) + 1, i % 20), i % 7 === 0 ? { worktree: wt() } : {}));
    const ids = groupSessions(rows, now).flatMap((g) => g.rows.map((r) => r.id));
    expect(ids.sort()).toEqual(rows.map((r) => r.id).sort());
  });
});
