import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { ArchGraph } from '@sequence/schema';

/**
 * THE EXIT CODE, RUN AS A BUILD WOULD RUN IT.
 *
 * `policyScans.test.ts` locks the arithmetic. This spawns the actual CLI and
 * reads the actual number, because the register's gate is not "the verdict says
 * false" — it is "a PR adding a sync call into payment EXITS NON-ZERO with both
 * anchors", and an exit code nothing has ever produced is a contract on paper.
 *
 * Graphs are handed in as JSON rather than scanned, so the test is about the
 * contract and not about the scanner: a change to detection should not be able
 * to make this go red for an unrelated reason.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '..', '..', 'dist', 'cli.js');

function graph(edges: [string, string][]): ArchGraph {
  return {
    version: 1,
    mode: 'scan',
    scannedAt: '2026-08-22T00:00:00.000Z',
    repoRoot: '',
    repoName: 'shop',
    nodes: ['web', 'api', 'payment', 'jobs'].map((id) => ({ id, label: id, kind: 'service' })),
    edges: edges.map(([srcId, dstId], i) => ({
      id: `e${i}`,
      srcId,
      dstId,
      kind: 'http',
      confidence: 1,
      origin: 'deterministic',
    })),
    warnings: [],
  } as unknown as ArchGraph;
}

/** A workspace holding two graph files and a `.sequence/policies` directory. */
function workspace(before: ArchGraph, after: ArchGraph, policy: unknown, baseline?: unknown) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-policy-'));
  const dir = path.join(root, '.sequence', 'policies');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'payments.json'), JSON.stringify(policy, null, 2));

  const beforePath = path.join(root, 'before.json');
  const afterPath = path.join(root, 'after.json');
  /* `repoRoot` is how the CLI finds `.sequence/policies` for the AFTER graph —
     policies are read from the tree being judged. */
  fs.writeFileSync(beforePath, JSON.stringify({ ...before, repoRoot: root }));
  fs.writeFileSync(afterPath, JSON.stringify({ ...after, repoRoot: root }));

  let baselinePath: string | undefined;
  if (baseline) {
    baselinePath = path.join(root, 'policy-baseline.json');
    fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
  }
  return { root, beforePath, afterPath, baselinePath };
}

function runPolicy(beforePath: string, afterPath: string, baselinePath?: string) {
  const args = [CLI, 'policy', beforePath, afterPath];
  if (baselinePath) args.push('--baseline', baselinePath);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

const NO_SYNC_INTO_PAYMENT = {
  version: 1,
  name: 'payments',
  rules: [
    {
      kind: 'no-sync-into',
      target: 'payment',
      reason: 'payment is reached through the ledger, never called directly',
    },
  ],
};

test('a change that adds a sync call into payment exits 1, naming rule and edge', () => {
  const w = workspace(
    graph([['web', 'api']]),
    graph([
      ['web', 'api'],
      ['api', 'payment'],
    ]),
    NO_SYNC_INTO_PAYMENT,
  );
  try {
    const r = runPolicy(w.beforePath, w.afterPath);
    assert.strictEqual(r.code, 1, `expected exit 1; stderr: ${r.err}`);
    /* BOTH ANCHORS. A build log that says "policy violation" and nothing else
       sends someone to read the rules; naming the rule and the edge does not. */
    assert.match(r.err, /no-sync-into/i);
    assert.match(r.err, /payment/);
  } finally {
    fs.rmSync(w.root, { recursive: true, force: true });
  }
});

test('a change that adds nothing forbidden exits 0', () => {
  const w = workspace(
    graph([['web', 'api']]),
    graph([
      ['web', 'api'],
      ['web', 'jobs'],
    ]),
    NO_SYNC_INTO_PAYMENT,
  );
  try {
    const r = runPolicy(w.beforePath, w.afterPath);
    assert.strictEqual(r.code, 0, `expected exit 0; stderr: ${r.err}`);
  } finally {
    fs.rmSync(w.root, { recursive: true, force: true });
  }
});

test('an EXISTING violation exits 0 — a check that fails every PR gets turned off', () => {
  const both = graph([['api', 'payment']]);
  const w = workspace(both, both, NO_SYNC_INTO_PAYMENT);
  try {
    assert.strictEqual(runPolicy(w.beforePath, w.afterPath).code, 0);
  } finally {
    fs.rmSync(w.root, { recursive: true, force: true });
  }
});

test('a baselined violation exits 0 and is still PRINTED', () => {
  const w = workspace(
    graph([]),
    graph([['api', 'payment']]),
    NO_SYNC_INTO_PAYMENT,
    { version: 1, accepted: ['no-sync-into|api|payment'] },
  );
  try {
    const r = runPolicy(w.beforePath, w.afterPath, w.baselinePath);
    assert.strictEqual(r.code, 0, `expected exit 0; stderr: ${r.err}`);
    /* A ratchet whose debt is invisible is a mute failure — the repository ends
       up unable to see what it has agreed to live with. */
    assert.match(r.out, /accepted \(baseline\)/i);
  } finally {
    fs.rmSync(w.root, { recursive: true, force: true });
  }
});

test('a new violation still exits 1 while an older one is baselined', () => {
  const w = workspace(
    graph([]),
    graph([
      ['api', 'payment'],
      ['jobs', 'payment'],
    ]),
    NO_SYNC_INTO_PAYMENT,
    { version: 1, accepted: ['no-sync-into|api|payment'] },
  );
  try {
    const r = runPolicy(w.beforePath, w.afterPath, w.baselinePath);
    assert.strictEqual(r.code, 1, 'the ratchet holds: new debt still fails');
    assert.match(r.err, /jobs/);
    assert.doesNotMatch(r.err, /BLOCK.*\bapi\b/);
  } finally {
    fs.rmSync(w.root, { recursive: true, force: true });
  }
});

test('a bad path exits 2, not 1 — a crash is not a policy failure', () => {
  const r = runPolicy(path.join(os.tmpdir(), 'nope-before.json'), path.join(os.tmpdir(), 'nope-after.json'));
  /*
   * The distinction the third code exists for. A tool that returns 1 for both
   * teaches a team to treat its own crashes as policy failures, and then to
   * treat policy failures as crashes.
   */
  assert.strictEqual(r.code, 2);
});

test('a repo with no policies exits 0 and says so', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-nopolicy-'));
  try {
    const before = path.join(root, 'b.json');
    const after = path.join(root, 'a.json');
    fs.writeFileSync(before, JSON.stringify({ ...graph([]), repoRoot: root }));
    fs.writeFileSync(after, JSON.stringify({ ...graph([['api', 'payment']]), repoRoot: root }));
    const r = runPolicy(before, after);
    assert.strictEqual(r.code, 0);
    /* Silence would be indistinguishable from "checked and clean". */
    assert.match(r.out, /no policies found/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
