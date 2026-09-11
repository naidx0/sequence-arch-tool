import assert from 'node:assert';
import { test } from 'node:test';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunReceipt } from '../server/runReceipt.js';
import { setRepoTrust } from '../server/repoTrust.js';
import { userStoreDir } from '../server/store.js';

/**
 * `sequence ask --json` CARRIES THE CHANGE RECEIPT, AND THE FILE LANDS (audit G3).
 *
 * Before this, `--json` emitted {text, coverage, usage} and nothing else: no
 * model, no provider host, no tools, no commands, no files written, no
 * retries — every one of those existed at the end of the turn and left by no
 * door. Two things are locked, in the shape the audit reported:
 *
 *   1. The keys that shipped are still at the top level, unchanged — a
 *      consumer reading `.text`/`.coverage`/`.usage` must not break.
 *   2. `receipt` is present, is the same object that was written to
 *      `.sequence/receipts/<runId>.json`, and never carries the key.
 *
 * Same discipline as ask-headless-cli.test.ts: a REAL child process, a real
 * scan, a real HTTP request to a stub at the other end — a test that called
 * the function directly would not prove the file lands from the binary.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'cli.js');
const CLI_TIMEOUT_MS = 60_000;

async function startStubProvider(reply: string): Promise<{ baseUrl: string; port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: reply } }],
          usage: { prompt_tokens: 11, completion_tokens: 7 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function fixtureRepo(): string {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ask-receipt-')));
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'ask-receipt-fixture', version: '0.0.0', type: 'module' }, null, 2) + '\n',
  );
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'src', 'server.js'),
    "import { rate } from './rates.js';\nexport function quote(n) {\n  return n * rate();\n}\n",
  );
  fs.writeFileSync(path.join(repo, 'src', 'rates.js'), 'export function rate() {\n  return 1.5;\n}\n');
  /* TRUSTED, because this fixture RUNS a done-when command. `run_command` and
     every other spawn are refused under an untrusted repository — see
     `server/repoTrust.ts`, locked in `repo-trust.test.ts`. */
  setRepoTrust(userStoreDir(), repo, true);
  return repo;
}

/** An empty HOME so `~/.sequence/ai.json` can never reach the child. */
function baseEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
  for (const k of Object.keys(env)) {
    if (/^(SEQUENCE_AI_|OPENROUTER_|DEEPSEEK_|SEQUENCE_GATEWAY_)/.test(k)) delete env[k];
  }
  return env;
}

/** Async, never spawnSync — the stub lives in this process (see ask-headless-cli.test.ts). */
function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(process.execPath, [CLI, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    child.stderr?.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    child.on('error', reject);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`sequence ${args.join(' ')} did not exit within ${CLI_TIMEOUT_MS}ms; stderr: ${stderr.slice(0, 300)}`));
    }, CLI_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

/** A diff-literate reply that edits src/rates.js — the prose-diff salvage applies it under a writing mode. */
const RATE_DIFF = [
  'Raise the rate.',
  '```diff',
  '--- a/src/rates.js',
  '+++ b/src/rates.js',
  '@@ -1,3 +1,3 @@',
  ' export function rate() {',
  '-  return 1.5;',
  '+  return 2.5;',
  ' }',
  '```',
].join('\n');

