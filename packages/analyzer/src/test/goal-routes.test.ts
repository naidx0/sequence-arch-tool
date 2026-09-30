import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { createSession, readSessionIndex, updateSession } from '../server/sessionsStore.js';
import { GOAL_RUN_TURN_CAP, goalRunState } from '../server/goalRunner.js';

/**
 * THE GOAL AND PLAN ON THE WIRE — PUT, GET, and the three goal-run routes.
 *
 * Route-level rather than store-level, because three of the rules under test
 * only exist at this layer: the 400 on a malformed plan (the store is handed
 * validated steps and would happily write garbage), the 404 on an unknown
 * thread, and the fact that `/api/sessions/:id/goal-run` is reachable at all —
 * the `/api/sessions/:id` block refuses any id containing a slash, so a
 * sub-resource matched after it would 404 with a clean build and a green suite.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

function freshRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-goal-routes-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

async function startRepoServer(repoRoot: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repoRoot, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function seed(repo: string): string {
  return createSession(repo).id;
}

test('PUT /api/sessions/:id stores goal and plan; GET hands both back', async () => {
  const repo = freshRepo();
  const id = seed(repo);
  const { base, close } = await startRepoServer(repo);
  try {
    const put = await fetch(`${base}/api/sessions/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        goal: '  make the goal run work  ',
        plan: [
          { id: 's1', text: 'Read the parser', status: 'done' },
          { id: 's2', text: 'Add the guard', status: 'open' },
          { id: 's3', text: 'Measure it', status: 'parked', why: 'no benchmark' },
        ],
      }),
    });
    assert.strictEqual(put.status, 200);

    const got = (await (await fetch(`${base}/api/sessions/${id}`)).json()) as {
      goal?: string;
      plan?: Array<{ id: string; status: string; why?: string }>;
    };
    assert.strictEqual(got.goal, 'make the goal run work');
    assert.deepStrictEqual(got.plan?.map((s) => s.status), ['done', 'open', 'parked']);
    assert.strictEqual(got.plan?.[2]!.why, 'no benchmark');

    /* And the INDEX carries it, which is what the rail and the goalbar read. */
    const entry = readSessionIndex(repo)!.sessions.find((s) => s.id === id)!;
    assert.strictEqual(entry.goal, 'make the goal run work');
    assert.strictEqual(entry.plan?.length, 3);
  } finally {
    await close();
  }
});

