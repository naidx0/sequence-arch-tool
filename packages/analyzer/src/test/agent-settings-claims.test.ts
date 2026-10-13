/**
 * Claims T3 and U71, in the settings payload (server/askAgentMap.ts):
 *   - GET /api/agent-settings carries `tools: { all, core, allTokens, coreTokens }` read from the MCP
 *     registry, so the Settings copy cannot say "All 16 tools" while the registry has more.
 *   - `updates.check` (default on) is stored, read and PUT here, and the daily update scheduler
 *     skips its request while it is off.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UpdateService, startDailyUpdateCheck } from '../server/appUpdate.js';
import { handleAppRoute } from '../server/appUpdateRoutes.js';
import { automaticUpdateCheckAllowed, readAgentSettings, updatesCheckEnabled, writeAgentSettings } from '../server/askAgentMap.js';
import { createRepoServer } from '../server/repoServer.js';
import { FAILURE_RETRY_MS, parseToolsListing, readToolsListing, resetToolsListing } from '../server/toolsListing.js';
import { sequenceMcpEntry } from '../server/sequenceMcp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.resolve(here, '..', '..', 'test', 'fixtures', 'shopfront');
const tmp = (p: string): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));

async function withServer<T>(fn: (base: string, store: string) => Promise<T>): Promise<T> {
  const repo = tmp('agent-settings-claims-repo-');
  fs.cpSync(SHOPFRONT, repo, { recursive: true, filter: (p) => !/(^|[\\/])\.sequence([\\/]|$)/.test(path.relative(SHOPFRONT, p)) });
  const store = tmp('agent-settings-claims-store-');
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir: store });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    return await fn(base, store);
  } finally {
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }
}

const put = (base: string, body: unknown) => fetch(`${base}/api/agent-settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('GET carries the tool counts from the registry: more than the old 16, core names include find_files, tokens are measured', async () => {
  const entry = sequenceMcpEntry();
  assert.ok(entry, 'packages/mcp is built (pnpm --filter @sequence/mcp build)');
  const registry = JSON.parse(execFileSync(process.execPath, [entry, '--listing'], { encoding: 'utf8', timeout: 60_000 }).trim().split('\n').pop()!) as { all: number; core: string[]; allTokens: number; coreTokens: number };
  await withServer(async (base) => {
    const got = (await (await fetch(`${base}/api/agent-settings`)).json()) as { tools: typeof registry | null };
    assert.ok(got.tools, 'tools is in the payload');
    assert.deepEqual(got.tools, registry);
    assert.ok(got.tools.all > 16, `the old copy said 16, the registry has ${got.tools.all}`);
    assert.ok(got.tools.core.includes('find_files') && got.tools.core.length < got.tools.all);
    assert.ok(got.tools.coreTokens > 0 && got.tools.allTokens > got.tools.coreTokens);
  });
});

test('parseToolsListing refuses anything that is not the summary, and readToolsListing is null with no entry', async () => {
  assert.equal(parseToolsListing(''), null);
  assert.equal(parseToolsListing('not json'), null);
  assert.equal(parseToolsListing('{"all":"23"}'), null);
  assert.deepEqual(parseToolsListing('noise\n{"all":2,"core":["a"],"allTokens":9,"coreTokens":4}\n'), { all: 2, core: ['a'], allTokens: 9, coreTokens: 4 });
  assert.equal(await readToolsListing(null), null);
  assert.equal(await readToolsListing(path.join(tmp('no-entry-'), 'missing.js'), 5_000), null);
});

test('updates.check: on by default, PUT stores it, a bad value is a 400, and other fields keep their values', async () => {
  await withServer(async (base, store) => {
    const first = (await (await fetch(`${base}/api/agent-settings`)).json()) as { updates: { check: boolean }; includeArchitectureMap: boolean };
    assert.deepEqual(first.updates, { check: true });
    assert.equal(updatesCheckEnabled(store), true);
    const off = await put(base, { updates: { check: false } });
    assert.equal(off.status, 200);
    assert.deepEqual(((await off.json()) as { updates: { check: boolean } }).updates, { check: false });
    assert.equal(updatesCheckEnabled(store), false);
    assert.equal(readAgentSettings(store).includeArchitectureMap, true, 'a PUT of one field leaves the others');
    assert.equal((await put(base, { allBoardTools: true })).status, 200);
    assert.equal(updatesCheckEnabled(store), false, 'a PUT of another field leaves updates.check off');
    assert.equal((await put(base, { updates: { check: 'no' } })).status, 400);
    assert.equal((await put(base, { updates: true })).status, 400);
    assert.equal((await put(base, {})).status, 400);
    assert.equal((await put(base, { updates: { check: true } })).status, 200);
    assert.equal(updatesCheckEnabled(store), true);
  });
});

test('updates.check: unreadable or hand-edited settings mean on', () => {
  const store = tmp('agent-settings-claims-edit-');
  fs.writeFileSync(path.join(store, 'agent-settings.json'), '{"updates":"nope"}');
  assert.equal(updatesCheckEnabled(store), true);
  fs.writeFileSync(path.join(store, 'agent-settings.json'), '{"updates":{"check":false}}');
  assert.equal(updatesCheckEnabled(store), false);
  writeAgentSettings(store, { autoRefine: true });
  assert.equal(updatesCheckEnabled(store), false, 'writing another field keeps it');
});

test('the daily scheduler makes no request while updates.check is off, and does once it is on again', async () => {
  let calls = 0;
  const service = { check: async () => void calls++ } as never;
  let on = false;
  const stop = startDailyUpdateCheck(service, 10, () => on);
  try {
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(calls, 0, 'off: no check');
    on = true;
    await new Promise((r) => setTimeout(r, 120));
    assert.ok(calls >= 1, 'on: the tick checks');
  } finally {
    stop();
  }
  const before = calls;
  let defaultCalls = 0;
  const stop2 = startDailyUpdateCheck({ check: async () => void defaultCalls++ } as never, 10);
  try {
    await new Promise((r) => setTimeout(r, 120));
    assert.ok(defaultCalls >= 1, 'with no guard given it checks as before');
  } finally {
    stop2();
  }
  assert.equal(calls, before);
});

/* ── updates.check off stops every automatic request, the Version section's refresh included ── */

