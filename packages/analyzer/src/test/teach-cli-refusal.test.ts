import assert from 'node:assert';
import { test } from 'node:test';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `--teach` ON THE CLI IS NOT A TEACH TURN — the reported shape, headless.
 *
 * `docs/research/teach-mode-driven-end-to-end.md` §3: "Only `repoServer.ts`
 * calls `beginTeachTurn` (two sites). The CLI passes `teach: true` into the
 * pipeline and nothing else — no thread resolution, no lesson, no refusal. So
 * the fix in §1 helps the app and does nothing for the CLI, and a headless demo
 * still gets the repo answer."
 *
 * §1 is the owner's own sentence: "I want to learn about machine learning"
 * against a repository containing no such thing produced a REPO GREP — confident
 * prose about whatever the digest happened to contain. The server refuses that
 * ask before any provider call (`beginTeachTurn().refusal()`, returned as
 * `{ text, source: 'lesson' }`). The CLI did not.
 *
 * THE HARNESS IS `ask-headless-cli.test.ts`'s, deliberately: a real child
 * process, a real scan of a real repo, and a real HTTP provider that RECORDS
 * every prompt it is sent. That last part is what makes the assertion here
 * non-vacuous — the refusal is supposed to arrive INSTEAD of a model call, so
 * the test proves the provider was never asked, rather than proving only that
 * some text appeared.
 *
 * WHY THE CLI CAN HAVE THIS AT ALL, given it has no session store: `refusal()`
 * is computed from the ASK and the GRAPH and nothing else — deliberately, per
 * the comment on it, because tying it to a resolved thread once shipped a hole.
 * So the CLI needs no thread, no `sessionsRoot` and no lesson file to get it,
 * and it must CALL the shared assembly rather than re-derive the rule, or this
 * is a rule in two handlers again.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'cli.js');
const CLI_TIMEOUT_MS = 60_000;
const cleanups: string[] = [];

interface StubProvider {
  baseUrl: string;
  prompts: string[];
  close: () => Promise<void>;
}

async function startStubProvider(reply: string): Promise<StubProvider> {
  const prompts: string[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      prompts.push(raw);
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

/** A REAL repo with nothing resembling machine learning in it. */
function fixtureRepo(): string {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-teach-repo-')));
  cleanups.push(repo);
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'teach-cli-fixture', version: '0.0.0', type: 'module' }, null, 2) + '\n',
  );
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'src', 'server.js'),
    "import { rate } from './rates.js';\nexport function quote(n) {\n  return n * rate();\n}\n",
  );
  fs.writeFileSync(path.join(repo, 'src', 'rates.js'), 'export function rate() {\n  return 1.5;\n}\n');
  return repo;
}

function emptyHome(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-teach-home-')));
  cleanups.push(dir);
  return dir;
}

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

function baseEnv(home: string, baseUrl: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
  for (const k of Object.keys(env)) {
    if (/^(SEQUENCE_AI_|OPENROUTER_|DEEPSEEK_|SEQUENCE_GATEWAY_)/.test(k)) delete env[k];
  }
  /* Names copied from `ask-headless-cli.test.ts`: the key is SEQUENCE_AI_KEY,
     and the base URL carries no `/v1` suffix — the provider appends it. */
  env.SEQUENCE_AI_KEY = 'stub-key';
  env.SEQUENCE_AI_PROVIDER = 'openai-compatible';
  env.SEQUENCE_AI_BASE_URL = baseUrl;
  env.SEQUENCE_AI_MODEL = 'stub-model';
  return env;
}

/* ASYNC, NEVER spawnSync: the stub provider is an http.Server in THIS process,
   so a blocking child wait deadlocks both sides. */
function runCli(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(process.execPath, [CLI, ...args], { env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`CLI timed out after ${CLI_TIMEOUT_MS}ms`));
    }, CLI_TIMEOUT_MS);
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

test('THE REPORTED SHAPE: `ask --teach` with no subject in the repo REFUSES, and never calls the model', async () => {
  const stub = await startStubProvider('The repository contains a quote function and a rate module.');
  const repo = fixtureRepo();
  const home = emptyHome();
  try {
    const r = await runCli(
      ['ask', '--repo', repo, '--teach', 'I want to learn about machine learning'],
      baseEnv(home, stub.baseUrl),
    );
    assert.match(
      r.stdout,
      /could not find a subject for this lesson in the scanned repository/,
      `the CLI must refuse, not paraphrase the digest.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    );
    /*
     * THE HALF THAT MAKES IT A REFUSAL RATHER THAN A STRING. The server refuses
     * BEFORE the provider call, on purpose: "a refusal that cost a model call
     * would be a worse answer that also spent money."
     */
    assert.strictEqual(
      stub.prompts.length,
      0,
      `a refusal must cost no model call; the child sent ${stub.prompts.length}`,
    );
    assert.strictEqual(r.code, 0, 'a refusal is a valid answer, not a failure');
  } finally {
    await stub.close();
    cleanupAll();
  }
});

test('NON-VACUITY: the same CLI, same repo, WITHOUT --teach still calls the model', async () => {
  /*
   * Without this the test above passes if the CLI is simply broken. Same
   * fixture, same provider, same ask — only the flag differs, which is the one
   * thing under test.
   */
  const stub = await startStubProvider('The repository contains a quote function and a rate module.');
  const repo = fixtureRepo();
  const home = emptyHome();
  try {
    const r = await runCli(
      ['ask', '--repo', repo, 'I want to learn about machine learning'],
      baseEnv(home, stub.baseUrl),
    );
    assert.ok(
      stub.prompts.length > 0,
      `the non-teach path must still reach the provider (exit ${r.code}): ${r.stderr}`,
    );
    assert.doesNotMatch(
      r.stdout,
      /could not find a subject for this lesson/,
      'the refusal must not leak onto a plain ask',
    );
  } finally {
    await stub.close();
    cleanupAll();
  }
});

test('a teach ask that DOES name a file in the repo is not refused', async () => {
  /*
   * THE FALSE POSITIVE THIS COULD CAUSE. `subjectlessRefusal` is gated on an
   * empty queue as well as on the ask being a lesson request; a teach ask that
   * names a real file must go on to a real lesson, and therefore to the model.
   */
  const stub = await startStubProvider('rates.js exports rate(), which server.js calls. Follow me?');
  const repo = fixtureRepo();
  const home = emptyHome();
  try {
    const r = await runCli(
      ['ask', '--repo', repo, '--teach', 'teach me rates.js'],
      baseEnv(home, stub.baseUrl),
    );
    assert.doesNotMatch(
      r.stdout,
      /could not find a subject for this lesson/,
      `a named file is a subject: ${r.stdout}`,
    );
    assert.ok(stub.prompts.length > 0, 'a real lesson still reaches the provider');
  } finally {
    await stub.close();
    cleanupAll();
  }
});

test('the CLI CALLS the shared assembly rather than restating the rule', async () => {
  /* A rule in two handlers is one rule until measured. */
  const src = fs.readFileSync(path.resolve(here, '..', '..', 'src', 'askCli.ts'), 'utf8');
  assert.match(src, /beginTeachTurn/, 'the CLI must call beginTeachTurn');
  assert.doesNotMatch(
    src,
    /subjectlessRefusal\s*\(/,
    'the CLI must not re-derive the refusal; that is the second copy this file exists to prevent',
  );
});
