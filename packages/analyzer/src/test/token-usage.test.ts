import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { aggregateTokenUsage, readTokenUsage } from '../server/tokenUsage.js';
import { createRepoServer } from '../server/repoServer.js';

/**
 * The token map's numbers. The load-bearing properties: a day is the LOCAL day
 * the turn started on, a turn the agent never reported is not a zero, and a
 * total with no `total` field falls back to input plus output rather than
 * reading as nothing.
 */

test('one turn lands on its local day with both halves counted', () => {
  const at = new Date(2026, 9, 14, 23, 30).getTime();
  const report = aggregateTokenUsage([
    { startedAt: at, usage: { input: 1000, output: 250, total: 1250 } },
  ]);
  assert.deepStrictEqual(report.days.map((d) => d.date), ['2026-10-14']);
  assert.strictEqual(report.days[0].total, 1250);
  assert.strictEqual(report.days[0].input, 1000);
  assert.strictEqual(report.days[0].output, 250);
  assert.strictEqual(report.days[0].turns, 1);
  assert.strictEqual(report.total, 1250);
  assert.strictEqual(report.turns, 1);
  assert.strictEqual(report.since, '2026-10-14');
});

test('turns on one day add up, and the days come back oldest first', () => {
  const report = aggregateTokenUsage([
    { startedAt: new Date(2026, 9, 15, 9).getTime(), usage: { input: 10, output: 5, total: 15 } },
    { startedAt: new Date(2026, 9, 12, 9).getTime(), usage: { input: 100, output: 50, total: 150 } },
    { startedAt: new Date(2026, 9, 15, 18).getTime(), usage: { input: 1, output: 1, total: 2 } },
  ]);
  assert.deepStrictEqual(report.days.map((d) => d.date), ['2026-10-12', '2026-10-15']);
  assert.deepStrictEqual(report.days.map((d) => d.total), [150, 17]);
  assert.strictEqual(report.days[1].turns, 2);
  assert.strictEqual(report.total, 167);
  assert.strictEqual(report.since, '2026-10-12');
});

test('a turn with no report is not a zero day', () => {
  const report = aggregateTokenUsage([
    { startedAt: new Date(2026, 9, 14, 9).getTime() },
    { startedAt: new Date(2026, 9, 14, 10).getTime(), usage: null },
    { startedAt: new Date(2026, 9, 14, 11).getTime(), usage: {} },
    { startedAt: new Date(2026, 9, 14, 12).getTime(), usage: { input: 0, output: 0, total: 0 } },
  ]);
  assert.deepStrictEqual(report.days, []);
  assert.strictEqual(report.total, 0);
  assert.strictEqual(report.turns, 0);
  assert.strictEqual(report.since, null);
});

test('a total the provider never gave falls back to input plus output', () => {
  const report = aggregateTokenUsage([
    { startedAt: new Date(2026, 9, 14, 9).getTime(), usage: { input: 900, output: 100 } },
    { startedAt: new Date(2026, 9, 14, 9).getTime(), usage: { output: 42 } },
  ]);
  assert.strictEqual(report.total, 1042);
  assert.strictEqual(report.turns, 2);
});

test('a turn with no usable timestamp is left out rather than guessed', () => {
  const report = aggregateTokenUsage([
    { usage: { input: 10, output: 1, total: 11 } },
    { startedAt: Number.NaN, usage: { input: 10, output: 1, total: 11 } },
    { startedAt: new Date(2026, 9, 14, 9).getTime(), usage: { input: 10, output: 1, total: 11 } },
  ]);
  assert.strictEqual(report.total, 11);
  assert.strictEqual(report.turns, 1);
});

/** A workspace with one session: index, live turns file, and nothing else. */
function workspaceWith(runs: object[], chatId = 'c1'): string {
  const root = mkdtempSync(path.join(tmpdir(), 'seq-tokens-'));
  const sequence = path.join(root, '.sequence');
  mkdirSync(path.join(sequence, 'sessions', chatId), { recursive: true });
  writeFileSync(
    path.join(sequence, 'sessions', 'index.json'),
    JSON.stringify({ version: 1, activeId: chatId, sessions: [{ id: chatId, title: 't', createdAt: 1, updatedAt: 2 }] }),
  );
  writeFileSync(
    path.join(sequence, 'sessions', chatId, 'agent-runs.json'),
    JSON.stringify({
      version: 1,
      runs: runs.map((run, i) => ({ id: `r${i}`, agentRef: 'claude', prompt: 'p', status: 'done', ...run })),
    }),
  );
  return root;
}

test('readTokenUsage reads a session index and sums its stored turns', () => {
  const root = workspaceWith([
    { id: 'r1', startedAt: new Date(2026, 9, 14, 9).getTime(), usage: { input: 100, output: 25, total: 125 } },
    { id: 'r2', startedAt: new Date(2026, 9, 14, 20).getTime(), usage: { input: 10, output: 5, total: 15 } },
  ]);
  try {
    const report = readTokenUsage(root);
    assert.strictEqual(report.total, 140);
    assert.strictEqual(report.days.length, 1);
    assert.strictEqual(report.days[0].turns, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a workspace with no sessions reads as no usage, never an error', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'seq-tokens-empty-'));
  try {
    const report = readTokenUsage(root);
    assert.strictEqual(report.total, 0);
    assert.deepStrictEqual(report.days, []);
    assert.strictEqual(report.since, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GET /api/usage/tokens serves the report, so the map is reached through the server', async () => {
  const root = workspaceWith([
    { startedAt: new Date(2026, 9, 14, 9).getTime(), usage: { input: 100, output: 25, total: 125 } },
    { startedAt: new Date(2026, 9, 14, 20).getTime(), usage: { input: 10, output: 5, total: 15 } },
  ]);
  const userDir = mkdtempSync(path.join(tmpdir(), 'seq-tokens-home-'));
  const server = await createRepoServer(root, { webDist: undefined, userConfigDir: userDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/usage/tokens`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { total: number; turns: number; days: { date: string }[] };
    assert.strictEqual(body.total, 140);
    assert.strictEqual(body.turns, 2);
    assert.deepStrictEqual(body.days.map((d) => d.date), ['2026-10-14']);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    /* Windows can hold a directory handle for a moment after close: the temp tree is the runner's to clean. */
    try {
      rmSync(root, { recursive: true, force: true });
      rmSync(userDir, { recursive: true, force: true });
    } catch {
      /* left for the OS temp cleaner */
    }
  }
});
