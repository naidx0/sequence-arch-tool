import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { dropPending, flushWrites, flushWritesSync, scheduleAppend, scheduleWrite, setAfterOpenHook, setBeforeRenameHook, writerStats } from '../server/asyncWriter.js';
import { appendTurnLog, readTurnLog, recordAgentRun, type StoredAgentRun } from '../server/agentChatStore.js';
import { createSession, deleteSession, ensureSessionsMigrated, moveSession, readSessionIndex, setActiveSession, updateSession } from '../server/sessionsStore.js';
import { readJson, SEQUENCE_DIR, SESSIONS_INDEX_FILE, writeJson } from '../server/store.js';

const run = (n: number, over: Partial<StoredAgentRun> = {}): StoredAgentRun => ({ id: `r${n}`, agentRef: 'claude', prompt: `p${n}`, text: `t${n}`, status: 'done', error: null, stopReason: 'end_turn', startedAt: n, endedAt: n + 1, model: null, nodeId: null, tools: [], ...over });
const tmp = (): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-batch-')));
const indexFile = (root: string): string => path.join(root, SEQUENCE_DIR, SESSIONS_INDEX_FILE);
const onDisk = (root: string) => JSON.parse(fs.readFileSync(indexFile(root), 'utf8')) as { activeId: string; sessions: Array<{ id: string; runningTurn?: { id: string } }> };

test('coalescing: N rapid updates to one file are ONE file write, and the last one wins', async () => {
  const dir = tmp();
  const f = path.join(dir, 'a.json');
  await flushWrites();
  const before = writerStats().fileWrites;
  for (let i = 0; i < 200; i++) scheduleWrite(f, JSON.stringify({ i }));
  assert.strictEqual(fs.existsSync(f), false, 'nothing is written on the calling stack');
  await flushWrites();
  assert.strictEqual(writerStats().fileWrites - before, 1);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { i: 199 });
  assert.deepStrictEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), []);
});

test('coalescing: rapid setActiveSession calls are one index write; this process reads the new value at once', async () => {
  const root = tmp();
  const first = ensureSessionsMigrated(root).activeId;
  const second = createSession(root).id;
  await flushWrites();
  const before = writerStats().fileWrites;
  for (let i = 0; i < 40; i++) setActiveSession(root, i % 2 ? first : second);
  /* 40 calls, the last one (i = 39) picked `first`; the store reads it back before any byte reaches the disk. */
  assert.strictEqual(readSessionIndex(root)!.activeId, first);
  await flushWrites();
  assert.strictEqual(writerStats().fileWrites - before, 1);
  assert.strictEqual(onDisk(root).activeId, first);
});

test('the index is machine-only and is written compact', async () => {
  const root = tmp();
  ensureSessionsMigrated(root);
  setActiveSession(root, readSessionIndex(root)!.activeId);
  await flushWrites();
  const text = fs.readFileSync(indexFile(root), 'utf8');
  assert.ok(!/\n\s/.test(text), 'no indentation or newlines inside the JSON');
});

test('durability: an acknowledged chat save and a started turn are on disk the moment the call returns', async () => {
  const root = tmp();
  const id = ensureSessionsMigrated(root).activeId;
  await flushWrites();
  updateSession(root, id, { chat: { version: 1, sessionId: id, turns: [{ role: 'user', text: 'hello durable' }] } as never });
  const chatFile = path.join(root, SEQUENCE_DIR, 'sessions', id, 'chat.json');
  assert.ok(fs.readFileSync(chatFile, 'utf8').includes('hello durable'), 'chat.json is on disk without any flush');
  /* The marker the rail reads for "interrupted by a restart" changes only on a turn start/end, and is written at once. */
  recordAgentRun(root, id, run(1, { status: 'running' }));
  assert.strictEqual(onDisk(root).sessions.find((s) => s.id === id)!.runningTurn?.id, 'r1');
  /* A progress write that moves only updatedAt is deferred, and still does not lose the marker. */
  recordAgentRun(root, id, run(1, { status: 'running', text: 'more' }));
  assert.strictEqual(readSessionIndex(root)!.sessions.find((s) => s.id === id)!.runningTurn?.id, 'r1');
  assert.strictEqual(onDisk(root).sessions.find((s) => s.id === id)!.runningTurn?.id, 'r1');
});

