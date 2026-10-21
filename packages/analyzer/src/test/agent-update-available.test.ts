import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProviderProbe, type ProviderStatus } from '../server/providerProbe.js';
import { updateAvailableFor } from '../server/agentVersions.js';

/*
 * 0.1.8.4: an installed agent older than the recommended version gets a calm
 * `updateAvailable` and stays usable. Every binary is a FAKE written into this
 * test's own temp dir (the PATH searched is that dir alone); nothing real runs.
 */

const FAKE_SCRIPT = `import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const [name, ...args] = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(here, name + '.json'), 'utf8'));
const r = cfg[args.join(' ')] ?? { stderr: 'unknown command', code: 2 };
process.stdout.write(r.stdout ?? '');
process.stderr.write(r.stderr ?? '');
process.exitCode = r.code ?? 0;
`;

function fakeBin(dir: string, name: string, replies: Record<string, { stdout?: string; stderr?: string; code?: number }>): void {
  fs.writeFileSync(path.join(dir, 'fake.mjs'), FAKE_SCRIPT);
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(replies));
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, `${name}.cmd`), `@"${process.execPath}" "%~dp0fake.mjs" ${name} %*\r\n`);
  } else {
    const p = path.join(dir, name);
    fs.writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'fake.mjs')}" ${name} "$@"\n`);
    fs.chmodSync(p, 0o755);
  }
}

const probeOf = async (dir: string): Promise<ProviderStatus[]> => (await createProviderProbe({ pathValue: dir, extraDirs: [], capMs: 15_000 }).get()).providers;
const dirOf = (): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-upd-')));

test('updateAvailableFor: older is flagged with the manual command, equal/newer/unknown are not (positive and negative control)', () => {
  const old = updateAvailableFor('codex', '0.100.0');
  assert.ok(old, 'older than recommended');
  assert.match(old.command, /@openai\/codex@latest/);
  assert.strictEqual(updateAvailableFor('codex', old.recommended), null);
  assert.strictEqual(updateAvailableFor('codex', '99.0.0'), null);
  assert.strictEqual(updateAvailableFor('codex', null), null);
  assert.strictEqual(updateAvailableFor('someother', '0.0.1'), null);
  assert.strictEqual(updateAvailableFor('claude', '2.1.200')?.command, 'claude update');
});

test('an old but signed-in Codex is still Ready and carries updateAvailable; a current one carries none', async () => {
  const dir = dirOf();
  fakeBin(dir, 'codex', { '--version': { stdout: 'codex-cli 0.100.0\n' }, 'login status': { stderr: 'Logged in using ChatGPT\n' } });
  const old = (await probeOf(dir)).find((p) => p.id === 'codex')!;
  assert.strictEqual(old.state, 'ready');
  assert.strictEqual(old.updateAvailable?.command, 'npm install -g @openai/codex@latest');
  fakeBin(dir, 'codex', { '--version': { stdout: 'codex-cli 99.0.0\n' }, 'login status': { stderr: 'Logged in using ChatGPT\n' } });
  const fresh = (await probeOf(dir)).find((p) => p.id === 'codex')!;
  assert.strictEqual(fresh.state, 'ready');
  assert.strictEqual(fresh.updateAvailable, undefined);
});
