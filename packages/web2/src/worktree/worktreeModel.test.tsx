import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { emptyTree, foldEvent } from '../agents/agentTree';
import type { AgentEvent } from '../agents/agentTypes';
import { WorktreeChip } from './WorktreeChip';
import {
  branchLabel,
  groupRunsByWorktree,
  mergeVerdict,
  removalDialog,
  worktreeApi,
  type ChatWorktree,
  type DryRun,
} from './worktreeModel';

const wt = (id: string, branch: string, merged = false): ChatWorktree => ({
  id,
  path: `/data/wt/${id}`,
  branch,
  baseCommit: 'a'.repeat(40),
  baseBranch: 'main',
  createdAt: '2026-10-06T00:00:00.000Z',
  ...(merged ? { merged: { at: '2026-10-06T01:00:00.000Z', mode: 'merge' as const, into: 'main', commit: 'b'.repeat(40) } } : {}),
});

describe('the Agents tree groups runs by worktree', () => {
  const sessions = [
    { id: 's-main' },
    { id: 's-a', worktree: wt('aaaaaaaa', 'sequence/fix-login-1a2b') },
    { id: 's-b', worktree: wt('bbbbbbbb', 'sequence/add-ping-3c4d', true) },
  ];
  it('puts the main checkout first and one group per worktree in run order', () => {
    const runs = [
      { id: 'r1', sessionId: 's-b' },
      { id: 'r2', sessionId: 's-main' },
      { id: 'r3', sessionId: 's-a' },
      { id: 'r4', sessionId: 's-b' },
      { id: 'r5', sessionId: null },
      { id: 'r6', sessionId: 'gone' },
    ];
    const groups = groupRunsByWorktree(runs, sessions);
    expect(groups.map((g) => [g.key, g.label, g.runs.map((r) => r.id)])).toEqual([
      ['main', 'Main checkout', ['r2', 'r5', 'r6']],
      ['bbbbbbbb', 'add-ping-3c4d', ['r1', 'r4']],
      ['aaaaaaaa', 'fix-login-1a2b', ['r3']],
    ]);
    expect(groups[1]!.merged).toBe(true);
  });
  it('returns no empty groups', () => {
    expect(groupRunsByWorktree([{ id: 'r', sessionId: 's-a' }], sessions).map((g) => g.key)).toEqual(['aaaaaaaa']);
    expect(groupRunsByWorktree([], sessions)).toEqual([]);
  });
  it("groups a run-node turn's events (sessionId = the chat id) under its chat's worktree", () => {
    /* The four events the server publishes for a replayed codex board-mcp-map
       turn in a bound chat (analyzer acp-s2a-server.test.ts), beside a hook session. */
    const ev = (sessionId: string, kind: AgentEvent['kind'], extra: Partial<AgentEvent> = {}, at = 1): AgentEvent => ({
      id: `${sessionId}-${kind}-${at}`,
      at,
      source: 'codex',
      sessionId,
      kind,
      paths: [],
      status: kind === 'tool_end' || kind === 'stop' ? 'done' : 'running',
      ...extra,
    });
    const tree = emptyTree();
    for (const e of [
      ev('s-main', 'tool_start', { source: 'claude-hook', tool: 'Read', toolUseId: 'u1' }),
      ev('s-a', 'session_start', { title: 'What does orders call?' }, 2),
      ev('s-a', 'tool_start', { tool: 'Read', toolKind: 'read', title: 'sequence.map', toolUseId: 'call-1' }, 3),
      ev('s-a', 'tool_end', { tool: 'Read', toolKind: 'read', title: 'sequence.map', toolUseId: 'call-1' }, 4),
      ev('s-a', 'stop', {}, 5),
    ])
      foldEvent(tree, e);
    const roots = [...tree.nodes.values()].filter((n) => n.parentId === null);
    const groups = groupRunsByWorktree(roots, sessions);
    expect(groups.map((g) => [g.label, g.runs.map((r) => r.id)])).toEqual([
      ['Main checkout', ['session:s-main']],
      ['fix-login-1a2b', ['session:s-a']],
    ]);
    const call = tree.nodes.get('tool:s-a:call-1')!;
    expect([call.title, call.status, call.parentId]).toEqual(['sequence.map', 'completed', 'turn:s-a:1']);
  });
});

