/**
 * Locks audit G4: the learning loop is built and tested and NOTHING CALLS IT.
 *
 * The unit half drives `runLearningLoop` on a seeded `.sequence/` and checks
 * what lands on disk (a pending proposal, never the target). The server half
 * is the reported shape itself: a repo where the same ask has failed twice —
 * after the second failure a proposal must exist under
 * `.sequence/refinements/` without anyone having asked a /api/harness route.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLearningLoop } from '../harness/learningLoop.js';
import {
  REFINEMENTS_DIR,
  PROPOSAL_FILE,
  denyRefineProposal,
  listRefineProposals,
  readRefineProposal,
  resolveRefineTarget,
  writeRefineProposal,
  type RefineProposal,
} from '../harness/refineProposal.js';
import { createRepoServer } from '../server/repoServer.js';
import type { TrajectoryDoc } from '../server/trajectoryStore.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

function tmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-learning-loop-'));
}

/** Same seed shape as refinePlanner.test.ts: one ask run, failed or not. */
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

function refinementsDir(repoRoot: string): string {
  return path.join(repoRoot, '.sequence', REFINEMENTS_DIR);
}

/* --------------------------------- unit ----------------------------------- */

test('runLearningLoop: two failed asks sharing an intent → a PENDING proposal is persisted, the target is not written', async () => {
  const repo = tmpRepo();
  seedTrajectory(repo, askDoc('f1', 'impact', ['src/a.ts'], false));
  seedTrajectory(repo, askDoc('f2', 'impact', ['src/b.ts'], false));

  const outcome = await runLearningLoop(repo);
  assert.equal(outcome.disposition, 'written');
  assert.ok(outcome.proposal, 'a proposal was planned');
  assert.equal(outcome.persistedId, outcome.proposal!.id);
  assert.equal(outcome.proposal!.trigger, 'repeated-failed-asks:impact');
  assert.deepEqual(outcome.proposal!.evidenceRefs.runIds, ['f1', 'f2']);

  // On disk, through the store, as pending.
  const stored = readRefineProposal(repo, outcome.persistedId!);
  assert.ok(stored, 'proposal.json exists under .sequence/refinements/<id>/');
  assert.equal(stored!.status, 'pending');
  assert.ok(
    fs.existsSync(path.join(refinementsDir(repo), outcome.persistedId!, PROPOSAL_FILE)),
    'the proposal file is where the store puts it',
  );

  // NEVER applied: the target the proposal names does not exist.
  const target = resolveRefineTarget(repo, outcome.proposal!.targetPath);
  assert.ok(target, 'target resolves inside .sequence/');
  assert.equal(fs.existsSync(target!), false, 'the loop proposes; it does not write the target');
});

test('runLearningLoop: no repeated failure → null, and nothing is written under .sequence/', async () => {
  const repo = tmpRepo();
  // One failure is below MIN_FAILED_FOR_REFINE; the successful run does not count.
  seedTrajectory(repo, askDoc('f1', 'impact', ['src/a.ts'], false));
  seedTrajectory(repo, askDoc('s1', 'impact', ['src/a.ts'], true));

  const outcome = await runLearningLoop(repo);
  assert.equal(outcome.proposal, null);
  assert.equal(outcome.disposition, 'no-pattern');
  assert.equal(outcome.persistedId, undefined);
  assert.equal(fs.existsSync(refinementsDir(repo)), false, 'no refinements dir was created');
  assert.equal(fs.existsSync(path.join(repo, '.sequence', 'memory')), false, 'no memory dir was created');
});

test('runLearningLoop: a byte-identical pending proposal is not rewritten (unchanged)', async () => {
  const repo = tmpRepo();
  seedTrajectory(repo, askDoc('f1', 'impact', ['src/a.ts'], false));
  seedTrajectory(repo, askDoc('f2', 'impact', ['src/b.ts'], false));

  const first = await runLearningLoop(repo);
  assert.equal(first.disposition, 'written');
  const proposalPath = path.join(refinementsDir(repo), first.persistedId!, PROPOSAL_FILE);
  const mtimeBefore = fs.statSync(proposalPath).mtimeMs;
  // A store write that happened would move mtime forward; make sure the clock can show it.
  fs.utimesSync(proposalPath, new Date(mtimeBefore - 5000), new Date(mtimeBefore - 5000));
  const stamped = fs.statSync(proposalPath).mtimeMs;

  const second = await runLearningLoop(repo);
  assert.equal(second.disposition, 'unchanged');
  assert.equal(second.persistedId, first.persistedId);
  assert.equal(fs.statSync(proposalPath).mtimeMs, stamped, 'proposal.json was not touched');
  assert.equal(listRefineProposals(repo).length, 1, 'still exactly one proposal');
});

test('runLearningLoop: new evidence updates a pending proposal (written again, same id)', async () => {
  const repo = tmpRepo();
  seedTrajectory(repo, askDoc('f1', 'impact', ['src/a.ts'], false));
  seedTrajectory(repo, askDoc('f2', 'impact', ['src/b.ts'], false));
  const first = await runLearningLoop(repo);
  assert.equal(first.disposition, 'written');

  seedTrajectory(repo, askDoc('f3', 'impact', ['src/c.ts'], false));
  const second = await runLearningLoop(repo);
  assert.equal(second.disposition, 'written');
  assert.equal(second.persistedId, first.persistedId, 'trigger + target unchanged → same id');
  assert.deepEqual(readRefineProposal(repo, second.persistedId!)!.evidenceRefs.runIds, ['f1', 'f2', 'f3']);
});

