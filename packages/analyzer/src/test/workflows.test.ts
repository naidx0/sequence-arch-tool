import { bound } from './load-scale.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { TEST_COMMANDS, compileWorkflow, validateProgram } from '@sequence/schema';

import { VERIFY_COMMAND_ALLOWLIST, isVerifyCommandAllowlisted } from '../harness/verifyGate.js';
import { createRepoServer } from '../server/repoServer.js';
import { WorkflowError, applyWorkflowEdit, createWorkflow, deleteWorkflow, findWorkflow, listWorkflows, readWorkflow, withLock } from '../workflows/workflowStore.js';

/** ROUND 13 (A8): saved block workflows, the store both the app and the MCP tool write through. */

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAINAPP = path.join(path.resolve(here, '..', '..'), 'test', 'fixtures', 'plainapp');
const tmpRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-workflows-'));

test('the Test runner offers exactly the engine\'s verify-gate commands', () => {
  assert.deepEqual([...TEST_COMMANDS], [...VERIFY_COMMAND_ALLOWLIST]);
  for (const c of TEST_COMMANDS) assert.equal(isVerifyCommandAllowlisted(c), true);
});

test('reading a project with no workflows writes nothing; create starts from the ready-made blocks and validates', () => {
  const root = tmpRoot();
  assert.deepEqual(listWorkflows(root), []);
  assert.equal(fs.existsSync(path.join(root, '.sequence')), false);
  const doc = createWorkflow(root, { name: 'Fix the bug' });
  assert.equal(doc.id, 'fix-the-bug');
  assert.deepEqual(doc.blocks.map((b) => b.kind), ['agent', 'checker', 'test', 'finish']);
  assert.deepEqual(validateProgram(compileWorkflow(doc)).errors, []);
  assert.equal(createWorkflow(root, { name: 'Fix the bug' }).id, 'fix-the-bug-2');
  assert.equal(findWorkflow(root, 'fix-the-bug-2')?.id, 'fix-the-bug-2');
  const uniq = createWorkflow(root, { name: 'Docs pass' });
  assert.equal(findWorkflow(root, 'DOCS PASS')?.id, uniq.id);
  assert.throws(() => createWorkflow(root, { name: '  ' }), WorkflowError);
});

test('edits are ops on the file as it is now: a second writer\'s change is kept, a bad op writes nothing', async () => {
  const root = tmpRoot();
  const a = createWorkflow(root, { name: 'W' });
  /* Another process (the MCP server) edits the same file between two edits of this one. */
  await applyWorkflowEdit(root, a.id, [{ op: 'update', id: 'b1', model: 'm-1' }]);
  const second = await applyWorkflowEdit(root, a.id, [{ op: 'add', kind: 'loop', at: 0, span: 3 }]);
  assert.equal(second.blocks.find((b) => b.id === 'b1')?.model, 'm-1');
  assert.equal(second.rev, a.rev + 2);
  const before = fs.readFileSync(path.join(root, '.sequence', 'workflows', `${a.id}.json`), 'utf8');
  await assert.rejects(applyWorkflowEdit(root, a.id, [{ op: 'rename', name: 'ok' }, { op: 'remove', id: 'nope' }]), /no block 'nope'/);
  assert.equal(fs.readFileSync(path.join(root, '.sequence', 'workflows', `${a.id}.json`), 'utf8'), before);
  await assert.rejects(applyWorkflowEdit(root, 'missing', [{ op: 'rename', name: 'x' }]), (e: unknown) => e instanceof WorkflowError && e.status === 404);
});

