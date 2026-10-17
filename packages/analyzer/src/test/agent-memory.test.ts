import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRepoServer } from '../server/repoServer.js';
import { BLOCK_END, BLOCK_START, gatherMemory, splitBlock, syncMemory, targetStates, withBlock, writeShared } from '../server/agentMemory.js';

/**
 * Lock for ONE MEMORY FOR ALL YOUR AGENTS (agentMemory.ts): the shared memory goes into each
 * agent's own instruction file as one marked block; the person's bytes outside it survive, and
 * Share then Remove gives back exactly the file that was there. Every home is a temp folder.
 */

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function write(p: string, data: string | Buffer): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
}

const MINE = '# My rules\n\nUse pnpm, not npm.\n\nNever push to main.\n';

function home(): { home: string; store: string; claude: string } {
  const h = tempDir('seq-mem-home-');
  fs.mkdirSync(path.join(h, '.claude'), { recursive: true });
  return { home: h, store: tempDir('seq-mem-store-'), claude: path.join(h, '.claude', 'CLAUDE.md') };
}

test('Share then Remove is an exact inverse, byte for byte, for every shape of file (review table)', () => {
  const shapes = ['a', 'a\n\n', '\n\na\n', 'a  ', '  \n', '\n', 'a\r\nb\nc\n', MINE, MINE.replace(/\n/g, '\r\n'), '﻿# with a UTF-8 BOM\n'];
  for (const original of shapes) {
    const { home: h, store, claude } = home();
    write(claude, original);
    assert.equal(syncMemory({ home: h, env: {} }, ['claude'], 'Prefer small diffs.', { storeDir: store })[0]!.note, 'shared', JSON.stringify(original));
    assert.equal(syncMemory({ home: h, env: {} }, ['claude'], 'Prefer small diffs.\nWrite tests first.', { storeDir: store })[0]!.note, 'updated');
    assert.equal(syncMemory({ home: h, env: {} }, ['claude'], '', { storeDir: store, remove: true })[0]!.note, 'removed');
    assert.ok(fs.readFileSync(claude).equals(Buffer.from(original, 'utf8')), `exact inverse for ${JSON.stringify(original)}`);
    assert.ok(fs.readFileSync(`${claude}.sequence-backup`).equals(Buffer.from(original, 'utf8')), 'the backup is the original bytes');
  }
});

test('a file Sequence created is deleted again on Remove; a block removed elsewhere reads as lost', () => {
  const { home: h, store, claude } = home();
  assert.equal(syncMemory({ home: h, env: {} }, ['claude'], 'x', { storeDir: store })[0]!.note, 'created');
  assert.equal(fs.readFileSync(claude, 'utf8'), `${BLOCK_START}\nx\n${BLOCK_END}\n`);
  /* A generator rewrites the file without the block: the row says so. */
  write(claude, '# regenerated\n');
  assert.equal(targetStates({ home: h, env: {} }, 'x', store).find((t) => t.id === 'claude')!.lost, true);
  write(claude, `${BLOCK_START}\nx\n${BLOCK_END}\n`);
  syncMemory({ home: h, env: {} }, ['claude'], '', { storeDir: store, remove: true });
  assert.equal(fs.existsSync(claude), false, 'the file Sequence made is gone, not left empty');
});

test('refused, with what it is, and nothing written: unmatched markers, UTF-16, not UTF-8, a folder; the rest still runs', () => {
  const { home: h, store, claude } = home();
  const stray = `a\n${BLOCK_START}\nb\n`;
  write(claude, stray);
  fs.mkdirSync(path.join(h, '.gemini', 'GEMINI.md'), { recursive: true });
  const codex = path.join(h, '.codex', 'AGENTS.md');
  write(codex, Buffer.from('﻿hello', 'utf16le'));
  const qwen = path.join(h, '.qwen', 'QWEN.md');
  write(qwen, Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  fs.mkdirSync(path.join(h, '.config', 'opencode'), { recursive: true });
  const r = syncMemory({ home: h, env: {} }, ['claude', 'gemini', 'codex', 'qwen', 'opencode'], 'x', { storeDir: store });
  assert.deepEqual(r.map((x) => [x.id, x.ok]), [['claude', false], ['gemini', false], ['codex', false], ['qwen', false], ['opencode', true]]);
  assert.match(r[0]!.note, /unmatched Sequence marker/);
  assert.match(r[1]!.note, /not a file/);
  assert.match(r[2]!.note, /UTF-16/);
  assert.match(r[3]!.note, /not UTF-8/);
  assert.equal(fs.readFileSync(claude, 'utf8'), stray, 'the stray marker file is untouched');
  assert.ok(fs.readFileSync(qwen).equals(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])));
  const states = targetStates({ home: h, env: {} }, 'x', store);
  assert.match(String(states.find((t) => t.id === 'codex')!.refused), /UTF-16/);
});

