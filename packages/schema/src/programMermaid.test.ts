import assert from 'node:assert';
import { test } from 'node:test';
import { programToMermaid, mermaidToProgram } from './programMermaid.js';
import { buildPrTriageProgram } from './programs/prTriage.js';
import type { Program } from './program.js';

/**
 * Round-trip + determinism lock for the ProgramGraph ⇄ Mermaid dialect (v16
 * Phase 4). The dialect carries node id/kind/title, agent runtime, and edge
 * from/to/kind — those must survive `mermaidToProgram(programToMermaid(p))`.
 */

/** Compare only the fields the mermaid dialect is contracted to preserve. */
function assertStructurallyEqual(actual: Program, expected: Program): void {
  assert.equal(actual.nodes.length, expected.nodes.length, 'node count');
  const byId = new Map(actual.nodes.map((n) => [n.id, n]));
  for (const en of expected.nodes) {
    const an = byId.get(en.id);
    assert.ok(an, `node ${en.id} reproduced`);
    assert.equal(an!.kind, en.kind, `node ${en.id} kind`);
    assert.equal(an!.title, en.title, `node ${en.id} title`);
    // agent.runtime — including the undefined / 'gateway' / 'acp' three-way.
    assert.equal(an!.agent?.runtime, en.agent?.runtime, `node ${en.id} agent.runtime`);
  }

  assert.equal(actual.edges.length, expected.edges.length, 'edge count');
  const key = (e: { from: string; to: string; kind: string }) => `${e.from}->${e.to}:${e.kind}`;
  const actualEdges = new Set(actual.edges.map(key));
  for (const ee of expected.edges) {
    assert.ok(actualEdges.has(key(ee)), `edge ${key(ee)} reproduced`);
  }
}

/** A program exercising every runtime state: acp, explicit gateway, and absent. */
function mixedRuntimeProgram(): Program {
  return {
    id: 'mix',
    name: 'mixed runtimes',
    nodes: [
      { id: 's', title: 'start', kind: 'start' },
      { id: 'fan', title: 'fan out', kind: 'parallel' },
      { id: 'a-acp', title: 'Extract intent', kind: 'agent', agent: { prompt: 'p', runtime: 'acp', acp: { agentRef: 'x' } } },
      { id: 'a-gw', title: 'Ask gateway', kind: 'agent', agent: { prompt: 'p', runtime: 'gateway' } },
      { id: 'a-def', title: 'Ask default', kind: 'agent', agent: { prompt: 'p' } },
      { id: 'br', title: 'gate', kind: 'branch', branch: { condition: { left: 'x', op: 'truthy' } } },
      { id: 'e-t', title: 'yes', kind: 'end' },
      { id: 'e-f', title: 'no', kind: 'end' },
    ],
    edges: [
      { id: '1', from: 's', to: 'fan', kind: 'seq' },
      { id: '2', from: 'fan', to: 'a-acp', kind: 'parallel' },
      { id: '3', from: 'fan', to: 'a-gw', kind: 'parallel' },
      { id: '4', from: 'fan', to: 'a-def', kind: 'parallel' },
      { id: '5', from: 'a-acp', to: 'br', kind: 'seq' },
      { id: '6', from: 'a-gw', to: 'br', kind: 'seq' },
      { id: '7', from: 'a-def', to: 'br', kind: 'seq' },
      { id: '8', from: 'br', to: 'e-t', kind: 'branch-true' },
      { id: '9', from: 'br', to: 'e-f', kind: 'branch-false' },
    ],
  };
}

/** A program with a title full of Mermaid-hostile characters. */
function hostileTitleProgram(): Program {
  return {
    id: 'h',
    name: 'hostile',
    nodes: [
      { id: 'weird id #1', title: 'Do "this" [now] | {maybe} <ok>', kind: 'start' },
      { id: 'x', title: 'end', kind: 'end' },
    ],
    edges: [{ id: 'e', from: 'weird id #1', to: 'x', kind: 'seq' }],
  };
}

test('programToMermaid: output starts with flowchart and is non-empty', () => {
  const m = programToMermaid(buildPrTriageProgram());
  assert.ok(m.length > 0);
  assert.ok(m.startsWith('flowchart'), m.slice(0, 20));
});

test('mermaid round-trips the PR-triage program (parallel + branch + acp)', () => {
  const p = buildPrTriageProgram();
  const back = mermaidToProgram(programToMermaid(p));
  assertStructurallyEqual(back, p);
  // The acp probe runtimes specifically survived.
  const acpCount = back.nodes.filter((n) => n.kind === 'agent' && n.agent?.runtime === 'acp').length;
  assert.ok(acpCount >= 3, `expected ≥3 acp agent nodes, got ${acpCount}`);
});

test('mermaid preserves the undefined / gateway / acp runtime distinction', () => {
  const p = mixedRuntimeProgram();
  const back = mermaidToProgram(programToMermaid(p));
  assertStructurallyEqual(back, p);
  const rt = (id: string) => back.nodes.find((n) => n.id === id)?.agent?.runtime;
  assert.equal(rt('a-acp'), 'acp');
  assert.equal(rt('a-gw'), 'gateway');
  assert.equal(rt('a-def'), undefined);
});

test('mermaid round-trips ids/titles with Mermaid-hostile characters', () => {
  const p = hostileTitleProgram();
  const m = programToMermaid(p);
  const back = mermaidToProgram(m);
  assertStructurallyEqual(back, p);
});

test('programToMermaid is deterministic (identical string for identical input)', () => {
  const p = buildPrTriageProgram();
  assert.equal(programToMermaid(p), programToMermaid(p));
  assert.equal(programToMermaid(mixedRuntimeProgram()), programToMermaid(mixedRuntimeProgram()));
});

test('programToMermaid throws on an edge referencing an unknown node', () => {
  const p: Program = {
    id: 'bad', name: 'bad',
    nodes: [{ id: 's', title: 's', kind: 'start' }],
    edges: [{ id: 'e', from: 's', to: 'ghost', kind: 'seq' }],
  };
  assert.throws(() => programToMermaid(p), /unknown to-node ghost/);
});

test('programToMermaid emits classDef styling for gate, checker, parallel, and worker roles', () => {
  const p = mixedRuntimeProgram();
  const m = programToMermaid(p);
  assert.ok(m.includes('classDef gate'), 'gate classDef present');
  assert.ok(m.includes('classDef checker'), 'checker classDef present');
  assert.ok(m.includes('classDef parallel'), 'parallel classDef present');
  assert.ok(m.includes('classDef worker'), 'worker classDef present');
  assert.ok(m.includes('class N5 gate'), 'branch node gets gate class');
  const back = mermaidToProgram(m);
  assertStructurallyEqual(back, p);
});

test('mermaidToProgram throws on malformed input', () => {
  assert.throws(() => mermaidToProgram(''), /flowchart/);
  assert.throws(() => mermaidToProgram('graph TD\n  A --> B'), /flowchart/);
  assert.throws(() => mermaidToProgram('flowchart TD\n  this is not a node line'), /unrecognized line/);
  // A node line whose label is not our dialect.
  assert.throws(() => mermaidToProgram('flowchart TD\n  N0["just a plain label"]'), /unparseable node label/);
  // An unknown node kind.
  assert.throws(() => mermaidToProgram('flowchart TD\n  N0["x [wobble] @n"]'), /unknown node kind/);
  // An edge to an undeclared mermaid node.
  assert.throws(
    () => mermaidToProgram('flowchart TD\n  N0["s [start] @s"]\n  N0 -->|seq| N9'),
    /undeclared node N9/,
  );
});
