/**
 * S2a: THE SERVER A CODING AGENT'S SESSION GETS (analyzer sequenceMcp.ts
 * starts `dist/server.js` with SEQUENCE_REPO and SEQUENCE_MCP_TOOLS=core).
 *
 *   - the core set keeps the four architecture reads and adds only board
 *     discovery/create/draw, with honest mutation hints and a measured budget
 *     (chars / 4, agentMap.ts's rule) of listing; `all` keeps every tool
 *   - `repoPath` defaults to the session's repository
 *   - spawning the server reads nothing; a second session on unchanged code
 *     loads the persisted graph and never re-analyses (graph.json is not
 *     rewritten)
 *
 * Each test owns a temp copy of the shopfront fixture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { scanRepoCached } from '@sequence/analyzer';
import { rmDir } from './rmDir.js';
import { CORE_TOOLS, createServer, type CreateServerOptions } from '../index.js';
import { optionsFromEnv } from '../server.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.resolve(HERE, '../../../..', 'packages/analyzer/test/fixtures/shopfront');
const SERVER_JS = path.resolve(HERE, '..', 'server.js');
/* A spawned server starts the repo's shared find_files host; let it leave soon after the test's session does. */
process.env.SEQUENCE_FIND_FILES_HOST_IDLE_MS = '2000';

function specimen(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-mcp-s2a-'));
  fs.cpSync(SHOPFRONT, dir, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git|\.sequence)([\\/]|$)/.test(p.slice(SHOPFRONT.length)) });
  return dir;
}

async function connect(opts: CreateServerOptions): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createServer(opts);
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 's2a-test', version: '0.0.0' });
  await Promise.all([server.connect(s), client.connect(c)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

const tokens = (v: unknown): number => Math.ceil(JSON.stringify(v).length / 4);

test('core: the smallest read/draw/workflow/find/web/components contract within 3.32k listing tokens (draw carries styling, svg and compose; web_fetch + web_search 220; components under 150); all keeps every tool', async (t) => {
  const core = await connect({ tools: 'core', repo: SHOPFRONT });
  const all = await connect({ repo: SHOPFRONT });
  try {
    const { tools } = await core.client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...CORE_TOOLS].sort());
    assert.deepEqual(tools.map(t => t.name).sort(), ['map', 'who_calls', 'impact', 'architecture_changed', 'list_boards', 'create_board', 'draw', 'edit_workflow', 'drawings', 'visual', 'find_files', 'web_fetch', 'web_search', 'components'].sort());
    assert.ok(tokens(tools) <= 3320, `core listing is ${tokens(tools)} tokens`);
    const writes = new Set(['create_board', 'draw', 'edit_workflow', 'visual']);
    for (const tool of tools) assert.equal(tool.annotations?.readOnlyHint, !writes.has(tool.name), tool.name);
    assert.match(core.client.getInstructions()!, /create_board.*draw/s);
    assert.match(core.client.getInstructions()!, /write|mutat/i);
    const every = (await all.client.listTools()).tools;
    const { TOOLS } = await import('../index.js');
    assert.deepEqual(every.map(t => t.name).sort(), TOOLS.map(t => t.name).sort());
    assert.ok(tokens(every) > tokens(tools), 'all still costs more than the bounded catalog');
    const original = tools.filter(t => !['list_boards', 'create_board', 'draw'].includes(t.name));
    t.diagnostic(JSON.stringify({ unit: 'ceil(JSON listing chars / 4)', reads: { count: original.length, tokens: tokens(original) }, core: { count: tools.length, tokens: tokens(tools) }, all: { count: every.length, tokens: tokens(every) } }));
    const ro = Object.fromEntries(every.map((t) => [t.name, t.annotations?.readOnlyHint]));
    assert.equal(ro.whiteboard, false);
    assert.equal(ro.export_diagram, false);
    assert.equal(ro.who_calls, true);
  } finally {
    await core.close();
    await all.close();
  }
});

test("repoPath defaults to the session's repository", async () => {
  const repo = specimen();
  const { client, close } = await connect({ tools: 'core', repo });
  try {
    const r = await client.callTool({ name: 'map', arguments: { budget: 400 } });
    assert.notEqual(r.isError, true, JSON.stringify(r.content));
    assert.match((r.content as { text: string }[])[0]!.text, /^# map /);
  } finally {
    await close();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('spawning the server (the real stdio entry, as a session starts it) reads nothing from the repository', async () => {
  const repo = specimen();
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_JS], env: { ...process.env, SEQUENCE_REPO: repo, SEQUENCE_MCP_TOOLS: 'core' } as Record<string, string>, stderr: 'ignore' });
  const client = new Client({ name: 's2a-spawn', version: '0.0.0' });
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, CORE_TOOLS.length);
    assert.equal(fs.existsSync(path.join(repo, '.sequence')), false, 'no scan, no cache written');
  } finally {
    await client.close();
    /* The warm-up host (a detached process, started on purpose) may still be scanning the repo; on Windows it holds the directory until it lets go. */
    rmDir(repo);
  }
});