test('PUT /api/sessions/:id is a 400 on a malformed plan, and stores nothing', async () => {
  const repo = freshRepo();
  const id = seed(repo);
  const { base, close } = await startRepoServer(repo);
  try {
    for (const bad of [
      'not an array',
      [{ text: 'no id', status: 'open' }],
      [{ id: 'a', text: 'x', status: 'nope' }],
      [
        { id: 'a', text: 'x', status: 'open' },
        { id: 'a', text: 'y', status: 'open' },
      ],
    ]) {
      const res = await fetch(`${base}/api/sessions/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan: bad }),
      });
      assert.strictEqual(res.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
      const body = (await res.json()) as { error?: string };
      assert.match(body.error ?? '', /invalid plan:/);
    }
    assert.strictEqual(readSessionIndex(repo)!.sessions.find((s) => s.id === id)!.plan, undefined);
  } finally {
    await close();
  }
});

test('PUT with goal "" clears it and is not read as absent', async () => {
  const repo = freshRepo();
  const id = seed(repo);
  const { base, close } = await startRepoServer(repo);
  try {
    await fetch(`${base}/api/sessions/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'a goal with four words' }),
    });
    await fetch(`${base}/api/sessions/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: '' }),
    });
    const entry = readSessionIndex(repo)!.sessions.find((s) => s.id === id)!;
    assert.strictEqual(entry.goal, '', 'the clear was recorded, not dropped');
  } finally {
    await close();
  }
});

/* ------------------------------- the goal run ----------------------------- */

test('GET goal-run answers for a session that has never run, and 404s an unknown one', async () => {
  const repo = freshRepo();
  const id = seed(repo);
  const { base, close } = await startRepoServer(repo);
  try {
    const res = await fetch(`${base}/api/sessions/${id}/goal-run`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { running: false, turns: 0, cap: GOAL_RUN_TURN_CAP });

    const missing = await fetch(`${base}/api/sessions/does-not-exist/goal-run`);
    assert.strictEqual(missing.status, 404);
  } finally {
    await close();
  }
});

test('POST goal-run is a 400 in Plan mode and a 400 with nothing open', async () => {
  const repo = freshRepo();
  const id = seed(repo);
  updateSession(repo, id, {
    goal: 'work the plan down',
    plan: [{ id: 's1', text: 'Read the parser', status: 'open' }],
  });
  const { base, close } = await startRepoServer(repo);
  try {
    const planMode = await fetch(`${base}/api/sessions/${id}/goal-run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ permission: 'plan' }),
    });
    assert.strictEqual(planMode.status, 400);
    assert.strictEqual(((await planMode.json()) as { reason?: string }).reason, 'not_building');

    /* No permission at all is the same refusal — default-deny, never a
       fall-through to Build. */
    const noPermission = await fetch(`${base}/api/sessions/${id}/goal-run`, { method: 'POST' });
    assert.strictEqual(noPermission.status, 400);
    assert.strictEqual(((await noPermission.json()) as { reason?: string }).reason, 'not_building');

    updateSession(repo, id, { plan: [{ id: 's1', text: 'Read the parser', status: 'done' }] });
    const nothingOpen = await fetch(`${base}/api/sessions/${id}/goal-run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ permission: 'build' }),
    });
    assert.strictEqual(nothingOpen.status, 400);
    assert.strictEqual(((await nothingOpen.json()) as { reason?: string }).reason, 'nothing_open');

    assert.strictEqual(goalRunState(repo, id).running, false, 'a refused start left no run row');
  } finally {
    await close();
  }
});

test('POST goal-run/stop is reachable, idempotent, and ends a running row', async () => {
  const repo = freshRepo();
  const id = seed(repo);
  const { base, close } = await startRepoServer(repo);
  try {
    /* Forge a running row the way a live engine leaves one — this test is about
       the ROUTE, and driving a real provider here would make it a provider test. */
    const dir = path.join(repo, '.sequence', 'sessions', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'goal-run.json'),
      JSON.stringify({ version: 1, sessionId: id, pid: process.pid, running: true, turns: 3, cap: 24 }),
    );

    const stop = await fetch(`${base}/api/sessions/${id}/goal-run/stop`, { method: 'POST' });
    assert.strictEqual(stop.status, 200);
    const body = (await stop.json()) as {
      ok: boolean;
      state: { running: boolean; lastStopReason?: string; lastStopSentence?: string };
    };
    assert.strictEqual(body.ok, true);
    /* The reap already ran when this server booted — before this row existed —
       so this is a live row as far as the engine is concerned, and Stop is what
       ends it. `goal-runner.test.ts` covers the orphan the other way round. */
    assert.strictEqual(body.state.running, false);
    assert.strictEqual(body.state.lastStopReason, 'stopped_by_hand');
    assert.match(body.state.lastStopSentence ?? '', /stopped by hand after 3 turns/);

    const again = await fetch(`${base}/api/sessions/${id}/goal-run/stop`, { method: 'POST' });
    assert.strictEqual(again.status, 200, 'stopping a stopped run is not an error');
  } finally {
    await close();
  }
});

test('the goal-run path is matched BEFORE the session block that refuses slashes', async () => {
  const repo = freshRepo();
  const id = seed(repo);
  const { base, close } = await startRepoServer(repo);
  try {
    /* Without its own matcher this is a 404: `/api/sessions/:id` slices the
       whole tail and rejects anything containing `/`. */
    const res = await fetch(`${base}/api/sessions/${id}/goal-run`);
    assert.strictEqual(res.status, 200);
    const wrongMethod = await fetch(`${base}/api/sessions/${id}/goal-run`, { method: 'DELETE' });
    assert.strictEqual(wrongMethod.status, 405);
  } finally {
    await close();
  }
});
