import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readAgentRuns, readAgentRunsChecked, recordAgentRun, type StoredAgentRun } from '../server/agentChatStore.js';
import { ensureSessionsMigrated } from '../server/sessionsStore.js';
import { SEQUENCE_DIR, atomicWriteFileSync, writeJson } from '../server/store.js';

const run = (n: number, over: Partial<StoredAgentRun> = {}): StoredAgentRun => ({ id: `r${n}`, agentRef: 'claude', prompt: `p${n}`, text: `t${n}`, status: 'done', error: null, stopReason: 'end_turn', startedAt: n, endedAt: n + 1, model: null, nodeId: null, tools: [], ...over });
function chat() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-safe-')));
  const chatId = ensureSessionsMigrated(root).activeId;
  return { root, chatId, file: path.join(root, SEQUENCE_DIR, 'sessions', chatId, 'agent-runs.json'), dir: path.join(root, SEQUENCE_DIR, 'sessions', chatId) };
}

test('writes go through a temp file and a rename: no temp is left, an old file is replaced whole', () => {
  const c = chat();
  const target = path.join(c.dir, 'x.json');
  atomicWriteFileSync(target, '{"a":1}');
  atomicWriteFileSync(target, '{"a":2}');
  assert.strictEqual(fs.readFileSync(target, 'utf8'), '{"a":2}');
  assert.deepStrictEqual(fs.readdirSync(c.dir).filter((f) => f.endsWith('.tmp')), []);
  /* A rename that fails (here: the target is a directory) never leaves half a file at the path or a stray temp. */
  const dirTarget = path.join(c.dir, 'd.json');
  fs.mkdirSync(dirTarget);
  assert.throws(() => atomicWriteFileSync(dirTarget, 'x'));
  assert.deepStrictEqual(fs.readdirSync(c.dir).filter((f) => f.endsWith('.tmp')), []);
  writeJson(c.root, 'sessions/' + c.chatId + '/y.json', { ok: true });
  assert.deepStrictEqual(fs.readdirSync(c.dir).filter((f) => f.endsWith('.tmp')), []);
});

test('a damaged turns file is never read as empty or overwritten: the backup stands in and the damaged file is kept', () => {
  const c = chat();
  recordAgentRun(c.root, c.chatId, run(1));
  recordAgentRun(c.root, c.chatId, run(2));
  fs.writeFileSync(c.file, '{"version":1,"runs":[{"id":"r1","pr');
  const read = readAgentRunsChecked(c.root, c.chatId);
  assert.deepStrictEqual(read.damaged, { restored: true });
  assert.deepStrictEqual(read.runs.map((r) => r.id), ['r1']);

  const torn = fs.readFileSync(c.file, 'utf8');
  recordAgentRun(c.root, c.chatId, run(3));
  assert.deepStrictEqual(readAgentRuns(c.root, c.chatId).map((r) => r.id), ['r1', 'r3']);
  const kept = fs.readdirSync(c.dir).filter((f) => f.startsWith('agent-runs.damaged-'));
  assert.strictEqual(kept.length, 1);
  assert.strictEqual(fs.readFileSync(path.join(c.dir, kept[0]!), 'utf8'), torn, 'the unparseable file is preserved byte for byte');
});

test('damaged with no backup: reported as unreadable, kept on the next write', () => {
  const c = chat();
  fs.writeFileSync(c.file, 'not json');
  assert.deepStrictEqual(readAgentRunsChecked(c.root, c.chatId).damaged, { restored: false });
  recordAgentRun(c.root, c.chatId, run(1));
  assert.strictEqual(fs.readdirSync(c.dir).filter((f) => f.startsWith('agent-runs.damaged-')).length, 1);
  assert.strictEqual(readAgentRunsChecked(c.root, c.chatId).damaged, undefined);
});

test('turns past the cap move to the archive, in order, and the count is reported', () => {
  const c = chat();
  for (let i = 1; i <= 203; i++) recordAgentRun(c.root, c.chatId, run(i));
  const read = readAgentRunsChecked(c.root, c.chatId);
  assert.strictEqual(read.runs.length, 200);
  assert.strictEqual(read.runs[0]!.id, 'r4');
  assert.strictEqual(read.archived, 3);
  const archive = fs.readFileSync(path.join(c.dir, 'agent-runs.archive.jsonl'), 'utf8').trim().split('\n').map((l) => (JSON.parse(l) as { id: string }).id);
  assert.deepStrictEqual(archive, ['r1', 'r2', 'r3']);
});

import { interruptedRun, listInterruptedChats, readArchivePage, runsForWire, writeAgentRunsBulk, BOOT_ID } from '../server/agentChatStore.js';
import { sweepStaleTmp } from '../server/store.js';
import { readSessionIndex } from '../server/sessionsStore.js';