test('a hand-damaged file keeps its valid blocks; delete removes it', () => {
  const root = tmpRoot();
  const a = createWorkflow(root, { name: 'W' });
  const file = path.join(root, '.sequence', 'workflows', `${a.id}.json`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.blocks.push({ id: 'x', kind: 'nonsense', title: 'x' }, 7);
  fs.writeFileSync(file, JSON.stringify(raw));
  assert.equal(readWorkflow(root, a.id)?.blocks.length, 4);
  deleteWorkflow(root, a.id);
  assert.equal(readWorkflow(root, a.id), null);
});

async function startServer(repo: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repo, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

test('routes: create, list with the compiled program, ops, a refused op is a 400 with its reason, delete', async () => {
  const dir = tmpRoot();
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  const { base, close } = await startServer(repo);
  const json = { 'content-type': 'application/json' };
  try {
    const created = await fetch(`${base}/api/workflows`, { method: 'POST', headers: json, body: JSON.stringify({ name: 'Ship' }) });
    assert.equal(created.status, 201);
    const doc = (await created.json()) as { id: string; valid: boolean; program: { nodes: unknown[] } };
    assert.equal(doc.valid, true);
    assert.equal(doc.program.nodes.length, 5);
    const ops = await fetch(`${base}/api/workflows/${doc.id}/ops`, { method: 'POST', headers: json, body: JSON.stringify({ ops: [{ op: 'add', kind: 'loop', at: 0, span: 3 }] }) });
    assert.equal(ops.status, 200);
    const edited = (await ops.json()) as { program: { nodes: { kind: string }[] }; notes: string[] };
    assert.equal(edited.program.nodes.some((n) => n.kind === 'loop'), true);
    const bad = await fetch(`${base}/api/workflows/${doc.id}/ops`, { method: 'POST', headers: json, body: JSON.stringify({ ops: [{ op: 'update', id: 'b3', command: 'rm -rf /' }] }) });
    assert.equal(bad.status, 400);
    assert.match(await bad.text(), /command must be one of/);
    const list = (await (await fetch(`${base}/api/workflows`)).json()) as { workflows: { id: string }[] };
    assert.deepEqual(list.workflows.map((w) => w.id), [doc.id]);
    assert.equal((await fetch(`${base}/api/workflows/${doc.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${base}/api/workflows/${doc.id}`)).status, 404);
  } finally {
    await close();
  }
});

test('writers in other processes do not lose each other: revisions climb one by one to the full count', async () => {
  const root = tmpRoot();
  const a = createWorkflow(root, { name: 'Race' });
  /* A file URL: on Windows import() refuses a bare C:\ path. */
  const mod = pathToFileURL(path.join(here, '..', 'workflows', 'workflowStore.js')).href;
  /* "busy, try again" (409) is the store's documented answer when the lock is held past its give-up; on a loaded machine a writer can be starved that long, so a writer retries it, as a client would. Every edit must still land exactly once: the revision count below is the proof. */
  const code = `const s = await import(${JSON.stringify(mod)}); for (let i = 0; i < 40; i++) { for (let k = 0; ; k++) { try { await s.applyWorkflowEdit(${JSON.stringify(root)}, ${JSON.stringify(a.id)}, [{ op: 'update', id: 'b1', title: process.argv[1] + i }]); break; } catch (e) { if (e && e.status === 409 && k < 20) continue; throw e; } } }`;
  const { spawn } = await import('node:child_process');
  await Promise.all(
    ['A', 'B', 'C'].map(
      (t) => new Promise<void>((resolve, reject) => {
        const p = spawn(process.execPath, ['--input-type=module', '-e', code, t], { stdio: ['ignore', 'inherit', 'pipe'] });
        let err = '';
        p.stderr.on('data', (d: Buffer) => (err += d.toString()));
        p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`writer ${t} exited ${c}: ${err.slice(0, 600)}`))));
      }),
    ),
  );
  assert.equal(readWorkflow(root, a.id)!.rev, a.rev + 120);
  assert.deepEqual(fs.readdirSync(path.join(root, '.sequence', 'workflows')), [`${a.id}.json`]);
});

test('an edit that names the revision it read is refused with 409 when the file moved on', async () => {
  const root = tmpRoot();
  const a = createWorkflow(root, { name: 'Cas' });
  await applyWorkflowEdit(root, a.id, [{ op: 'rename', name: 'one' }], a.rev);
  await assert.rejects(applyWorkflowEdit(root, a.id, [{ op: 'rename', name: 'two' }], a.rev), (e: unknown) => e instanceof WorkflowError && e.status === 409);
  assert.equal(readWorkflow(root, a.id)!.name, 'one');
});

