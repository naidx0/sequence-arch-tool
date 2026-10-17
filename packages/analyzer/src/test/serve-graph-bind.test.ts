/**
 * `sequence serve <graph.json>` binds loopback by default (claim U70: "Everything binds to 127.0.0.1").
 * serveGraph used to call server.listen(port) with no host, which listens on every interface.
 * `--host` is the opt-out and follows SEQUENCE_BIND_HOST: a non-loopback host needs auth.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { serveGraph } from '../serve.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '..', 'cli.js');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-bind-'));
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>v</title>');
  const graphPath = path.join(dir, 'g.json');
  fs.writeFileSync(graphPath, JSON.stringify({ repoName: 'bind-test', nodes: [], edges: [] }));
  return { dist, graphPath };
}

const NO_AUTH_ENV = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
  const env = { ...process.env, ...extra };
  for (const k of ['SESSION_SECRET', 'PUBLIC_BASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']) delete env[k];
  if (!('SEQUENCE_BIND_HOST' in extra)) delete env.SEQUENCE_BIND_HOST;
  return env;
};

test('serveGraph listens on 127.0.0.1 and not on every interface', async () => {
  const saved = process.env.SEQUENCE_BIND_HOST;
  delete process.env.SEQUENCE_BIND_HOST;
  const { dist, graphPath } = fixture();
  const server = serveGraph(graphPath, 0, dist);
  try {
    await new Promise<void>((resolve) => (server.listening ? resolve() : server.once('listening', () => resolve())));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    assert.equal(addr.address, '127.0.0.1');
  } finally {
    server.close();
    if (saved !== undefined) process.env.SEQUENCE_BIND_HOST = saved;
  }
});

test('serveGraph refuses a non-loopback SEQUENCE_BIND_HOST when no auth is configured, before listening', () => {
  const saved = { host: process.env.SEQUENCE_BIND_HOST, secret: process.env.SESSION_SECRET };
  delete process.env.SESSION_SECRET;
  process.env.SEQUENCE_BIND_HOST = '0.0.0.0';
  const { dist, graphPath } = fixture();
  try {
    assert.throws(() => serveGraph(graphPath, 0, dist), /refusing to bind 0\.0\.0\.0/);
  } finally {
    if (saved.host === undefined) delete process.env.SEQUENCE_BIND_HOST;
    else process.env.SEQUENCE_BIND_HOST = saved.host;
    if (saved.secret !== undefined) process.env.SESSION_SECRET = saved.secret;
  }
});

test('the CLI has --host: a non-loopback host with no auth is refused with the same message, and --host is not mistaken for the graph path', () => {
  const { dist, graphPath } = fixture();
  const r = spawnSync(process.execPath, [CLI, 'serve', '--host', '0.0.0.0', '--port', '0', '--web', dist, graphPath], { env: NO_AUTH_ENV(), encoding: 'utf8', timeout: 60_000 });
  assert.notEqual(r.status, 0);
  assert.match(`${r.stdout}${r.stderr}`, /refusing to bind 0\.0\.0\.0/);
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /graph file not found/);
});

test('the CLI help documents --host', () => {
  const r = spawnSync(process.execPath, [CLI, '--help'], { env: NO_AUTH_ENV(), encoding: 'utf8', timeout: 60_000 });
  assert.match(`${r.stdout}${r.stderr}`, /--host <addr>/);
});

test('the CLI refusal has one "sequence:" prefix, not two', () => {
  const { dist, graphPath } = fixture();
  const r = spawnSync(process.execPath, [CLI, 'serve', '--host', '0.0.0.0', '--port', '0', '--web', dist, graphPath], { env: NO_AUTH_ENV(), encoding: 'utf8', timeout: 60_000 });
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /sequence: sequence:/);
  assert.match(r.stderr, /^sequence: refusing to bind/m);
});

test('an IPv6 bind host is printed in brackets', async () => {
  const saved = process.env.SEQUENCE_BIND_HOST;
  process.env.SEQUENCE_BIND_HOST = '::1';
  const { dist, graphPath } = fixture();
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => void logs.push(a.join(' '));
  let server: ReturnType<typeof serveGraph> | undefined;
  try {
    try {
      server = serveGraph(graphPath, 0, dist);
      await new Promise<void>((resolve, reject) => {
        server!.once('listening', () => resolve());
        server!.once('error', reject);
      });
    } catch {
      return; // no IPv6 loopback on this machine: nothing to print
    }
  } finally {
    console.log = orig;
    server?.close();
    if (saved === undefined) delete process.env.SEQUENCE_BIND_HOST;
    else process.env.SEQUENCE_BIND_HOST = saved;
  }
  assert.ok(logs.some((l) => /http:\/\/\[::1\]:\d+/.test(l)), logs.join('\n'));
});
