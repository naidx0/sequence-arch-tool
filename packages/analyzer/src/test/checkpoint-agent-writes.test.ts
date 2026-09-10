import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRepoServer } from '../server/repoServer.js';
import { setRepoTrust } from '../server/repoTrust.js';
import { userStoreDir } from '../server/store.js';
import {
  applyRestore,
  listCheckpoints,
  listTrackedFiles,
  planRestore,
} from '../server/checkpointStore.js';
import { startMockProvider } from './mock-provider.js';

/**
 * P10 / AUDIT GAP G1 — THE AGENT'S OWN WRITES WERE INVISIBLE TO REWIND.
 *
 * `writeSession.ts` told this story once already: the checkpoint store was
 * complete, tested and reachable, and never ran because the client never sent
 * a session id. Fixing that covered PUT /api/file. It did NOT cover the two
 * modes where the agent writes on its own — `autoEdit` and `full` — because
 * `trackSessionWrite` had exactly one production caller, and it was not the
 * ask route. So the turns most worth undoing (the ones the user did not
 * approve file by file) left no restore point, under Rewind copy promising one.
 *
 * The shape here is the reported one, not a convenient one: a Full-permission
 * ask over the STREAMING route (the one the product posts to), a provider
 * answer that edits TWO files, and then the store is asked what it knows.
 * The final assertion reads the FILES ON DISK after a restore, the same law
 * `checkpoint-rewind.test.ts` set — a store that updated its bookkeeping and
 * never touched the tree cannot pass it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');
const TEST_KEY = 'sk-ant-test-CHECKPOINT-G1';

const cleanups: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
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

/** The two files the turn will edit, with content THIS test controls. */
const BACKEND = 'backend/app/main.py';
const FRONTEND = 'frontend/index.tsx';
const BACKEND_BEFORE = 'def list_notes():\n    return []\n';
const FRONTEND_BEFORE = 'export function loadNotes() {\n  return fetch("/notes");\n}\n';

/**
 * A plainapp copy whose two target files hold LF content of known shape. The
 * checked-out fixture arrives CRLF on Windows (core.autocrlf), and a prose
 * diff's context lines must match the file exactly — so the test writes the
 * "before" state itself rather than depending on the checkout's line endings.
 */
function plainappRepo(): string {
  const dir = tempDir('seq-cp-agent-');
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  fs.writeFileSync(path.join(repo, BACKEND), BACKEND_BEFORE);
  fs.writeFileSync(path.join(repo, FRONTEND), FRONTEND_BEFORE);
  /* TRUSTED: this fixture is written to and then verified with a real
     done-when command run, and every spawn is refused under an untrusted
     repository (`server/repoTrust.ts`, locked in `repo-trust.test.ts`). */
  setRepoTrust(userStoreDir(), fs.realpathSync(repo), true);
  return repo;
}

/**
 * The answer a diff-literate model gives under Full: no tool call, the whole
 * edit as unified diffs in prose. The pipeline's prose-diff salvage applies it
 * through `applyProposedFiles` — the exact write path G1 names.
 */
const TWO_FILE_DIFF = [
  'Both sides of the notes route need the change. Fix:',
  '```diff',
  `--- a/${BACKEND}`,
  `+++ b/${BACKEND}`,
  '@@ -1,2 +1,2 @@',
  ' def list_notes():',
  '-    return []',
  '+    return [{"id": 1}]',
  '```',
  '```diff',
  `--- a/${FRONTEND}`,
  `+++ b/${FRONTEND}`,
  '@@ -1,3 +1,3 @@',
  ' export function loadNotes() {',
  '-  return fetch("/notes");',
  '+  return fetch("/api/notes");',
  ' }',
  '```',
].join('\n');