async function serveUpdate(autoCheck: () => boolean) {
  let fetches = 0;
  const svc = new UpdateService({
    fetchImpl: (async () => {
      fetches++;
      return new Response('{}', { status: 404 });
    }) as typeof fetch,
    now: () => 1,
    userDir: tmp('agent-settings-claims-upd-'),
    platform: 'win32',
    arch: 'x64',
    current: () => '0.1.7',
    desktop: () => true,
    launch: () => 'x',
  });
  const server = http.createServer((req, r) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    void handleAppRoute({ req, res: r, url, method: req.method ?? 'GET', authOn: false, service: svc, autoCheck }).then((h) => {
      if (!h) {
        r.statusCode = 404;
        r.end('{}');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return { base, fetches: () => fetches, close: () => new Promise<void>((r) => (server.close(() => r()), (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.())) };
}

test('the automatic refresh (GET /api/app/update) makes no request while the check is off and says checkDisabled; only force=1 fetches', async () => {
  let on = false;
  const srv = await serveUpdate(() => on);
  try {
    const off = (await (await fetch(`${srv.base}/api/app/update`)).json()) as { checkDisabled?: boolean; check: { current: string; checkDisabled?: boolean } };
    assert.equal(srv.fetches(), 0, 'off: no request to GitHub');
    assert.equal(off.checkDisabled, true);
    assert.equal(off.check.checkDisabled, true);
    assert.equal(off.check.current, '0.1.7');
    await fetch(`${srv.base}/api/app/update?force=1`);
    assert.ok(srv.fetches() >= 1, 'Check now still asks');
    const before = srv.fetches();
    on = true;
    const again = (await (await fetch(`${srv.base}/api/app/update`)).json()) as { checkDisabled?: boolean };
    assert.equal(again.checkDisabled, undefined, 'on: the normal path');
    assert.ok(srv.fetches() >= before);
  } finally {
    await srv.close();
  }
});

test('automaticUpdateCheckAllowed: the setting and SEQUENCE_NO_UPDATE_CHECK=1 each switch it off', () => {
  const store = tmp('agent-settings-claims-auto-');
  assert.equal(automaticUpdateCheckAllowed(store, {}), true);
  assert.equal(automaticUpdateCheckAllowed(store, { SEQUENCE_NO_UPDATE_CHECK: '1' }), false);
  writeAgentSettings(store, { updates: { check: false } });
  assert.equal(automaticUpdateCheckAllowed(store, {}), false);
});

test('readToolsListing remembers a failure for 10 minutes: no second subprocess per GET', async () => {
  resetToolsListing();
  const dir = tmp('agent-settings-claims-fail-');
  const counter = path.join(dir, 'runs.txt');
  const entry = path.join(dir, 'entry.js');
  fs.writeFileSync(entry, `require('fs').appendFileSync(${JSON.stringify(counter)}, 'x'); process.exit(1);`);
  let t = 1_000;
  const runs = () => (fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8').length : 0);
  assert.equal(await readToolsListing(entry, 10_000, () => t), null);
  assert.equal(runs(), 1);
  t += FAILURE_RETRY_MS - 1;
  assert.equal(await readToolsListing(entry, 10_000, () => t), null);
  assert.equal(runs(), 1, 'inside the window: not run again');
  t += 2;
  assert.equal(await readToolsListing(entry, 10_000, () => t), null);
  assert.equal(runs(), 2, 'after the window: tried again');
  resetToolsListing();
});

test('claims-audit 1.6/2.6: boardFlowsTopDown and findFilesFirst default OFF, are stored on an explicit true, and PUT only takes booleans', async () => {
  await withServer(async (base, store) => {
    const get = async () => (await (await fetch(`${base}/api/agent-settings`)).json()) as { boardFlowsTopDown: boolean; findFilesFirst: boolean };
    const first = await get();
    assert.equal(first.boardFlowsTopDown, false);
    assert.equal(first.findFilesFirst, false);
    const put = (body: unknown) => fetch(`${base}/api/agent-settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await put({ boardFlowsTopDown: 'yes' })).status, 400);
    assert.equal((await put({ findFilesFirst: 1 })).status, 400);
    assert.equal((await put({ boardFlowsTopDown: true })).status, 200);
    assert.equal(readAgentSettings(store).boardFlowsTopDown, true);
    assert.equal(readAgentSettings(store).findFilesFirst, false, 'a field left out keeps its value');
    assert.equal((await put({ findFilesFirst: true })).status, 200);
    assert.deepEqual([readAgentSettings(store).boardFlowsTopDown, readAgentSettings(store).findFilesFirst], [true, true]);
  });
});

test('the first update check runs once shortly after launch, and respects updates.check', async () => {
  let calls = 0;
  const service = { check: async () => void calls++ } as never;
  let on = true;
  const stop = startDailyUpdateCheck(service, 60_000, () => on, 20);
  try {
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(calls, 1, 'on: one check at launch, before the daily interval fires');
  } finally {
    stop();
  }
  const off = startDailyUpdateCheck(service, 60_000, () => false, 20);
  try {
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(calls, 1, 'off: the first check makes no request');
  } finally {
    off();
  }
  const none = startDailyUpdateCheck(service, 60_000, () => true, null);
  try {
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(calls, 1, 'null: no first check');
  } finally {
    none();
  }
});
