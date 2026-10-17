/**
 * find_files over MCP (prime proposal 2): the trained file ranker as one tool for
 * Claude and Codex. The engine's own behaviour (ranking, budget, learning) is
 * tested in packages/analyzer find-files.test.ts; this file holds what only the
 * MCP surface can break: it is listed in the core set, it says to be used before
 * grep, it is a read, it answers a real question about a real repo, and a bad
 * call is an error result, not a crash.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { closeFindFilesHostConnections, dropFindFiles, findFiles, findFilesHostStats, warmFindFiles } from '@sequence/analyzer';
import { rmDir } from './rmDir.js';
import { CORE_TOOLS, createServer } from '../index.js';

const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function makeRepo(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-mcp-findfiles-')));
  git(dir, 'init', '-q');
  const w = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  w('src/retry/backoff.ts', 'export function retryDelay(attempt: number) {\n  return Math.min(30000, 100 * 2 ** attempt);\n}\n');
  w('src/net/client.ts', "import { retryDelay } from '../retry/backoff';\nexport async function get(url: string) { return fetch(url); }\n");
  w('src/ui/button.tsx', 'export const Button = () => null;\n');
  w('src/auth/session.ts', 'export function refreshToken(t: string) { return t; }\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'add retry delay and client');
  fs.appendFileSync(path.join(dir, 'src/retry/backoff.ts'), '// jitter\n');
  git(dir, 'commit', '-q', '-am', 'retry delay: add jitter');
  return dir;
}

async function connect(opts: Parameters<typeof createServer>[0] = {}) {
  const server = createServer(opts);
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'find-files-test', version: '0.0.0' });
  await Promise.all([server.connect(s), client.connect(c)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

test('find_files is in the core set, a read, and tells an agent to use it before grep', async () => {
  assert.ok(CORE_TOOLS.includes('find_files'));
  const { client, close } = await connect({ tools: 'core' });
  try {
    const tool = (await client.listTools()).tools.find((t) => t.name === 'find_files')!;
    assert.ok(tool, 'listed in the core catalog');
    assert.match(tool.description!, /BEFORE grep or glob/);
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.ok(Buffer.byteLength(JSON.stringify(tool)) <= 2048, 'inside the 2 KB listing ceiling');
    assert.match(client.getInstructions()!, /find_files.*BEFORE grep/s);
    assert.ok(Buffer.byteLength(client.getInstructions()!) <= 2048);
  } finally {
    await close();
  }
});

test('find_files over MCP: the file a question is about, with a reason and a snippet, in a budget', async () => {
  const dir = makeRepo();
  warmFindFiles(dir);
  await findFiles(dir, 'warm', { noLog: true, waitMs: 30_000 });
  const { client, close } = await connect({ tools: 'core', repo: dir });
  try {
    const r = await client.callTool({ name: 'find_files', arguments: { query: 'where is the retry delay computed', k: 3 } });
    assert.notEqual(r.isError, true);
    const text = (r.content as { type: string; text: string }[])[0]!.text;
    assert.match(text, /^find_files: 3 of /);
    assert.match(text, /1\. src\/retry\/backoff\.ts {2}\[/);
    assert.match(text, /\d+\| export function retryDelay/);
    assert.ok(Math.ceil(text.length / 4) <= 800, `${text.length} chars`);
    assert.equal(fs.existsSync(path.join(dir, '.sequence', 'findfiles')), true, 'the call is logged for learning');
    assert.equal(git(dir, 'status', '--porcelain').trim(), '', 'and nothing it writes shows in git status');
  } finally {
    await close();
    dropFindFiles(dir);
    rmDir(dir);
  }
});

test('find_files over MCP: an empty query is refused, a missing repo is an error result, never a crash', async () => {
  const { client, close } = await connect({ tools: 'core', repo: '/definitely/not/here' });
  try {
    const empty = await client.callTool({ name: 'find_files', arguments: { query: '' } }).catch((e: Error) => e);
    assert.ok(empty instanceof Error || (empty as { isError?: boolean }).isError === true);
    const gone = await client.callTool({ name: 'find_files', arguments: { query: 'anything' } });
    const text = (gone.content as { type: string; text: string }[])[0]!.text;
    assert.ok(gone.isError === true || /No file matched|find_files/.test(text));
    const again = await client.callTool({ name: 'find_files', arguments: { query: 'still alive' } });
    assert.ok(Array.isArray(again.content), 'the session survived');
  } finally {
    await close();
  }
});

/* ───────────── review of find-files, item 7: the tool is jailed to the session's worktree ───────────── */