async function startServer(repo: string): Promise<{ base: string; close: () => Promise<void> }> {
  const userDir = tempDir('seq-cp-agent-user-');
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir: userDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** One Full-permission turn over the streaming route, answered by the mock. */
async function runFullTurn(repo: string, body: Record<string, unknown>): Promise<string> {
  const mock = await startMockProvider(() => ({ text: TWO_FILE_DIFF }));
  const { base, close } = await startServer(repo);
  try {
    const cfg = await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', baseUrl: mock.baseUrl, model: 'claude-test', apiKey: TEST_KEY }),
    });
    assert.equal(cfg.status, 200, `ai-config: ${await cfg.text()}`);
    const res = await fetch(`${base}/api/ask/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'Fix the notes route on both sides',
        permission: 'full',
        ...body,
      }),
    });
    const text = await res.text();
    assert.equal(res.status, 200, `ask/stream: ${text}`);
    return text;
  } finally {
    await close();
    await mock.close();
  }
}

function onDisk(repo: string, rel: string): string {
  return fs.readFileSync(path.join(repo, rel), 'utf8');
}

/**
 * The same Full turn over the BUFFERED route. Returns the HTTP status and the
 * JSON payload (or the error text), so a test can assert a 400 as well as an
 * answer.
 */
async function runFullTurnBuffered(
  repo: string,
  body: Record<string, unknown>,
): Promise<{ status: number; text: string; json?: Record<string, unknown> }> {
  const mock = await startMockProvider(() => ({ text: TWO_FILE_DIFF }));
  const { base, close } = await startServer(repo);
  try {
    const cfg = await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', baseUrl: mock.baseUrl, model: 'claude-test', apiKey: TEST_KEY }),
    });
    assert.equal(cfg.status, 200, `ai-config: ${await cfg.text()}`);
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Fix the notes route on both sides', permission: 'full', ...body }),
    });
    const text = await res.text();
    let json: Record<string, unknown> | undefined;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = undefined;
    }
    return { status: res.status, text, json };
  } finally {
    await close();
    await mock.close();
  }
}

/** A streaming turn whose response status is returned too — for the 400 cases. */
async function postStream(repo: string, body: Record<string, unknown>): Promise<{ status: number; text: string }> {
  const mock = await startMockProvider(() => ({ text: TWO_FILE_DIFF }));
  const { base, close } = await startServer(repo);
  try {
    await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', baseUrl: mock.baseUrl, model: 'claude-test', apiKey: TEST_KEY }),
    });
    const res = await fetch(`${base}/api/ask/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Fix the notes route on both sides', permission: 'full', ...body }),
    });
    return { status: res.status, text: await res.text() };
  } finally {
    await close();
    await mock.close();
  }
}

/** A done-when command the gate accepts (`node` is a known runner) with a known exit. */
function writeExitScript(repo: string, name: string, code: number): void {
  fs.writeFileSync(path.join(repo, name), `process.exit(${code});\n`);
}