function child(root: string, body: string): { status: number | null; signal: NodeJS.Signals | null; stderr: string } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const u = (n: string): string => pathToFileURL(path.join(here, '..', 'server', n)).href;
  const code = `
    import { setActiveSession, createSession, updateSession, ensureSessionsMigrated } from '${u('sessionsStore.js')}';
    const root = ${JSON.stringify(root)};
    ${body}
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env } });
  return { status: r.status, signal: r.signal, stderr: r.stderr };
}

test('crash: a process that dies hard right after an acknowledged chat save has the chat on disk', () => {
  const root = tmp();
  const id = ensureSessionsMigrated(root).activeId;
  child(
    root,
    `const id = ${JSON.stringify(id)};
     updateSession(root, id, { chat: { version: 1, sessionId: id, turns: [{ role: 'user', text: 'survives SIGKILL' }] } });
     createSession(root);
     setActiveSession(root, id);
     process.kill(process.pid, 'SIGKILL');`,
  );
  const chat = fs.readFileSync(path.join(root, SEQUENCE_DIR, 'sessions', id, 'chat.json'), 'utf8');
  assert.ok(chat.includes('survives SIGKILL'));
  /* The created chat (acknowledged) is in the index on disk; only the deferred pointer may be lost. */
  assert.strictEqual(onDisk(root).sessions.length, 2);
});

test('exit: deferred writes queued mid-debounce are flushed when the process exits', () => {
  const root = tmp();
  const first = ensureSessionsMigrated(root).activeId;
  const second = createSession(root).id;
  assert.notStrictEqual(first, second);
  const r = child(root, `setActiveSession(root, ${JSON.stringify(first)}); process.exit(0);`);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(onDisk(root).activeId, first);
});

test('the turn log is appended behind the writer, read back at once, and coalesced into one append', async () => {
  const root = tmp();
  const id = ensureSessionsMigrated(root).activeId;
  const userDir = tmp();
  await flushWrites();
  const before = writerStats().fileWrites;
  for (let i = 0; i < 25; i++) appendTurnLog(root, id, userDir, { n: i });
  assert.deepStrictEqual(readTurnLog(root, id, userDir, 100).length, 25);
  await flushWrites();
  assert.strictEqual(writerStats().fileWrites - before, 1);
});

test('server.close() puts queued writes on disk before it returns (no flush timer needed)', async () => {
  const { createRepoServer } = await import('../server/repoServer.js');
  const dir = tmp();
  const repo = path.join(dir, 'repo');
  const store = path.join(dir, 'user', '.sequence');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(repo, 'index.ts'), 'export const a = 1;\n');
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir: store });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const f = path.join(dir, 'queued.json');
  scheduleWrite(f, '{"queued":true}');
  assert.strictEqual(fs.existsSync(f), false, 'still queued');
  server.close();
  assert.strictEqual(fs.readFileSync(f, 'utf8'), '{"queued":true}', 'on disk the moment close() returns');
});

/* ── a deferred write never overwrites, resurrects or erases something newer ───────────────────────────────── */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('race: a synchronous write that lands while a deferred write is mid-flight is not replaced by the older text', async () => {
  const root = tmp();
  const f = path.join(root, SEQUENCE_DIR, 'x.json');
  writeJson(root, 'x.json', { v: 'old-deferred' }, { compact: true, defer: true });
  /* The seam pauses the drain after its temp file is complete and BEFORE the rename: exactly the window. */
  setBeforeRenameHook(async () => {
    setBeforeRenameHook(undefined);
    writeJson(root, 'x.json', { v: 'acked-sync' }, { compact: true });
  });
  try {
    await flushWrites();
  } finally {
    setBeforeRenameHook(undefined);
  }
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { v: 'acked-sync' });
  assert.deepStrictEqual(readJson(root, 'x.json'), { v: 'acked-sync' });
  assert.deepStrictEqual(fs.readdirSync(path.dirname(f)).filter((n) => n.endsWith('.tmp')), [], 'the abandoned temp file is removed');
});

test('race: a delete that lands while a deferred write is mid-flight stays deleted', async () => {
  const root = tmp();
  const f = path.join(root, SEQUENCE_DIR, 'x.json');
  writeJson(root, 'x.json', { v: 1 }, { compact: true });
  writeJson(root, 'x.json', { v: 2 }, { compact: true, defer: true });
  setBeforeRenameHook(async () => {
    setBeforeRenameHook(undefined);
    dropPending(f);
    fs.rmSync(f, { force: true });
  });
  try {
    await flushWrites();
  } finally {
    setBeforeRenameHook(undefined);
  }
  assert.strictEqual(fs.existsSync(f), false, 'the deleted file came back');
});

test('race: close() (flushWritesSync) while a drain is mid-flight: the newest text survives the drain finishing', async () => {
  const root = tmp();
  const f = path.join(root, SEQUENCE_DIR, 'x.json');
  scheduleWrite(f, '{"v":"older-in-flight"}');
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let reached!: () => void;
  const atRename = new Promise<void>((r) => (reached = r));
  setBeforeRenameHook(async () => {
    setBeforeRenameHook(undefined);
    reached();
    await gate;
  });
  try {
    const drain = flushWrites();
    await atRename;
    scheduleWrite(f, '{"v":"newest"}');
    flushWritesSync();
    assert.strictEqual(fs.readFileSync(f, 'utf8'), '{"v":"newest"}');
    release();
    await drain;
  } finally {
    setBeforeRenameHook(undefined);
    release();
  }
  assert.strictEqual(fs.readFileSync(f, 'utf8'), '{"v":"newest"}', 'the older in-flight text was renamed over the newest');
  assert.deepStrictEqual(fs.readdirSync(path.dirname(f)).filter((n) => n.endsWith('.tmp')), []);
});

test('race (product): a chat created after the debounce timer fired is still in the index after the flush', async () => {
  const root = tmp();
  const first = ensureSessionsMigrated(root).activeId;
  createSession(root);
  setActiveSession(root, first);
  await sleep(90); /* the debounce timer fires and a drain starts */
  const made = createSession(root).id;
  await flushWrites();
  assert.ok(onDisk(root).sessions.some((s) => s.id === made), 'the new chat is on disk');
  assert.ok(readSessionIndex(root)!.sessions.some((s) => s.id === made), 'and in what the store reads');
});

test('cross-process: a deferred index write does not erase a chat another process created meanwhile', async () => {
  const root = tmp();
  const first = ensureSessionsMigrated(root).activeId;
  setActiveSession(root, first); /* deferred, holding THIS process's full-file view */
  const here = path.dirname(fileURLToPath(import.meta.url));
  const u = pathToFileURL(path.join(here, '..', 'server', 'sessionsStore.js')).href;
  const code = `const S = await import(${JSON.stringify(u)}); process.stdout.write(S.createSession(${JSON.stringify(root)}).id);`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env } });
  assert.strictEqual(r.status, 0, r.stderr);
  const other = r.stdout.trim();
  assert.ok(onDisk(root).sessions.some((s) => s.id === other), "the other process's chat is on disk before the drain");
  await flushWrites();
  const after = onDisk(root);
  assert.ok(after.sessions.some((s) => s.id === other), "the other process's chat survived our drain");
  assert.strictEqual(after.activeId, first, 'and our own change (the active pointer) still landed');
});

test('appends: a synchronous read while a drain holds earlier lines sees all of them, in order', async () => {
  const dir = tmp();
  const f = path.join(dir, 'turns.jsonl');
  const slow = path.join(dir, 'slow.json');
  scheduleWrite(slow, '{}'); /* keeps the drain busy so it has TAKEN the append job and not written it */
  scheduleAppend(f, 'L1');
  const drain = flushWrites();
  await new Promise((r) => setImmediate(r));
  scheduleAppend(f, 'L2');
  flushWritesSync(f);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), 'L1\nL2\n', 'the read sees both');
  await drain;
  assert.strictEqual(fs.readFileSync(f, 'utf8'), 'L1\nL2\n', 'and the drain does not append L1 again, out of order');
});

test('deleteSession drops queued turn-log lines: the deleted chat folder does not come back', async () => {
  const root = tmp();
  const userDir = tmp();
  ensureSessionsMigrated(root);
  const id = createSession(root).id;
  appendTurnLog(root, id, userDir, { n: 1 });
  deleteSession(root, id);
  const dir = path.join(root, SEQUENCE_DIR, 'sessions', id);
  assert.strictEqual(fs.existsSync(dir), false);
  await flushWrites();
  assert.strictEqual(fs.existsSync(dir), false, 'a queued line recreated the deleted folder');
  /* the same, with the line already taken by a drain that is busy with an earlier write */
  const id2 = createSession(root).id;
  scheduleWrite(path.join(userDir, 'busy.json'), '{}');
  appendTurnLog(root, id2, userDir, { n: 2 });
  const drain = flushWrites();
  await new Promise((r) => setImmediate(r));
  deleteSession(root, id2);
  await drain;
  assert.strictEqual(fs.existsSync(path.join(root, SEQUENCE_DIR, 'sessions', id2)), false, 'a taken line recreated the folder');
});

test('moveSession carries queued turn-log lines to the destination and leaves nothing behind in the source', async () => {
  const from = tmp();
  const to = tmp();
  const userDir = tmp();
  ensureSessionsMigrated(from);
  const id = createSession(from).id;
  appendTurnLog(from, id, userDir, { moved: true });
  assert.ok(moveSession(from, to, id));
  await flushWrites();
  assert.strictEqual(fs.existsSync(path.join(from, SEQUENCE_DIR, 'sessions', id)), false, 'the source folder came back');
  assert.deepStrictEqual(readTurnLog(to, id, userDir, 10), [{ moved: true }]);
});

/* ── round 2: merges see the live file; a missing file stays missing; one temp namer; no merge is lost ─────── */

function otherProcess(body: string): { status: number | null; stdout: string; stderr: string } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const u = (n: string): string => pathToFileURL(path.join(here, '..', 'server', n)).href;
  const code = `
    import * as S from '${u('sessionsStore.js')}';
    import * as W from '${u('asyncWriter.js')}';
    import * as ST from '${u('store.js')}';
    ${body}
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('cross-process: a synchronous write after a queued deferred one does not build on stale queued text', async () => {
  const root = tmp();
  const first = ensureSessionsMigrated(root).activeId;
  await flushWrites();
  setActiveSession(root, first); /* queued in this process, computed before the other one writes */
  const r = otherProcess(`process.stdout.write(S.createSession(${JSON.stringify(root)}).id);`);
  assert.strictEqual(r.status, 0, r.stderr);
  const other = r.stdout.trim();
  assert.ok(readSessionIndex(root)!.sessions.some((s) => s.id === other), 'what this process reads includes the other chat');
  updateSession(root, first, { title: 'renamed here' }); /* acknowledged, synchronous */
  await flushWrites();
  const after = onDisk(root);
  assert.ok(after.sessions.some((s) => s.id === other), "the other process's acknowledged chat was erased by our rename");
  assert.ok(after.sessions.some((s) => s.id === first));
});

