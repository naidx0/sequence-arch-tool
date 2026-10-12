import assert from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRepoServer, serverSettled } from '../server/repoServer.js';
import { bootMarks } from '../server/bootMarks.js';

/**
 * THE SERVER'S START IS MEASURED IN STAGES.
 *
 * One server-up number cannot say whether the time went to loading modules,
 * hashing the repo, scanning or binding. The marks can, and they are what any
 * future boot change is measured against, so their order is locked here.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const PLAINAPP = path.resolve(here, '..', '..', 'test', 'fixtures', 'plainapp');

test('a cold start marks create, signature, scan, routes and the first status answer, in order', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-boot-marks-')));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  const userDir = path.join(dir, 'user');
  fs.mkdirSync(userDir);
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir: userDir });
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    const res = await fetch(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/api/status`);
    assert.strictEqual(res.status, 200);
    const names = bootMarks().map((m) => m.name);
    assert.deepStrictEqual(names, ['serverCreate', 'signature', 'graphScanned', 'routesReady', 'status200']);
    const ms = bootMarks().map((m) => m.ms);
    assert.deepStrictEqual([...ms].sort((a, b) => a - b), ms, 'marks are in time order');
    /* Closed by the first status answer: a later one adds nothing. */
    await fetch(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/api/status`);
    assert.strictEqual(bootMarks().length, 5);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
    await serverSettled(server);
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('SEQUENCE_BOOT_PROFILE=1 prints the marks once, as one line; unset, nothing', () => {
  const mod = pathToFileURL(path.resolve(here, '..', 'server', 'bootMarks.js')).href;
  const code = `const m = await import(${JSON.stringify(mod)}); m.bootMark('a'); m.reportBootOnce(); m.reportBootOnce();`;
  const on = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, SEQUENCE_BOOT_PROFILE: '1' } });
  const lines = on.stderr.split(/\r?\n/).filter((l) => l.startsWith('SEQUENCE_BOOT '));
  assert.strictEqual(lines.length, 1, on.stderr);
  assert.deepStrictEqual(JSON.parse(lines[0].slice('SEQUENCE_BOOT '.length)).map((m: { name: string }) => m.name), ['a', 'status200']);
  const off = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, SEQUENCE_BOOT_PROFILE: '' } });
  assert.doesNotMatch(off.stderr, /SEQUENCE_BOOT/);
});
