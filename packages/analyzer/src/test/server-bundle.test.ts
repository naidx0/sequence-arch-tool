import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * THE BUNDLED SERVER SERVES, ON EVERY PATH THE ENTRY CAN TAKE.
 *
 * `pnpm build` writes dist/sequence-server.cjs (esbuild) and
 * dist/sequence-server-entry.cjs (scripts/server-entry.cjs). The desktop runs
 * the entry. Each case boots it on a temp copy of the shopfront fixture and
 * checks the scan (tree-sitter wasm through a routed dynamic import), the
 * graphology require, and `/` from the web dist (scripts/check-server-bundle.mjs).
 *
 *   no cache        plain require of the bundle
 *   compile cache   module.enableCompileCache on this Node (22.1+)
 *   cachedData      the vm.Script path Electron's Node 20 takes, forced here
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER = path.resolve(here, '..', '..');
const ENTRY = path.join(ANALYZER, 'dist', 'sequence-server-entry.cjs');
const FIXTURE = path.join(ANALYZER, 'test', 'fixtures', 'shopfront');
const WEB = path.resolve(ANALYZER, '..', 'web2', 'dist');

type Check = (o: Record<string, unknown>) => Promise<{ ok: boolean; problems: string[]; output: string }>;
const load = async (): Promise<Check> =>
  ((await import(pathToFileURL(path.join(ANALYZER, 'scripts', 'check-server-bundle.mjs')).href)) as { checkServerBundle: Check }).checkServerBundle;

test('prerequisite: the build wrote the bundle and its entry', () => {
  assert.ok(fs.existsSync(ENTRY), `missing ${ENTRY}: run pnpm --filter @sequence/analyzer build`);
  assert.ok(fs.existsSync(path.join(ANALYZER, 'dist', 'sequence-server.cjs')));
  const text = fs.readFileSync(path.join(ANALYZER, 'dist', 'sequence-server.cjs'), 'utf8');
  /* Every dynamic import goes through the entry (vm.Script on Node 20 refuses import()). */
  assert.doesNotMatch(text.replace("((s) => import(s))", ''), /(?<![\w$.])import\(/);
});

for (const mode of ['no cache', 'compile cache', 'cachedData'] as const) {
  test(`the bundled server scans, requires and serves the web app (${mode})`, async () => {
    const check = await load();
    const cacheDir = mode === 'no cache' ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'seq-v8-'));
    try {
      const r = await check({
        entry: ENTRY,
        fixture: FIXTURE,
        webDist: WEB,
        cacheDir,
        env: mode === 'cachedData' ? { SEQUENCE_COMPILE_CACHE_MODE: 'cachedData' } : {},
      });
      assert.ok(r.ok, `${r.problems.join('; ')}\n--- output ---\n${r.output.slice(-1500)}`);
      assert.match(r.output, /SEQUENCE_LISTENING http:\/\/127\.0\.0\.1:\d+/);
    } finally {
      if (cacheDir) fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  });
}

test('a cachedData cache from one boot is accepted by the next', async () => {
  const check = await load();
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-v8-'));
  try {
    const env = { SEQUENCE_COMPILE_CACHE_MODE: 'cachedData', SEQUENCE_BOOT_PROFILE: '1' };
    const first = await check({ entry: ENTRY, fixture: FIXTURE, webDist: WEB, cacheDir, env });
    assert.ok(first.ok, first.problems.join('; '));
    const written = fs.readdirSync(cacheDir);
    assert.strictEqual(written.length, 1, written.join(', '));
    const stamp = fs.statSync(path.join(cacheDir, written[0])).mtimeMs;
    const second = await check({ entry: ENTRY, fixture: FIXTURE, webDist: WEB, cacheDir, env });
    assert.ok(second.ok, second.problems.join('; '));
    /* Accepted means not rewritten: a rejected cache is written again. */
    assert.strictEqual(fs.statSync(path.join(cacheDir, written[0])).mtimeMs, stamp, 'the second boot rewrote the cache, so V8 rejected it');
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('a server killed by a signal is reported, not waited on forever', async () => {
  /* The 0.1.4 macOS release build: the server died by a signal, exitCode stayed null, and the check
     waited on an 'exit' event that had already fired, so prepare-server quit with code 13 and no reason. */
  const check = await load();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-dies-'));
  try {
    const entry = path.join(dir, 'dies.cjs');
    fs.writeFileSync(entry, "process.stderr.write('dying on purpose\n'); setTimeout(() => process.kill(process.pid, 'SIGKILL'), 50);\n");
    const t0 = Date.now();
    const r = await check({ entry, fixture: FIXTURE });
    assert.equal(r.ok, false);
    assert.match(r.problems.join('; '), /exited before answering/);
    assert.match(r.problems.join('; '), /dying on purpose/);
    assert.ok(Date.now() - t0 < 30000, 'reported promptly, not after the 60 s boot wait');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
