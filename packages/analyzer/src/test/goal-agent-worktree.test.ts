import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { addAgent } from '../server/agentsStore.js';
import { goalRunState } from '../server/goalRunner.js';
import { createRepoServer } from '../server/repoServer.js';
import { sequenceMcpEntry } from '../server/sequenceMcp.js';
import { createSession, readSessionGoal, readSessionWorktree, updateSession } from '../server/sessionsStore.js';

/**
 * TWO AGENT GOAL RUNS ON ONE REPO NEVER INTERLEAVE WRITES (audit P1-11, the agent half).
 *
 * Agents write files themselves, so the per-path lock cannot order them. The second Build run on a repo is cut a chat
 * worktree and its agent's cwd is that worktree. The agent is the repo's own mock (goal-agent.mjs, mode `write`: it
 * writes its --tag into shared.txt under the cwd the host gave it), so there is no real CLI.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '..', '..', '..', 'acp', 'src', 'test', 'fixtures', 'goal-agent.mjs');
const tmp = (p: string): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const git = (cwd: string, ...args: string[]): string => {
  const env = { ...process.env };
  delete env.GIT_DIR;
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, env, encoding: 'utf8' });
};

interface Rig {
  base: string;
  repo: string;
  chats: string[];
  events: (tag: string) => Array<Record<string, any>>;
  close: () => Promise<void>;
}

async function rig(opts: { git: boolean }): Promise<Rig> {
  assert.ok(sequenceMcpEntry(), 'the MCP server must be built (packages/mcp/dist/server.js) for this test');
  const parent = tmp('goal-wt-');
  const repo = path.join(parent, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'repo', version: '1.0.0' }));
  fs.writeFileSync(path.join(repo, '.gitignore'), '.sequence/\n');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'main.ts'), 'export const where = "MAIN";\n');
  if (opts.git) {
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'init');
  }
  const userConfigDir = tmp('goal-wt-user-');
  const logDir = tmp('goal-wt-log-');
  for (const tag of ['A', 'B']) {
    addAgent(userConfigDir, { id: `mock${tag}`, command: process.execPath, args: [FIXTURE, '--mode=write', `--tag=${tag}`, `--log=${path.join(logDir, `${tag}.jsonl`)}`] });
  }
  addAgent(userConfigDir, { id: 'mockN', command: process.execPath, args: [FIXTURE, '--mode=narrate', `--log=${path.join(logDir, 'N.jsonl')}`] });
  const chats = ['A', 'B', 'N'].map((tag) => {
    const made = createSession(repo);
    updateSession(repo, made.id, { title: `chat ${tag}`, goal: tag === 'N' ? 'Change where in src/onlyinwt.ts' : `goal ${tag}`, ...(tag === 'N' ? {} : { plan: [{ id: 's1', text: `step for ${tag}`, status: 'open' as const }] }) });
    return made.id;
  });
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir, browseRoot: parent });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    base,
    repo,
    chats,
    events: (tag) => {
      const f = path.join(logDir, `${tag}.jsonl`);
      return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    },
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

const startRun = (r: Rig, chat: string, tag: string, permission = 'build'): Promise<Response> =>
  fetch(`${r.base}/api/sessions/${chat}/goal-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ permission, agentRef: `mock${tag}` }),
  });

async function waitFor(what: string, f: () => boolean, ms = 30_000): Promise<void> {
  for (let i = 0; i < ms / 100 && !f(); i += 1) await sleep(100);
  assert.ok(f(), what);
}

const samePath = (a: string, b: string): boolean => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

test('a second agent Build run on a git repo works in its own worktree: the two never write the same file', async () => {
  const r = await rig({ git: true });
  try {
    const [a, b] = r.chats as [string, string];
    const first = await startRun(r, a, 'A');
    assert.strictEqual(first.status, 200, await first.clone().text());
    assert.strictEqual(((await first.json()) as { worktree?: unknown }).worktree, undefined, 'the first run keeps the main checkout');
    await waitFor('the first agent wrote', () => r.events('A').some((e) => e.ev === 'write'));
    const second = await startRun(r, b, 'B');
    assert.strictEqual(second.status, 200, await second.clone().text());
    const body = (await second.json()) as { worktree?: { path: string; branch: string }; warning?: string };
    assert.ok(body.worktree, 'the second run was cut a worktree');
    assert.strictEqual(body.warning, undefined);
    await waitFor('the second agent wrote', () => r.events('B').some((e) => e.ev === 'write'));

    const bound = readSessionWorktree(r.repo, b);
    assert.ok(bound, 'the worktree is bound to the chat, so the Worktrees section lists it and merge/PR work as for any chat');
    assert.ok(samePath(bound.path, body.worktree.path));
    assert.strictEqual(readSessionWorktree(r.repo, a), null, 'the first run has no worktree');
    assert.ok(samePath(r.events('A').find((e) => e.ev === 'write')!.cwd, r.repo), "the first run's cwd is the main checkout");
    assert.ok(samePath(r.events('B').find((e) => e.ev === 'write')!.cwd, bound.path), "the second run's cwd is the worktree");

    for (const c of [a, b]) await waitFor(`run ${c} finished`, () => !goalRunState(r.repo, c).running, 60_000);
    assert.strictEqual(fs.readFileSync(path.join(r.repo, 'shared.txt'), 'utf8'), 'A\n', "the main checkout has only the first run's content");
    assert.strictEqual(fs.readFileSync(path.join(bound.path, 'shared.txt'), 'utf8'), 'B\n', "the worktree has only the second run's content");
  } finally {
    await r.close();
  }
});

test('a plan-mode run never gets a worktree, even beside a live Build run', async () => {
  const r = await rig({ git: true });
  try {
    const [a, b] = r.chats as [string, string];
    assert.strictEqual((await startRun(r, a, 'A')).status, 200);
    await waitFor('the first agent wrote', () => r.events('A').some((e) => e.ev === 'write'));
    const plan = await startRun(r, b, 'B', 'plan');
    assert.strictEqual(plan.status, 400, 'plan mode is refused at the door: it cannot write');
    assert.strictEqual(readSessionWorktree(r.repo, b), null);
    assert.strictEqual(r.events('B').filter((e) => e.ev === 'write').length, 0);
    await waitFor('run finished', () => !goalRunState(r.repo, a).running, 60_000);
  } finally {
    await r.close();
  }
});

test('in a folder that is not a git repo the second run keeps the checkout and is told runs may overlap', async () => {
  const r = await rig({ git: false });
  try {
    const [a, b] = r.chats as [string, string];
    assert.strictEqual((await startRun(r, a, 'A')).status, 200);
    await waitFor('the first agent wrote', () => r.events('A').some((e) => e.ev === 'write'));
    const second = await startRun(r, b, 'B');
    assert.strictEqual(second.status, 200, await second.clone().text());
    const body = (await second.json()) as { worktree?: unknown; warning?: string };
    assert.strictEqual(body.worktree, undefined);
    assert.match(body.warning ?? '', /may overlap/);
    assert.match(body.warning ?? '', /not a git repository/);
    await waitFor('the second agent wrote', () => r.events('B').some((e) => e.ev === 'write'));
    assert.strictEqual(readSessionWorktree(r.repo, b), null);
    assert.ok(samePath(r.events('B').find((e) => e.ev === 'write')!.cwd, r.repo), 'the run stays in the main checkout');
    for (const c of [a, b]) await waitFor(`run ${c} finished`, () => !goalRunState(r.repo, c).running, 60_000);
  } finally {
    await r.close();
  }
});

test("the harness's plan skeleton for a worktree run names files from the worktree, which the main checkout lacks", async () => {
  const r = await rig({ git: true });
  try {
    const [a, , n] = r.chats as [string, string, string];
    assert.strictEqual((await startRun(r, a, 'A')).status, 200);
    await waitFor('the first agent wrote', () => r.events('A').some((e) => e.ev === 'write'));
    const second = await startRun(r, n, 'N');
    assert.strictEqual(second.status, 200, await second.clone().text());
    assert.ok(((await second.json()) as { worktree?: unknown }).worktree, 'the run got a worktree');
    /* The agent creates src/onlyinwt.ts in its cwd only and writes no plan; after two plan turns the harness writes a
       skeleton from the goal, which can name that file only if it looks in the run's worktree. */
    await waitFor('the harness wrote a plan', () => (readSessionGoal(r.repo, n).plan ?? []).length > 0, 30_000);
    const plan = (readSessionGoal(r.repo, n).plan ?? []).map((s) => s.text).join('\n');
    assert.match(plan, /src\/onlyinwt\.ts/);
    assert.strictEqual(fs.existsSync(path.join(r.repo, 'src', 'onlyinwt.ts')), false, 'the main checkout never had the file');
    await fetch(`${r.base}/api/sessions/${n}/goal-run/stop`, { method: 'POST' });
    await waitFor('runs finished', () => !goalRunState(r.repo, a).running && !goalRunState(r.repo, n).running, 60_000);
  } finally {
    await r.close();
  }
});