test('cross-process: a queued merge does not bring back an index another process deleted', async () => {
  const root = tmp();
  const only = ensureSessionsMigrated(root).activeId;
  await flushWrites();
  setActiveSession(root, only);
  const r = otherProcess(`S.deleteSession(${JSON.stringify(root)}, ${JSON.stringify(only)}, { keepOneLiveThread: false });`);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(fs.existsSync(indexFile(root)), false, 'precondition: the other process removed it');
  await flushWrites();
  assert.strictEqual(fs.existsSync(indexFile(root)), false, 'the deferred merge resurrected the deleted index');
});

test('temp names: the drain and a synchronous write never share a temp file (fresh process, equal counters)', () => {
  const root = tmp();
  const r = otherProcess(`
    import fs from 'node:fs';
    import path from 'node:path';
    const root = ${JSON.stringify(root)};
    const p = path.join(root, '.sequence', 'sessions.json');
    let release; const gate = new Promise((r) => (release = r)); let opened; const openedP = new Promise((r) => (opened = r));
    W.setAfterOpenHook(async () => { W.setAfterOpenHook(undefined); opened(); await gate; });
    ST.writeJson(root, 'sessions.json', { v: 'old-deferred' }, { compact: true, defer: true });
    const f = W.flushWrites();
    await openedP; /* the drain holds its temp file open and has written nothing */
    ST.writeJson(root, 'sessions.json', { v: 'acked-sync' }, { compact: true });
    release();
    await f;
    process.stdout.write(fs.readFileSync(p, 'utf8'));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '{"v":"acked-sync"}');
});

test('close(): a merge in flight is not lost behind a newer pending merge', async () => {
  const dir = tmp();
  const a = path.join(dir, 'a.json');
  const b = path.join(dir, 'b.json');
  fs.writeFileSync(b, JSON.stringify({ x: 0, y: 0 }));
  const set = (k: string, v: number) => (t: string): string => JSON.stringify({ ...JSON.parse(t), [k]: v });
  scheduleWrite(a, '"a"');
  scheduleWrite(b, JSON.stringify({ x: 1, y: 0 }), set('x', 1));
  let hold!: () => void;
  const held = new Promise<void>((r) => (hold = r));
  let reached!: () => void;
  const at = new Promise<void>((r) => (reached = r));
  setBeforeRenameHook(async (p) => {
    if (p !== a) return;
    setBeforeRenameHook(undefined);
    reached();
    await held;
  });
  try {
    const drain = flushWrites();
    await at; /* parked on a.json; b.json's first merge is in flight */
    scheduleWrite(b, JSON.stringify({ x: 1, y: 2 }), set('y', 2));
    flushWritesSync();
    hold();
    await drain;
    await flushWrites();
  } finally {
    setBeforeRenameHook(undefined);
    hold();
  }
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(b, 'utf8')), { x: 1, y: 2 });
});

test('a queued merge whose fresh read fails (EBUSY) retries instead of writing the stale whole-file snapshot', async () => {
  const dir = tmp();
  const f = path.join(dir, 'idx.json');
  fs.writeFileSync(f, JSON.stringify({ x: 0, other: 'kept' }));
  /* the whole-file snapshot this process queued is stale: it lacks `other` */
  scheduleWrite(f, JSON.stringify({ x: 9 }), (t) => JSON.stringify({ ...JSON.parse(t), x: 9 }));
  const realRead = fs.readFileSync;
  let failures = 0;
  (fs as { readFileSync: unknown }).readFileSync = ((p: unknown, ...a: unknown[]) => {
    if (p === f && failures < 3) {
      failures++;
      throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    }
    return (realRead as (...x: unknown[]) => unknown)(p, ...a);
  }) as typeof fs.readFileSync;
  try {
    await flushWrites();
  } finally {
    (fs as { readFileSync: unknown }).readFileSync = realRead;
  }
  assert.ok(failures >= 1, 'the read really failed');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { x: 9, other: 'kept' }, 'merged onto the live file, not the stale snapshot');
});
