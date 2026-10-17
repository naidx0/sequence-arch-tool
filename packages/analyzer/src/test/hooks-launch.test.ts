import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';

import { createRepoServer, serverSettled } from '../server/repoServer.js';

/**
 * ROUND 7, A5: "Click to start Claude Code with hooks. Could not start it."
 *
 * Reproduced: the panel typed the command into the Terminal tab's shell, and
 * that shell is refused (409) when no project is attached, which is where
 * Jaden was. The panel now opens its own terminal on the launch the POST
 * recorded; the server starts claude with argv, with no project, and with
 * every path holding a space (the temp dir and the claude install dir here).
 *
 * The only `claude` reachable is a FAKE npm-style shim in the test's own
 * temp dir: it prints its argv and whether each file it was given exists.
 */

const FAKE = `const fs = require('node:fs');
const args = process.argv.slice(2);
const at = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const s = at('--settings');
const m = at('--mcp-config');
process.stdout.write('FAKE-CLAUDE argv=' + JSON.stringify(args) + '\\n');
process.stdout.write('settings ' + (s && fs.existsSync(s) ? 'found' : 'MISSING') + '; mcp ' + (m === null ? 'none' : fs.existsSync(m) ? 'found' : 'MISSING') + '; cwd=' + process.cwd() + '\\n');
`;

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function fakeClaude(dir: string): void {
  fs.writeFileSync(path.join(dir, 'fake.cjs'), FAKE);
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, 'claude.cmd'), `@"${process.execPath}" "%~dp0fake.cjs" %*\r\n`);
  } else {
    const p = path.join(dir, 'claude');
    fs.writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'fake.cjs')}" "$@"\n`, { mode: 0o755 });
  }
}

function post(port: number, p: string): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': 2 } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }));
    });
    req.on('error', reject);
    req.end('{}');
  });
}

function runSocket(url: string): Promise<{ output: string; code: number } | { refused: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let output = '';
    ws.on('message', (data, isBinary) => {
      if (isBinary) output += Buffer.from(data as Buffer).toString('utf8');
    });
    ws.on('unexpected-response', (_req, res) => {
      resolve({ refused: res.statusCode ?? 0 });
      ws.terminate();
    });
    ws.on('close', (code) => resolve({ output, code }));
    ws.on('error', () => {});
  });
}

test('Start Claude Code with hooks runs claude with its files, with no project, through paths with spaces', { timeout: 60_000 }, async () => {
  const root = tempDir('seq-hooks-launch-');
  const bin = path.join(root, 'npm global');
  const temp = path.join(root, 'Temp Dir');
  fs.mkdirSync(bin);
  fs.mkdirSync(temp);
  fakeClaude(bin);
  const saved = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  process.env.TEMP = process.env.TMP = process.env.TMPDIR = temp;
  const realTmp = os.tmpdir;
  os.tmpdir = () => temp;
  const server = await createRepoServer(null, {
    webDist: undefined,
    browseRoot: root,
    recentStoreDir: root,
    userConfigDir: root,
    providerSearch: { pathValue: bin, extraDirs: [], capMs: 15_000 },
  });
  const sockets = new Set<{ destroy: () => void }>();
  server.on('upgrade', (_r, s) => sockets.add(s as unknown as { destroy: () => void }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    const r = await post(port, '/api/agent-hooks/claude');
    assert.equal(r.status, 200);
    assert.ok(String(r.json.settingsFile).startsWith(temp), `the settings file is under the temp dir with a space: ${r.json.settingsFile} vs ${temp}`);
    assert.equal(typeof r.json.launchId, 'string');

    /* The old path typed the command into the Terminal tab's shell, which was refused
       (409) with no project attached; since round 7 B6 that shell opens in the home
       workspace instead (terminal.test owns that). The launch below needs neither. */

    const ran = await runSocket(`ws://127.0.0.1:${port}/api/terminal?launch=${encodeURIComponent(String(r.json.launchId))}`);
    assert.ok('output' in ran, `launch refused: ${JSON.stringify(ran)}`);
    const out = ran.output.replace(/\r/g, '');
    assert.match(out, /settings found; mcp none/);
    const argv = JSON.parse(/FAKE-CLAUDE argv=(\[.*\])/.exec(out)?.[1] ?? '[]') as string[];
    assert.deepEqual(argv, ['--settings', r.json.settingsFile], 'each path arrives as one argument');
    assert.equal(ran.code, 1000);

    /* An id the server never recorded runs nothing. */
    assert.deepEqual(await runSocket(`ws://127.0.0.1:${port}/api/terminal?launch=nope`), { refused: 400 });
  } finally {
    os.tmpdir = realTmp;
    Object.assign(process.env, saved);
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    for (const s of sockets) s.destroy();
    await new Promise<void>((res) => {
      server.close(() => res());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
    await serverSettled(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('with a project attached the launch also carries --mcp-config, both paths intact', { timeout: 60_000 }, async () => {
  const root = tempDir('seq-hooks-launch-repo-');
  const bin = path.join(root, 'npm global');
  const temp = path.join(root, 'Temp Dir');
  const repo = path.join(root, 'my project');
  fs.mkdirSync(bin);
  fs.mkdirSync(temp);
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'README.md'), '# x\n');
  fakeClaude(bin);
  const saved = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  process.env.TEMP = process.env.TMP = process.env.TMPDIR = temp;
  const realTmp = os.tmpdir;
  os.tmpdir = () => temp;
  const server = await createRepoServer(repo, {
    webDist: undefined,
    browseRoot: root,
    recentStoreDir: root,
    userConfigDir: root,
    providerSearch: { pathValue: bin, extraDirs: [], capMs: 15_000 },
  });
  const sockets = new Set<{ destroy: () => void }>();
  server.on('upgrade', (_r, s) => sockets.add(s as unknown as { destroy: () => void }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    const r = await post(port, '/api/agent-hooks/claude');
    assert.equal(r.status, 200);
    assert.ok(r.json.mcpConfigFile, 'a project gives the board server');
    assert.ok(String(r.json.mcpConfigFile).includes(' '), 'the board config path holds a space');
    /* The Claude terminal launch asks this app about components, and carries the person's mode. */
    const launchEnv = (JSON.parse(fs.readFileSync(String(r.json.mcpConfigFile), 'utf8')) as { mcpServers: { sequence: { env: Record<string, string> } } }).mcpServers.sequence.env;
    assert.equal(launchEnv.SEQUENCE_COMPONENTS_URL, `http://127.0.0.1:${port}`);
    assert.equal(launchEnv.SEQUENCE_COMPONENTS_MODE, 'approve');
    const ran = await runSocket(`ws://127.0.0.1:${port}/api/terminal?launch=${encodeURIComponent(String(r.json.launchId))}`);
    assert.ok('output' in ran, `launch refused: ${JSON.stringify(ran)}`);
    const out = ran.output.replace(/\r/g, '');
    assert.match(out, /settings found; mcp found/);
    const argv = JSON.parse(/FAKE-CLAUDE argv=(\[.*\])/.exec(out)?.[1] ?? '[]') as string[];
    assert.deepEqual(argv, ['--settings', r.json.settingsFile, '--mcp-config', r.json.mcpConfigFile]);
    assert.ok(out.includes(`cwd=${repo}`), `claude runs in the project: ${out}`);
  } finally {
    os.tmpdir = realTmp;
    Object.assign(process.env, saved);
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    for (const s of sockets) s.destroy();
    await new Promise<void>((res) => {
      server.close(() => res());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
    await serverSettled(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