test('a Full-permission turn that writes two files leaves a restore point to the PRE-turn tree', async () => {
  const repo = plainappRepo();
  const session = 'session-g1-0001';
  try {
    const stream = await runFullTurn(repo, { sessionId: session });

    // The turn really wrote — otherwise the assertions below would pass
    // vacuously against an empty store.
    assert.ok(stream.includes('"edit:proposal"'), `the salvage surfaced as an edit:proposal, got: ${stream.slice(0, 600)}`);
    assert.ok(onDisk(repo, BACKEND).includes('[{"id": 1}]'), 'backend edit landed on disk');
    assert.ok(onDisk(repo, FRONTEND).includes('/api/notes'), 'frontend edit landed on disk');

    // THE STORE KNOWS BOTH FILES, with the content they held BEFORE the turn.
    const tracked = listTrackedFiles(repo, session);
    assert.deepEqual(
      tracked.map((t) => t.path).sort(),
      [BACKEND, FRONTEND],
      `both agent writes are tracked, got: ${JSON.stringify(tracked.map((t) => t.path))}`,
    );
    for (const t of tracked) {
      assert.ok(t.baseline.blob, `${t.path} has a baseline blob (it existed before the turn)`);
    }

    // ONE checkpoint, taken before the first byte landed, labelled for the turn.
    const points = listCheckpoints(repo, session);
    assert.equal(points.length, 1, `exactly one checkpoint per turn, got ${points.length}`);
    assert.match(points[0]!.label ?? '', /Before the agent's first write this turn/);
    assert.deepEqual(
      points[0]!.files,
      [],
      'the point predates every write of this session, so it froze no file yet — the baselines carry the pre-turn state',
    );

    // A RESTORE TO THAT POINT PUTS THE PRE-TURN CONTENT BACK — planned, then done.
    const plan = planRestore(repo, session, points[0]!.seq, 'code');
    assert.equal(plan.ok, true, plan.error);
    assert.deepEqual(plan.writes.map((w) => w.path).sort(), [BACKEND, FRONTEND]);
    assert.deepEqual(plan.deletes, [], 'both files existed before the turn — nothing is deleted');

    const done = applyRestore(repo, plan);
    assert.equal(done.ok, true, done.error);
    assert.equal(onDisk(repo, BACKEND), BACKEND_BEFORE, 'backend is byte-for-byte its pre-turn self ON DISK');
    assert.equal(onDisk(repo, FRONTEND), FRONTEND_BEFORE, 'frontend is byte-for-byte its pre-turn self ON DISK');
  } finally {
    cleanupAll();
  }
});

test('a turn without a session id writes normally and tracks nothing — no refusal, no directory', async () => {
  const repo = plainappRepo();
  try {
    await runFullTurn(repo, {});
    assert.ok(onDisk(repo, BACKEND).includes('[{"id": 1}]'), 'the edit still lands: the ask is never refused for a missing id');
    assert.equal(
      fs.existsSync(path.join(repo, '.sequence', 'checkpoints')),
      false,
      'no checkpoint directory is created for a caller that sent no session',
    );
  } finally {
    cleanupAll();
  }
});

test('the BUFFERED /api/ask route tracks agent writes too — the same tracker, exercised', async () => {
  /*
   * REVIEW (tests): the non-streaming route was wired to the same tracker and
   * covered by nothing. The client posts to the stream, but the buffered route
   * is the CLI-shaped one and a tracker that only works on one of two doors is
   * the drift `ask-stream-parity.test.ts` exists to catch.
   */
  const repo = plainappRepo();
  const session = 'session-g1-0002';
  try {
    const r = await runFullTurnBuffered(repo, { sessionId: session });
    assert.equal(r.status, 200, r.text);
    assert.ok(onDisk(repo, BACKEND).includes('[{"id": 1}]'), 'the edit landed');
    assert.deepEqual(listTrackedFiles(repo, session).map((t) => t.path).sort(), [BACKEND, FRONTEND]);
    assert.equal(listCheckpoints(repo, session).length, 1, 'one restore point, taken before the first write');
  } finally {
    cleanupAll();
  }
});

test('done-when over HTTP: a skip with no reason is a 400 on BOTH routes, never a silent no-gate', async () => {
  /*
   * REVIEW (tests): G5's HTTP wiring — `parseAskDoneWhen` on both bodies —
   * had no test posting a `doneWhen`. The skip-reason law is the one rule the
   * parser enforces beyond shape, so it is the one to lock at the route.
   */
  const repo = plainappRepo();
  try {
    const buffered = await runFullTurnBuffered(repo, { doneWhen: { kind: 'skip' } });
    assert.equal(buffered.status, 400, buffered.text);
    assert.match(buffered.text, /requires a non-empty string \\?"reason\\?"/);
    const streamed = await postStream(repo, { doneWhen: { kind: 'skip', reason: '   ' } });
    assert.equal(streamed.status, 400, streamed.text);
    assert.match(streamed.text, /requires a non-empty string \\?"reason\\?"/);
    assert.equal(onDisk(repo, BACKEND), BACKEND_BEFORE, 'a refused body wrote nothing');
  } finally {
    cleanupAll();
  }
});

test('done-when over HTTP: the command runs after the writes and the answer ends with its verdict', async () => {
  /*
   * The gate from the route into the pipeline, end to end, on the reported
   * shape: a Full turn that writes two files, a done-when the gate accepts
   * (`node <script>` — a known runner, no metacharacters), one that exits 3 and
   * one that exits 0. The closing sentence is what a reader sees; the files
   * stay written either way — a failing gate NAMES, it does not revert.
   */
  const repo = plainappRepo();
  writeExitScript(repo, 'fail.js', 3);
  writeExitScript(repo, 'ok.js', 0);
  try {
    const failed = await runFullTurnBuffered(repo, { doneWhen: { kind: 'command', cmd: 'node fail.js' } });
    assert.equal(failed.status, 200, failed.text);
    const failedText = String(failed.json?.text ?? '');
    assert.match(failedText, /Done-when 'node fail\.js' FAILED \(exit 3\)/, failedText.slice(-300));
    assert.match(failedText, /left in place, not reverted/);
    assert.doesNotMatch(failedText, /rewind to the turn's checkpoint/, 'no promise of a checkpoint that was never taken');
    assert.ok(onDisk(repo, BACKEND).includes('[{"id": 1}]'), 'the failing gate did not revert the edit');

    const repo2 = plainappRepo();
    writeExitScript(repo2, 'ok.js', 0);
    const passed = await postStream(repo2, { doneWhen: { kind: 'command', cmd: 'node ok.js' } });
    assert.equal(passed.status, 200);
    assert.match(passed.text, /Done-when 'node ok\.js' passed after writing 2 files/);
    assert.ok(passed.text.includes('"command:log"'), 'the run surfaced as a command:log event');
  } finally {
    cleanupAll();
  }
});

test('a session id that fails the contract is ignored, and the ask still answers', async () => {
  const repo = plainappRepo();
  try {
    await runFullTurn(repo, { sessionId: '../escape' });
    assert.ok(onDisk(repo, BACKEND).includes('[{"id": 1}]'), 'the edit still lands');
    assert.equal(fs.existsSync(path.join(repo, '.sequence', 'checkpoints')), false, 'nothing was filed under a hostile id');
  } finally {
    cleanupAll();
  }
});
