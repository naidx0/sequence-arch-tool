import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runProgramFile } from '../programRun.js';
import { addAgent } from '../server/agentsStore.js';

/**
 * End-to-end lock for `sequence program run` (v16 Wave 2a) against the CONFORMANT
 * mock ACP agent shipped with @sequence/acp — a real subprocess round-trip over the
 * ACP wire protocol (no AI, deterministic). Asserts: a [start→acp→end] program runs
 * to completion with node status streamed and exit 0; an invalid program fails
 * loudly with a nonzero exit; and an acp node with no resolvable agent errors
 * honestly (never a fabricated done).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> dist -> analyzer -> packages -> <repo root>
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const MOCK_AGENT = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'mock-agent.mjs');

function tempStoreDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-progrun-')));
}

function writeProgram(dir: string, program: unknown): string {
  const file = path.join(dir, 'program.json');
  fs.writeFileSync(file, JSON.stringify(program));
  return file;
}

/** A minimal [start → acp → end] program that echoes a prompt via the mock agent. */
function echoProgram(): unknown {
  return {
    id: 'p-echo',
    name: 'echo program',
    nodes: [
      { id: 'start', title: 'start', kind: 'start' },
      { id: 'a', title: 'echo step', kind: 'agent', agent: { prompt: 'hello world', runtime: 'acp', outKey: 'reply' } },
      { id: 'end', title: 'end', kind: 'end' },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'a', kind: 'seq' },
      { id: 'e2', from: 'a', to: 'end', kind: 'seq' },
    ],
  };
}

test('program run: [start→acp→end] runs to completion, streams node status, exit 0', async () => {
  const dir = tempStoreDir();
  addAgent(dir, { id: 'mock', command: process.execPath, args: [MOCK_AGENT] });
  const file = writeProgram(dir, echoProgram());

  const lines: string[] = [];
  const outcome = await runProgramFile(file, {
    agentId: 'mock',
    storeDir: dir,
    log: (l) => lines.push(l),
  });

  assert.strictEqual(outcome.status, 'completed');
  assert.strictEqual(outcome.exitCode, 0);
  // Node status was streamed (queued → running → done for the acp node).
  const joined = lines.join('\n');
  assert.match(joined, /\[echo step\] queued/);
  assert.match(joined, /\[echo step\] running/);
  assert.match(joined, /\[echo step\] done/);
  assert.match(joined, /result: completed/);

  // The REAL turn result was written to state (honest stopReason + echoed text).
  const reply = outcome.result?.finalState.reply as { stopReason: string; text: string } | undefined;
  assert.ok(reply, 'the acp node wrote its result to outKey');
  assert.strictEqual(reply.stopReason, 'end_turn');
  assert.match(reply.text, /echo:/);
  assert.match(reply.text, /hello world/);
});

test('program run: an invalid program fails with an honest message and nonzero exit', async () => {
  const dir = tempStoreDir();
  // No `start` node ⇒ validateProgram rejects it.
  const file = writeProgram(dir, {
    id: 'bad',
    name: 'no start',
    nodes: [{ id: 'end', title: 'end', kind: 'end' }],
    edges: [],
  });

  const lines: string[] = [];
  const outcome = await runProgramFile(file, { storeDir: dir, log: (l) => lines.push(l) });
  assert.strictEqual(outcome.status, 'invalid');
  assert.notStrictEqual(outcome.exitCode, 0);
  assert.match(lines.join('\n'), /not a valid program/);
});

/** A [start → acp → end] program whose acp turn HANGs forever and ignores cancel. */
function hangProgram(): unknown {
  return {
    id: 'p-hang',
    name: 'hang program',
    nodes: [
      { id: 'start', title: 'start', kind: 'start' },
      { id: 'a', title: 'hang step', kind: 'agent', agent: { prompt: 'please HANG forever', runtime: 'acp', outKey: 'r' } },
      { id: 'end', title: 'end', kind: 'end' },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'a', kind: 'seq' },
      { id: 'e2', from: 'a', to: 'end', kind: 'seq' },
    ],
  };
}

// v16 Finding 5 — the CLI's SIGINT/abort path truly KILLS the spawned agent child
// (SIGTERM→SIGKILL via dispose in the finally), even for an uncooperative agent.
test('program run: an abort (Ctrl-C) kills the spawned agent subprocess (no orphan)', async () => {
  const dir = tempStoreDir();
  addAgent(dir, { id: 'mock', command: process.execPath, args: [MOCK_AGENT] });
  const file = writeProgram(dir, hangProgram());

  const ac = new AbortController();
  let child: childProcess.ChildProcess | undefined;
  const spawn = ((cmd: string, args: readonly string[], opts: object) => {
    child = childProcess.spawn(cmd, args as string[], opts);
    return child;
  }) as unknown as typeof childProcess.spawn;

  const running = runProgramFile(file, {
    agentId: 'mock',
    storeDir: dir,
    spawn,
    signal: ac.signal,
    log: () => {},
  });

  // Wait until the agent subprocess is actually spawned, then Ctrl-C.
  const deadline = Date.now() + 5000;
  while (!child && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  assert.ok(child, 'the agent subprocess spawned');
  await new Promise((r) => setTimeout(r, 50)); // let the hung turn get underway
  ac.abort();

  const outcome = await running;
  assert.strictEqual(outcome.status, 'stopped', 'an aborted run is honestly stopped');
  // The child was disposed (SIGTERM→SIGKILL) in the finally — it is dead, not orphaned.
  assert.ok(
    child!.exitCode !== null || child!.signalCode !== null,
    'the agent subprocess must be dead after the aborted run (no orphan)'
  );
});

test('program run: an acp node with no resolvable agent errors honestly (no fabricated done)', async () => {
  const dir = tempStoreDir(); // empty store, and no --agent given
  const file = writeProgram(dir, echoProgram());

  const lines: string[] = [];
  const outcome = await runProgramFile(file, { storeDir: dir, log: (l) => lines.push(l) });

  assert.strictEqual(outcome.status, 'failed');
  assert.notStrictEqual(outcome.exitCode, 0);
  const joined = lines.join('\n');
  assert.match(joined, /\[echo step\] error:/);
  assert.match(joined, /agent/i);
  // The node is NOT recorded as done.
  assert.strictEqual(outcome.result?.nodeResults.a.status, 'error');
});
