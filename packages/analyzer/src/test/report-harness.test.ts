/**
 * THE MODEL REPORTS ON ITS HARNESS, AND CANNOT TOUCH IT.
 *
 * Owner walk, 2026-09-21: "it should also add a card or like a tool which lets
 * the model change the environment it's in. So if it's a flaw in the
 * environment it's in, it could actually write, or hand back advice to us so we
 * can fix ... it's kind of like an RL environment where the model ... decides
 * this is good, this is bad, or what can we change around the harness to
 * empower the model to do better."
 *
 * ── WHAT WAS BUILT IS THE SECOND HALF OF THAT SENTENCE ────────────────────
 *
 * He asked for a tool that CHANGES the environment. This one REPORTS on it,
 * and the gap is the point rather than a shortfall: a model that can edit its
 * own harness can widen any permission gating any other tool, from inside a
 * turn, with no person in the loop. The report is the part that can be given
 * to an unattended model safely, and acting on it stays a human act — which is
 * also the only arrangement in which the report means anything afterwards.
 *
 * These lock the three properties that make that true: it writes exactly one
 * place, it refuses a report with no remedy, and it never invents a file.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  ASK_TOOL_ALLOWLIST,
  ASK_TOOL_CACHEABLE,
  executeAskTool,
  HARNESS_REPORT_FILE,
} from '../server/askTools.js';

function freshRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-harness-'));
}

/** The minimum context the tool reads. */
function ctxFor(repoRoot: string) {
  return { repoRoot } as unknown as Parameters<typeof executeAskTool>[2];
}

function reportsIn(repoRoot: string): Record<string, unknown>[] {
  const file = path.join(repoRoot, '.sequence', HARNESS_REPORT_FILE);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

test('a report is one line in one file, and nothing else moves', async () => {
  const repo = freshRepo();
  /* A witness: any write outside the log is a failure of the whole premise. */
  fs.writeFileSync(path.join(repo, 'untouched.txt'), 'original');

  const result = await executeAskTool(
    'report_harness',
    {
      blocked: 'I could not read past 12,000 bytes of a 40,000-byte file.',
      needed: 'An offset argument on read_file, or a larger cap for one call.',
      tool: 'read_file',
      severity: 'friction',
    },
    ctxFor(repo),
  );

  assert.strictEqual(result.ok, true, result.evidence);

  const rows = reportsIn(repo);
  assert.strictEqual(rows.length, 1, 'exactly one line');
  assert.match(String(rows[0].blocked), /12,000 bytes/);
  assert.match(String(rows[0].needed), /offset argument/);
  assert.strictEqual(rows[0].tool, 'read_file');
  assert.strictEqual(rows[0].severity, 'friction');
  assert.match(String(rows[0].at), /^\d{4}-\d{2}-\d{2}T/, 'stamped, so a reader can order them');

  assert.strictEqual(
    fs.readFileSync(path.join(repo, 'untouched.txt'), 'utf8'),
    'original',
    'a report changes nothing but the log',
  );

  /*
   * AND THE CARD SAYS SO. The reader of a transcript sees the evidence line;
   * one that read like an action would teach them the harness had been
   * altered on the model's say-so.
   */
  assert.match(result.evidence, /harness report filed/);
});

test('reports accumulate rather than replacing each other', async () => {
  const repo = freshRepo();
  for (const n of [1, 2, 3]) {
    await executeAskTool(
      'report_harness',
      { blocked: `thing ${n}`, needed: `fix ${n}` },
      ctxFor(repo),
    );
  }

  /* Append-only: a log that overwrote would lose the pattern, and a pattern
     across turns is the only thing that distinguishes a real harness fault
     from one bad turn. */
  const rows = reportsIn(repo);
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(
    rows.map((r) => r.blocked),
    ['thing 1', 'thing 2', 'thing 3'],
  );
});

test('a complaint with no remedy is refused, and writes nothing', async () => {
  const repo = freshRepo();

  for (const args of [
    { blocked: 'the search tool is bad' },
    { needed: 'a better search tool' },
    { blocked: '   ', needed: 'something' },
    {},
  ]) {
    const result = await executeAskTool('report_harness', args, ctxFor(repo));
    assert.strictEqual(result.ok, false, `${JSON.stringify(args)} should be refused`);
    assert.match(result.evidence, /needs both/);
  }

  /*
   * A LOG OF COMPLAINTS IS A MOOD. The pairing is what turns this into a work
   * list, so a half-report is not written at all rather than written and
   * ignored later — a file of unactionable rows is how a log stops being read.
   */
  assert.deepStrictEqual(reportsIn(repo), [], 'nothing half-written');
});

test('with no repository attached it refuses instead of choosing a folder', async () => {
  const result = await executeAskTool(
    'report_harness',
    { blocked: 'x', needed: 'y' },
    { repoRoot: undefined } as unknown as Parameters<typeof executeAskTool>[2],
  );

  /* Every other tool in design mode is refused for the same reason: a tool
     that picks its own destination when it was given none writes somewhere
     nobody will look. */
  assert.strictEqual(result.ok, false);
  assert.match(result.evidence, /attached repository/);
});

test('it is on the belt and is not cacheable, because it writes', async () => {
  assert.ok(ASK_TOOL_ALLOWLIST.includes('report_harness'), 'the model can reach it');

  /*
   * THE CACHE SERVES A REPEATED CALL FROM THE FIRST ANSWER. That is right for
   * a read and wrong for this: two identical reports in one turn are two
   * facts about how often the harness got in the way, and a cache would
   * silently record one of them.
   */
  assert.ok(
    !ASK_TOOL_CACHEABLE.includes('report_harness'),
    'a tool that appends must not be served from a per-turn cache',
  );
});
