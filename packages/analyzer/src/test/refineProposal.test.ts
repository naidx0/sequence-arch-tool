import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planRefineFromTrajectories } from '../harness/refinePlanner.js';
import {
  applyRefineProposal,
  denyRefineProposal,
  listRefineProposals,
  refineProposalId,
  rollbackRefineProposal,
  writeRefineProposal,
  type RefineProposal,
} from '../harness/refineProposal.js';
import { distillSkillsFromTrajectories } from '../harness/skillDistill.js';
import type { TrajectoryDoc } from '../server/trajectoryStore.js';

function tmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-refine-'));
}

function askDoc(
  runId: string,
  intentId: string,
  filePaths: string[],
  ok: boolean,
): TrajectoryDoc {
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
  askTrace.push({ type: 'result', text: ok ? 'answer' : 'failed' });
  return {
    version: 1,
    runId,
    kind: 'ask',
    startedAt: '2026-08-11T00:00:00.000Z',
    finishedAt: '2026-08-11T00:00:01.000Z',
    askTrace,
    askTerminal: { type: ok ? 'result' : 'error', text: ok ? 'answer' : 'failed' },
    graph: { runId, nodes: [], edges: [] },
  };
}

function writeTrajectory(repoRoot: string, doc: TrajectoryDoc): void {
  const dir = path.join(repoRoot, '.sequence', 'trajectory');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${doc.runId}.json`), JSON.stringify(doc, null, 2));
}

test('planRefineFromTrajectories: proposes a refine from repeated failed asks', async () => {
  const repo = tmpRepo();
  writeTrajectory(repo, askDoc('f1', 'impact', ['src/a.ts'], false));
  writeTrajectory(repo, askDoc('f2', 'impact', ['src/b.ts'], false));
  const proposal = await planRefineFromTrajectories(repo);
  assert.ok(proposal, 'expected a proposal from two failed asks sharing intent');
  assert.equal(proposal!.status, 'pending');
  assert.ok(proposal!.trigger.startsWith('repeated-failed-asks:impact'));
  assert.deepEqual(proposal!.evidenceRefs.runIds.sort(), ['f1', 'f2']);
  assert.ok(proposal!.targetPath.startsWith('.sequence/'));
  assert.ok(proposal!.after.length > proposal!.before.length);
});

test('planRefineFromTrajectories: prefers appending pitfalls to an existing SKILL.md', async () => {
  const repo = tmpRepo();
  writeTrajectory(repo, askDoc('s1', 'impact', ['src/a.ts'], true));
  writeTrajectory(repo, askDoc('s2', 'impact', ['src/b.ts'], true));
  writeTrajectory(repo, askDoc('s3', 'impact', ['src/c.ts'], true));
  await distillSkillsFromTrajectories(repo);
  writeTrajectory(repo, askDoc('f1', 'impact', ['src/a.ts'], false));
  writeTrajectory(repo, askDoc('f2', 'impact', ['src/b.ts'], false));
  const proposal = await planRefineFromTrajectories(repo);
  assert.ok(proposal);
  assert.ok(proposal!.targetPath.endsWith('SKILL.md'));
  assert.ok(proposal!.after.includes('## Pitfalls'));
});

test('applyRefineProposal: accept writes after to the confined target', async () => {
  const repo = tmpRepo();
  writeTrajectory(repo, askDoc('f1', 'impact', ['src/a.ts'], false));
  writeTrajectory(repo, askDoc('f2', 'impact', ['src/b.ts'], false));
  const planned = await planRefineFromTrajectories(repo);
  assert.ok(planned);
  writeRefineProposal(repo, planned!);
  const result = applyRefineProposal(repo, planned!.id);
  assert.equal(result.ok, true);
  const targetAbs = path.join(repo, planned!.targetPath);
  assert.ok(fs.existsSync(targetAbs), 'target file written');
  assert.equal(fs.readFileSync(targetAbs, 'utf8'), planned!.after);
  assert.equal(result.proposal?.status, 'accepted');
});

test('denyRefineProposal: deny marks denied and does not write the target', async () => {
  const repo = tmpRepo();
  writeTrajectory(repo, askDoc('f1', 'impact', ['src/a.ts'], false));
  writeTrajectory(repo, askDoc('f2', 'impact', ['src/b.ts'], false));
  const planned = await planRefineFromTrajectories(repo);
  assert.ok(planned);
  writeRefineProposal(repo, planned!);
  const result = denyRefineProposal(repo, planned!.id);
  assert.equal(result.ok, true);
  assert.equal(result.proposal?.status, 'denied');
  const targetAbs = path.join(repo, planned!.targetPath);
  assert.ok(!fs.existsSync(targetAbs), 'target must not be written on deny');
});

test('rollbackRefineProposal: restores before snapshot and marks rolled_back', async () => {
  const repo = tmpRepo();
  writeTrajectory(repo, askDoc('f1', 'impact', ['src/a.ts'], false));
  writeTrajectory(repo, askDoc('f2', 'impact', ['src/b.ts'], false));
  const planned = await planRefineFromTrajectories(repo);
  assert.ok(planned);
  writeRefineProposal(repo, planned!);
  const accepted = applyRefineProposal(repo, planned!.id);
  assert.equal(accepted.ok, true);
  const targetAbs = path.join(repo, planned!.targetPath);
  assert.equal(fs.readFileSync(targetAbs, 'utf8'), planned!.after, 'after written on accept');

  const rolled = rollbackRefineProposal(repo, planned!.id);
  assert.equal(rolled.ok, true);
  assert.equal(rolled.proposal?.status, 'rolled_back');
  assert.ok(!fs.existsSync(targetAbs), 'target removed when before was empty');
  const again = rollbackRefineProposal(repo, planned!.id);
  assert.equal(again.ok, false);
  assert.match(again.error ?? '', /not accepted/);
});

test('applyRefineProposal: refuses a target that escapes .sequence/', () => {
  const repo = tmpRepo();
  const evil: RefineProposal = {
    id: refineProposalId('evil', 'src/evil.txt'),
    trigger: 'evil',
    evidenceRefs: { runIds: ['x'], filePaths: [] },
    targetPath: 'src/evil.txt',
    before: '',
    after: 'pwned',
    status: 'pending',
  };
  writeRefineProposal(repo, evil);
  const result = applyRefineProposal(repo, evil.id);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /\.sequence/);
  assert.ok(!fs.existsSync(path.join(repo, 'src', 'evil.txt')));
});

test('listRefineProposals: returns persisted proposals', async () => {
  const repo = tmpRepo();
  writeTrajectory(repo, askDoc('f1', 'impact', ['src/a.ts'], false));
  writeTrajectory(repo, askDoc('f2', 'impact', ['src/b.ts'], false));
  const planned = await planRefineFromTrajectories(repo);
  assert.ok(planned);
  writeRefineProposal(repo, planned!);
  const listed = listRefineProposals(repo);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, planned!.id);
});
