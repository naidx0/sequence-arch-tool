import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runProgramFile } from '../programRun.js';

/**
 * A HEADLESS RUN THAT CAN BE PIPED.
 *
 * CANON names `claude -p` and Unix composition as the shape to match, and the
 * pipe half is genuinely shipped — `sequence ask --json` works. A program run
 * emitted `  [node] done`, which is a sentence for a human and nothing a script
 * can read, so the ONE command that runs a whole workflow was the one that
 * could not be composed with anything.
 */

function programFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-prog-'));
  const file = path.join(dir, 'p.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      id: 'p1',
      name: 'two commands',
      nodes: [
        { id: 's', title: 'start', kind: 'start' },
        { id: 'a', title: 'say hello', kind: 'command', command: { command: 'echo hello' } },
        { id: 'e', title: 'end', kind: 'end' },
      ],
      edges: [
        { id: '1', from: 's', to: 'a', kind: 'seq' },
        { id: '2', from: 'a', to: 'e', kind: 'seq' },
      ],
    }),
  );
  return file;
}

async function runJson(): Promise<Record<string, unknown>[]> {
  const lines: string[] = [];
  await runProgramFile(programFile(), { json: true, log: (l) => lines.push(l) });
  return lines.filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
}

test('EVERY LINE IS VALID JSON', async () => {
  /* The whole point. One unparseable line makes the stream unusable to the
     consumer it exists for. */
  const events = await runJson();
  assert.ok(events.length > 0);
  for (const e of events) assert.strictEqual(typeof e.type, 'string');
});

test('the FIRST line states the denominator', async () => {
  /*
   * The same thing `run:started` does on the server's stream: a consumer can
   * show progress from the first line rather than discovering the total as it
   * goes.
   */
  const events = await runJson();
  assert.strictEqual(events[0]!.type, 'start');
  assert.ok(Array.isArray(events[0]!.nodeIds));
  assert.strictEqual(events[0]!.programName, 'two commands');
});

test('the LAST line is terminal, and carries the exit code', async () => {
  /* A stream that simply stopped would leave a reader unable to tell
     "finished" from "the pipe broke". */
  const events = await runJson();
  const last = events[events.length - 1]!;
  assert.strictEqual(last.type, 'result');
  assert.strictEqual(typeof last.exitCode, 'number');
  assert.strictEqual(typeof last.status, 'string');
});

test('node lines carry the TITLE as well as the id', async () => {
  /* A consumer should not have to load the program file to render a line. */
  const events = await runJson();
  const node = events.find((e) => e.type === 'node');
  assert.ok(node, 'expected at least one node event');
  assert.strictEqual(typeof node.title, 'string');
  assert.strictEqual(typeof node.nodeId, 'string');
});

test('WITHOUT --json the output is still prose', async () => {
  /* The human path must not regress into machine output. */
  const lines: string[] = [];
  await runProgramFile(programFile(), { log: (l) => lines.push(l) });
  assert.ok(lines.some((l) => l.startsWith('running program:')));
  assert.ok(!lines.some((l) => l.trim().startsWith('{')));
});

test('EVEN A FAILURE IS JSON', async () => {
  /*
   * A consumer that receives prose on the one path it most needs to parse —
   * the failure — has to guess, and the guess it makes is usually "the stream
   * is empty". One unparseable line makes the whole stream unusable.
   */
  const lines: string[] = [];
  const outcome = await runProgramFile('does-not-exist.json', {
    json: true,
    log: (l) => lines.push(l),
  });

  assert.strictEqual(outcome.exitCode, 2);
  const events = lines.filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
  assert.strictEqual(events[0]!.type, 'error');
  assert.strictEqual(events[0]!.exitCode, 2);
});

test('an INVALID program reports every problem in one object', async () => {
  /* A consumer should not have to reassemble a list from N prose lines it has
     to recognise by indent. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-bad-'));
  const file = path.join(dir, 'bad.json');
  fs.writeFileSync(file, JSON.stringify({ id: 'p', nodes: 'not an array' }));

  const lines: string[] = [];
  await runProgramFile(file, { json: true, log: (l) => lines.push(l) });

  const event = JSON.parse(lines.filter((l) => l.trim() !== '')[0]!);
  assert.strictEqual(event.type, 'error');
  assert.ok(Array.isArray(event.problems) || typeof event.message === 'string');
});
