/**
 * `sequence harness refine|distill|list` — the by-hand caller of the learning
 * loop (audit G4: the harness routes had none). Locks: the subcommand prints
 * the proposal / the no-pattern line, the exit code is honest, it never applies
 * the target, and `cli.ts` actually dispatches the verb.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HARNESS_EXIT, NO_PATTERN_LINE, runHarnessCli, type HarnessCliIo } from '../refineCli.js';
import { denyRefineProposal, listRefineProposals, resolveRefineTarget } from '../harness/refineProposal.js';
import type { TrajectoryDoc } from '../server/trajectoryStore.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '..', 'cli.js');

function tmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-harness-cli-'));
}

function askDoc(runId: string, intentId: string, filePaths: string[], ok: boolean): TrajectoryDoc {
  const askTrace: Array<Record<string, unknown>> = [
    { type: 'intent:start', id: intentId },
    { type: 'intent:done', id: intentId },
  ];
  for (const p of filePaths) {
    askTrace.push({ type: 'file:read', path: p });
    askTrace.push({ type: 'file:done', path: p });
  }
  askTrace.push({ type: 'provider:start' });
  askTrace.push({ type: 'provider:done' });
  return {
    version: 1,
    runId,
    kind: 'ask',
    startedAt: '2026-09-01T00:00:00.000Z',
    finishedAt: '2026-09-01T00:00:01.000Z',
    // No `question`: clusterKeyForDoc would key the distill on its stem instead
    // of the intent id, and the slug asserted below would become the stem's.
    askTrace,
    askTerminal: { type: ok ? 'result' : 'error', text: ok ? 'answer' : 'boom' },
    graph: { runId, nodes: [], edges: [] },
  };
}

function seedTrajectory(repoRoot: string, doc: TrajectoryDoc): void {
  const dir = path.join(repoRoot, '.sequence', 'trajectory');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${doc.runId}.json`), JSON.stringify(doc, null, 2));
}

function capture(): HarnessCliIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (t) => stdout.push(t), err: (t) => stderr.push(t) };
}

test('harness refine: prints the proposal and persists it pending; the target is not written', async () => {
  const repo = tmpRepo();
  seedTrajectory(repo, askDoc('f1', 'impact', ['src/a.ts'], false));
  seedTrajectory(repo, askDoc('f2', 'impact', ['src/b.ts'], false));
  const io = capture();
  const code = await runHarnessCli(['refine', '--repo', repo], io);
  assert.equal(code, HARNESS_EXIT.OK);
  const out = io.stdout.join('');
  assert.match(out, /proposal written \(pending\)/);
  assert.match(out, /trigger\s+repeated-failed-asks:impact/);
  assert.match(out, /evidence\s+f1, f2/);
  assert.match(out, /target\s+\.sequence\/memory\/NOTES\.md \(new file\)/);
  const stored = listRefineProposals(repo);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].status, 'pending');
  assert.equal(fs.existsSync(resolveRefineTarget(repo, stored[0].targetPath)!), false, 'proposed, not applied');
});

test('harness refine: no repeated failure → the no-pattern line, exit 0, nothing written', async () => {
  const repo = tmpRepo();
  seedTrajectory(repo, askDoc('f1', 'impact', ['src/a.ts'], false));
  const io = capture();
  const code = await runHarnessCli(['refine', '--repo', repo], io);
  assert.equal(code, HARNESS_EXIT.OK, '"nothing to propose" is an answer, not a failure');
  assert.match(io.stdout.join(''), new RegExp(`^${NO_PATTERN_LINE} in `));
  assert.equal(fs.existsSync(path.join(repo, '.sequence', 'refinements')), false);
});

test('harness refine: the no-pattern line says what was read and what a pattern is', async () => {
  /*
   * REVIEW (user-seat): "no repeated failure pattern in <dir>" named a directory
   * that might not exist and gave no way to tell "no failures yet" from "the
   * planner read nothing". One run seeded ⇒ the line counts it; no directory ⇒
   * the line says so instead of pointing at a path that is not there.
   */
  const seeded = tmpRepo();
  seedTrajectory(seeded, askDoc('f1', 'impact', ['src/a.ts'], false));
  const io = capture();
  assert.equal(await runHarnessCli(['refine', '--repo', seeded], io), HARNESS_EXIT.OK);
  const out = io.stdout.join('');
  assert.match(out, /1 persisted run read/);
  assert.match(out, />=2 FAILED asks sharing an intent/);

  const empty = capture();
  assert.equal(await runHarnessCli(['refine', '--repo', tmpRepo()], empty), HARNESS_EXIT.OK);
  assert.match(empty.stdout.join(''), /no persisted runs yet — the directory does not exist/);
});

