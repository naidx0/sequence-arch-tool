import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { REVIEW } from './anchors';
import { ConnectedReview } from './ConnectedReview';
import { ReviewPane } from './ReviewPane';
import { createReviewClient } from './reviewClient';
import { StoreProvider, createStore } from '../state';

/* ══════════════════════════════════════════════════════════════════════════
   WAVE 5 — THE THREE LOCKS, STATED AS THE RUN STATED THEM.

     1. a real diff renders from a real git status
     2. accepting one file of three writes only that path
     3. a line comment reaches the composer as context

   WHY THE DIFF IN LOCK 1 IS PRODUCED BY GIT, HERE, NOW.

   A unified diff pasted into a test file is a shape somebody found convenient,
   and every parser bug this surface can have is a bug about a shape nobody
   found convenient — the omitted hunk count, the `\ No newline` marker, the
   CRLF this repository's own core.autocrlf produces. So this file creates a
   throwaway repository, commits a file, edits it, and asks the real `git` for
   the real bytes, exactly as `gitWorkspace.ts` does at :206-224 with
   `git diff --no-color HEAD -- <path>`. What the component parses is what the
   engine will hand it.

   WHY THE WRITE IN LOCK 2 IS ASSERTED ON THE WIRE AND NOT ON A CALLBACK.

   CANON §6: "This project has twice shipped a test asserting that a dispatch
   landed while the button opened nothing." The honest question is not "did
   accept fire with one path" but "how many PUTs did this component issue, and
   to which paths" — so the client under test is the REAL `createReviewClient`,
   bound to a recording fetch. A component that ignored the plan and looped over
   `state.files` would satisfy any callback assertion and fail this one.

   WHAT THIS FILE CANNOT ASSERT, said out loud so nobody reads it as covered:
   jsdom has no layout, so nothing here proves the gutter is legible, that the
   washes paint, or that the pane fits its column. That is the Tier-4
   screenshot pass, and it is the wiring lane's mount that makes the surface
   reachable at all.
   ══════════════════════════════════════════════════════════════════════════ */

const sel = (id: string) => `[data-testid="${id}"]`;

/* ── a real repository, a real diff ──────────────────────────────────────── */

const ORIGINAL = ['export function verify(token) {', '  const claims = decode(token);', '  if (!claims) return null;', '  return claims;', '}', ''].join('\n');

const EDITED = [
  'export function verify(token) {',
  '  const claims = decode(token);',
  '  if (!claims) throw new AuthError("unreadable token");',
  '  if (claims.exp < now()) throw new AuthError("expired");',
  '  return claims;',
  '}',
  '',
].join('\n');

let REAL_DIFF = '';
let REAL_STATUS: { branch: string; files: { path: string; status: string }[] } = {
  branch: '',
  files: [],
};

function git(cwd: string, args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.email=t@t.test', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

beforeAll(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'web2-review-'));
  git(root, ['init', '-q', '-b', 'main']);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'auth.ts'), ORIGINAL);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'first']);
  fs.writeFileSync(path.join(root, 'src', 'auth.ts'), EDITED);

  REAL_DIFF = git(root, ['diff', '--no-color', 'HEAD', '--', 'src/auth.ts']);
  /* The same porcelain the engine parses, reduced to the same two fields
     GET /api/git/status puts on the wire. */
  const porcelain = git(root, ['status', '--porcelain=v1', '-b', '--no-renames']);
  REAL_STATUS = {
    branch: 'main',
    files: porcelain
      .split('\n')
      .filter((l) => l.length > 3 && !l.startsWith('## '))
      .map((l) => ({ path: l.slice(3).replace(/\\/g, '/'), status: 'modified' })),
  };

  if (!REAL_DIFF.includes('@@')) {
    throw new Error(`the harness could not produce a diff — git said: ${JSON.stringify(REAL_DIFF)}`);
  }
});

