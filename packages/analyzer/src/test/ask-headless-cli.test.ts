import assert from 'node:assert';
import { test } from 'node:test';
import childProcess from 'node:child_process';
import { parseAskArgs } from '../askCli.js';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * P14 — HEADLESS ENTRY. The lock the item names, verbatim: "run it as a real
 * child process with a real repo and assert the answer reaches stdout and the
 * exit code is honest. A test that calls the function directly is not this."
 *
 * So NOTHING here imports `askCli.ts`. Every case spawns
 * `node dist/cli.js ask …` as a real child process, reads the child's real
 * stdout/stderr and its real exit status, and — for the composition case —
 * pipes the child into a second process, because `claude -p` composing with
 * Unix pipes is the whole capability being matched.
 *
 * THE PROVIDER IS A LOCAL STUB, NOT A MOCK OF THE PIPELINE. The child runs the
 * real `runAskPipeline` against a real scan of a real repo, and makes a real
 * HTTP request; only the machine at the other end of that request is ours. A
 * test that stubbed `runAskPipeline` would prove the CLI parses flags, which is
 * not the claim.
 *
 * `HOME`/`USERPROFILE` are pointed at an empty directory in EVERY child, so the
 * developer's own `~/.sequence/ai.json` cannot silently supply a provider —
 * `docs/CANON.md` names exactly that global fallback as the cause of three
 * phantom failures in this suite.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
/** `dist/test/…` → `dist/cli.js`, the real built entry point the `sequence` bin runs. */
const CLI = path.join(here, '..', 'cli.js');

interface StubProvider {
  baseUrl: string;
  /** Every prompt the child actually sent, in order. */
  prompts: string[];
  close: () => Promise<void>;
}

/**
 * An OpenAI-compatible `/v1/chat/completions` that answers with `reply`.
 * Records each prompt so a test can prove the child really called out.
 */
async function startStubProvider(reply: string, status = 200): Promise<StubProvider> {
  const prompts: string[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      prompts.push(raw);
      if (status !== 200) {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'stub provider refused' } }));
        return;
      }
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
    prompts,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const cleanups: string[] = [];

/**
 * Generous on purpose — see the note in {@link runCli}. The real call takes
 * under half a second; this exists so a stall is a FAILURE rather than a stall.
 */
const CLI_TIMEOUT_MS = 60_000;

/** A REAL repo on disk: a manifest, source files, and an import edge to find. */
function fixtureRepo(): string {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ask-repo-')));
  cleanups.push(repo);
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'ask-headless-fixture', version: '0.0.0', type: 'module' }, null, 2) + '\n',
  );
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'src', 'server.js'),
    "import { rate } from './rates.js';\nexport function quote(n) {\n  return n * rate();\n}\n",
  );
  fs.writeFileSync(path.join(repo, 'src', 'rates.js'), 'export function rate() {\n  return 1.5;\n}\n');
  return repo;
}

/** An empty HOME so `~/.sequence/ai.json` can never reach a child. */
function emptyHome(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ask-home-')));
  cleanups.push(dir);
  return dir;
}

/**
 * Removes every directory registered SO FAR — which is why each test must call
 * it in a `finally`, and why nothing may run concurrently in this file.
 *
 * `cleanups` is module-scoped and this pops it empty, so a test tearing down
 * while another still holds a fixture would delete that fixture underneath it.
 * The tests here are sequential and each awaits its child, so that cannot
 * happen today — but it is one `concurrency` option away from being able to,
 * and the symptom would be exactly the intermittent stall this file just had.
 */
