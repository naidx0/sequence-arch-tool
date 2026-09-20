import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { scanRepo } from '../scan.js';
import { buildDigest } from '../explain/explain.js';
import {
  runAskPipeline,
  type AskPipelineInput,
  type AskStreamEvent,
} from '../server/askPipeline.js';

/**
 * THE LIE DETECTOR, ON THE STREAM.
 *
 * `claim-check.test.ts` locks the checker on hand-built graphs. This is the
 * half the register row is actually about — "claim verification ON THE STREAM"
 * — because a checker the pipeline never calls catches nothing, which is the
 * lesson this repo has now paid for three times.
 *
 * The fixture reproduces the original incident as closely as a test can: a repo
 * whose only datastore is SQLite, and a model that says MySQL.
 */

/** A tiny Python service with a real sqlite3 call, like the repo that started this. */
function sqliteRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-claims-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'app'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'pyproject.toml'), '[project]\nname = "shop"\nversion = "0.1.0"\n');
  fs.writeFileSync(
    path.join(repo, 'app', 'db.py'),
    [
      'import sqlite3',
      '',
      'def connect():',
      '    conn = sqlite3.connect("shop.db")',
      '    conn.execute("SELECT id FROM orders")',
      '    return conn',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(repo, 'app', 'main.py'),
    ['from .db import connect', '', 'def run():', '    return connect()', ''].join('\n'),
  );
  return repo;
}

/** A provider that answers with whatever text the test wants, and no tools. */
function saying(text: string) {
  return async () => ({ text, toolRequests: [] }) as never;
}

async function ask(repo: string, answer: string): Promise<AskStreamEvent[]> {
  const graph = await scanRepo(repo, {});
  const input = {
    question: 'What does this store data in?',
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: undefined,
    designMode: false,
    askMode: 'research',
    graph,
    digest: buildDigest(graph),
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: (p: string) => path.resolve(repo, p),
    repoRoot: repo,
    callProvider: saying(answer),
  } as unknown as AskPipelineInput;

  const events: AskStreamEvent[] = [];
  await runAskPipeline(input, (e) => events.push(e));
  return events;
}

function resultOf(events: AskStreamEvent[]): Extract<AskStreamEvent, { type: 'result' }> {
  const r = events.find((e) => e.type === 'result');
  assert.ok(r, 'the stream ended in a result');
  return r as Extract<AskStreamEvent, { type: 'result' }>;
}

test('the original incident: an answer claiming MySQL is flagged on the stream', async () => {
  const repo = sqliteRepo();
  try {
    const events = await ask(
      repo,
      'The application stores its orders in MySQL databases behind a connection pool.',
    );
    const result = resultOf(events);

    assert.ok(result.claims, 'the result carries a claim report');
    const tech = result.claims!.unsupportedTechnologies;
    assert.strictEqual(tech.length, 1);
    assert.strictEqual(tech[0]!.term, 'mysql');
    /* And it hands over the correction rather than only the complaint. */
    assert.ok(tech[0]!.found.includes('sqlite'), `expected sqlite, got ${tech[0]!.found.join(',')}`);

    /*
     * THE ANSWER ITSELF IS UNTOUCHED. The report rides beside the text; it does
     * not edit it. A pipeline that rewrote a model's words on a heuristic's
     * say-so would make the transcript another thing nobody can trust.
     */
    assert.match(result.text, /MySQL/);
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('a truthful answer carries no claim report at all', async () => {
  const repo = sqliteRepo();
  try {
    const events = await ask(repo, 'It stores orders in SQLite, opened in app/db.py.');
    const result = resultOf(events);
    /* Absent, not empty: the field's presence is the signal, so an empty report
       on every clean answer would make it meaningless. */
    assert.strictEqual(result.claims, undefined);
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('a fabricated file citation is flagged on the stream', async () => {
  const repo = sqliteRepo();
  try {
    const events = await ask(repo, 'The pooling logic lives in app/pool/manager.py.');
    const result = resultOf(events);
    assert.ok(result.claims, 'a fabricated citation is a finding');
    assert.deepStrictEqual(
      result.claims!.unknownPaths.map((p) => p.path),
      ['app/pool/manager.py'],
    );
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('the report says which checks it was able to run', async () => {
  const repo = sqliteRepo();
  try {
    const events = await ask(repo, 'It uses MongoDB.');
    const result = resultOf(events);
    assert.ok(result.claims);
    /*
     * An empty finding list from a check that could not run is not a clean bill
     * of health, so the caller is told which ran. This repo has both a datastore
     * and files, so both are true here — and a consumer that renders "verified"
     * must read these rather than the length of the lists.
     */
    assert.strictEqual(result.claims!.checked.datastores, true);
    assert.strictEqual(result.claims!.checked.files, true);
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});