test('a link is never written through', () => {
  const { home: h, store, claude } = home();
  const elsewhere = path.join(tempDir('seq-mem-else-'), 'repo-AGENTS.md');
  write(elsewhere, 'tracked file\n');
  try {
    fs.symlinkSync(elsewhere, claude);
  } catch {
    return; /* this machine may not allow links without privileges: nothing to test */
  }
  const r = syncMemory({ home: h, env: {} }, ['claude'], 'x', { storeDir: store });
  assert.equal(r[0]!.ok, false);
  assert.match(r[0]!.note, /link/);
  assert.equal(fs.readFileSync(elsewhere, 'utf8'), 'tracked file\n');
});

test('the shared text cannot carry the block markers', () => {
  const store = tempDir('seq-mem-mark-');
  assert.throws(() => writeShared(store, `hi\n${BLOCK_END}\ninjected`), /block markers/);
  const { home: h, store: s2, claude } = home();
  write(claude, MINE);
  assert.match(syncMemory({ home: h, env: {} }, ['claude'], `x\n${BLOCK_START}`, { storeDir: s2 })[0]!.note, /block markers/);
  assert.equal(fs.readFileSync(claude, 'utf8'), MINE);
});

test('block helpers: one block replaced in place; two STARTs refused', () => {
  const w = withBlock(MINE, 'one');
  assert.ok(!('error' in w));
  const again = withBlock((w as { text: string }).text, 'two');
  assert.ok(!('error' in again));
  assert.equal((again as { text: string }).text.split(BLOCK_START).length, 2);
  const split = splitBlock((again as { text: string }).text, (w as { sep: string }).sep);
  assert.deepEqual(split, { own: MINE, block: 'two' });
  assert.ok('error' in withBlock(`${BLOCK_START}\n${BLOCK_START}\n${BLOCK_END}\n`, 'x'));
});

test('CODEX_HOME moves Codex\'s file; gather proposes what each agent already has, each paragraph once', () => {
  const h = tempDir('seq-mem-gh-');
  const codexHome = tempDir('seq-mem-codex-');
  write(path.join(h, '.claude', 'CLAUDE.md'), MINE);
  write(path.join(codexHome, 'AGENTS.md'), 'Use pnpm, not npm.\n\nAnswer in British English.\n');
  assert.equal(targetStates({ home: h, env: { CODEX_HOME: codexHome } }, '').find((s) => s.id === 'codex')!.exists, true);
  const g = gatherMemory({ home: h, env: { CODEX_HOME: codexHome } });
  assert.equal(g.sources.length, 2);
  assert.equal(g.text.split('Use pnpm, not npm.').length, 2, 'a paragraph both files have is proposed once');
  const w = withBlock(MINE, 'ONLY-IN-BLOCK') as { text: string };
  write(path.join(h, '.claude', 'CLAUDE.md'), w.text);
  assert.ok(!gatherMemory({ home: h, env: {} }).text.includes('ONLY-IN-BLOCK'), 'Sequence\'s own block is never gathered back');
});