test('runLearningLoop: a proposal the owner already DENIED is left alone, not resurrected as pending', async () => {
  const repo = tmpRepo();
  seedTrajectory(repo, askDoc('f1', 'impact', ['src/a.ts'], false));
  seedTrajectory(repo, askDoc('f2', 'impact', ['src/b.ts'], false));
  const first = await runLearningLoop(repo);
  assert.equal(first.disposition, 'written');
  assert.equal(denyRefineProposal(repo, first.persistedId!).ok, true);

  // The next failed ask re-plans the same trigger with MORE evidence — the by-hand
  // route would overwrite the denial; the automatic loop must not.
  seedTrajectory(repo, askDoc('f3', 'impact', ['src/c.ts'], false));
  const second = await runLearningLoop(repo);
  assert.equal(second.disposition, 'already-ruled');
  assert.equal(second.persistedId, first.persistedId);
  assert.equal(readRefineProposal(repo, first.persistedId!)!.status, 'denied', 'the denial stands');
});

test('runLearningLoop: never throws — an unreadable proposal store becomes an outcome, not an exception', async () => {
  const repo = tmpRepo();
  seedTrajectory(repo, askDoc('f1', 'impact', ['src/a.ts'], false));
  seedTrajectory(repo, askDoc('f2', 'impact', ['src/b.ts'], false));
  // Put a FILE where the refinements directory must go, so mkdirSync fails.
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.writeFileSync(refinementsDir(repo), 'not a directory');

  let outcome;
  try {
    outcome = await runLearningLoop(repo);
  } catch (e) {
    assert.fail(`runLearningLoop threw: ${(e as Error).message}`);
  }
  assert.equal(outcome.disposition, 'write-failed');
  assert.ok(outcome.proposal, 'the plan itself succeeded');
  assert.equal(outcome.persistedId, undefined, 'nothing is claimed to be on disk');
  assert.match(outcome.error ?? '', /could not persist/);
});

test('runLearningLoop: a repo with no .sequence/ at all → no-pattern, no throw, no dir created', async () => {
  const repo = tmpRepo();
  const outcome = await runLearningLoop(repo);
  assert.equal(outcome.disposition, 'no-pattern');
  assert.equal(fs.existsSync(path.join(repo, '.sequence')), false);
});

/* -------------------------------- server ---------------------------------- */

function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-learning-hook-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

async function startServer(repoRoot: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repoRoot, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function failedAsk(base: string): Promise<{ runId: string; terminal: Record<string, unknown> }> {
  const res = await fetch(`${base}/api/ask/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      question: 'What does the backend do?',
      intents: [{ id: 'impact', subject: 'backend', subjectNodeId: 'svc:backend' }],
    }),
  });
  assert.strictEqual(res.status, 200);
  const events: Array<Record<string, unknown>> = [];
  for (const line of (await res.text()).split('\n')) {
    if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)) as Record<string, unknown>);
  }
  const start = events.find((e) => e.type === 'trajectory:start') as { runId: string } | undefined;
  assert.ok(start?.runId, 'the stream announced a runId');
  const terminal = events.find((e) => e.type === 'error');
  assert.ok(terminal, 'the turn ended in an ERROR terminal (the provider is unreachable)');
  return { runId: start!.runId, terminal: terminal! };
}

/** The hook is fire-and-forget, so the test waits for the store, bounded. */
async function waitForProposals(repoRoot: string, timeoutMs: number): Promise<RefineProposal[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = listRefineProposals(repoRoot);
    if (found.length > 0 || Date.now() > deadline) return found;
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('/api/ask/stream: after the SAME ask fails twice, a pending proposal exists — nobody called /api/harness', async () => {
  const repo = plainappRepo();
  const { base, close } = await startServer(repo);
  try {
    /* A configured provider that nothing listens on: every turn ends as a
       thrown ProviderError → the route's error terminal → finalizeTrajectory. */
    await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'anthropic',
        baseUrl: 'http://127.0.0.1:1/never-listening',
        model: 'claude-test',
        apiKey: 'sk-ant-test-LEARNING-LOOP-1',
      }),
    });

    const first = await failedAsk(base);
    const second = await failedAsk(base);
    assert.notEqual(first.runId, second.runId);

    const proposals = await waitForProposals(repo, 5000);
    assert.equal(
      proposals.length,
      1,
      'the server ran the learning loop after the error terminal and persisted ONE proposal',
    );
    const [p] = proposals;
    assert.equal(p.status, 'pending', 'a proposal, not an applied edit');
    assert.deepEqual(
      [...p.evidenceRefs.runIds].sort(),
      [first.runId, second.runId].sort(),
      'the evidence is exactly the two failed runs',
    );
    assert.ok(p.targetPath.startsWith('.sequence/'), 'the target is supplemental state');
    const target = resolveRefineTarget(repo, p.targetPath);
    assert.ok(target);
    assert.equal(fs.existsSync(target!), false, 'the hook never writes the target');

    // Sanity on the shape the store would accept, so the assertion above is on a real proposal.
    assert.equal(writeRefineProposal(repo, p), true);
  } finally {
    await close();
  }
});