test('harness refine: a written proposal names the next step, and a ruled-on one shows the RULING', async () => {
  /*
   * REVIEW (user-seat), two findings with one root: the report ended at the
   * proposal body. A written proposal was a dead end (no next step), and after
   * the owner DENIED it, a re-run printed "already ruled on" followed by
   * `status    pending` — the fresh plan's status, not the on-disk ruling.
   */
  const repo = tmpRepo();
  seedTrajectory(repo, askDoc('f1', 'impact', ['src/a.ts'], false));
  seedTrajectory(repo, askDoc('f2', 'impact', ['src/b.ts'], false));
  const first = capture();
  assert.equal(await runHarnessCli(['refine', '--repo', repo], first), HARNESS_EXIT.OK);
  const written = first.stdout.join('');
  assert.match(written, /next\s+review \.sequence\/refinements\//, 'a written proposal says where to go next');
  assert.match(written, /\/accept \| \/deny \| \/rollback/, 'and names the verify-gated route');

  const [stored] = listRefineProposals(repo);
  assert.equal(denyRefineProposal(repo, stored.id).ok, true);
  seedTrajectory(repo, askDoc('f3', 'impact', ['src/c.ts'], false));
  const again = capture();
  assert.equal(await runHarnessCli(['refine', '--repo', repo], again), HARNESS_EXIT.OK);
  const ruled = again.stdout.join('');
  assert.match(ruled, /proposal already ruled on, left alone/);
  assert.match(ruled, /status\s+denied/, 'the on-disk ruling, not the fresh plan');
  assert.doesNotMatch(ruled, /status\s+pending/);
  assert.match(ruled, /next\s+nothing — the ruling above stands/);
});

test('harness refine: --repo with no value is a usage error, never a fallback to the cwd', async () => {
  /*
   * REVIEW (correctness): `--repo` followed by nothing (or by the next flag)
   * silently became process.cwd() — and this verb WRITES .sequence/refinements/
   * into that directory.
   */
  for (const argv of [['refine', '--repo'], ['refine', '--repo', '--json']]) {
    const io = capture();
    assert.equal(await runHarnessCli(argv, io), HARNESS_EXIT.USAGE, argv.join(' '));
    assert.match(io.stderr.join(''), /--repo needs a directory/);
  }
});

test('harness refine --json: one object on stdout carrying the outcome', async () => {
  const repo = tmpRepo();
  seedTrajectory(repo, askDoc('f1', 'impact', ['src/a.ts'], false));
  seedTrajectory(repo, askDoc('f2', 'impact', ['src/b.ts'], false));
  const io = capture();
  const code = await runHarnessCli(['refine', '--repo', repo, '--json'], io);
  assert.equal(code, HARNESS_EXIT.OK);
  assert.equal(io.stdout.length, 1, 'exactly one write to stdout');
  const parsed = JSON.parse(io.stdout[0]) as { disposition: string; persistedId?: string; proposal: { id: string } | null };
  assert.equal(parsed.disposition, 'written');
  assert.ok(parsed.proposal);
  assert.equal(parsed.persistedId, parsed.proposal!.id);
});

test('harness refine: a store that cannot be written → exit 3 and "refine failed" on stdout', async () => {
  const repo = tmpRepo();
  seedTrajectory(repo, askDoc('f1', 'impact', ['src/a.ts'], false));
  seedTrajectory(repo, askDoc('f2', 'impact', ['src/b.ts'], false));
  fs.writeFileSync(path.join(repo, '.sequence', 'refinements'), 'a file where the dir must go');
  const io = capture();
  const code = await runHarnessCli(['refine', '--repo', repo], io);
  assert.equal(code, HARNESS_EXIT.FAILED);
  assert.match(io.stdout.join(''), /refine failed: could not persist/);
});

test('harness list: pending only by default, --all includes ruled ones', async () => {
  const repo = tmpRepo();
  seedTrajectory(repo, askDoc('f1', 'impact', ['src/a.ts'], false));
  seedTrajectory(repo, askDoc('f2', 'impact', ['src/b.ts'], false));
  const empty = capture();
  assert.equal(await runHarnessCli(['list', '--repo', repo], empty), HARNESS_EXIT.OK);
  assert.match(empty.stdout.join(''), /^no pending proposals under /);

  await runHarnessCli(['refine', '--repo', repo], capture());
  const listed = capture();
  assert.equal(await runHarnessCli(['list', '--repo', repo], listed), HARNESS_EXIT.OK);
  assert.match(listed.stdout.join(''), /status\s+pending/);

  const json = capture();
  await runHarnessCli(['list', '--repo', repo, '--all', '--json'], json);
  const parsed = JSON.parse(json.stdout[0]) as { proposals: Array<{ status: string }> };
  assert.equal(parsed.proposals.length, 1);
});

test('harness distill: writes a SKILL.md for >=3 successful asks sharing an intent; exit 0', async () => {
  const repo = tmpRepo();
  seedTrajectory(repo, askDoc('s1', 'impact', ['src/a.ts'], true));
  seedTrajectory(repo, askDoc('s2', 'impact', ['src/b.ts'], true));
  seedTrajectory(repo, askDoc('s3', 'impact', ['src/c.ts'], true));
  const io = capture();
  const code = await runHarnessCli(['distill', '--repo', repo], io);
  assert.equal(code, HARNESS_EXIT.OK);
  assert.match(io.stdout.join(''), /^wrote impact\s+/);
  assert.ok(fs.existsSync(path.join(repo, '.sequence', 'skills', 'impact', 'SKILL.md')));

  const none = capture();
  assert.equal(await runHarnessCli(['distill', '--repo', tmpRepo()], none), HARNESS_EXIT.OK);
  assert.match(none.stdout.join(''), /no cluster of >=3 successful asks/);
});

test('harness: usage errors exit 2 and write nothing to stdout', async () => {
  for (const argv of [[], ['accept', 'x'], ['refine', '--bogus'], ['refine', 'extra']]) {
    const io = capture();
    assert.equal(await runHarnessCli(argv, io), HARNESS_EXIT.USAGE, JSON.stringify(argv));
    assert.equal(io.stdout.length, 0, `stdout stays empty for ${JSON.stringify(argv)}`);
    assert.match(io.stderr.join(''), /usage: sequence harness/);
  }
  const io = capture();
  assert.equal(await runHarnessCli(['refine', '--repo', path.join(tmpRepo(), 'missing')], io), HARNESS_EXIT.REPO);
  assert.match(io.stderr.join(''), /--repo is not a directory/);
});

test('sequence harness refine: cli.ts dispatches the verb (spawned, no-pattern path)', () => {
  const repo = tmpRepo();
  const out = execFileSync('node', [CLI, 'harness', 'refine', '--repo', repo], { encoding: 'utf8', stdio: 'pipe' });
  assert.match(out, new RegExp(`^${NO_PATTERN_LINE} in `));
});
