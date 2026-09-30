/**
 * Tier 2 — Standard "Build this architecture" program template.
 *
 * Scout → plan → build loop with grounded checker → review. Prompts on diagram
 * agent nodes override defaults when present.
 */

import type { Program } from '../program.js';
import type { SeqDiagramV1, SeqDiagramNode } from '../seqdiagram.js';
import { DOGFOOD_MAX_ITERATIONS } from './dogfoodLoop.js';

function promptFor(doc: SeqDiagramV1, match: RegExp, fallback: string): string {
  const node = doc.nodes.find((n) => n.kind === 'agent' && match.test(n.label));
  return node?.agent?.prompt ?? fallback;
}

function runtimeFor(doc: SeqDiagramV1, match: RegExp): 'gateway' | 'acp' | undefined {
  const node = doc.nodes.find((n) => n.kind === 'agent' && match.test(n.label));
  return node?.agent?.runtime;
}

function acpFor(doc: SeqDiagramV1, match: RegExp) {
  const node = doc.nodes.find((n) => n.kind === 'agent' && match.test(n.label));
  if (node?.agent?.runtime === 'acp' && node.agent.agentRef) {
    return { agentRef: node.agent.agentRef };
  }
  return undefined;
}

export function buildBuildArchitectureProgram(doc?: SeqDiagramV1): Program {
  const scoutPrompt = doc
    ? promptFor(
        doc,
        /scout|orchestrat|planner/i,
        'Scout the attached architecture graph. List real node ids and edges relevant to the user intent. Cite evidence only.',
      )
    : 'Scout the attached architecture graph. List real node ids and edges relevant to the user intent. Cite evidence only.';

  const planPrompt = doc
    ? promptFor(
        doc,
        /plan/i,
        'Write a concise build plan as scoutNotes: ordered steps, scoped node ids, risks. No invented topology.',
      )
    : 'Write a concise build plan: ordered steps, scoped node ids, risks. Grounded only.';

  const buildPrompt = doc
    ? promptFor(
        doc,
        /build|implement|coder/i,
        'Using scoutNotes (and violations if any), propose claimedNodeIds as a JSON array of real architecture node ids for the build step.',
      )
    : 'Propose claimedNodeIds as a JSON array of real architecture node ids for the build step. Grounded only.';

  const reviewPrompt = doc
    ? promptFor(
        doc,
        /verif|review|check/i,
        'Write reviewNotes: what passed the checker, remaining risks, and a ship checklist. No fake claims.',
      )
    : 'Write reviewNotes: what passed the checker, remaining risks, and a ship checklist.';

  const scoutRuntime = doc ? runtimeFor(doc, /scout|orchestrat|planner/i) : undefined;
  const buildRuntime = doc ? runtimeFor(doc, /build|implement|coder/i) : 'acp';

  return {
    id: 'build-architecture',
    name: doc?.title ?? 'Build architecture',
    description:
      'Tier 2: scout → plan → build loop with grounded checker → review. ' +
      'Agents propose; the checker commits.',
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
    nodes: [
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
      {
        id: 'scout',
        title: 'Scout graph',
        kind: 'agent',
        agent: {
          prompt: scoutPrompt,
          intent: 'ask',
          outKey: 'scoutNotes',
          ...(scoutRuntime ? { runtime: scoutRuntime } : {}),
          ...(scoutRuntime === 'acp' && doc ? { acp: acpFor(doc, /scout|orchestrat|planner/i) } : {}),
        },
      },
      {
        id: 'plan',
        title: 'Plan build',
        kind: 'agent',
        agent: {
          prompt: planPrompt,
          intent: 'ask',
          outKey: 'scoutNotes',
        },
      },
      {
        id: 'gate',
        title: 'Build until checker clean',
        kind: 'loop',
        loop: {
          condition: { left: 'checkerOk', op: '!=', right: 'yes' },
          maxIterations: DOGFOOD_MAX_ITERATIONS,
        },
      },
      {
        id: 'build',
        title: 'Propose build ids',
        kind: 'agent',
        agent: {
          prompt: buildPrompt,
          intent: 'ask',
          outKey: 'claimedNodeIds',
          runtime: buildRuntime ?? 'acp',
          ...(buildRuntime === 'acp' && doc ? { acp: acpFor(doc, /build|implement|coder/i) } : {}),
        },
      },
      {
        id: 'check',
        title: 'Grounded checker',
        kind: 'checker',
        checker: {
          claimedKey: 'claimedNodeIds',
          outKey: 'checkerOk',
          violationsKey: 'violations',
        },
      },
      {
        id: 'review',
        title: 'Review note',
        kind: 'agent',
        agent: {
          prompt: reviewPrompt,
          intent: 'ask',
          outKey: 'reviewNotes',
        },
      },
      { id: 'end', title: 'Done', kind: 'end' },
    ],
    edges: [
      { id: 'e-start-state', from: 'start', to: 'state', kind: 'seq' },
      { id: 'e-state-scout', from: 'state', to: 'scout', kind: 'seq' },
      { id: 'e-scout-plan', from: 'scout', to: 'plan', kind: 'seq' },
      { id: 'e-plan-gate', from: 'plan', to: 'gate', kind: 'seq' },
      { id: 'e-gate-body', from: 'gate', to: 'build', kind: 'loop-body' },
      { id: 'e-build-check', from: 'build', to: 'check', kind: 'seq' },
      { id: 'e-check-back', from: 'check', to: 'gate', kind: 'loop-back' },
      { id: 'e-gate-review', from: 'gate', to: 'review', kind: 'seq' },
      { id: 'e-review-end', from: 'review', to: 'end', kind: 'seq' },
    ],
  };
}