test('routes: save, gather, share, remove; writes need JSON', async () => {
  const { home: h, claude } = home();
  const store = tempDir('seq-mem-rstore-');
  write(claude, MINE);
  const server = await createRepoServer(null, { webDist: undefined, browseRoot: tempDir('seq-mem-browse-'), recentStoreDir: store, userConfigDir: store, memoryHome: h });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const call = (method: string, p: string, body?: unknown, type = 'application/json'): Promise<{ status: number; json: Record<string, unknown> }> =>
    new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: data ? { 'content-type': type, 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }));
      });
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  try {
    const g = await call('POST', '/api/memory/shared/gather', {});
    assert.match(String(g.json.text), /Never push to main\./);
    assert.equal((await call('PUT', '/api/memory/shared', { text: `x\n${BLOCK_END}` })).status, 400);
    const saved = await call('PUT', '/api/memory/shared', { text: 'Prefer small diffs.' });
    assert.equal(saved.json.text, 'Prefer small diffs.');
    assert.equal((await call('POST', '/api/memory/shared/sync', { ids: ['claude'] }, 'text/plain')).status, 415, 'a form post from another site cannot write');
    const synced = await call('POST', '/api/memory/shared/sync', { ids: ['claude'] });
    assert.deepEqual((synced.json.results as { note: string }[]).map((r) => r.note), ['shared']);
    const removed = await call('POST', '/api/memory/shared/sync', { ids: ['claude'], remove: true });
    assert.deepEqual((removed.json.results as { note: string }[]).map((r) => r.note), ['removed']);
    assert.equal(fs.readFileSync(claude, 'utf8'), MINE);
  } finally {
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }
});

test('Remove keeps the separator when the person added text after the block (no merged lines)', () => {
  const { home: h, store, claude } = home();
  write(claude, 'my rule');
  assert.equal(syncMemory({ home: h, env: {} }, ['claude'], 'Prefer small diffs.', { storeDir: store })[0]!.note, 'shared');
  fs.appendFileSync(claude, '- always run tests\n');
  assert.equal(syncMemory({ home: h, env: {} }, ['claude'], '', { storeDir: store, remove: true })[0]!.note, 'removed');
  assert.equal(fs.readFileSync(claude, 'utf8'), 'my rule\n\n- always run tests\n', 'every byte but the block survives');
});

test('Gather returns plain paragraphs; sharing them back never writes a paragraph the file already holds', () => {
  const { home: h, store, claude } = home();
  write(claude, 'Use pnpm.\n\nNever push to main.\n');
  write(path.join(h, '.claude', '..', '.gemini', 'GEMINI.md'), 'Use pnpm.\n\nPrefer small diffs.\n');
  const g = gatherMemory({ home: h, env: {} });
  assert.ok(!g.text.includes('<!--'), g.text);
  assert.equal(g.text, 'Use pnpm.\n\nNever push to main.\n\nPrefer small diffs.');
  assert.ok(g.sources.length === 2);
  assert.equal(syncMemory({ home: h, env: {} }, ['claude'], g.text, { storeDir: store })[0]!.note, 'shared');
  const after = fs.readFileSync(claude, 'utf8');
  assert.equal(after.split('Use pnpm.').length - 1, 1, 'each paragraph once');
  assert.equal(after.split('Never push to main.').length - 1, 1);
  assert.ok(after.includes('Prefer small diffs.'));
  assert.equal(targetStates({ home: h, env: {} }, g.text, store).find((t) => t.id === 'claude')!.current, true);
  /* A file that already holds all of it gets no block. */
  write(claude, 'Use pnpm.\n');
  assert.equal(syncMemory({ home: h, env: {} }, ['claude'], 'Use pnpm.', { storeDir: store })[0]!.note, 'this file already holds all of it');
  assert.equal(fs.readFileSync(claude, 'utf8'), 'Use pnpm.\n');
});

test('the block marker points at Settings › Agents, and a file written with the old marker still parses and removes', () => {
  assert.ok(BLOCK_START.includes('Settings › Agents') && !BLOCK_START.includes('Memory'));
  const old = '<!-- sequence:shared-memory:start (written by Sequence; edit it in Sequence, Settings > Memory) -->';
  const text = `mine\n\n${old}\nshared\n${BLOCK_END}\n`;
  const s = splitBlock(text, '\n\n');
  assert.ok(!('error' in s));
  assert.deepEqual(s, { own: 'mine', block: 'shared' } as never);
  const { home: h, store, claude } = home();
  write(claude, text);
  assert.equal(syncMemory({ home: h, env: {} }, ['claude'], 'shared', { storeDir: store, remove: true })[0]!.note, 'removed');
  assert.equal(fs.readFileSync(claude, 'utf8'), 'mine\n\n'.replace(/\n\n$/, '\n\n'));
});