test('a second session on unchanged code loads the persisted graph: no re-analysis (graph.json is not rewritten)', async () => {
  const repo = specimen();
  try {
    const first = await connect({ tools: 'core', repo });
    await first.client.callTool({ name: 'impact', arguments: { node: 'payments' } });
    await first.close();
    const graphFile = path.join(repo, '.sequence', 'graph.json');
    assert.ok(fs.existsSync(graphFile), 'the first session persisted the analysis');
    const before = fs.statSync(graphFile).mtimeMs;
    const second = await connect({ tools: 'core', repo });
    const r = await second.client.callTool({ name: 'map', arguments: { budget: 400 } });
    await second.close();
    assert.notEqual(r.isError, true);
    assert.equal(fs.statSync(graphFile).mtimeMs, before, 'scanRepo would have rewritten it');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

/** A git repository (one commit) holding a shopfront copy, its graph persisted the way the running server keeps it. */
async function gitRepoWithGraph(): Promise<{ dir: string; repo: string; sha: string; git: (args: string[], cwd?: string) => string }> {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-mcp-fresh-')));
  const repo = path.join(dir, 'repo');
  fs.cpSync(SHOPFRONT, repo, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git|\.sequence)([\\/]|$)/.test(p.slice(SHOPFRONT.length)) });
  const git = (args: string[], cwd = repo) =>
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
  git(['init', '-q', '-b', 'main']);
  /* What the running server keeps out of history: its own .sequence. */
  fs.writeFileSync(path.join(repo, '.gitignore'), '.sequence/\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
  await scanRepoCached(repo, { cluster: true });
  return { dir, repo, sha: git(['rev-parse', 'HEAD']), git };
}

const AGE = '(?:under a minute|\\d+ min) old';

async function spawnedCall(repo: string, tool: string, args: Record<string, unknown>): Promise<{ content: { type: string; text?: string }[] }> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_JS], env: { ...process.env, SEQUENCE_REPO: repo, SEQUENCE_MCP_TOOLS: 'core' } as Record<string, string>, stderr: 'ignore' });
  const client = new Client({ name: 's2a-fresh', version: '0.0.0' });
  try {
    await client.connect(transport);
    return (await client.callTool({ name: tool, arguments: args })) as { content: { type: string; text?: string }[] };
  } finally {
    await client.close();
  }
}

test("every answer says how old its graph is: the spawned server's map ends with \"graph at <commit>, <age>\"; a JSON answer carries it as `freshness`", async () => {
  const r = await gitRepoWithGraph();
  try {
    const map = await spawnedCall(r.repo, 'map', { budget: 400 });
    /* The graph is seconds old on an idle machine; on a loaded one the spawn can take over a minute and the age reads "N min". Still proves: this commit, an age in words, as the last line. */
    assert.match(map.content.at(-1)!.text!, new RegExp(`^graph at ${r.sha.slice(0, 7)}, ${AGE}$`));
    const impact = await spawnedCall(r.repo, 'impact', { node: 'payments' });
    assert.match(JSON.parse(impact.content[0]!.text!).freshness, new RegExp(`^graph at ${r.sha.slice(0, 7)}, ${AGE}$`));
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});

test('a worktree with no graph of its own answers from its base\'s graph and says so; nothing analyses the worktree', async () => {
  const r = await gitRepoWithGraph();
  const wt = path.join(r.dir, 'wt-chat');
  try {
    r.git(['worktree', 'add', '-q', '-b', 'sequence/chat-1', wt]);
    assert.equal(fs.existsSync(path.join(wt, '.sequence')), false);
    const map = await spawnedCall(wt, 'map', { budget: 400 });
    assert.match(map.content[0]!.text!, /^# map /);
    assert.match(map.content.at(-1)!.text!, new RegExp(`^graph from base ${r.sha.slice(0, 7)}, ${AGE} \\(this worktree has no graph of its own\\)$`));
    assert.equal(fs.existsSync(path.join(wt, '.sequence')), false, 'the worktree was not scanned');
  } finally {
    try {
      r.git(['worktree', 'remove', '--force', wt]);
    } catch {
      /* the temp dir goes below either way */
    }
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});

test('the environment a session sets selects the core set and the repository; unset is a standalone install', () => {
  assert.deepEqual(optionsFromEnv({ SEQUENCE_REPO: 'C:/r', SEQUENCE_MCP_TOOLS: 'core' }), { tools: 'core', repo: 'C:/r' });
  assert.deepEqual(optionsFromEnv({}), { tools: 'all' });
});

test('drawings tools (lane visual): one read-only tool adds under 150 listing tokens', async () => {
  const core = await connect({ tools: 'core', repo: SHOPFRONT });
  try {
    const { tools } = await core.client.listTools();
    const mine = tools.filter((t) => t.name === 'drawings');
    assert.equal(mine.length, 1);
    assert.ok(tokens(mine) <= 150, `the drawings tool lists at ${tokens(mine)} tokens`);
    for (const t of mine) assert.equal(t.annotations?.readOnlyHint, true);
  } finally {
    await core.close();
  }
});

test('visual (lane components): the core listing grows by under 200 tokens and the tool is a write', async () => {
  const core = await connect({ tools: 'core', repo: SHOPFRONT });
  try {
    const { tools } = await core.client.listTools();
    const mine = tools.filter((t) => t.name === 'visual');
    assert.equal(mine.length, 1);
    assert.ok(tokens(mine) <= 200, `the visual tool lists at ${tokens(mine)} tokens`);
    assert.equal(mine[0]!.annotations?.readOnlyHint, false);
  } finally {
    await core.close();
  }
});
