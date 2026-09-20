/**
 * Compile a grounded agent-workflow `.seqd` into a validateProgram-clean {@link Program}.
 *
 * Design-time truth stays in SeqDiagram; execution is a frozen Program snapshot at
 * approve. Deterministic control flow only — LLM bodies live in agent node prompts.
 */

import type { Program, ProgramEdge, ProgramNode } from './program.js';
import { validateProgram } from './program.js';
import type { SeqDiagramV1, SeqDiagramNode } from './seqdiagram.js';
import { validateSeqDiagram } from './seqdiagram.js';
import { buildBuildArchitectureProgram } from './programs/buildArchitecture.js';
import { buildBuildArchitectureFullProgram } from './programs/buildArchitectureFull.js';
import { buildReviewLoopProgram } from './programs/reviewLoop.js';

export type CompileTier = 'minimal' | 'standard' | 'full';

export interface CompileSeqDiagramOptions {
  tier?: CompileTier;
}

export type CompileSeqDiagramResult =
  | { ok: true; program: Program; diagramHash: string }
  | { ok: false; errors: string[] };

const BOARD_KINDS = new Set(['service-flow', 'agent-workflow']);

/** Stable short hash of diagram content for run metadata (browser-safe). */
export function hashSeqDiagram(doc: SeqDiagramV1): string {
  const payload = JSON.stringify({
    kind: doc.kind,
    title: doc.title,
    nodes: doc.nodes,
    edges: doc.edges,
  });
  let h = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function defaultAgentPrompt(node: SeqDiagramNode): string {
  return (
    node.agent?.prompt ??
    `Execute the "${node.label}" step in the architecture workflow. Ground every claim in the attached scan.`
  );
}

function agentProgramNode(node: SeqDiagramNode, outKey?: string): ProgramNode {
  const pack = node.agent;
  return {
    id: `wf:${node.id}`,
    title: node.label,
    kind: 'agent',
    agent: {
      prompt: defaultAgentPrompt(node),
      intent: 'ask',
      ...(outKey ? { outKey } : {}),
      ...(pack?.runtime ? { runtime: pack.runtime } : {}),
      ...(pack?.runtime === 'acp' && pack.agentRef
        ? { acp: { agentRef: pack.agentRef } }
        : {}),
    },
  };
}

function isVerifierNode(node: SeqDiagramNode): boolean {
  const label = node.label.toLowerCase();
  return label.includes('verif') || label.includes('check') || label.includes('review');
}

function isBuilderNode(node: SeqDiagramNode): boolean {
  const label = node.label.toLowerCase();
  return label.includes('build') || label.includes('implement') || label.includes('coder');
}

/**
 * Dynamic compile: walk agent nodes following control edges; insert checker loops
 * after builder nodes when the diagram contains a cycle.
 */
function buildDynamicAgentWorkflowProgram(doc: SeqDiagramV1): Program {
  const agentNodes = doc.nodes.filter((n) => n.kind === 'agent');
  if (agentNodes.length === 0) {
    throw new Error('agent-workflow diagram has no agent nodes');
  }

  const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));
  const agentIds = new Set(agentNodes.map((n) => n.id));
  const controlEdges = doc.edges.filter((e) => e.family === 'control' || e.family === 'call');

  const outEdges = new Map<string, string[]>();
  for (const e of controlEdges) {
    if (!agentIds.has(e.from) || !agentIds.has(e.to)) continue;
    const list = outEdges.get(e.from) ?? [];
    list.push(e.to);
    outEdges.set(e.from, list);
  }

  const inDegree = new Map<string, number>();
  for (const id of agentIds) inDegree.set(id, 0);
  for (const [from, tos] of outEdges) {
    for (const to of tos) inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  }

  const starts = [...agentIds].filter((id) => (inDegree.get(id) ?? 0) === 0);
  const order: SeqDiagramNode[] = [];
  const seen = new Set<string>();
  const queue = starts.length > 0 ? [...starts] : [agentNodes[0]!.id];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = nodeById.get(id);
    if (node?.kind === 'agent') order.push(node);
    for (const next of outEdges.get(id) ?? []) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  for (const n of agentNodes) {
    if (!seen.has(n.id)) order.push(n);
  }

  const hasCycle =
    controlEdges.some((e) => agentIds.has(e.from) && agentIds.has(e.to)) &&
    order.length < agentNodes.length + controlEdges.filter((e) => agentIds.has(e.from)).length;

  const nodes: ProgramNode[] = [
    { id: 'start', title: 'Start', kind: 'start' },
    {
      id: 'state',
      title: 'Shared state',
      kind: 'state',
      state: {
        shape: {
          scoutNotes: 'string',
          claimedNodeIds: 'json',
          checkerOk: 'string',
          violations: 'string',
          reviewNotes: 'string',
        },
        initial: {
          scoutNotes: '',
          claimedNodeIds: [],
          checkerOk: 'no',
          violations: '',
          reviewNotes: '',
        },
      },
    },
  ];
  const edges: ProgramEdge[] = [
    { id: 'e-start-state', from: 'start', to: 'state', kind: 'seq' },
  ];

  let prev = 'state';
  let insertedLoop = false;

  for (const node of order) {
    const pid = `wf:${node.id}`;
    if (isVerifierNode(node) && hasCycle && !insertedLoop) {
      nodes.push({
        id: 'verify-loop',
        title: 'Verify until clean',
        kind: 'loop',
        loop: {
          condition: { left: 'checkerOk', op: '!=', right: 'yes' },
          maxIterations: 3,
        },
      });
      edges.push({ id: `e-${prev}-verify`, from: prev, to: 'verify-loop', kind: 'seq' });
      nodes.push(agentProgramNode(node, 'reviewNotes'));
      nodes.push({
        id: 'wf:checker',
        title: 'Grounded checker',
        kind: 'checker',
        checker: {
          claimedKey: 'claimedNodeIds',
          outKey: 'checkerOk',
          violationsKey: 'violations',
        },
      });
      edges.push({ id: 'e-verify-body', from: 'verify-loop', to: pid, kind: 'loop-body' });
      edges.push({ id: `e-${pid}-check`, from: pid, to: 'wf:checker', kind: 'seq' });
      edges.push({ id: 'e-check-back', from: 'wf:checker', to: 'verify-loop', kind: 'loop-back' });
      prev = 'verify-loop';
      insertedLoop = true;
      continue;
    }

    const outKey = isBuilderNode(node) ? 'claimedNodeIds' : undefined;
    nodes.push(agentProgramNode(node, outKey));
    edges.push({ id: `e-${prev}-${pid}`, from: prev, to: pid, kind: 'seq' });
    prev = pid;
  }

  nodes.push({ id: 'end', title: 'Done', kind: 'end' });
  edges.push({ id: 'e-end', from: prev, to: 'end', kind: 'seq' });

  return {
    id: 'compiled-agent-workflow',
    name: doc.title || 'Compiled agent workflow',
    description: `Compiled from agent-workflow diagram (${doc.nodes.length} nodes).`,
    state: {
      shape: {
        scoutNotes: 'string',
        claimedNodeIds: 'json',
        checkerOk: 'string',
        violations: 'string',
        reviewNotes: 'string',
      },
      initial: {
        scoutNotes: '',
        claimedNodeIds: [],
        checkerOk: 'no',
        violations: '',
        reviewNotes: '',
      },
    },
    nodes,
    edges,
  };
}

