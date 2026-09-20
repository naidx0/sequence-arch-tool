import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  planRefineFromTrajectories,
  MIN_FAILED_FOR_REFINE,
  MEMORY_DIR,
  NOTES_FILE,
} from '../harness/refinePlanner.js';
import {
  applyRefineProposal,
  denyRefineProposal,
  listRefineProposals,
  readRefineProposal,
  refineProposalId,
  resolveRefineTarget,
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
  ok = true,
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
  return {
    version: 1,
    runId,
    kind: 'ask',
    startedAt: '2026-08-11T00:00:00.000Z',
    finishedAt: '2026-08-11T00:00:01.000Z',
    askTrace,
    askTerminal: { type: ok ? 'result' : 'error', text: ok ? 'answer' : 'boom' },
    graph: { runId, nodes: [], edges: [] },
  };
}

function writeTrajectory(repoRoot: string, doc: TrajectoryDoc): void {
  const dir = path.join(repoRoot, '.sequence', 'trajectory');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${doc.runId}.json`), JSON.stringify(doc, null, 2));
}

/* ------------------------------- planRefineFromTrajectories ---------------- */

test('planRefineFromTrajectories: null when no failed asks', async () => {
  const repo = tmpRepo();
  writeTrajectory(repo, askDoc('r1', 'impact', ['src/a.ts']));
  writeTrajectory(repo, askDoc('r2', 'impact', ['src/b.ts']));
  assert.equal(await planRefineFromTrajectories(repo), null);
});

test('planRefineFromTrajectories: null when only one failed ask (below min)', async () => {
  const repo = tmpRepo();
  writeTrajectory(repo, askDoc('r1', 'impact', ['src/a.ts'], false));
  assert.equal(await planRefineFromTrajectories(repo), null);
});

test('planRefineFromTrajectories: proposes a NOTES.md tip for ≥2 failed asks sharing an intent, no matching skill', async () => {
  const repo = tmpRepo();
  writeTrajectory(repo, askDoc('r1', 'impact', ['src/a.ts'], false));
  writeTrajectory(repo, askDoc('r2', 'impact', ['src/b.ts'], false));
  // A successful ask does not count toward the failure pattern.
  writeTrajectory(repo, askDoc('r3', 'impact', ['src/c.ts'], true));
  const proposal = await planRefineFromTrajectories(repo);
  assert.ok(proposal, 'expected a proposal');
  assert.equal(proposal!.status, 'pending');
  assert.equal(proposal!.trigger, 'repeated-failed-asks:impact');
  assert.deepEqual(proposal!.evidenceRefs.runIds, ['r1', 'r2']);
  assert.deepEqual(proposal!.evidenceRefs.filePaths, ['src/a.ts', 'src/b.ts']);
  // No matching skill → target is .sequence/memory/NOTES.md.
  assert.equal(proposal!.targetPath, ['.sequence', MEMORY_DIR, NOTES_FILE].join('/'));
  assert.equal(proposal!.before, '', 'target does not exist yet');
  assert.ok(proposal!.after.includes('# Repo memory'), 'notes header');
  assert.ok(proposal!.after.includes('repeated-failed-asks:impact'), 'trigger recorded');
  assert.ok(proposal!.after.includes('r1, r2'), 'evidence run ids recorded');
  assert.ok(proposal!.after.includes('src/a.ts'), 'evidence file path recorded');
  // Id is stable for the same trigger + target.
  assert.equal(proposal!.id, refineProposalId(proposal!.trigger, proposal!.targetPath));
});

test('planRefineFromTrajectories: appends a Pitfalls section to an existing SKILL.md when the intent matches a distilled skill', async () => {
  const repo = tmpRepo();
  // Distill a skill for the 'impact' intent from 3 successful asks.
  writeTrajectory(repo, askDoc('s1', 'impact', ['src/a.ts'], true));
  writeTrajectory(repo, askDoc('s2', 'impact', ['src/b.ts'], true));
  writeTrajectory(repo, askDoc('s3', 'impact', ['src/c.ts'], true));
  const { written } = await distillSkillsFromTrajectories(repo);
  assert.equal(written.length, 1);
  const skillPath = written[0].filePath;
  const skillBefore = fs.readFileSync(skillPath, 'utf8');

  // Now two failed asks share the same intent.
  writeTrajectory(repo, askDoc('f1', 'impact', ['src/a.ts'], false));
  writeTrajectory(repo, askDoc('f2', 'impact', ['src/d.ts'], false));
  const proposal = await planRefineFromTrajectories(repo);
  assert.ok(proposal, 'expected a proposal');
  assert.equal(proposal!.trigger, 'repeated-failed-asks:impact');
  assert.equal(
    proposal!.targetPath,
    '.sequence/skills/impact/SKILL.md',
    'target is the existing skill',
  );
  assert.equal(proposal!.before, skillBefore, 'before is the current skill content');
  assert.ok(proposal!.after.includes('## Pitfalls'), 'pitfalls section appended');
  assert.ok(proposal!.after.startsWith(skillBefore), 'existing skill body preserved');
  assert.ok(proposal!.after.includes('- f1'), 'failed run id recorded in pitfalls');
  assert.ok(proposal!.after.includes('src/d.ts'), 'failed file path recorded');
});

test('planRefineFromTrajectories: falls back to a file-read trigger when no intent is shared', async () => {
  const repo = tmpRepo();
  // Two failed asks with DIFFERENT intents but both read the same file.
  writeTrajectory(repo, askDoc('r1', 'impact', ['src/shared.ts'], false));
  writeTrajectory(repo, askDoc('r2', 'risks', ['src/shared.ts'], false));
  const proposal = await planRefineFromTrajectories(repo);
  assert.ok(proposal, 'expected a proposal');
  assert.equal(proposal!.trigger, 'repeated-file-reads:src/shared.ts');
  assert.deepEqual(proposal!.evidenceRefs.runIds, ['r1', 'r2']);
  assert.deepEqual(proposal!.evidenceRefs.filePaths, ['src/shared.ts']);
  assert.equal(proposal!.targetPath, ['.sequence', MEMORY_DIR, NOTES_FILE].join('/'));
});

test('planRefineFromTrajectories: idempotent — re-planning the same trigger does not duplicate the section', async () => {
  const repo = tmpRepo();
  writeTrajectory(repo, askDoc('r1', 'impact', ['src/a.ts'], false));
  writeTrajectory(repo, askDoc('r2', 'impact', ['src/b.ts'], false));
  const first = await planRefineFromTrajectories(repo);
  assert.ok(first);
  // Simulate the notes file already containing the tip (as if a prior accept landed).
  fs.mkdirSync(path.dirname(path.join(repo, first!.targetPath)), { recursive: true });
  fs.writeFileSync(path.join(repo, first!.targetPath), first!.after);
  const second = await planRefineFromTrajectories(repo);
  assert.ok(second);
  // The after content is byte-identical — the tip was not appended twice.
  assert.equal(second!.after, first!.after);
});

test('MIN_FAILED_FOR_REFINE is 2', () => {
  assert.equal(MIN_FAILED_FOR_REFINE, 2);
});

/* ------------------------------- resolveRefineTarget ----------------------- */

test('resolveRefineTarget: confines to .sequence/ and refuses escapes', () => {
  const repo = tmpRepo();
  assert.ok(resolveRefineTarget(repo, '.sequence/memory/NOTES.md'));
  assert.ok(resolveRefineTarget(repo, '.sequence/skills/impact/SKILL.md'));
  assert.equal(resolveRefineTarget(repo, '../etc/passwd'), null);
  assert.equal(resolveRefineTarget(repo, '/etc/passwd'), null);
  assert.equal(resolveRefineTarget(repo, '.sequence/../../etc/passwd'), null);
});

/* ------------------------------- write / list / read ----------------------- */

test('writeRefineProposal + readRefineProposal + listRefineProposals round-trip', () => {
  const repo = tmpRepo();
  const proposal: RefineProposal = {
    id: refineProposalId('repeated-failed-asks:impact', '.sequence/memory/NOTES.md'),
    trigger: 'repeated-failed-asks:impact',
    evidenceRefs: { runIds: ['r1', 'r2'], filePaths: ['src/a.ts'] },
    targetPath: '.sequence/memory/NOTES.md',
    before: '',
    after: '# Repo memory\n\n- tip\n',
    status: 'pending',
  };
  assert.equal(writeRefineProposal(repo, proposal), true);
  const read = readRefineProposal(repo, proposal.id);
  assert.ok(read, 'proposal persisted');
  assert.deepEqual(read, proposal);
  const list = listRefineProposals(repo);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, proposal.id);
  // The before snapshot is written next to the proposal.
  assert.ok(
    fs.existsSync(path.join(repo, '.sequence', 'refinements', proposal.id, 'before')),
    'before snapshot file exists',
  );
});

test('listRefineProposals: empty when no refinements dir (never throws)', () => {
  const repo = tmpRepo();
  assert.deepEqual(listRefineProposals(repo), []);
});

/* ------------------------------- applyRefineProposal ----------------------- */

test('applyRefineProposal: writes after to target, marks accepted, refuses escapes', () => {
  const repo = tmpRepo();
  const proposal: RefineProposal = {
    id: refineProposalId('t', '.sequence/memory/NOTES.md'),
    trigger: 't',
    evidenceRefs: { runIds: ['r1'], filePaths: [] },
    targetPath: '.sequence/memory/NOTES.md',
    before: '',
    after: '# Repo memory\n\n- tip\n',
    status: 'pending',
  };
  writeRefineProposal(repo, proposal);
  const result = applyRefineProposal(repo, proposal.id);
  assert.equal(result.ok, true);
  assert.equal(result.proposal!.status, 'accepted');
  const target = path.join(repo, '.sequence', 'memory', 'NOTES.md');
  assert.equal(fs.readFileSync(target, 'utf8'), proposal.after, 'after written to target');
  // Re-accept is refused.
  const again = applyRefineProposal(repo, proposal.id);
  assert.equal(again.ok, false);
  assert.match(again.error!, /already accepted/);
});

test('applyRefineProposal: refuses a target that escapes .sequence/', () => {
  const repo = tmpRepo();
  const proposal: RefineProposal = {
    id: refineProposalId('escape', '../evil.txt'),
    trigger: 'escape',
    evidenceRefs: { runIds: ['r1'], filePaths: [] },
    targetPath: '../evil.txt',
    before: '',
    after: 'pwned',
    status: 'pending',
  };
  writeRefineProposal(repo, proposal);
  const result = applyRefineProposal(repo, proposal.id);
  assert.equal(result.ok, false);
  assert.match(result.error!, /escapes \.sequence\//);
  assert.ok(!fs.existsSync(path.join(repo, 'evil.txt')), 'no file written outside .sequence/');
});

test('applyRefineProposal: missing proposal returns ok:false', () => {
  const repo = tmpRepo();
  const result = applyRefineProposal(repo, 'nope');
  assert.equal(result.ok, false);
  assert.match(result.error!, /not found/);
});

/* ------------------------------- denyRefineProposal ----------------------- */

test('denyRefineProposal: marks denied without writing the target', () => {
  const repo = tmpRepo();
  const proposal: RefineProposal = {
    id: refineProposalId('t', '.sequence/memory/NOTES.md'),
    trigger: 't',
    evidenceRefs: { runIds: ['r1'], filePaths: [] },
    targetPath: '.sequence/memory/NOTES.md',
    before: '',
    after: '# Repo memory\n\n- tip\n',
    status: 'pending',
  };
  writeRefineProposal(repo, proposal);
  const result = denyRefineProposal(repo, proposal.id);
  assert.equal(result.ok, true);
  assert.equal(result.proposal!.status, 'denied');
  // The target was NOT written.
  assert.ok(!fs.existsSync(path.join(repo, '.sequence', 'memory', 'NOTES.md')));
  // Re-deny is refused.
  const again = denyRefineProposal(repo, proposal.id);
  assert.equal(again.ok, false);
  assert.match(again.error!, /already denied/);
});

/* ------------------------------- rollbackRefineProposal -------------------- */

test('rollbackRefineProposal: restores BEFORE_FILE snapshot for an accepted refine', () => {
  const repo = tmpRepo();
  const proposal: RefineProposal = {
    id: refineProposalId('t', '.sequence/memory/NOTES.md'),
    trigger: 't',
    evidenceRefs: { runIds: ['r1'], filePaths: [] },
    targetPath: '.sequence/memory/NOTES.md',
    before: '# Before\n',
    after: '# After\n',
    status: 'pending',
  };
  writeRefineProposal(repo, proposal);
  const accepted = applyRefineProposal(repo, proposal.id);
  assert.equal(accepted.ok, true);
  const target = path.join(repo, '.sequence', 'memory', 'NOTES.md');
  assert.equal(fs.readFileSync(target, 'utf8'), '# After\n');

  const rolled = rollbackRefineProposal(repo, proposal.id);
  assert.equal(rolled.ok, true);
  assert.equal(rolled.proposal!.status, 'rolled_back');
  assert.equal(fs.readFileSync(target, 'utf8'), '# Before\n');
});

test('rollbackRefineProposal: refuses when proposal is not accepted', () => {
  const repo = tmpRepo();
  const proposal: RefineProposal = {
    id: refineProposalId('t', '.sequence/memory/NOTES.md'),
    trigger: 't',
    evidenceRefs: { runIds: ['r1'], filePaths: [] },
    targetPath: '.sequence/memory/NOTES.md',
    before: '',
    after: '# After\n',
    status: 'pending',
  };
  writeRefineProposal(repo, proposal);
  const result = rollbackRefineProposal(repo, proposal.id);
  assert.equal(result.ok, false);
  assert.match(result.error!, /not accepted/);
});
