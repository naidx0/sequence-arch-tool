import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { addAgent } from '../server/agentsStore.js';
import {
  FULL_ACCESS_FILE,
  FULL_ACCESS_PROMPT,
  hasFullAccessConsent,
  recordFullAccessConsent,
} from '../server/fullAccessConsent.js';
import { workspaceRoot } from '../server/workspace.js';

/**
 * FULL ACCESS = SKIP PERMISSIONS, behind ONE confirmation per project.
 *
 *  - every wire value of `permissionMode` reaches the agent unchanged, as the
 *    Claude `_meta.claudeCode.options` the build spec's table names;
 *  - full access is refused until the project's `.sequence/` holds the
 *    confirmation, and allowed (with no further prompt) after it;
 *  - when the agent refuses bypass, its own reason reaches the caller and the
 *    turn does NOT run in a weaker mode.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const MOCK_AGENT = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'mock-agent.mjs');

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** An attached repo is watched; on Windows the watcher can still hold the dir. */
function rmBestEffort(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* temp dir; the OS reaps it */
  }
}

function tempProject(): string {
  const dir = tempDir('seq-full-access-proj-');
  fs.writeFileSync(path.join(dir, 'index.ts'), 'export const x = 1;\n');
  return dir;
}

async function startServer(userConfigDir: string, repoRoot: string | null) {
  const server = await createRepoServer(repoRoot, { webDist: undefined, userConfigDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

async function post(base: string, route: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function accessOf(text: string): { meta: { claudeCode?: { options?: Record<string, unknown> } } | null } {
  const m = /access=(.*)$/s.exec(text);
  assert.ok(m, `the mock reported what reached it; got ${text}`);
  return JSON.parse(m![1]!);
}

/* ------------------------------ the consent store ------------------------------ */

test('consent: absent until recorded, present after, stored in the project .sequence/', () => {
  const proj = tempProject();
  try {
    assert.strictEqual(hasFullAccessConsent(proj), false);
    recordFullAccessConsent(proj);
    assert.strictEqual(hasFullAccessConsent(proj), true);
    assert.ok(fs.existsSync(path.join(proj, '.sequence', FULL_ACCESS_FILE)));
    assert.strictEqual(hasFullAccessConsent(null), false, 'no project, no consent');
  } finally {
    rmBestEffort(proj);
  }
});

test('consent: a file written for a different root does not count (a repo cannot ship its own yes)', () => {
  const a = tempProject();
  const b = tempProject();
  try {
    recordFullAccessConsent(a);
    fs.mkdirSync(path.join(b, '.sequence'), { recursive: true });
    fs.copyFileSync(path.join(a, '.sequence', FULL_ACCESS_FILE), path.join(b, '.sequence', FULL_ACCESS_FILE));
    assert.strictEqual(hasFullAccessConsent(b), false);
  } finally {
    rmBestEffort(a);
    rmBestEffort(b);
  }
});

/* ------------------------------ the HTTP surface ------------------------------ */

test('General workspace Full consent needs no agentRef and binds Full runs to that workspace, once per workspace', async () => {
  const store = tempDir('seq-general-full-'), otherStore = tempDir('seq-general-full-other-');
  const configuredCwd = tempProject();
  addAgent(store, { id: 'mock', command: process.execPath, args: [MOCK_AGENT], cwd: configuredCwd });
  const s = await startServer(store, null), other = await startServer(otherStore, null);
  const workspace = path.join(store, 'workspace');
  try {
    const before = await post(s.base, '/api/acp/run-node', { agentRef: 'mock', prompt: 'CWD', permissionMode: 'full' });
    assert.strictEqual(before.status, 409);
    const state = await fetch(`${s.base}/api/acp/full-access`).then(r => r.json()) as { confirmed: boolean; projectKey?: string };
    assert.strictEqual(state.confirmed, false);
    const earlier = await post(s.base, '/api/acp/run-node', { agentRef: 'mock', prompt: 'CWD', permissionMode: 'autoEdit', sessionKey: 'general-full' });
    assert.strictEqual(earlier.status, 200);
    assert.ok(String(earlier.json.text).includes(`cwd=${configuredCwd}`));
    const confirmed = await post(s.base, '/api/acp/full-access', { confirm: true });
    assert.strictEqual(confirmed.status, 200, 'General Full confirmation works without an agentRef');
    assert.strictEqual(confirmed.json.projectKey, workspace);
    assert.strictEqual(hasFullAccessConsent(workspace), true);
    assert.strictEqual(hasFullAccessConsent(configuredCwd), false, 'configured cwd is not silently granted consent');
    for (const sessionKey of [undefined, 'general-full']) {
      const run = await post(s.base, '/api/acp/run-node', { agentRef: 'mock', prompt: 'CWD', permissionMode: 'full', cwd: configuredCwd, ...(sessionKey ? { sessionKey } : {}) });
      assert.strictEqual(run.status, 200, JSON.stringify(run.json));
      assert.ok(String(run.json.text).includes(`cwd=${workspace}`), 'Full operates in the same workspace that was confirmed');
    }
    assert.strictEqual(((await fetch(`${s.base}/api/acp/full-access`).then(r => r.json())) as { confirmed: boolean }).confirmed, true);
    assert.strictEqual(((await fetch(`${other.base}/api/acp/full-access`).then(r => r.json())) as { confirmed: boolean }).confirmed, false, 'another workspace has not consented');
  } finally { await s.close(); await other.close(); rmBestEffort(store); rmBestEffort(otherStore); rmBestEffort(configuredCwd); }
});

const WIRE_TABLE: Array<{ wire: string; permissionMode: string; bypass?: true }> = [
  { wire: 'default', permissionMode: 'default' },
  { wire: 'propose', permissionMode: 'default' },
  { wire: 'acceptEdits', permissionMode: 'acceptEdits' },
  { wire: 'autoEdit', permissionMode: 'acceptEdits' },
  { wire: 'plan', permissionMode: 'plan' },
  { wire: 'bypassPermissions', permissionMode: 'bypassPermissions', bypass: true },
  { wire: 'full', permissionMode: 'bypassPermissions', bypass: true },
];

test('run-node: every permissionMode value reaches the agent as the exact Claude option', async () => {
  const store = tempDir('seq-full-access-store-');
  const proj = tempProject();
  addAgent(store, { id: 'mock', command: process.execPath, args: [MOCK_AGENT] });
  recordFullAccessConsent(proj);
  const s = await startServer(store, proj);
  try {
    for (const row of WIRE_TABLE) {
      const r = await post(s.base, '/api/acp/run-node', { agentRef: 'mock', prompt: 'ACCESS', permissionMode: row.wire });
      assert.strictEqual(r.status, 200, `${row.wire}: ${JSON.stringify(r.json)}`);
      const options = accessOf(String(r.json.text)).meta?.claudeCode?.options;
      /* S2a: with a repository attached the session carries Sequence's board
         server, and its read-only tools are allowed alongside the mode. */
      assert.deepStrictEqual(
        options,
        {
          ...(row.bypass ? { permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true } : { permissionMode: row.permissionMode }),
          allowedTools: ['mcp__sequence__*'],
        },
        `${row.wire} reached the agent unchanged`
      );
    }
  } finally {
    await s.close();
    rmBestEffort(store);
    rmBestEffort(proj);
  }
});

test('run-node: full access is refused until the project confirms, then allowed with no further prompt', async () => {
  const store = tempDir('seq-full-access-store-');
  const proj = tempProject();
  addAgent(store, { id: 'mock', command: process.execPath, args: [MOCK_AGENT] });
  const s = await startServer(store, proj);
  try {
    const before = await post(s.base, '/api/acp/run-node', { agentRef: 'mock', prompt: 'PERMISSION', permissionMode: 'full' });
    assert.strictEqual(before.status, 409, 'refused before the confirmation');
    assert.strictEqual(before.json.needsConfirmation, true);
    assert.strictEqual(before.json.prompt, FULL_ACCESS_PROMPT);
    assert.match(String(before.json.error), /Agents can run any command without asking/);

    const state0 = (await (await fetch(`${s.base}/api/acp/full-access`)).json()) as Record<string, unknown>;
    assert.strictEqual(state0.confirmed, false);

    // A confirm must be explicit: anything but `confirm: true` records nothing.
    const sloppy = await post(s.base, '/api/acp/full-access', { confirm: 'yes' });
    assert.strictEqual(sloppy.status, 400);
    assert.strictEqual(hasFullAccessConsent(proj), false);

    const ok = await post(s.base, '/api/acp/full-access', { confirm: true });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.json.confirmed, true);
    assert.strictEqual(hasFullAccessConsent(proj), true, 'remembered in the project store');

    // After: allowed, and every permission request is answered allow — no lock.
    for (let i = 0; i < 2; i++) {
      const after = await post(s.base, '/api/acp/run-node', { agentRef: 'mock', prompt: 'PERMISSION', permissionMode: 'full' });
      assert.strictEqual(after.status, 200, JSON.stringify(after.json));
      assert.match(String(after.json.text), /permission=allow-1/);
    }
  } finally {
    await s.close();
    rmBestEffort(store);
    rmBestEffort(proj);
  }
});

test("run-node: the agent's bypass refusal reason reaches the caller; the turn is not downgraded", async () => {
  const store = tempDir('seq-full-access-store-');
  const proj = tempProject();
  const reason = 'bypassPermissions is disabled by managed policy (disableBypassPermissionsMode)';
  addAgent(store, { id: 'mock', command: process.execPath, args: [MOCK_AGENT] });
  recordFullAccessConsent(proj);
  process.env.MOCK_AGENT_REFUSE_BYPASS = reason;
  const s = await startServer(store, proj);
  try {
    for (const sessionKey of [undefined, 'run-1::mock']) {
      const r = await post(s.base, '/api/acp/run-node', {
        agentRef: 'mock',
        prompt: 'ACCESS',
        permissionMode: 'full',
        ...(sessionKey ? { sessionKey } : {}),
      });
      assert.strictEqual(r.status, 403, `refused, not run (${sessionKey ?? 'fresh'}): ${JSON.stringify(r.json)}`);
      assert.ok(String(r.json.reason).includes(reason), `the agent's reason passes through: ${JSON.stringify(r.json)}`);
      assert.match(String(r.json.error), /refused full access/);
      assert.strictEqual(r.json.text, undefined, 'no turn ran in a weaker mode');
    }
  } finally {
    delete process.env.MOCK_AGENT_REFUSE_BYPASS;
    await s.close();
    rmBestEffort(store);
    rmBestEffort(proj);
  }
});

test('default workspace: with no repository attached, Full access is confirmed for the home workspace and the turn runs there', async () => {
  const store = tempDir('seq-full-access-store-');
  addAgent(store, { id: 'mock', command: process.execPath, args: [MOCK_AGENT] });
  const s = await startServer(store, null as unknown as string);
  try {
    const state0 = (await (await fetch(`${s.base}/api/acp/full-access`)).json()) as Record<string, unknown>;
    assert.strictEqual(state0.confirmed, false, 'not confirmed yet');
    const before = await post(s.base, '/api/acp/run-node', { agentRef: 'mock', prompt: 'PERMISSION', permissionMode: 'full' });
    assert.strictEqual(before.status, 409, 'refused before the confirmation');

    /* Round 9: this answered 400 "no project" on the default workspace. */
    const ok = await post(s.base, '/api/acp/full-access', { confirm: true });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
    assert.strictEqual(ok.json.confirmed, true);
    const state1 = (await (await fetch(`${s.base}/api/acp/full-access`)).json()) as Record<string, unknown>;
    assert.strictEqual(state1.confirmed, true, 'remembered for the workspace');

    const after = await post(s.base, '/api/acp/run-node', { agentRef: 'mock', prompt: 'PERMISSION', permissionMode: 'full' });
    assert.strictEqual(after.status, 200, JSON.stringify(after.json));
    assert.match(String(after.json.text), /permission=allow-1/);

    const where = await post(s.base, '/api/acp/run-node', { agentRef: 'mock', prompt: 'CWD', permissionMode: 'full' });
    assert.strictEqual(where.status, 200, JSON.stringify(where.json));
    const ws = fs.realpathSync(workspaceRoot(store));
    assert.ok(String(where.json.text).includes(`cwd=${ws}`), `the agent runs in the workspace: ${String(where.json.text)}`);
  } finally {
    await s.close();
    rmBestEffort(store);
  }
});