/**
 * Compile a SeqDiagram into a Program. Returns validation errors when the diagram
 * or compiled program is invalid.
 */
export function compileSeqDiagramToProgram(
  doc: SeqDiagramV1,
  options: CompileSeqDiagramOptions = {},
): CompileSeqDiagramResult {
  const tier = options.tier ?? 'standard';
  const diagCheck = validateSeqDiagram(doc);
  if (!diagCheck.ok) {
    return { ok: false, errors: diagCheck.errors };
  }

  if (!BOARD_KINDS.has(doc.kind)) {
    return {
      ok: false,
      errors: [`compile supports service-flow and agent-workflow, not ${doc.kind}`],
    };
  }

  let program: Program;
  try {
    if (doc.kind === 'agent-workflow') {
      if (tier === 'minimal') {
        program = buildReviewLoopProgram();
        program = {
          ...program,
          name: doc.title || program.name,
          description: `Tier 1 review loop for: ${doc.title}`,
        };
      } else if (tier === 'full') {
        program = buildBuildArchitectureFullProgram(doc);
      } else {
        program = buildBuildArchitectureProgram(doc);
      }
    } else {
      program = buildBuildArchitectureProgram(doc);
    }
  } catch (err) {
    return { ok: false, errors: [err instanceof Error ? err.message : String(err)] };
  }

  const check = validateProgram(program);
  if (!check.ok) {
    return { ok: false, errors: check.errors };
  }

  return { ok: true, program, diagramHash: hashSeqDiagram(doc) };
}

/** Export dynamic graph compile for tests — bypasses tier templates. */
export function compileAgentWorkflowGraph(doc: SeqDiagramV1): CompileSeqDiagramResult {
  const diagCheck = validateSeqDiagram(doc);
  if (!diagCheck.ok) return { ok: false, errors: diagCheck.errors };
  if (doc.kind !== 'agent-workflow') {
    return { ok: false, errors: ['compileAgentWorkflowGraph requires agent-workflow kind'] };
  }
  try {
    const program = buildDynamicAgentWorkflowProgram(doc);
    const check = validateProgram(program);
    if (!check.ok) return { ok: false, errors: check.errors };
    return { ok: true, program, diagramHash: hashSeqDiagram(doc) };
  } catch (err) {
    return { ok: false, errors: [err instanceof Error ? err.message : String(err)] };
  }
}