test('the archive is paged from its end, deduped, bounded, and a torn tail is not a turn', async () => {
  const c = chat();
  const many = Array.from({ length: 260 }, (_, i) => run(i + 1));
  assert.ok(await writeAgentRunsBulk(c.root, c.chatId, many));
  assert.strictEqual(readAgentRunsChecked(c.root, c.chatId).archived, 60);
  /* A re-written overlap does not archive the same turn twice. */
  recordAgentRun(c.root, c.chatId, run(261));
  recordAgentRun(c.root, c.chatId, run(262));
  const first = readArchivePage(c.root, c.chatId, 0, 25);
  assert.deepStrictEqual([first.runs[0]!.id, first.runs.at(-1)!.id, first.remaining], ['r38', 'r62', 37]);
  const next = readArchivePage(c.root, c.chatId, 25, 100);
  assert.deepStrictEqual([next.runs[0]!.id, next.runs.length, next.remaining], ['r1', 37, 0]);
  const archive = path.join(c.dir, 'agent-runs.archive.jsonl');
  const ids = fs.readFileSync(archive, 'utf8').trim().split('\n').map((l) => (JSON.parse(l) as { id: string }).id);
  assert.strictEqual(new Set(ids).size, ids.length);
  /* A crash mid-append leaves a torn last line: it is not counted, and the next append starts on a fresh line. */
  fs.appendFileSync(archive, '{"id":"torn","pr');
  const c2 = chat();
  fs.mkdirSync(c2.dir, { recursive: true });
  fs.copyFileSync(archive, path.join(c2.dir, 'agent-runs.archive.jsonl'));
  assert.strictEqual(readArchivePage(c2.root, c2.chatId, 0, 500).runs.length, 62);
  recordAgentRun(c2.root, c2.chatId, run(1000));
  for (let i = 1; i <= 201; i++) recordAgentRun(c2.root, c2.chatId, run(1000 + i));
  assert.ok(readArchivePage(c2.root, c2.chatId, 0, 500).runs.some((r) => r.id === 'r1001' || r.id === 'r1000'));
});

test('a progress write does not re-read or re-copy the chat file (cache), only a finished turn rotates the backup', () => {
  const c = chat();
  recordAgentRun(c.root, c.chatId, run(1));
  const reads: string[] = [];
  const copies: string[] = [];
  const realRead = fs.readFileSync;
  const realCopy = fs.copyFileSync;
  (fs as { readFileSync: unknown }).readFileSync = (p: fs.PathOrFileDescriptor, ...rest: unknown[]) => (reads.push(String(p)), (realRead as (...a: unknown[]) => unknown)(p, ...rest));
  (fs as { copyFileSync: unknown }).copyFileSync = (a: fs.PathLike, b: fs.PathLike, ...rest: unknown[]) => (copies.push(String(b)), (realCopy as (...a: unknown[]) => unknown)(a, b, ...rest));
  try {
    recordAgentRun(c.root, c.chatId, run(2, { status: 'running' }), new Date(), { touch: true });
    for (let i = 0; i < 5; i++) recordAgentRun(c.root, c.chatId, run(2, { status: 'running', text: 'x'.repeat(i) }), new Date(), { touch: false });
    assert.deepStrictEqual(reads.filter((p) => p.includes('agent-runs')), [], 'no read of the turns or archive file');
    assert.deepStrictEqual(copies, [], 'no backup copy for progress writes');
    recordAgentRun(c.root, c.chatId, run(2));
    assert.deepStrictEqual(copies.map((p) => path.basename(p)), ['agent-runs.json.bak']);
  } finally {
    (fs as { readFileSync: unknown }).readFileSync = realRead;
    (fs as { copyFileSync: unknown }).copyFileSync = realCopy;
  }
});

test('a running turn written by another LIVE process is not interrupted; a dead one is; the index marks it', () => {
  const c = chat();
  const mine = run(1, { status: 'running', owner: { pid: process.pid, boot: BOOT_ID } });
  assert.strictEqual(interruptedRun([mine], new Set())?.id, 'r1', 'this process, no live runtime: cut off');
  const other = run(2, { status: 'running', owner: { pid: process.ppid, boot: 'another-boot' } });
  assert.strictEqual(interruptedRun([other], new Set())?.id, 'r2', 'the pid is alive but nothing beats for it: a reused pid, not a live server');
  const liveDir = path.join(os.tmpdir(), 'sequence-live');
  fs.mkdirSync(liveDir, { recursive: true });
  fs.writeFileSync(path.join(liveDir, 'another-boot'), String(process.ppid));
  assert.strictEqual(interruptedRun([other], new Set()), null, 'a parent process still runs and beats: its turn is live there');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(liveDir, 'another-boot'), old, old);
  assert.strictEqual(interruptedRun([other], new Set())?.id, 'r2', 'a stale heartbeat is not alive');
  fs.writeFileSync(path.join(liveDir, 'another-boot'), String(process.ppid));
  assert.strictEqual(runsForWire([other], new Set())[0]!.status, 'running');
  const dead = run(3, { status: 'running', owner: { pid: 2 ** 22 - 1, boot: 'gone' } });
  assert.strictEqual(interruptedRun([dead], new Set())?.id, 'r3');
  recordAgentRun(c.root, c.chatId, mine);
  assert.strictEqual(readSessionIndex(c.root)!.sessions.find((s) => s.id === c.chatId)!.runningTurn?.id, 'r1');
  assert.deepStrictEqual(listInterruptedChats(c.root, new Set()).map((x) => x.runId), ['r1']);
  recordAgentRun(c.root, c.chatId, { ...mine, status: 'done' });
  assert.strictEqual(readSessionIndex(c.root)!.sessions.find((s) => s.id === c.chatId)!.runningTurn, undefined);
  assert.deepStrictEqual(listInterruptedChats(c.root, new Set()), []);
});

test('old temp files are swept; a write that fails leaves no temp behind', () => {
  const c = chat();
  const old = path.join(c.dir, 'x.json.1.1.tmp');
  const fresh = path.join(c.dir, 'y.json.1.2.tmp');
  fs.writeFileSync(old, 'a');
  fs.writeFileSync(fresh, 'b');
  fs.utimesSync(old, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
  sweepStaleTmp(c.dir);
  assert.deepStrictEqual([fs.existsSync(old), fs.existsSync(fresh)], [false, true]);
});
