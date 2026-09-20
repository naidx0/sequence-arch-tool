import assert from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildPrTriageProgram, STRICT_MODE, DEFAULT_MODE } from './programs/prTriage.js';
import {
  validateProgram,
  runProgram,
  type Program,
  type NodeExecutor,
  type ProgramExecutors,
  type RunEvent,
} from './index.js';
import { programToMermaid, mermaidToProgram } from './programMermaid.js';

/**
 * Lock for the PR-triage flagship template (v16 Phase 4 + adversarial-review
 * fixes): a validateProgram-clean graph whose parallel ACP probes JOIN at a real
 * barrier (`fan --seq--> summarize`, not a per-probe race) and whose branch is
 * HONEST and SATISFIABLE — it gates on the SUPPLIED `mode` input (both ends
 * reachable), never on a score magically parsed from agent text. The shipped
 * .sequence/programs/pr-triage.json stays in sync with the builder.
 */

/** An agent executor that completes every turn honestly (a real end_turn). */
const okAgent: NodeExecutor = async () => ({ ok: true, value: { stopReason: 'end_turn', text: 'x' } });
const noopCommand: NodeExecutor = async () => ({ ok: true, value: 'noop' });
const executors: ProgramExecutors = { agent: okAgent, command: noopCommand };

test('buildPrTriageProgram: validateProgram returns no errors', () => {
  assert.deepEqual(validateProgram(buildPrTriageProgram()), { ok: true, errors: [] });
});

test('buildPrTriageProgram: ≥3 parallel probe agent nodes, all runtime acp', () => {
  const p = buildPrTriageProgram();
  const fan = p.nodes.find((n) => n.kind === 'parallel');
  assert.ok(fan, 'has a parallel fan-out node');
  const probeIds = p.edges.filter((e) => e.from === fan!.id && e.kind === 'parallel').map((e) => e.to);
  assert.ok(probeIds.length >= 3, `expected ≥3 parallel probes, got ${probeIds.length}`);
  for (const id of probeIds) {
    const n = p.nodes.find((x) => x.id === id);
    assert.ok(n, `probe ${id} exists`);
    assert.equal(n!.kind, 'agent', `probe ${id} is an agent`);
    assert.equal(n!.agent?.runtime, 'acp', `probe ${id} runs on acp`);
    assert.ok((n!.agent?.prompt.length ?? 0) > 0, `probe ${id} has an honest prompt`);
  }
});

test('the join is a REAL barrier: fan has exactly one seq edge (→summarize); no probe seq→summarize', () => {
  const p = buildPrTriageProgram();
  const fan = p.nodes.find((n) => n.kind === 'parallel')!;
  const probeIds = new Set(
    p.edges.filter((e) => e.from === fan.id && e.kind === 'parallel').map((e) => e.to)
  );

  // The parallel node's join is its single seq edge — that is where summarize hangs.
  const fanSeq = p.edges.filter((e) => e.from === fan.id && e.kind === 'seq');
  assert.equal(fanSeq.length, 1, 'fan has exactly one seq (join) edge');
  const joinTarget = fanSeq[0].to;

  // NO probe wires seq→(join target): probes are parallel children ONLY, so the
  // summarize node cannot run on whichever probe finishes first.
  for (const id of probeIds) {
    const probeSeqEdges = p.edges.filter((e) => e.from === id && e.kind === 'seq');
    assert.equal(probeSeqEdges.length, 0, `probe ${id} must carry NO seq edge (no race to the join)`);
  }

  // The join target is the summarize agent, and it feeds the branch.
  const summarize = p.nodes.find((n) => n.id === joinTarget);
  assert.ok(summarize && summarize.kind === 'agent', 'the join target is the summarize agent');
});

