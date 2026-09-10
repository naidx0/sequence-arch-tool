import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  serveRepo,
  assertSafeBind,
  isLoopbackBindHost,
  resolveTerminalEnabled,
} from '../server/repoServer.js';
import { serveApp } from '../serve.js';

/**
 * v13 P0 — bind + terminal hardening. Locks:
 *   - assertSafeBind THROWS on a non-loopback bind with no auth; passes for loopback,
 *     and passes for non-loopback WHEN auth is enabled.
 *   - serveRepo AND serveApp reject (never listen) on a non-loopback bind without auth.
 *   - resolveTerminalEnabled forces the terminal OFF on a non-loopback bind even with
 *     SEQUENCE_ENABLE_TERMINAL=1, while preserving the local (loopback) default = on.
 */

const AUTH_ENV = {
  GOOGLE_CLIENT_ID: 'g-id',
  GOOGLE_CLIENT_SECRET: 'g-secret',
  SESSION_SECRET: 'sess-secret-abc',
  PUBLIC_BASE_URL: 'https://app.example.com',
} as NodeJS.ProcessEnv;

const NO_AUTH_ENV = {} as NodeJS.ProcessEnv;

/** Run `fn` with the auth + bind env vars scrubbed and SEQUENCE_BIND_HOST forced. */
async function withEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const keys = [
    'SEQUENCE_BIND_HOST',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'SESSION_SECRET',
    'PUBLIC_BASE_URL',
    'SEQUENCE_ENABLE_TERMINAL',
  ];
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) saved[k] = process.env[k];
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined) process.env[k] = v;
  try {
    await fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('isLoopbackBindHost recognises loopback names only', () => {
  for (const h of ['127.0.0.1', 'localhost', '::1']) assert.strictEqual(isLoopbackBindHost(h), true, h);
  for (const h of ['0.0.0.0', '10.0.0.5', 'example.com', '::']) assert.strictEqual(isLoopbackBindHost(h), false, h);
});

test('assertSafeBind: loopback ok; non-loopback+no-auth throws; non-loopback+auth ok', () => {
  assert.strictEqual(assertSafeBind('127.0.0.1', NO_AUTH_ENV), true, 'loopback is always safe');
  assert.throws(() => assertSafeBind('0.0.0.0', NO_AUTH_ENV), /refusing to bind/i, 'public + no auth is refused');
  assert.strictEqual(assertSafeBind('0.0.0.0', AUTH_ENV), false, 'public + auth is allowed (returns non-loopback)');
});

test('resolveTerminalEnabled: public bind forces OFF; loopback preserves the local default', () => {
  // Public (non-loopback) bind → ALWAYS off, even with auth on and the enable flag set.
  assert.strictEqual(resolveTerminalEnabled(false, true, { SEQUENCE_ENABLE_TERMINAL: '1' } as NodeJS.ProcessEnv), false);
  assert.strictEqual(resolveTerminalEnabled(false, false, {} as NodeJS.ProcessEnv), false);
  // Loopback + no auth → on (the local single-user default, unchanged).
  assert.strictEqual(resolveTerminalEnabled(true, false, {} as NodeJS.ProcessEnv), true);
  // Loopback + auth → opt-in only.
  assert.strictEqual(resolveTerminalEnabled(true, true, { SEQUENCE_ENABLE_TERMINAL: '1' } as NodeJS.ProcessEnv), true);
  assert.strictEqual(resolveTerminalEnabled(true, true, {} as NodeJS.ProcessEnv), false);
});

test('serveRepo THROWS (does not listen) on a non-loopback bind with no auth', async () => {
  await withEnv({ SEQUENCE_BIND_HOST: '0.0.0.0' }, async () => {
    await assert.rejects(() => serveRepo(null, 0, undefined), /refusing to bind/i);
  });
});

test('serveApp THROWS (does not listen) on a non-loopback bind (no auth wiring)', async () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-bind-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>home</title>');
  try {
    await withEnv({ SEQUENCE_BIND_HOST: '0.0.0.0' }, async () => {
      await assert.rejects(() => serveApp(undefined, 0, dist), /refusing to bind/i);
    });
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});