const dry = (over: Partial<DryRun> = {}): DryRun => ({
  ok: true,
  target: 'main',
  targetHead: 'c'.repeat(40),
  files: [{ path: 'hello.txt', status: 'added' }],
  conflicts: [],
  worktreeDirty: true,
  mainUncommitted: [],
  method: 'merge-tree',
  ...over,
});

describe('the merge-back verdict', () => {
  it('may merge a clean dry run, and says how much', () => {
    expect(mergeVerdict(dry())).toEqual({ can: true, summary: '1 file into main', files: dry().files });
  });
  it('refuses while the checkout has uncommitted changes, before conflicts', () => {
    const v = mergeVerdict(dry({ mainUncommitted: [' M a.txt', '?? b.txt'], conflicts: ['x'] }));
    expect(v.can).toBe(false);
    expect(!v.can && v.reason).toBe('uncommitted');
    expect(!v.can && v.line).toBe('Your checkout has 2 uncommitted changes. Commit or stash them, then merge.');
  });
  it('lists conflicts and says nothing was changed', () => {
    const v = mergeVerdict(dry({ conflicts: ['a.txt'] }));
    expect(!v.can && [v.reason, v.line, v.conflicts]).toEqual(['conflicts', 'Merging into main would conflict in 1 file. Nothing was changed.', ['a.txt']]);
  });
  it('has nothing to merge when nothing changed', () => {
    expect(mergeVerdict(dry({ files: [] })).can).toBe(false);
  });
});

describe('the removal dialog names every unmerged commit', () => {
  it('confirms exactly the commits it shows', () => {
    const d = removalDialog('sequence/fix-login-1a2b', [
      { sha: '1'.repeat(40), subject: 'Add ping' },
      { sha: '2'.repeat(40), subject: 'Fix test' },
    ]);
    /* The coordinator's removal ruling adds the Rewind line to every confirm. */
    expect(d.body).toBe('fix-login-1a2b has 2 commits that your branch does not. Deleting the worktree deletes them. This also removes its Rewind history.');
    expect(d.confirm).toEqual(d.commits.map((c) => c.sha));
    expect(d.confirmLabel).toBe('Delete 2 commits');
    expect(branchLabel('feature/x')).toBe('feature/x');
  });
});

describe('the API client', () => {
  it('posts the merge mode and the removal confirmation to the session route', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const f = async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    await worktreeApi.merge('s/1', 'squash', f);
    await worktreeApi.remove('s1', ['abc'], f);
    await worktreeApi.diff('s1', 'a b.txt', f);
    expect(calls.map(([u, i]) => [u, i?.method ?? 'GET', i?.body ?? null])).toEqual([
      ['/api/sessions/s%2F1/worktree/merge', 'POST', '{"mode":"squash"}'],
      ['/api/sessions/s1/worktree', 'DELETE', '{"confirmUnmerged":["abc"]}'],
      ['/api/sessions/s1/worktree/diff?path=a%20b.txt', 'GET', null],
    ]);
  });
  it('keeps the server refusal readable when the body is not JSON', async () => {
    const r = await worktreeApi.dryRun('s1', async () => new Response('nope', { status: 502 }));
    expect([r.ok, r.status, r.body.error]).toEqual([false, 502, 'The server answered 502.']);
  });
});

describe('the worktree chip', () => {
  it('shows the branch without the shared prefix, and the merged state', () => {
    render(<WorktreeChip worktree={wt('aaaaaaaa', 'sequence/fix-login-1a2b', true)} />);
    const chip = screen.getByTestId('worktree-chip');
    expect(chip.textContent).toBe('fix-login-1a2bmerged');
    expect(chip.getAttribute('aria-label')).toBe('Worktree on sequence/fix-login-1a2b, merged into main');
    expect(chip.getAttribute('data-merged')).toBe('true');
  });
});
