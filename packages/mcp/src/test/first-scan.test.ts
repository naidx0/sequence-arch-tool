/**
 * THE FIRST BOARD CALL ON A REPO WITH NO GRAPH. The server scans it (as it
 * always has), and then:
 *   - the `.sequence/` that scan created goes in the repo's LOCAL
 *     `.git/info/exclude` (once; .gitignore untouched), so `git status` stays
 *     clean, the same rule the S3 snapshot code keeps (`ensureSequenceIgnored`);
 *   - that answer says "scanned just now (N s)" rather than "graph at <sha7>,
 *     under a minute old", because nothing persisted was read.
 * A repo whose graph already exists keeps the old line and its exclude file
 * is not touched.
 *
 * Each test owns a temp git repo (a shopfront copy, one commit) and runs the
 * real stdio server with SEQUENCE_USER_DIR pointed at a temp dir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { scanRepoCached } from '@sequence/analyzer';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.resolve(HERE, '../../../..', 'packages/analyzer/test/fixtures/shopfront');
const SERVER_JS = path.resolve(HERE, '..', 'server.js');
/* A spawned server starts the repo's shared find_files host; let it leave soon after the test's session does. */
process.env.SEQUENCE_FIND_FILES_HOST_IDLE_MS = '2000';

/** A temp git repo (one commit, no .gitignore, no .sequence) plus an isolated user store. */
function freshGitRepo(): { dir: string; repo: string; userDir: string; git: (args: string[]) => string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-mcp-first-')));
  const repo = path.join(dir, 'repo');
  const userDir = path.join(dir, 'user-store');
  fs.mkdirSync(userDir);
  fs.cpSync(SHOPFRONT, repo, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git|\.sequence)([\\/]|$)/.test(p.slice(SHOPFRONT.length)) });
  const git = (args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
  git(['init', '-q', '-b', 'main']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
  assert.equal(fs.existsSync(path.join(repo, '.sequence')), false);
  assert.equal(fs.existsSync(path.join(repo, '.gitignore')), false);
  return { dir, repo, userDir, git };
}

async function spawnedCall(repo: string, userDir: string, tool: string, args: Record<string, unknown>): Promise<{ isError?: boolean; content: { type: string; text?: string }[] }> {
  const env = { ...process.env, SEQUENCE_REPO: repo, SEQUENCE_MCP_TOOLS: 'core', SEQUENCE_USER_DIR: userDir, SEQUENCE_HOME: userDir } as Record<string, string>;
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_JS], env, stderr: 'ignore' });
  const client = new Client({ name: 'first-scan', version: '0.0.0' });
  try {
    await client.connect(transport);
    return (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { type: string; text?: string }[] };
  } finally {
    await client.close();
  }
}

const excludeFile = (repo: string) => path.join(repo, '.git', 'info', 'exclude');
const sequenceLines = (repo: string) =>
  (fs.existsSync(excludeFile(repo)) ? fs.readFileSync(excludeFile(repo), 'utf8') : '').split(/\r?\n/).filter((l) => l.trim() === '.sequence/');

test('first map call on a repo with no graph: .sequence/ goes in info/exclude once, git status stays clean, and the answer says "scanned just now (N s)"', async () => {
  const r = freshGitRepo();
  try {
    const map = await spawnedCall(r.repo, r.userDir, 'map', { budget: 400 });
    assert.notEqual(map.isError, true, JSON.stringify(map.content));
    assert.ok(fs.existsSync(path.join(r.repo, '.sequence', 'graph.json')), 'the call scanned and persisted');
    assert.equal(r.git(['status', '--porcelain']), '', 'git status shows nothing Sequence wrote');
    assert.equal(sequenceLines(r.repo).length, 1);
    assert.equal(fs.existsSync(path.join(r.repo, '.gitignore')), false, '.gitignore is never touched');
    const last = map.content.at(-1)!.text!;
    assert.ok(last.includes('scanned just now ('), last);
    assert.match(last, /^scanned just now \(\d+\.\d s\)$/);

    /* A second call (a new session) reads the persisted graph: old line, no second exclude line. */
    const again = await spawnedCall(r.repo, r.userDir, 'map', { budget: 400 });
    assert.equal(sequenceLines(r.repo).length, 1, 'idempotent: no duplicate line');
    assert.match(again.content.at(-1)!.text!, /^graph at [0-9a-f]{7}, /);
    assert.equal(r.git(['status', '--porcelain']), '');
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});

test('a repo whose persisted graph already exists keeps "graph at <sha7>, …" and its info/exclude is not touched', async () => {
  const r = freshGitRepo();
  try {
    await scanRepoCached(r.repo, { cluster: true });
    const before = fs.existsSync(excludeFile(r.repo)) ? fs.readFileSync(excludeFile(r.repo)) : null;
    const sha = r.git(['rev-parse', 'HEAD']);
    const map = await spawnedCall(r.repo, r.userDir, 'map', { budget: 400 });
    assert.equal(map.content.at(-1)!.text, `graph at ${sha.slice(0, 7)}, under a minute old`);
    const impact = await spawnedCall(r.repo, r.userDir, 'impact', { node: 'payments' });
    assert.equal(JSON.parse(impact.content[0]!.text!).freshness, `graph at ${sha.slice(0, 7)}, under a minute old`);
    const after = fs.existsSync(excludeFile(r.repo)) ? fs.readFileSync(excludeFile(r.repo)) : null;
    assert.deepEqual(after, before, 'info/exclude byte-identical');
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});