test('a symlinked .sequence/workflows is refused, and a malformed address is a 400', async () => {
  const root = tmpRoot();
  const outside = tmpRoot();
  fs.mkdirSync(path.join(root, '.sequence'));
  fs.symlinkSync(outside, path.join(root, '.sequence', 'workflows'));
  assert.throws(() => createWorkflow(root, { name: 'x' }), (e: unknown) => e instanceof WorkflowError && e.status === 403);
  assert.deepEqual(fs.readdirSync(outside), []);
  const repo = path.join(tmpRoot(), 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  const { base, close } = await startServer(repo);
  try {
    assert.equal((await fetch(`${base}/api/workflows/%E0%A4%A`)).status, 400);
  } finally {
    await close();
  }
});

test('a symlinked .sequence is refused before anything is made, even when the workflows folder does not exist yet', () => {
  const root = tmpRoot();
  const outside = tmpRoot();
  fs.symlinkSync(outside, path.join(root, '.sequence'));
  assert.throws(() => createWorkflow(root, { name: 'x' }), (e: unknown) => e instanceof WorkflowError && e.status === 403 && /\.sequence is a symbolic link/.test(e.message));
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.deepEqual(listWorkflows(root), []);
  /* a file-level symlink inside a real folder is not followed */
  const r2 = tmpRoot();
  createWorkflow(r2, { name: 'real' });
  const secret = path.join(outside, 'secret.json');
  fs.writeFileSync(secret, JSON.stringify({ name: 'SECRET', blocks: [] }));
  fs.symlinkSync(secret, path.join(r2, '.sequence', 'workflows', 'leak.json'));
  assert.equal(readWorkflow(r2, 'leak'), null);
});

test('a lock left by a dead process is broken at once, and the wait never blocks the thread', async () => {
  const root = tmpRoot();
  const a = createWorkflow(root, { name: 'Lock' });
  const lock = path.join(root, '.sequence', 'workflows', `${a.id}.json.lock`);
  const { spawnSync } = await import('node:child_process');
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']).stdout.toString();
  fs.writeFileSync(lock, JSON.stringify({ pid: Number(dead), startedAt: Date.now(), token: 'dead' }));
  const t0 = Date.now();
  const doc = await applyWorkflowEdit(root, a.id, [{ op: 'rename', name: 'after a crash' }]);
  assert.equal(doc.name, 'after a crash');
  assert.ok(Date.now() - t0 < bound(2_000, 5_000), `took ${Date.now() - t0}ms`); /* ceiling 5 s: a dead owner's lock is broken at once, not after waiting out a stale age (60 s) */
  assert.deepEqual(fs.readdirSync(path.join(root, '.sequence', 'workflows')), [`${a.id}.json`]);
  /* a live owner (this process) holds it: the edit waits, and timers keep firing meanwhile */
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: Date.now(), token: 'mine-elsewhere' }));
  let ticks = 0;
  const tick = setInterval(() => (ticks += 1), 5);
  const waiting = applyWorkflowEdit(root, a.id, [{ op: 'rename', name: 'second' }]);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(readWorkflow(root, a.id)!.name, 'after a crash');
  /* 200 ms of 5 ms timers is 40 ticks idle; a blocked thread gives ~0. Under load timers coalesce, so ask for a fraction. */
  assert.ok(ticks >= 3, `event loop starved: ${ticks} ticks`);
  fs.rmSync(lock);
  assert.equal((await waiting).name, 'second');
  clearInterval(tick);
  /* an empty lock (an older build mid-write, or garbage) is broken after a short grace, not 10s */
  fs.writeFileSync(lock, '');
  const t1 = Date.now();
  await applyWorkflowEdit(root, a.id, [{ op: 'rename', name: 'third' }]);
  assert.ok(Date.now() - t1 < bound(3_000, 4_000), `took ${Date.now() - t1}ms`); /* ceiling 4 s: an unreadable lock is broken after its 1 s grace, not a longer one */
});

test('a writer releases only its own lock: one that was replaced under it is put back', async () => {
  const root = tmpRoot();
  const a = createWorkflow(root, { name: 'Own' });
  const file = path.join(root, '.sequence', 'workflows', `${a.id}.json`);
  const other = JSON.stringify({ pid: process.pid, startedAt: Date.now(), token: 'other' });
  await withLock(file, () => {
    /* as if our lock had been broken and another writer took it */
    fs.writeFileSync(`${file}.lock`, other);
  });
  assert.equal(fs.readFileSync(`${file}.lock`, 'utf8'), other);
  fs.rmSync(`${file}.lock`);
});

test('in one process, edits queue rather than collide: every one lands', async () => {
  const root = tmpRoot();
  const a = createWorkflow(root, { name: 'Queue' });
  await Promise.all(Array.from({ length: 30 }, (_, i) => applyWorkflowEdit(root, a.id, [{ op: 'update', id: 'b1', title: `t${i}` }])));
  assert.equal(readWorkflow(root, a.id)!.rev, a.rev + 30);
});
