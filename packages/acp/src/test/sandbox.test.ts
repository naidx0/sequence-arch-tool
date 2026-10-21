import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcpClient, containerNameOf, guestPath, isSandboxed, SANDBOX_WORKSPACE } from '../client.js';

/*
 * THE SANDBOX CONTRACT: a launch whose args carry {cwd} runs the agent in a container with the
 * project mounted at /workspace. The token becomes the host folder at spawn; the agent is told
 * the folder under /workspace, never a host path it cannot reach; Sequence's host-side MCP
 * servers are not offered inside. A plain launch is untouched (the negative control).
 */

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AGENT = path.join(PKG_ROOT, 'src', 'test', 'fixtures', 'sandbox-agent.mjs');

function readLog(file: string): Record<string, unknown>[] {
  return fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
}

test('guestPath maps under the mount, and anything outside it to the mount itself', () => {
  const root = path.join(os.tmpdir(), 'repo');
  assert.equal(guestPath(root, root), SANDBOX_WORKSPACE);
  assert.equal(guestPath(root, path.join(root, 'packages', 'web2')), '/workspace/packages/web2');
  assert.equal(guestPath(root, path.join(os.tmpdir(), 'elsewhere')), SANDBOX_WORKSPACE);
  assert.equal(isSandboxed(['run', '-v', '{cwd}:/workspace'], 'C:/Program Files/Docker/docker.exe'), true);
  assert.equal(isSandboxed(['run', '-v', '{cwd}:/workspace'], '/usr/bin/docker'), true);
  assert.equal(isSandboxed(['acp']), false);
  assert.equal(isSandboxed(undefined), false);
  /* A {cwd} in an ordinary agent's args (a hostile registry entry) is not a sandbox. */
  assert.equal(isSandboxed(['--acp', '{cwd}'], '/usr/local/bin/gemini'), false);
  assert.equal(containerNameOf(['run', '--name', 'seq-gemini-ab12', 'img']), 'seq-gemini-ab12');
  assert.equal(containerNameOf(['run', '--name', 'bad name;', 'img']), null);
  assert.equal(containerNameOf(['run', 'img']), null);
});

/** Node itself, under the name docker: a sandbox is recognised by its command (isSandboxed), and this one runs the mock. */
function nodeNamedDocker(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-fake-docker-')));
  const p = path.join(dir, process.platform === 'win32' ? 'docker.exe' : 'docker');
  try {
    fs.linkSync(process.execPath, p);
  } catch {
    fs.copyFileSync(process.execPath, p);
    fs.chmodSync(p, 0o755);
  }
  return p;
}

async function run(args: string[], command = process.execPath): Promise<{ log: Record<string, unknown>[]; cwd: string }> {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-sandbox-')));
  const logFile = path.join(dir, 'log.jsonl');
  const client = new AcpClient({
    command,
    args: [AGENT, ...args],
    cwd: dir,
    env: { ...process.env, SANDBOX_AGENT_LOG: logFile },
    mcpServers: [{ name: 'sequence', command: process.execPath, args: ['nothing.js'] }],
  });
  try {
    await client.start();
    await client.newSession(path.join(dir, 'sub'));
  } finally {
    await client.dispose();
  }
  return { log: readLog(logFile), cwd: dir };
}

test('sandboxed: {cwd} becomes the host folder at spawn; the session is told /workspace/...; no host MCP servers', async () => {
  const { log, cwd } = await run(['--mount={cwd}:/workspace'], nodeNamedDocker());
  assert.deepEqual(log[0]!.argv, [`--mount=${cwd}:/workspace`]);
  assert.deepEqual(log[1], { ev: 'newSession', cwd: '/workspace/sub', mcpServers: 0 });
});

test('a plain launch is untouched, even with a {cwd} in its args: host cwd, MCP servers offered', async () => {
  const { log, cwd } = await run(['--plain', '{cwd}']);
  assert.deepEqual(log[0]!.argv, ['--plain', '{cwd}']);
  assert.deepEqual(log[1], { ev: 'newSession', cwd: path.join(cwd, 'sub'), mcpServers: 1 });
});

test('sandboxed: a project folder with a comma is refused in plain words, before anything is spawned (a --mount value is comma-separated)', async () => {
  const dir = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-sandbox-comma-'))), 'my,project');
  fs.mkdirSync(dir);
  const spawned: string[] = [];
  const client = new AcpClient({
    command: 'docker',
    args: ['run', '--mount', 'type=bind,src={cwd},dst=/workspace'],
    cwd: dir,
    spawn: ((c: string) => {
      spawned.push(c);
      throw new Error('should not spawn');
    }) as never,
  });
  await assert.rejects(client.start(), /comma/i);
  assert.deepEqual(spawned, []);
  await client.dispose();
  /* Negative control: the same folder is fine for a plain (non-sandboxed) launch, which reaches spawn. */
  const plain = new AcpClient({ command: 'agent', args: ['acp'], cwd: dir, spawn: ((c: string) => (spawned.push(c), (() => { throw new Error('plain reached spawn'); })())) as never });
  await assert.rejects(plain.start(), /plain reached spawn/);
  assert.deepEqual(spawned, ['agent']);
  await plain.dispose();
});