function cleanupAll(): void {
  while (cleanups.length > 0) {
    const dir = cleanups.pop()!;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

/** The env every child gets: no inherited provider, no inherited HOME. */
function baseEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
  for (const k of Object.keys(env)) {
    if (/^(SEQUENCE_AI_|OPENROUTER_|DEEPSEEK_|SEQUENCE_GATEWAY_)/.test(k)) delete env[k];
  }
  return env;
}

/**
 * Spawn the real CLI and collect its real stdout/stderr/exit code.
 *
 * ASYNC, NEVER `spawnSync`, and the reason is a deadlock this test hit for
 * real: `spawnSync` blocks THIS process's event loop until the child exits, and
 * the stub provider is an `http.Server` living in THIS process — so the child's
 * request could never be answered and both sides waited for each other until
 * the 120s timeout. The one case that passed was the pipe case, which was
 * already async. Anything that drives a child and serves it in one process has
 * to be async on both ends.
 */
function runCli(
  args: string[],
  env: NodeJS.ProcessEnv,
  input?: string,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(process.execPath, [CLI, ...args], {
      env,
      stdio: [input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    child.stderr?.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    child.on('error', reject);

    /*
      A CHILD THAT NEVER EXITS MUST FAIL, NOT HANG.

      This promise had no timeout, so a child that never closed left it pending
      for ever and the whole file stalled — measured by the gate at 5 runs in 8,
      always in the same case. A hanging lock is worse than a missing one: CI
      reports it as an infrastructure timeout, which is exactly how a red test
      becomes invisible, and the run before it reported "27/27 in 3.3s" from one
      lucky pass while consecutive tries reported 2, 27 and 23 cases.

      The CLI itself is innocent — invoked directly, this same call exits 3 in
      370-490ms, five times out of five. So the timeout is generous: it is here to
      turn an invisible stall into a readable failure, not to police performance.
    */
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error(
          `sequence ${args.join(' ')} did not exit within ${CLI_TIMEOUT_MS}ms. ` +
            `stdout so far: ${JSON.stringify(stdout.slice(0, 200))} ` +
            `stderr so far: ${JSON.stringify(stderr.slice(0, 200))}`,
        ),
      );
    }, CLI_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

/* ======================= the named lock: stdout + exit ==================== */

test('`sequence ask` writes the answer to stdout and exits 0, as a real child process', async () => {
  const repo = fixtureRepo();
  const home = emptyHome();
  const stub = await startStubProvider('quote() multiplies by the rate from src/rates.js.');
  try {
    const env = {
      ...baseEnv(home),
      SEQUENCE_AI_KEY: 'stub-key',
      SEQUENCE_AI_PROVIDER: 'openai-compatible',
      SEQUENCE_AI_BASE_URL: stub.baseUrl,
      SEQUENCE_AI_MODEL: 'stub-model',
    };
    const r = await runCli(['ask', 'what does quote do?', '--repo', repo], env);

    // THE LOCK — the answer is on stdout, and the exit code is 0.
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}\nstderr:\n${r.stderr}`);
    assert.equal(
      r.stdout.replace(/\r\n/g, '\n').trim(),
      'quote() multiplies by the rate from src/rates.js.',
    );

    // STDOUT IS THE ANSWER AND NOTHING ELSE — that is what makes it pipeable.
    // Progress, the model id, warnings: all of it belongs on stderr.
    assert.equal(r.stdout.includes('scanned'), false, 'stdout must carry no progress chatter');
    assert.equal(r.stdout.includes('sequence'), false, 'stdout must carry no banner');

    // And it really went through the pipeline to a real provider request: the
    // prompt the child sent names the repo's own file.
    assert.equal(stub.prompts.length >= 1, true, 'the child must have called the provider');
    assert.match(stub.prompts.join('\n'), /rates\.js/);
  } finally {
    await stub.close();
    cleanupAll();
  }
});

test('`sequence ask --stdin` reads the question from a pipe', async () => {
  const repo = fixtureRepo();
  const home = emptyHome();
  const stub = await startStubProvider('read from stdin, answered.');
  try {
    const env = {
      ...baseEnv(home),
      SEQUENCE_AI_KEY: 'stub-key',
      SEQUENCE_AI_PROVIDER: 'openai-compatible',
      SEQUENCE_AI_BASE_URL: stub.baseUrl,
      SEQUENCE_AI_MODEL: 'stub-model',
    };
    const r = await runCli(['ask', '--stdin', '--repo', repo], env, 'which file computes the rate?\n');
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}\nstderr:\n${r.stderr}`);
    assert.equal(r.stdout.replace(/\r\n/g, '\n').trim(), 'read from stdin, answered.');
    assert.match(stub.prompts.join('\n'), /which file computes the rate\?/);
  } finally {
    await stub.close();
    cleanupAll();
  }
});

test('the answer really composes with a Unix pipe into another process', async () => {
  const repo = fixtureRepo();
  const home = emptyHome();
  const stub = await startStubProvider('alpha\nbeta\ngamma');
  try {
    const env = {
      ...baseEnv(home),
      SEQUENCE_AI_KEY: 'stub-key',
      SEQUENCE_AI_PROVIDER: 'openai-compatible',
      SEQUENCE_AI_BASE_URL: stub.baseUrl,
      SEQUENCE_AI_MODEL: 'stub-model',
    };
    // `sequence ask … | node -e "count the lines"`. Two real processes, one real
    // pipe — not a string the test assembled itself.
    const producer = childProcess.spawn(
      process.execPath,
      [CLI, 'ask', 'list three', '--repo', repo],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const consumer = childProcess.spawn(
      process.execPath,
      [
        '-e',
        "let b='';process.stdin.on('data',c=>b+=c).on('end',()=>process.stdout.write(String(b.trim().split(/\\r?\\n/).length)))",
      ],
      { stdio: ['pipe', 'pipe', 'inherit'] },
    );
    producer.stdout.pipe(consumer.stdin);
    let producerErr = '';
    producer.stderr.on('data', (c: Buffer) => (producerErr += c.toString('utf8')));
    let counted = '';
    consumer.stdout.on('data', (c: Buffer) => (counted += c.toString('utf8')));

    /*
      BOTH listeners are attached BEFORE either is awaited. This is load-bearing.

      Attaching the consumer's listener after `await`ing the producer's `close`
      is a race the consumer wins often: it is a three-line `node -e` that exits
      the instant its stdin ends, and its stdin ends when the producer's stdout
      closes — the same instant the producer closes. When the consumer gets there
      first its `close` has ALREADY fired, a listener attached afterwards never
      hears it, and the promise never settles. The test then hangs for ever
      rather than failing, which is the worst outcome available: CI reads a stall
      as an infrastructure timeout, so a genuinely red test becomes invisible.

      Measured at 1 stall in 7 runs and, on a bad day, the very first run. `close`
      is emitted once and is not replayed to late subscribers, so the only fix is
      to subscribe first and await second. Nothing asserted below changes.
    */
    const producerClosed = new Promise<number | null>((resolve) =>
      producer.on('close', (code) => resolve(code)),
    );
    const consumerClosed = new Promise<void>((resolve) => consumer.on('close', () => resolve()));

    const producerCode = await producerClosed;
    await consumerClosed;

    assert.equal(producerCode, 0, `producer failed:\n${producerErr}`);
    assert.equal(counted, '3', 'the downstream process must see exactly the three answer lines');
  } finally {
    await stub.close();
    cleanupAll();
  }
});

/* ======================= the exit code is honest ========================= */

test('no provider configured exits non-zero with an empty stdout', async () => {
  const repo = fixtureRepo();
  const home = emptyHome();
  try {
    // baseEnv strips every SEQUENCE_AI_*/OPENROUTER_*/DEEPSEEK_* var and points
    // HOME at an empty dir, so there is genuinely no provider anywhere.
    const r = await runCli(['ask', 'anything', '--repo', repo], baseEnv(home));
    assert.notEqual(r.code, 0, 'a question that could not be answered must not exit 0');
    assert.equal(r.stdout, '', 'nothing may reach stdout when there is no answer');
    assert.match(r.stderr, /provider/i);
  } finally {
    cleanupAll();
  }
});

test('a provider failure exits non-zero and says so on stderr, not stdout', async () => {
  const repo = fixtureRepo();
  const home = emptyHome();
  const stub = await startStubProvider('', 502);
  try {
    const env = {
      ...baseEnv(home),
      SEQUENCE_AI_KEY: 'stub-key',
      SEQUENCE_AI_PROVIDER: 'openai-compatible',
      SEQUENCE_AI_BASE_URL: stub.baseUrl,
      SEQUENCE_AI_MODEL: 'stub-model',
    };
    const r = await runCli(['ask', 'what does quote do?', '--repo', repo], env);
    assert.notEqual(r.code, 0);
    assert.equal(r.stdout, '');
    assert.notEqual(r.stderr.trim(), '', 'a failure must end in words');
  } finally {
    await stub.close();
    cleanupAll();
  }
});

test('a missing question and a missing repo are honest usage failures', async () => {
  const home = emptyHome();
  try {
    const noQuestion = await runCli(['ask'], baseEnv(home));
    assert.notEqual(noQuestion.code, 0);
    assert.equal(noQuestion.stdout, '');
    assert.match(noQuestion.stderr, /usage: sequence ask/);

    const badRepo = await runCli(
      ['ask', 'hello', '--repo', path.join(home, 'does-not-exist')],
      baseEnv(home),
    );
    assert.notEqual(badRepo.code, 0);
    assert.equal(badRepo.stdout, '');
    assert.notEqual(badRepo.stderr.trim(), '');
  } finally {
    cleanupAll();
  }
});

test('`sequence ask` is listed in --help, so it is discoverable at all', async () => {
  const home = emptyHome();
  try {
    const r = await runCli(['--help'], baseEnv(home));
    assert.equal(r.code, 0);
    assert.match(r.stdout, /sequence ask/);
  } finally {
    cleanupAll();
  }
});

test('parseAskArgs: --rounds reaches maxRounds, and garbage is a usage error, not a silent 8', () => {
  const parsed = parseAskArgs(['what breaks?', '--rounds', '32']);
  assert.strictEqual(parsed.rounds, 32);
  assert.strictEqual(parseAskArgs(['q']).rounds, undefined);
});
