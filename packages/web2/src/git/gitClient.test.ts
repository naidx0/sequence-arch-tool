import { describe, expect, it, vi } from 'vitest';

import {
  createGitClient,
  diffQuery,
  dirtyFiles,
  subscribeGitEvents,
  type EventSourceLike,
  type GitServerEvent,
} from './gitClient';

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
}

describe('gitClient', () => {
  it('branches GETs /api/git/branches', async () => {
    const f = fakeFetch(200, { current: 'main', detached: false, sha: null, branches: [], remoteBranches: [], dirty: 0 });
    const r = await createGitClient(f as unknown as typeof fetch).branches();
    expect(f.mock.calls[0]![0]).toBe('/api/git/branches');
    expect(r.outcome).toBe('ok');
  });

  it('switchBranch POSTs JSON and surfaces a dirty refusal with its files', async () => {
    const f = fakeFetch(409, { ok: false, reason: 'dirty', error: 'x', files: ['src/a.ts'] });
    const r = await createGitClient(f as unknown as typeof fetch).switchBranch({ branch: 'other' });
    const init = f.mock.calls[0]![1]!;
    expect(f.mock.calls[0]![0]).toBe('/api/git/switch');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ branch: 'other' });
    expect(dirtyFiles(r)).toEqual(['src/a.ts']);
  });

  it('dirtyFiles is null for other refusals and for success', async () => {
    const bad = await createGitClient(fakeFetch(400, { ok: false, reason: 'invalid', error: 'no' }) as unknown as typeof fetch).switchBranch({ branch: '--x' });
    expect(dirtyFiles(bad)).toBeNull();
    const ok = await createGitClient(fakeFetch(200, { ok: true }) as unknown as typeof fetch).switchBranch({ branch: 'a' });
    expect(dirtyFiles(ok)).toBeNull();
  });

  it('branchChanges encodes the base and omits it by default', async () => {
    const f = fakeFetch(200, { files: [] });
    const c = createGitClient(f as unknown as typeof fetch);
    await c.branchChanges();
    await c.branchChanges('release/1.0');
    expect(f.mock.calls[0]![0]).toBe('/api/git/branch-changes');
    expect(f.mock.calls[1]![0]).toBe('/api/git/branch-changes?base=release%2F1.0');
  });

  it('diff builds one scope query per kind', () => {
    expect(diffQuery('a b.ts', { kind: 'unstaged' })).toBe('path=a+b.ts&scope=unstaged');
    expect(diffQuery('a.ts', { kind: 'staged' })).toBe('path=a.ts&scope=staged');
    expect(diffQuery('a.ts', { kind: 'branch' })).toBe('path=a.ts&scope=branch');
    expect(diffQuery('a.ts', { kind: 'branch', base: 'main' })).toBe('path=a.ts&scope=branch&base=main');
    expect(diffQuery('a.ts', { kind: 'commit', rev: 'abc' })).toBe('path=a.ts&scope=commit&rev=abc');
  });

  it('subscribeGitEvents delivers git:head and graph:updated, drops junk, and closes', () => {
    const listeners = new Map<string, (e: { data: string }) => void>();
    const close = vi.fn();
    const src: EventSourceLike = { addEventListener: (t, l) => void listeners.set(t, l), close };
    const seen: GitServerEvent[] = [];
    const stop = subscribeGitEvents(
      (e) => seen.push(e),
      (url) => {
        expect(url).toBe('/api/git/events');
        return src;
      },
    );
    listeners.get('git:head')!({ data: JSON.stringify({ type: 'git:head', branch: 'b', sha: 's', detached: false, previous: { branch: 'a', sha: 't' }, rescan: true }) });
    listeners.get('graph:updated')!({ data: JSON.stringify({ type: 'graph:updated', reason: 'git:head', branch: 'b', sha: 's' }) });
    listeners.get('git:head')!({ data: 'not json' });
    listeners.get('git:head')!({ data: JSON.stringify({ type: 'other' }) });
    expect(seen.map((e) => e.type)).toEqual(['git:head', 'graph:updated']);
    stop();
    expect(close).toHaveBeenCalledOnce();
  });
});