/* ── a recording fetch that answers only the routes the engine answers ───── */

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function recorder(routes: Record<string, (url: URL, body: unknown) => [number, unknown]>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = String(input);
    const url = new URL(raw, 'http://review.test');
    const method = init?.method ?? 'GET';
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push({ method, url: raw, body });

    const handler = routes[url.pathname];
    if (!handler) return new Response(JSON.stringify({ error: 'no route' }), { status: 404 });
    const [status, payload] = handler(url, body);
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const NO_STEER = () => {};

/* ══════════════════════════════════════════════════════════════════════════
   LOCK 1 — a real diff renders from a real git status
   ══════════════════════════════════════════════════════════════════════════ */

describe('lock 1 — a real diff renders from a real git status', () => {
  function mountGit() {
    const { calls, fetchImpl } = recorder({
      '/api/git/status': () => [200, REAL_STATUS],
      '/api/git/diff': (url) => [200, { path: url.searchParams.get('path'), diff: REAL_DIFF }],
    });
    render(
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={null}
        graph={null}
        functions={null}
        scope="unstaged"
        onSteer={NO_STEER}
      />,
    );
    return calls;
  }

  it('asks the engine for the status, then for that file’s diff', async () => {
    const calls = mountGit();
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/git/status'))).toBe(true));
    await waitFor(() =>
      expect(calls.some((c) => c.url.startsWith('/api/git/diff?path=src%2Fauth.ts'))).toBe(true),
    );
  });

  it('renders the file git reported, and no file it did not', async () => {
    mountGit();
    const files = await screen.findAllByTestId(REVIEW.file);
    expect(files.map((f) => f.getAttribute('data-path'))).toEqual(['src/auth.ts']);
  });

  it('renders every line of the real hunk, numbered from the real header', async () => {
    mountGit();
    await screen.findByTestId(REVIEW.diff);
    const lines = screen.getAllByTestId(REVIEW.line);

    /* The exact hunk git produced for the edit above: one context line kept,
       one line removed, two added, then context. The numbers are the file's
       real numbers, not indices into an array. */
    const removed = lines.filter((l) => l.getAttribute('data-kind') === 'del');
    const added = lines.filter((l) => l.getAttribute('data-kind') === 'add');
    expect(removed).toHaveLength(1);
    expect(added).toHaveLength(2);
    expect(removed[0].textContent).toContain('if (!claims) return null;');
    expect(added[0].getAttribute('data-new')).toBe('3');
    expect(added[1].getAttribute('data-new')).toBe('4');
    /* A removed line occupies no line in the new file, and a gutter that
       numbered it anyway would anchor a comment to a line that is not there. */
    expect(removed[0].getAttribute('data-new')).toBe(null);
    expect(removed[0].getAttribute('data-old')).toBe('3');
  });

  it('shows the diff’s own arithmetic in the file header', async () => {
    mountGit();
    const head = await screen.findByTestId(REVIEW.fileHead);
    expect(within(head).getByTestId(REVIEW.statAdd).textContent).toBe('+2');
    expect(within(head).getByTestId(REVIEW.statDel).textContent).toBe('−1');
  });

  it('states what it measured, because "Unstaged" is not what git diff HEAD answers', async () => {
    mountGit();
    const provenance = await screen.findByTestId(REVIEW.provenance);
    expect(provenance.textContent).toMatch(/git diff HEAD/);
  });

  it('renders the honest empty state when the tree is clean — never a placeholder diff', async () => {
    const { fetchImpl } = recorder({
      '/api/git/status': () => [200, { branch: 'main', files: [] }],
    });
    render(
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={null}
        graph={null}
        functions={null}
        scope="unstaged"
        onSteer={NO_STEER}
      />,
    );
    const empty = await screen.findByTestId(REVIEW.empty);
    expect(empty.textContent).toMatch(/main/);
    expect(document.querySelector(sel(REVIEW.diff))).toBe(null);
  });

  it('renders a refusal, not an empty tree, when the engine refuses', async () => {
    const { fetchImpl } = recorder({
      '/api/git/status': () => [409, { error: 'no repository is attached' }],
    });
    render(
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={null}
        graph={null}
        functions={null}
        scope="unstaged"
        onSteer={NO_STEER}
      />,
    );
    const failure = await screen.findByTestId(REVIEW.failure);
    expect(failure.textContent).toMatch(/no repository is attached/);
    expect(document.querySelector(sel(REVIEW.empty))).toBe(null);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   LOCK 2 — accepting one file of three writes only that path
   ══════════════════════════════════════════════════════════════════════════ */

const PROPOSAL = {
  id: 'turn-1:p1',
  title: 'Harden the token check',
  rationale: null,
  files: [
    { path: 'packages/analyzer/src/auth.ts', content: 'ALPHA\n' },
    { path: 'packages/schema/src/token.ts', content: 'BETA\n' },
    { path: 'packages/web2/src/app/App.tsx', content: 'GAMMA\n' },
  ],
};

describe('lock 2 — accepting one file of three writes only that path', () => {
  function mountProposal(
    onWroteOrOpts?: ((paths: string[]) => void) | { checkpointFails?: boolean },
  ) {
    const opts = typeof onWroteOrOpts === 'function' ? {} : (onWroteOrOpts ?? {});
    const onWrote = typeof onWroteOrOpts === 'function' ? onWroteOrOpts : undefined;
    const { calls, fetchImpl } = recorder({
      '/api/file': (_url, body) => [200, { ok: true, path: (body as { path: string }).path }],
      '/api/git/diff': (url) => [200, { path: url.searchParams.get('path'), diff: '' }],
      /* The restore point an apply takes before it writes. */
      '/api/git/discard': (_url, body) => [200, { ok: true, discarded: (body as { paths: string[] }).paths }],
      '/api/checkpoint': () =>
        opts.checkpointFails
          ? [500, { error: 'no room on disk' }]
          : [200, { checkpoint: { seq: 1, at: 1, sessionId: 's', files: [] } }],
    });
    render(
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={PROPOSAL}
        graph={null}
        functions={null}
        scope="last-turn"
        onSteer={NO_STEER}
        {...(onWrote ? { onWrote } : {})}
      />,
    );
    return calls;
  }

  it('tells the host which paths landed, so the graph can be marked stale', async () => {
    /*
     * `PUT /api/file` clears the persisted graph cache WITHOUT re-scanning, so
     * from the instant this write lands every claim the board makes is grounded
     * in a file that may no longer say what the citation says. This callback is
     * the only signal that happens, and it went unconsumed long enough for
     * `RepoStale` — and the four surfaces that branch on it — to exist as a
     * state no run could enter.
     */
    const landed: string[][] = [];
    const calls = mountProposal((paths) => landed.push(paths));
    const files = await screen.findAllByTestId(REVIEW.file);

    fireEvent.click(within(files[1]).getByTestId(REVIEW.accept));
    fireEvent.click(screen.getByTestId(REVIEW.apply));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));

    /* The paths the write ACTUALLY landed on, from the response — not the ones
       requested. A rename or a normalisation server-side would otherwise mark
       the wrong file stale. */
    await waitFor(() => expect(landed).toHaveLength(1));
    expect(landed[0]).toEqual(['packages/schema/src/token.ts']);
  });

  it('does not claim anything landed when every write failed', async () => {
    const { calls, fetchImpl } = recorder({
      '/api/file': () => [500, { error: 'disk on fire' }],
      '/api/git/diff': (url) => [200, { path: url.searchParams.get('path'), diff: '' }],
    });
    const landed: string[][] = [];
    render(
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={PROPOSAL}
        graph={null}
        functions={null}
        scope="last-turn"
        onSteer={NO_STEER}
        onWrote={(paths) => landed.push(paths)}
      />,
    );
    const files = await screen.findAllByTestId(REVIEW.file);
    fireEvent.click(within(files[1]).getByTestId(REVIEW.accept));
    fireEvent.click(screen.getByTestId(REVIEW.apply));

    /* The write was attempted and refused. */
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    /* Marking a graph stale for a write that never happened would send the user
       to re-scan for nothing, and would teach them the staleness bar lies. */
    expect(landed).toEqual([]);
  });

  it('lists all three proposed files', async () => {
    mountProposal();
    const files = await screen.findAllByTestId(REVIEW.file);
    expect(files.map((f) => f.getAttribute('data-path'))).toEqual(PROPOSAL.files.map((f) => f.path));
  });

  it('shows the proposal file count and a diff preview when git returns no diff', async () => {
    mountProposal();
    expect((await screen.findByTestId(REVIEW.totals)).textContent).toMatch(/3 files/);
    await waitFor(() => {
      expect(screen.getAllByTestId(REVIEW.line).length).toBeGreaterThan(0);
    });
  });

  it('TAKES A RESTORE POINT FIRST, before any byte lands', async () => {
    /*
     * The engine tracked every write's pre-write baseline and nothing ever
     * froze one into a checkpoint, so the Rewind panel told every real user
     * "No checkpoints yet" forever - under copy promising one is taken before
     * a turn edits files. The capability was complete on both sides of a call
     * nobody made.
     *
     * ORDER IS THE ASSERTION. A restore point taken after the writes is a
     * restore point to the state you are trying to escape.
     */
    const calls = mountProposal();
    const files = await screen.findAllByTestId(REVIEW.file);

    fireEvent.click(within(files[1]).getByTestId(REVIEW.accept));
    fireEvent.click(screen.getByTestId(REVIEW.apply));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));

    const checkpointAt = calls.findIndex((c) => c.url === '/api/checkpoint');
    const firstWriteAt = calls.findIndex((c) => c.method === 'PUT' && c.url === '/api/file');
    expect(checkpointAt).toBeGreaterThanOrEqual(0);
    expect(checkpointAt).toBeLessThan(firstWriteAt);
  });

  it('still applies when the restore point could not be taken', async () => {
    /* The user asked for the edit. Refusing it because a safety net could not
       be hung would trade their actual request for a hypothetical one. */
    const calls = mountProposal({ checkpointFails: true });
    const files = await screen.findAllByTestId(REVIEW.file);

    fireEvent.click(within(files[1]).getByTestId(REVIEW.accept));
    fireEvent.click(screen.getByTestId(REVIEW.apply));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
  });

  it('issues exactly one PUT /api/file, for the accepted path only', async () => {
    const calls = mountProposal();
    const files = await screen.findAllByTestId(REVIEW.file);

    fireEvent.click(within(files[1]).getByTestId(REVIEW.accept));
    fireEvent.click(within(files[0]).getByTestId(REVIEW.reject));
    fireEvent.click(screen.getByTestId(REVIEW.apply));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));

    const writes = calls.filter((c) => c.method === 'PUT');
    expect(writes).toHaveLength(1);
    expect(writes[0].url).toBe('/api/file');
    /* The claim this lock makes is ONE write, for the accepted path, with the
       accepted content - asserted field by field so that adding a field to the
       wire does not read as this lock breaking. The added field is asserted
       too, against the server's own id rule, because a malformed sessionId
       makes the engine skip the checkpoint baseline SILENTLY. And the key set
       is pinned, so a stray field still fails here. */
    const body = writes[0].body as { path: string; content: string; sessionId?: string };
    expect(body.path).toBe('packages/schema/src/token.ts');
    expect(body.content).toBe('BETA\n');
    expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(Object.keys(body).sort()).toEqual(['content', 'path', 'sessionId']);
  });

  it('writes nothing at all when nothing has been accepted', async () => {
    const calls = mountProposal();
    await screen.findAllByTestId(REVIEW.file);
    const apply = screen.getByTestId(REVIEW.apply) as HTMLButtonElement;
    /* Disabled is the honest state, and clicking it must still write nothing —
       a `disabled` attribute that a keyboard or a test can step around is a
       styling choice, not a guard. (`toBeDisabled` is jest-dom, which this
       package does not install; the property is the same question asked
       without a dependency.) */
    expect(apply.disabled).toBe(true);
    fireEvent.click(apply);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('marks the written file written, and leaves the others alone', async () => {
    mountProposal();
    const files = await screen.findAllByTestId(REVIEW.file);
    fireEvent.click(within(files[1]).getByTestId(REVIEW.accept));
    fireEvent.click(screen.getByTestId(REVIEW.apply));

    await waitFor(() =>
      expect(screen.getAllByTestId(REVIEW.file)[1].getAttribute('data-applied')).toBe('written'),
    );
    expect(screen.getAllByTestId(REVIEW.file)[0].getAttribute('data-applied')).toBe(null);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   LOCK 2b — selective staging is the commit's `paths`, not "everything"
   ══════════════════════════════════════════════════════════════════════════ */

describe('item 5.2 — selective staging', () => {
  it('commits exactly the checked paths', async () => {
    const status = {
      branch: 'main',
      files: [
        { path: 'a.ts', status: 'modified' },
        { path: 'b.ts', status: 'modified' },
        { path: 'c.ts', status: 'modified' },
      ],
    };
    const { calls, fetchImpl } = recorder({
      '/api/git/status': () => [200, status],
      '/api/git/diff': (url) => [200, { path: url.searchParams.get('path'), diff: REAL_DIFF }],
      '/api/git/commit': () => [200, { ok: true, commit: 'abc1234' }],
    });
    render(
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={null}
        graph={null}
        functions={null}
        scope="unstaged"
        onSteer={NO_STEER}
      />,
    );

    const files = await screen.findAllByTestId(REVIEW.file);
    fireEvent.click(within(files[0]).getByTestId(REVIEW.stage));
    fireEvent.click(within(files[2]).getByTestId(REVIEW.stage));
    fireEvent.change(screen.getByTestId(REVIEW.commitMessage), {
      target: { value: 'harden the token check' },
    });
    fireEvent.click(screen.getByTestId(REVIEW.commit));

    await waitFor(() => expect(calls.some((c) => c.url === '/api/git/commit')).toBe(true));
    const commit = calls.find((c) => c.url === '/api/git/commit');
    expect(commit?.body).toEqual({ message: 'harden the token check', paths: ['a.ts', 'c.ts'] });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   LOCK 3 — a line comment reaches the composer as context
   ══════════════════════════════════════════════════════════════════════════ */

describe('lock 3 — a line comment reaches the composer as context', () => {
  it('hands the host a steering line carrying path:line, and a grounded chip', async () => {
    const steers: { text: string; chip: { ref: string; kind: string } }[] = [];
    const { fetchImpl } = recorder({
      '/api/git/status': () => [200, REAL_STATUS],
      '/api/git/diff': (url) => [200, { path: url.searchParams.get('path'), diff: REAL_DIFF }],
    });
    render(
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={null}
        graph={null}
        functions={null}
        scope="unstaged"
        onSteer={(s) => steers.push(s as never)}
      />,
    );

    await screen.findByTestId(REVIEW.diff);
    /* Comment on the second added line, which git numbered 4 in the new file.
       The number is read off the rendered gutter rather than assumed, so this
       test fails if the gutter and the comment ever disagree. */
    const added = screen.getAllByTestId(REVIEW.line).filter((l) => l.getAttribute('data-kind') === 'add');
    const line = added[1];
    expect(line.getAttribute('data-new')).toBe('4');

    fireEvent.click(within(line).getByTestId(REVIEW.commentAdd));
    fireEvent.change(screen.getByTestId(REVIEW.commentField), {
      target: { value: 'this swallows the expiry case' },
    });
    fireEvent.click(screen.getByTestId(REVIEW.commentSend));

    expect(steers).toHaveLength(1);
    expect(steers[0].text).toContain('src/auth.ts:4');
    expect(steers[0].text).toContain('this swallows the expiry case');
    expect(steers[0].chip.ref).toBe('src/auth.ts');
    expect(steers[0].chip.kind).toBe('file');
  });

  it('keeps the comment anchored on the line after it is sent', async () => {
    const { fetchImpl } = recorder({
      '/api/git/status': () => [200, REAL_STATUS],
      '/api/git/diff': (url) => [200, { path: url.searchParams.get('path'), diff: REAL_DIFF }],
    });
    render(
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={null}
        graph={null}
        functions={null}
        scope="unstaged"
        onSteer={NO_STEER}
      />,
    );
    await screen.findByTestId(REVIEW.diff);
    const line = screen.getAllByTestId(REVIEW.line).filter((l) => l.getAttribute('data-kind') === 'add')[0];
    fireEvent.click(within(line).getByTestId(REVIEW.commentAdd));
    fireEvent.change(screen.getByTestId(REVIEW.commentField), { target: { value: 'narrow this' } });
    fireEvent.click(screen.getByTestId(REVIEW.commentSend));

    const comment = await screen.findByTestId(REVIEW.comment);
    expect(comment.textContent).toContain('narrow this');
    expect(comment.getAttribute('data-line')).toBe('3');
  });

  it('sends nothing for an empty comment', async () => {
    const steers: unknown[] = [];
    const { fetchImpl } = recorder({
      '/api/git/status': () => [200, REAL_STATUS],
      '/api/git/diff': (url) => [200, { path: url.searchParams.get('path'), diff: REAL_DIFF }],
    });
    render(
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={null}
        graph={null}
        functions={null}
        scope="unstaged"
        onSteer={(s) => steers.push(s)}
      />,
    );
    await screen.findByTestId(REVIEW.diff);
    const line = screen.getAllByTestId(REVIEW.line)[0];
    fireEvent.click(within(line).getByTestId(REVIEW.commentAdd));
    fireEvent.click(screen.getByTestId(REVIEW.commentSend));
    expect(steers).toEqual([]);
  });

  it('reaches the REAL composer through the real store', async () => {
    /* The invariant, not the expression. `onSteer` firing proves the pane
       raised an event; this proves the event lands where a turn will read it —
       `composer.draft` and `composer.chips` are what `POST /api/ask` is built
       from. Wave 3's gate is the reason this test exists in this form: every
       board unit test was green while the feature was unreachable in the app. */
    const store = createStore();
    const { fetchImpl } = recorder({
      '/api/git/status': () => [200, REAL_STATUS],
      '/api/git/diff': (url) => [200, { path: url.searchParams.get('path'), diff: REAL_DIFF }],
    });

    render(
      <StoreProvider store={store}>
        <ConnectedReview client={createReviewClient(fetchImpl)} scope="unstaged" />
      </StoreProvider>,
    );

    await screen.findByTestId(REVIEW.diff);
    const line = screen.getAllByTestId(REVIEW.line).filter((l) => l.getAttribute('data-kind') === 'add')[1];
    fireEvent.click(within(line).getByTestId(REVIEW.commentAdd));
    fireEvent.change(screen.getByTestId(REVIEW.commentField), {
      target: { value: 'this swallows the expiry case' },
    });
    fireEvent.click(screen.getByTestId(REVIEW.commentSend));

    await waitFor(() => expect(store.getState().composer.draft).toContain('src/auth.ts:4'));
    expect(store.getState().composer.chips.map((c) => [c.kind, c.ref])).toEqual([
      ['file', 'src/auth.ts'],
    ]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ITEM 5.4 — the segmented control, including the three it cannot serve
   ══════════════════════════════════════════════════════════════════════════ */

describe('item 5.4 — the scope segmented control', () => {
  function mountScopes() {
    const { fetchImpl } = recorder({
      '/api/git/status': () => [200, REAL_STATUS],
      '/api/git/diff': (url) => [200, { path: url.searchParams.get('path'), diff: REAL_DIFF }],
    });
    render(
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={PROPOSAL}
        graph={null}
        functions={null}
        onSteer={NO_STEER}
      />,
    );
  }

  /* THE AWAIT IS NOT DECORATION. Mounting on a served scope starts a real
     fetch; asserting synchronously and returning leaves that promise to resolve
     into an unmounted tree, which React reports as an act() warning. A warning
     stream is where a real defect hides, so every test here settles first. */
  it('renders all five segments', async () => {
    mountScopes();
    await screen.findByTestId(REVIEW.diff);
    expect(screen.getAllByTestId(REVIEW.scopeSeg).map((s) => s.getAttribute('data-scope'))).toEqual([
      'unstaged',
      'staged',
      'commit',
      'branch',
      'last-turn',
    ]);
  });

  it('marks all five as served — each one earned it', async () => {
    mountScopes();
    await screen.findByTestId(REVIEW.diff);
    const served = Object.fromEntries(
      screen.getAllByTestId(REVIEW.scopeSeg).map((s) => [s.getAttribute('data-scope'), s.getAttribute('data-served')]),
    );
    /* `staged` was served when `GET /api/git/diff` grew `?scope=`; `commit` and
       `branch` when the pane grew a revision picker off
       `GET /api/git/revisions`. All five now send a scope the route answers. */
    expect(served).toEqual({
      unstaged: 'yes',
      staged: 'yes',
      commit: 'yes',
      branch: 'yes',
      'last-turn': 'yes',
    });
  });

  it('the staged segment actually asks for the index, not the working tree', async () => {
    /*
     * THE SCOPE HAS TO REACH THE WIRE. A segmented control that changes a label
     * and fetches the same diff is worse than one marked unavailable, because
     * the reader cannot tell — and would review the wrong change believing they
     * had reviewed the right one.
     */
    const { calls, fetchImpl } = recorder({
      '/api/git/status': () => [200, REAL_STATUS],
      '/api/git/diff': (url) => [200, { path: url.searchParams.get('path'), diff: REAL_DIFF }],
    });
    render(
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={null}
        graph={null}
        functions={null}
        scope="staged"
        onSteer={NO_STEER}
      />,
    );
    await waitFor(() =>
      expect(calls.some((c) => c.url.startsWith('/api/git/diff'))).toBe(true),
    );
    const diffCall = calls.find((c) => c.url.startsWith('/api/git/diff'))!;
    expect(diffCall.url).toMatch(/scope=staged/);
  });

  it('choosing Commit asks for a revision, and diffs the one that was chosen', async () => {
    const { calls, fetchImpl } = recorder({
      '/api/git/status': () => [200, REAL_STATUS],
      '/api/git/diff': (url) => [200, { path: url.searchParams.get('path'), diff: REAL_DIFF }],
      '/api/git/revisions': () => [
        200,
        {
          commits: [
            { sha: 'f'.repeat(40), shortSha: 'fffffff', subject: 'widen it', at: '2026-08-22T09:00:00.000Z' },
          ],
          branches: ['main', 'feature'],
          head: 'feature',
        },
      ],
    });
    render(
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={null}
        graph={null}
        functions={null}
        scope="commit"
        onSteer={NO_STEER}
      />,
    );

    /* THE THING THE SCOPE WAS MISSING. A Commit scope with no picker would
       always have meant HEAD, which is the worktree scope wearing another
       word. */
    await screen.findByTestId(REVIEW.revPicker);
    const select = screen.getByTestId('review-rev-select') as HTMLSelectElement;
    /* The short sha AND the subject — a list of forty-character hashes is a
       list nobody can choose from. */
    expect(select.textContent).toMatch(/fffffff/);
    expect(select.textContent).toMatch(/widen it/);

    await waitFor(() =>
      expect(calls.some((c) => c.url.startsWith('/api/git/diff') && c.url.includes('scope=commit'))).toBe(true),
    );
    const diffCall = calls.find((c) => c.url.includes('scope=commit'))!;
    /* The CHOSEN revision reaches the wire, not a default the pane picked. */
    expect(diffCall.url).toContain(`rev=${'f'.repeat(40)}`);
  });

  it('the picker is absent for the three scopes that do not need one', async () => {
    const { fetchImpl } = recorder({
      '/api/git/status': () => [200, REAL_STATUS],
      '/api/git/diff': (url) => [200, { path: url.searchParams.get('path'), diff: REAL_DIFF }],
    });
    render(
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={null}
        graph={null}
        functions={null}
        scope="unstaged"
        onSteer={NO_STEER}
      />,
    );
    await screen.findByTestId(REVIEW.diff);
    /* A control that is meaningless for three of five segments is worse than no
       control — the reader has to work out which of them it applies to. */
    expect(screen.queryByTestId(REVIEW.revPicker)).toBeNull();
  });

  it('switches to the last turn and shows the proposal, not the git files', async () => {
    mountScopes();
    await screen.findByTestId(REVIEW.diff);
    fireEvent.click(screen.getAllByTestId(REVIEW.scopeSeg).find((s) => s.getAttribute('data-scope') === 'last-turn')!);
    const files = await screen.findAllByTestId(REVIEW.file);
    expect(files.map((f) => f.getAttribute('data-path'))).toEqual(PROPOSAL.files.map((f) => f.path));
  });

  it('says so when the last turn proposed nothing, instead of showing an old proposal', async () => {
    const { fetchImpl } = recorder({});
    render(
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={null}
        graph={null}
        functions={null}
        scope="last-turn"
        onSteer={NO_STEER}
      />,
    );
    expect((await screen.findByTestId(REVIEW.empty)).textContent).toMatch(/propose/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ITEM 5.5 / B2 — the impact panel beside the diff
   ══════════════════════════════════════════════════════════════════════════ */

describe('item 5.5 — the impact panel', () => {
  const GRAPH = {
    version: 1,
    scannedAt: '2026-08-20T00:00:00.000Z',
    root: '/repo',
    nodes: [
      { id: 'svc:auth', kind: 'service', label: 'auth', path: 'src' },
      { id: 'svc:web', kind: 'service', label: 'web', path: 'web' },
    ],
    edges: [
      {
        id: 'e1',
        srcId: 'svc:web',
        dstId: 'svc:auth',
        kind: 'http',
        confidence: 0.9,
        origin: 'deterministic',
        evidence: [{ file: 'src/auth.ts', line: 3, snippet: 'verify(' }],
      },
    ],
  } as never;

  it('names the node the change is inside and what breaks if it fails', async () => {
    const { fetchImpl } = recorder({
      '/api/git/status': () => [200, REAL_STATUS],
      '/api/git/diff': (url) => [200, { path: url.searchParams.get('path'), diff: REAL_DIFF }],
    });
    render(
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={null}
        graph={GRAPH}
        functions={null}
        scope="unstaged"
        onSteer={NO_STEER}
      />,
    );
    await screen.findByTestId(REVIEW.diff);
    const nodes = await screen.findAllByTestId(REVIEW.impactNode);
    expect(nodes.map((n) => n.getAttribute('data-node-id'))).toEqual(['svc:auth']);
    expect(nodes[0].textContent).toContain('svc:web');
  });

  it('names the edge whose evidence sits on a changed line, with file:line', async () => {
    const { fetchImpl } = recorder({
      '/api/git/status': () => [200, REAL_STATUS],
      '/api/git/diff': (url) => [200, { path: url.searchParams.get('path'), diff: REAL_DIFF }],
    });
    render(
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={null}
        graph={GRAPH}
        functions={null}
        scope="unstaged"
        onSteer={NO_STEER}
      />,
    );
    await screen.findByTestId(REVIEW.diff);
    const edges = await screen.findAllByTestId(REVIEW.impactEdge);
    expect(edges[0].textContent).toContain('src/auth.ts:3');
  });

  it('says nothing was measured, rather than zero, with no graph attached', async () => {
    const { fetchImpl } = recorder({
      '/api/git/status': () => [200, REAL_STATUS],
      '/api/git/diff': (url) => [200, { path: url.searchParams.get('path'), diff: REAL_DIFF }],
    });
    render(
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={null}
        graph={null}
        functions={null}
        scope="unstaged"
        onSteer={NO_STEER}
      />,
    );
    await screen.findByTestId(REVIEW.diff);
    const gaps = await screen.findAllByTestId(REVIEW.impactGap);
    expect(gaps.map((g) => g.textContent).join(' ')).toMatch(/no graph/i);
    expect(document.querySelector(sel(REVIEW.impactNode))).toBe(null);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE SCOPE MUST REACH THE WIRE — and it did not, in the shipped app.

   `ReviewPane` reads `state.scope` to RENDER the segmented control and to
   decide which segment is lit, and read the `scope` PROP in the two effects
   that actually fetch. The prop is optional and defaults to `unstaged`, and
   `App.tsx` mounts `<ConnectedReview />` with no props at all — so clicking
   Staged, Commit or Branch changed the label and fetched the worktree diff
   anyway.

   THE TESTS NEVER CAUGHT IT BECAUSE THEY PASS THE PROP AT MOUNT, which the
   real app does not. Every case below therefore mounts WITHOUT it, the way the
   application does, and drives the control by CLICKING — which is the only way
   to exercise the path a user takes.

   The file's own comment names this exact defect: "Requesting `staged` and
   rendering the worktree diff would be a segmented control that changes a
   label and nothing else — worse than the segment being marked unavailable,
   because the reader cannot tell."
   ══════════════════════════════════════════════════════════════════════════ */
describe('the chosen scope reaches the wire', () => {
  function mountAsTheAppDoes() {
    const { calls, fetchImpl } = recorder({
      '/api/git/status': () => [200, REAL_STATUS],
      '/api/git/diff': (url) => [200, { path: url.searchParams.get('path'), diff: REAL_DIFF }],
      '/api/git/revisions': () => [200, { commits: [], branches: [] }],
    });
    render(
      /* NO `scope` prop — exactly as App.tsx mounts it. */
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={null}
        graph={null}
        functions={null}
        onSteer={NO_STEER}
      />,
    );
    return calls;
  }

  function segment(name: string): HTMLElement {
    const seg = screen
      .getAllByTestId(REVIEW.scopeSeg)
      .find((el) => el.getAttribute('data-scope') === name);
    if (!seg) throw new Error(`no scope segment ${name}`);
    return seg;
  }

  it('clicking Staged asks for the STAGED diff, not the worktree', async () => {
    const calls = mountAsTheAppDoes();
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/git/diff'))).toBe(true));
    const before = calls.length;

    fireEvent.click(segment('staged'));

    await waitFor(() => {
      const after = calls.slice(before).filter((c) => c.url.includes('/api/git/diff'));
      expect(after.length).toBeGreaterThan(0);
      /* The whole assertion. Without it the request carries no scope at all and
         the server serves the worktree. */
      expect(after.some((c) => c.url.includes('scope=staged'))).toBe(true);
    });
  });

  it('the lit segment and the requested scope are the SAME scope', async () => {
    /*
     * The failure this prevents is not "the wrong diff" — it is the wrong diff
     * under the right label, which a reader cannot detect from the screen.
     */
    const calls = mountAsTheAppDoes();
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/git/diff'))).toBe(true));

    fireEvent.click(segment('staged'));

    await waitFor(() => {
      const lit = screen
        .getAllByTestId(REVIEW.scopeSeg)
        .find((el) => el.getAttribute('aria-pressed') === 'true');
      expect(lit?.getAttribute('data-scope')).toBe('staged');
      const last = [...calls].reverse().find((c) => c.url.includes('/api/git/diff'));
      expect(last?.url).toContain('scope=staged');
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   WHICH COMMENTS THE AGENT ALREADY HAS.

   `comment/sent` has had a reducer since comments existed and was dispatched
   by NOBODY. Every comment read "not sent" forever: the reader could not tell
   which of their notes had reached the agent, and `unsentComments` collected
   all of them every time — so steering twice sent the same note twice.
   ══════════════════════════════════════════════════════════════════════════ */
describe('a steered comment is marked as handed over', () => {
  function mountWithDiff() {
    const { fetchImpl } = recorder({
      '/api/git/status': () => [200, REAL_STATUS],
      '/api/git/diff': (url) => [200, { path: url.searchParams.get('path'), diff: REAL_DIFF }],
    });
    const onSteer = vi.fn();
    render(
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={null}
        graph={null}
        functions={null}
        onSteer={onSteer}
      />,
    );
    return { onSteer };
  }

  it('marks it sent once it has been steered', async () => {
    const { onSteer } = mountWithDiff();
    await waitFor(() => expect(screen.queryAllByTestId(REVIEW.commentAdd).length).toBeGreaterThan(0));

    /* Open the comment box on a line, type, and steer. */
    fireEvent.click(screen.getAllByTestId(REVIEW.commentAdd)[0]!);
    const field = screen.getByTestId(REVIEW.commentField);
    fireEvent.change(field, { target: { value: 'this needs a guard' } });
    fireEvent.click(screen.getByTestId(REVIEW.commentSend));

    await waitFor(() => expect(onSteer).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const marks = screen.getAllByTestId(REVIEW.comment);
      /* The reader can now see the agent has it. Before this, every comment
         said "not sent" for the rest of the session. */
      expect(marks.some((m) => m.getAttribute('data-sent') === 'yes')).toBe(true);
    });
  });
});


/* ══════════════════════════════════════════════════════════════════════════
   THE STAGED SCOPE LISTS WHAT IS STAGED.

   Requesting the staged diff per file was only half the fix. The FILE LIST was
   the whole dirty tree regardless of scope, so Staged showed rows for files
   with nothing staged and each rendered an empty diff — which reads as a
   broken diff rather than as a file that does not belong in this scope.

   The wire could not express the distinction at all: porcelain gives two
   letters per file and the server collapsed them into one word.
   ══════════════════════════════════════════════════════════════════════════ */
describe('the scope filters the file LIST', () => {
  function withFiles(files: unknown[]) {
    const { calls, fetchImpl } = recorder({
      '/api/git/status': () => [200, { branch: 'main', files }],
      '/api/git/diff': (url) => [200, { path: url.searchParams.get('path'), diff: REAL_DIFF }],
    });
    render(
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={null}
        graph={null}
        functions={null}
        onSteer={NO_STEER}
      />,
    );
    return calls;
  }

  const MIXED = [
    { path: 'staged.ts', status: 'modified', staged: true, unstaged: false },
    { path: 'dirty.ts', status: 'modified', staged: false, unstaged: true },
  ];

  it('Staged shows only the staged file', async () => {
    withFiles(MIXED);
    await waitFor(() => expect(screen.queryAllByTestId(REVIEW.scopeSeg).length).toBeGreaterThan(0));

    fireEvent.click(
      screen.getAllByTestId(REVIEW.scopeSeg).find((el) => el.getAttribute('data-scope') === 'staged')!,
    );

    await waitFor(() => {
      const text = screen.getByTestId(REVIEW.root).textContent ?? '';
      expect(text).toContain('staged.ts');
      expect(text).not.toContain('dirty.ts');
    });
  });

  it('AN OLDER SERVER STILL SHOWS EVERYTHING', async () => {
    /*
     * A server that does not send the flags has not said "no" — it has said
     * nothing. Hiding a real change because the server was old is a worse
     * failure than showing one that turns out to be unstaged.
     */
    withFiles([{ path: 'legacy.ts', status: 'modified' }]);
    await waitFor(() => expect(screen.queryAllByTestId(REVIEW.scopeSeg).length).toBeGreaterThan(0));

    fireEvent.click(
      screen.getAllByTestId(REVIEW.scopeSeg).find((el) => el.getAttribute('data-scope') === 'staged')!,
    );

    await waitFor(() => expect(screen.getByTestId(REVIEW.root).textContent).toContain('legacy.ts'));
  });
});

/**
 * REVERT — the one irreversible act, and the tooltip that had become a lie.
 *
 * The control sat disabled behind "No route discards a working-tree change:
 * the engine serves /api/git/status, /api/git/diff and /api/git/commit only."
 * `/api/git/discard` shipped and that sentence was never revisited, so the
 * product was telling the reader a falsehood about itself — worse than the
 * missing feature, because it teaches them to stop looking.
 */
describe('throwing a working-tree change away', () => {
  function mountWorktree() {
    const status = {
      branch: 'main',
      files: [
        { path: 'a.ts', status: 'modified' },
        { path: 'b.ts', status: 'modified' },
      ],
    };
    const { calls, fetchImpl } = recorder({
      '/api/git/status': () => [200, status],
      '/api/git/diff': (url) => [200, { path: url.searchParams.get('path'), diff: REAL_DIFF }],
      '/api/git/discard': (_url, body) => [
        200,
        { ok: true, discarded: (body as { paths: string[] }).paths },
      ],
    });
    render(
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={null}
        graph={null}
        functions={null}
        scope="unstaged"
        onSteer={NO_STEER}
      />,
    );
    return calls;
  }

  it('is enabled, and no longer claims the route does not exist', async () => {
    const calls = mountWorktree();
    const files = await screen.findAllByTestId(REVIEW.file);
    fireEvent.click(within(files[0]).getByTestId(REVIEW.stage));

    const revert = screen.getByTestId(REVIEW.revert);
    expect(revert.hasAttribute('disabled')).toBe(false);
    expect(revert.getAttribute('title')).not.toMatch(/No route discards/);
    expect(calls.some((c) => c.url === '/api/git/discard')).toBe(false);
  });

  it('ARMS on the first press and only fires on the second', async () => {
    /* A single-press discard is the defect this arm exists to prevent: the
       content is not in the index, not in a commit, and not recoverable by
       git once it is gone. */
    const calls = mountWorktree();
    const files = await screen.findAllByTestId(REVIEW.file);
    fireEvent.click(within(files[0]).getByTestId(REVIEW.stage));

    fireEvent.click(screen.getByTestId(REVIEW.revert));
    expect(calls.some((c) => c.url === '/api/git/discard')).toBe(false);

    fireEvent.click(screen.getByTestId(REVIEW.revertConfirm));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/git/discard')).toBe(true));
    const sent = calls.find((c) => c.url === '/api/git/discard')!;
    expect((sent.body as { paths: string[] }).paths).toEqual(['a.ts']);
  });

  it('names the count on the confirm rather than asking "are you sure"', async () => {
    mountWorktree();
    const files = await screen.findAllByTestId(REVIEW.file);
    fireEvent.click(within(files[0]).getByTestId(REVIEW.stage));
    fireEvent.click(within(files[1]).getByTestId(REVIEW.stage));
    fireEvent.click(screen.getByTestId(REVIEW.revert));

    expect(screen.getByTestId(REVIEW.revertConfirm).textContent).toContain('2 files');
  });

  it('Keep them backs out without throwing anything away', async () => {
    const calls = mountWorktree();
    const files = await screen.findAllByTestId(REVIEW.file);
    fireEvent.click(within(files[0]).getByTestId(REVIEW.stage));

    fireEvent.click(screen.getByTestId(REVIEW.revert));
    fireEvent.click(screen.getByTestId(REVIEW.revertCancel));

    expect(calls.some((c) => c.url === '/api/git/discard')).toBe(false);
    expect(screen.getByTestId(REVIEW.revert)).toBeTruthy();
  });

  it('offers nothing to discard when nothing is selected', async () => {
    /* The server refuses an empty list outright - "discard never applies to
       the whole tree" - and the client must not be the caller that lost its
       argument. */
    mountWorktree();
    await screen.findAllByTestId(REVIEW.file);
    expect(screen.getByTestId(REVIEW.revert).hasAttribute('disabled')).toBe(true);
  });
});

/**
 * WHY THIS CHANGE — what a reviewer needs in order to disagree.
 *
 * `TopologyProposal` has carried a rationale from the start and the board
 * renders it, so a proposed change to the ARCHITECTURE explained itself. A
 * proposed change to the CODE could not: `propose_files` took a title and
 * files and nothing else, so the most consequential thing this product does
 * arrived as a title and a diff.
 */
describe('the reason a change was proposed', () => {
  const WHY = 'The token is compared with == so a null token passes.';

  function mountWithRationale(rationale: string | null) {
    const { calls, fetchImpl } = recorder({
      '/api/git/diff': (url) => [200, { path: url.searchParams.get('path'), diff: REAL_DIFF }],
    });
    render(
      <ReviewPane
        client={createReviewClient(fetchImpl)}
        proposal={{ ...PROPOSAL, rationale }}
        graph={null}
        functions={null}
        scope="last-turn"
        onSteer={NO_STEER}
      />,
    );
    return calls;
  }

  it('shows it above the files', async () => {
    mountWithRationale(WHY);
    await screen.findAllByTestId(REVIEW.file);
    expect(screen.getByTestId(REVIEW.why).textContent).toBe(WHY);
  });

  it('draws NOTHING when the model had nothing to add', async () => {
    /* A model with nothing to say beyond the title must not have prose
       invented for it, and an empty row is worse than no row. */
    mountWithRationale(null);
    await screen.findAllByTestId(REVIEW.file);
    expect(screen.queryByTestId(REVIEW.why)).toBeNull();
  });

  it('does not replace the title — they answer different questions', async () => {
    /* A title NAMES the change; the rationale says why it is the right one. */
    mountWithRationale(WHY);
    await screen.findAllByTestId(REVIEW.file);
    expect(screen.getByTestId(REVIEW.head).textContent).toContain(PROPOSAL.title);
    expect(screen.getByTestId(REVIEW.why).textContent).toBe(WHY);
  });
});