test('`sequence ask --done-when`: a FAILED gate exits 7 (answered, unverified), and the flag without a writing mode is a usage error', async () => {
  /*
   * REVIEW (user-seat), two findings: the gate's verdict never reached the exit
   * code — a script that named a done-when got 0 whether it held or not — and
   * `--done-when` under `plan` was silently inert (nothing can be written, so
   * the gate never ran and the absence of a verdict read as a pass).
   */
  const repo = fixtureRepo();
  fs.writeFileSync(path.join(repo, 'fail.mjs'), 'process.exitCode = 3;\n');
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ask-dw-home-')));
  const stub = await startStubProvider(RATE_DIFF);
  try {
    const env = {
      ...baseEnv(home),
      SEQUENCE_AI_KEY: 'stub-key',
      SEQUENCE_AI_PROVIDER: 'openai-compatible',
      SEQUENCE_AI_BASE_URL: stub.baseUrl,
      SEQUENCE_AI_MODEL: 'stub-model',
    };
    const failed = await runCli(
      ['ask', 'Fix src/rates.js so rate() returns 2.5', '--repo', repo, '--permission', 'full', '--done-when', 'node fail.mjs', '--quiet'],
      env,
    );
    assert.equal(failed.code, 7, `expected exit 7 (UNVERIFIED), got ${failed.code}\nstdout:\n${failed.stdout}\nstderr:\n${failed.stderr}`);
    assert.match(failed.stdout, /Done-when 'node fail\.mjs' FAILED \(exit 3\)/);
    assert.match(fs.readFileSync(path.join(repo, 'src', 'rates.js'), 'utf8'), /return 2\.5;/, 'the edit stayed on disk');

    const inert = await runCli(['ask', 'Fix src/rates.js so rate() returns 2.5', '--repo', repo, '--permission', 'plan', '--done-when', 'node fail.mjs'], env);
    assert.equal(inert.code, 2, `expected exit 2 (USAGE), got ${inert.code}\nstderr:\n${inert.stderr}`);
    assert.match(inert.stderr, /--done-when needs a writing mode/);
    assert.equal(inert.stdout, '', 'a usage error answers nothing');
  } finally {
    await stub.close();
  }
});

test('`sequence ask --json` keeps text/coverage/usage at the top level and adds the receipt, which also lands on disk', async () => {
  const repo = fixtureRepo();
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ask-receipt-home-')));
  const SECRET = 'stub-key-SECRET-31337';
  const stub = await startStubProvider('quote() multiplies by the rate.');
  try {
    const env = {
      ...baseEnv(home),
      SEQUENCE_AI_KEY: SECRET,
      SEQUENCE_AI_PROVIDER: 'openai-compatible',
      SEQUENCE_AI_BASE_URL: stub.baseUrl,
      SEQUENCE_AI_MODEL: 'stub-model',
    };
    const r = await runCli(['ask', 'what does quote do?', '--repo', repo, '--json', '--permission', 'plan'], env);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}\nstderr:\n${r.stderr}`);

    const out = JSON.parse(r.stdout) as Record<string, unknown> & { receipt?: RunReceipt };

    /* 1. What shipped is untouched, at the top level. */
    assert.equal(out.text, 'quote() multiplies by the rate.');
    assert.ok(out.coverage && typeof out.coverage === 'object', '--json still carries coverage at the top level');
    assert.deepEqual(out.usage, { inputTokens: 11, outputTokens: 7, estimated: false });

    /* 2. The receipt — the reported shape: one object, assembled from live values. */
    const receipt = out.receipt;
    assert.ok(receipt, '--json must carry a receipt');
    assert.equal(receipt.version, 1);
    assert.equal(receipt.terminal, 'result');
    assert.match(receipt.runId, /^[A-Za-z0-9_-]+$/);
    assert.equal(receipt.model, 'stub-model');
    assert.deepEqual(receipt.providerRoute, { provider: 'openai-compatible', host: `127.0.0.1:${stub.port}` });
    assert.deepEqual(receipt.permission, { mode: 'plan', sources: [] });
    assert.equal(typeof receipt.instructionHash, 'string');
    assert.equal(receipt.providerRetries, 0, 'the retry loop ran and retried nothing — a measurement, not a default');
    assert.equal(typeof receipt.metrics?.rounds, 'number');
    assert.deepEqual(receipt.metrics?.tokens, { input: 11, output: 7, estimated: false });
    assert.deepEqual(receipt.filesWritten, [], 'a words-only turn measured zero writes');
    assert.equal('rollbackPoint' in receipt, false, 'no checkpoint session on the headless path ⇒ absent');
    assert.equal('verify' in receipt, false, 'no --done-when ⇒ absent');
    assert.equal('tools' in receipt, false, 'the stub asked for no tool ⇒ absent');

    /* The file is the same object. */
    const file = path.join(repo, '.sequence', 'receipts', `${receipt.runId}.json`);
    assert.ok(fs.existsSync(file), `receipt file written at ${file}`);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), receipt);

    /* The key is in the child's environment and nowhere in the output. */
    assert.equal(r.stdout.includes(SECRET), false, 'the key must not reach stdout');
    assert.equal(fs.readFileSync(file, 'utf8').includes(SECRET), false, 'the key must not reach the receipt file');
  } finally {
    await stub.close();
    for (const dir of [repo, home]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }
});
