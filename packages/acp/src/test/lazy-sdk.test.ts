import assert from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * IMPORTING THIS PACKAGE DOES NOT LOAD THE ACP SDK.
 *
 * The analyzer server imports @sequence/acp at boot for pure helpers, and the
 * SDK with its zod was 88 of the 335 files that boot loaded (measured
 * 2026-10-05; server-up 568 -> 471 ms median, n=9 interleaved, once it
 * stopped). So the SDK loads when an agent starts, and this locks both halves:
 * not on import, and yes on start.
 *
 * Observed from a child process through a resolve hook that reports every
 * module URL the loader resolves, so the check reads the loader itself rather
 * than a proxy for it.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = pathToFileURL(path.resolve(here, '..', 'index.js')).href;
const MOCK_AGENT = path.resolve(here, '..', '..', 'src', 'test', 'fixtures', 'mock-agent.mjs');

const HOOK =
  'data:text/javascript,' +
  encodeURIComponent(`
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(\`
import { writeSync } from 'node:fs';
export async function resolve(spec, ctx, next) {
  const r = await next(spec, ctx);
  writeSync(2, 'RESOLVED ' + r.url + '\\\\n');
  return r;
}\`));
`);

function sdkResolved(code: string): { sdk: boolean; out: string } {
  const r = spawnSync(process.execPath, ['--import', HOOK, '--input-type=module', '-e', code], { encoding: 'utf8' });
  const resolved = r.stderr.split(/\r?\n/).filter((l) => l.startsWith('RESOLVED '));
  return { sdk: resolved.some((l) => l.includes('@agentclientprotocol')), out: `${r.stdout}\n${r.stderr.slice(-800)}` };
}

test('importing @sequence/acp leaves the SDK unloaded', () => {
  const r = sdkResolved(`const m = await import(${JSON.stringify(INDEX)}); console.log(typeof m.AcpClient, m.allowsTool('autoEdit', 'edit'));`);
  assert.match(r.out, /function true/, 'the package still exports its helpers and the client');
  assert.strictEqual(r.sdk, false, `the SDK was resolved on import:\n${r.out}`);
});

test('starting an ACP client loads it (positive control)', () => {
  const code = `
    const { AcpClient } = await import(${JSON.stringify(INDEX)});
    const c = new AcpClient({ command: process.execPath, args: [${JSON.stringify(MOCK_AGENT)}] });
    await c.start();
    await c.dispose();
    console.log('started');`;
  const r = sdkResolved(code);
  assert.match(r.out, /started/);
  assert.strictEqual(r.sdk, true, `start() did not load the SDK:\n${r.out}`);
});