test('find_files in a session is jailed to that session: another directory, or a symlink out, is refused and none of its text is shown', async () => {
  const dir = makeRepo();
  const other = makeRepo();
  fs.writeFileSync(path.join(other, 'src/auth/session.ts'), 'export const OTHER_CHECKOUT_SECRET = "sk-live-other";\nexport function refreshToken() {}\n');
  git(other, 'commit', '-q', '-am', 'secret');
  fs.symlinkSync(other, path.join(dir, 'escape'), 'dir');
  const { client, close } = await connect({ tools: 'core', repo: dir });
  try {
    for (const repoPath of [other, path.join(dir, 'escape'), path.join(dir, '..')]) {
      const r = await client.callTool({ name: 'find_files', arguments: { repoPath, query: 'refreshToken secret' } });
      const text = (r.content as { type: string; text: string }[])[0]!.text;
      assert.equal(r.isError, true, `${repoPath} was searched`);
      assert.doesNotMatch(text, /OTHER_CHECKOUT_SECRET|sk-live/);
      assert.match(text, /this session's repository only/);
    }
    const inside = await client.callTool({ name: 'find_files', arguments: { repoPath: path.join(dir, 'src'), query: 'where is the retry delay computed' } });
    assert.notEqual(inside.isError, true, 'a path inside the session repo searches it');
  } finally {
    await close();
    dropFindFiles(dir);
    dropFindFiles(other);
    rmDir(dir);
    rmDir(other);
  }
});

test('find_files in a chat worktree searches the worktree, not the main checkout its graph comes from', async () => {
  const main = makeRepo();
  /* The main checkout has a persisted graph: the other tools answer a graphless worktree from it. */
  fs.mkdirSync(path.join(main, '.sequence'), { recursive: true });
  fs.writeFileSync(path.join(main, '.sequence', 'graph.json'), JSON.stringify({ commit: 'abc', graph: { scannedAt: new Date().toISOString() } }));
  const wt = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-mcp-ff-wt-'))) + '/w';
  git(main, 'worktree', 'add', '-q', '-b', 'chat', wt);
  fs.mkdirSync(path.join(wt, 'src/quota'), { recursive: true });
  fs.writeFileSync(path.join(wt, 'src/quota/limiter.ts'), 'export function quotaLimiterWindow() { return 60; }\n');
  git(wt, 'add', '-A');
  git(wt, 'commit', '-q', '-m', 'quota limiter in the chat');
  const { client, close } = await connect({ tools: 'core', repo: wt });
  try {
    const r = await client.callTool({ name: 'find_files', arguments: { query: 'quotaLimiterWindow quota limiter' } });
    const text = (r.content as { type: string; text: string }[])[0]!.text;
    assert.notEqual(r.isError, true);
    assert.match(text, /src\/quota\/limiter\.ts/, 'the worktree-only file is found');
    assert.doesNotMatch(text, /graph at|scanned just now/, 'no graph freshness line: find_files reads no graph');
  } finally {
    await close();
    dropFindFiles(wt);
    dropFindFiles(main);
    rmDir(path.dirname(wt));
    rmDir(main);
  }
});

/* ───────────── review of find-files, item 1: one index per repo, however many sessions ───────────── */

test('two agent sessions (the real stdio entry, as Sequence starts them) on one repo share one find_files index process', async () => {
  const SERVER_JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
  const dir = makeRepo();
  const env = { ...process.env, SEQUENCE_REPO: dir, SEQUENCE_MCP_TOOLS: 'core', SEQUENCE_FIND_FILES_HOST_IDLE_MS: '2000', SEQUENCE_FIND_FILES_LEARN: '0' } as Record<string, string>;
  const sessions = [0, 1].map(() => new Client({ name: 'ff-session', version: '0.0.0' }));
  try {
    for (const c of sessions) await c.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER_JS], env, stderr: 'ignore' }));
    let texts: string[] = [];
    for (let i = 0; i < 40; i++) {
      texts = [];
      for (const c of sessions) texts.push(((await c.callTool({ name: 'find_files', arguments: { query: 'where is the retry delay computed' } })).content as { text: string }[])[0]!.text);
      if (texts.every((t) => /\(learned ranker[,)]/.test(t))) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    for (const t of texts) assert.match(t, /1\. src\/retry\/backoff\.ts/);
    process.env.SEQUENCE_FIND_FILES_HOST_IDLE_MS = '2000';
    const s = await findFilesHostStats(dir, SERVER_JS);
    assert.ok(s, 'a host serves the repo');
    assert.equal(s!.builds, 1, 'one index, built once');
    assert.ok(s!.clients >= 3, `both sessions (and this test) are its clients: ${s!.clients}`);
  } finally {
    for (const c of sessions) await c.close();
    closeFindFilesHostConnections();
    rmDir(dir);
  }
});