test('the join barrier runs summarize AFTER all three probes complete (behavioral)', async () => {
  const p = buildPrTriageProgram();
  const events: RunEvent[] = [];
  const result = await runProgram(p, executors, { onEvent: (e) => events.push(e) });
  assert.equal(result.status, 'completed');

  const probeDoneIndex = ['probe-intent', 'probe-quality', 'probe-conflicts'].map((id) =>
    events.findIndex((e) => e.nodeId === id && e.status === 'done')
  );
  for (const [i, idx] of probeDoneIndex.entries()) assert.ok(idx >= 0, `probe ${i} completed`);
  const summarizeRunningIndex = events.findIndex(
    (e) => e.nodeId === 'summarize' && e.status === 'running'
  );
  assert.ok(summarizeRunningIndex >= 0, 'summarize ran');
  // summarize must not start until every probe is done — the join barrier.
  for (const idx of probeDoneIndex) {
    assert.ok(summarizeRunningIndex > idx, 'summarize started only after all probes were done');
  }
  // And summarize ran exactly once (a barrier, not once-per-probe).
  const summarizeRuns = events.filter((e) => e.nodeId === 'summarize' && e.status === 'running');
  assert.equal(summarizeRuns.length, 1, 'summarize runs exactly once');
});

test('the branch is HONEST: both ends reachable over the supplied `mode` input (branch-true not dead)', async () => {
  const branch = buildPrTriageProgram().nodes.find((n) => n.kind === 'branch')!;
  const outs = buildPrTriageProgram().edges.filter((e) => e.from === branch.id);
  assert.ok(outs.some((e) => e.kind === 'branch-true'), 'has branch-true');
  assert.ok(outs.some((e) => e.kind === 'branch-false'), 'has branch-false');
  // The predicate reads a real, declared typed slot with an equality op (works on strings).
  assert.equal(branch.branch?.condition.left, 'mode');
  assert.equal(branch.branch?.condition.op, '==');
  assert.equal(branch.branch?.condition.right, STRICT_MODE);
  assert.equal(buildPrTriageProgram().state?.shape.mode, 'string');

  // mode=strict → the deep-review (branch-true) end fires; standard does not.
  const withMode = (mode: string): Program => {
    const p = buildPrTriageProgram();
    return { ...p, state: { shape: p.state!.shape, initial: { ...p.state!.initial, mode } } };
  };
  const strict = await runProgram(withMode(STRICT_MODE), executors);
  assert.equal(strict.status, 'completed');
  assert.equal(strict.nodeResults['end-deep']?.status, 'done', 'strict → deep-review reached');
  assert.equal(strict.nodeResults['end-standard'], undefined, 'strict → standard NOT reached');

  // The default (standard) → the standard-review (branch-false) end fires instead.
  const standard = await runProgram(withMode(DEFAULT_MODE), executors);
  assert.equal(standard.status, 'completed');
  assert.equal(standard.nodeResults['end-standard']?.status, 'done', 'default → standard-review reached');
  assert.equal(standard.nodeResults['end-deep'], undefined, 'default → deep NOT reached');
});

test('shipped .sequence/programs/pr-triage.json parses, validates, and matches the builder', () => {
  const here = dirname(fileURLToPath(import.meta.url)); // packages/schema/dist
  const jsonPath = resolve(here, '../../../.sequence/programs/pr-triage.json');
  const raw = JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;

  // It carries an honest $note that it is a template AND explains the honest branch.
  assert.equal(typeof raw.$note, 'string');
  assert.match(String(raw.$note), /template/i);
  assert.match(String(raw.$note), /\{stopReason,text\}/);
  assert.match(String(raw.$note), /mode/);

  const fromDisk = raw as unknown as Program;
  assert.deepEqual(validateProgram(fromDisk), { ok: true, errors: [] });

  // The serialized program is the builder's output (modulo the $note wrapper).
  const built = buildPrTriageProgram();
  assert.deepEqual(fromDisk.nodes, built.nodes);
  assert.deepEqual(fromDisk.edges, built.edges);
  assert.deepEqual(fromDisk.state, built.state);
});

test('shipped pr-triage.json round-trips through mermaid', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const jsonPath = resolve(here, '../../../.sequence/programs/pr-triage.json');
  const fromDisk = JSON.parse(readFileSync(jsonPath, 'utf8')) as Program;

  const back = mermaidToProgram(programToMermaid(fromDisk));
  assert.equal(back.nodes.length, fromDisk.nodes.length);
  assert.equal(back.edges.length, fromDisk.edges.length);
  const byId = new Map(back.nodes.map((n) => [n.id, n]));
  for (const n of fromDisk.nodes) {
    const b = byId.get(n.id);
    assert.ok(b, `node ${n.id} survived`);
    assert.equal(b!.kind, n.kind);
    assert.equal(b!.agent?.runtime, n.agent?.runtime);
  }
});
