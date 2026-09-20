/**
 * Grounded council-against-risks Program template (harness-plan W5).
 *
 * Shape: propose claimed graph ids → parallel N critics (SPOF / blast-radius /
 * cycles lenses) → synthesize → deterministic checker. Agents propose; only the
 * checker commits. Fixture-runnable with mock agents + real ArchGraph.
 */

import type { Program } from '../program.js';

/** Max verify iterations before a loud loop-cap exit. */
export const COUNCIL_MAX_ITERATIONS = 2;

/**
 * Build the council-against-risks {@link Program}. validateProgram-clean.
 *
 * Shared state:
 *  - claimedNodeIds: agent proposal (string[] / JSON)
 *  - criticSpof / criticBlast / criticCycles: parallel critic notes
 *  - synthesis: merged council output
 *  - checkerOk: 'yes' | 'no'
 *  - violations: joined checker failures
 */
export function buildCouncilAgainstRisksProgram(): Program {
  return {
    id: 'council-against-risks',
    name: 'Council against risks',
    description:
      'Propose a change → N critics score it against SPOF / blast-radius / cycles ' +
      'lenses on the real graph → synthesize → grounded checker. Agents propose; ' +
      'the checker commits.',
    state: {
      shape: {
        claimedNodeIds: 'json',
        criticSpof: 'string',
        criticBlast: 'string',
        criticCycles: 'string',
        synthesis: 'string',
        checkerOk: 'string',
        violations: 'string',
      },
      initial: {
        claimedNodeIds: [],
        criticSpof: '',
        criticBlast: '',
        criticCycles: '',
        synthesis: '',
        checkerOk: 'no',
        violations: '',
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
            claimedNodeIds: 'json',
            criticSpof: 'string',
            criticBlast: 'string',
            criticCycles: 'string',
            synthesis: 'string',
            checkerOk: 'string',
            violations: 'string',
          },
          initial: {
            claimedNodeIds: [],
            criticSpof: '',
            criticBlast: '',
            criticCycles: '',
            synthesis: '',
            checkerOk: 'no',
            violations: '',
          },
        },
      },
      {
        id: 'verify',
        title: 'Council until clean',
        kind: 'loop',
        loop: {
          condition: { left: 'checkerOk', op: '!=', right: 'yes' },
          maxIterations: COUNCIL_MAX_ITERATIONS,
        },
      },
      {
        id: 'propose',
        title: 'Propose change ids',
        kind: 'agent',
        agent: {
          prompt:
            'Propose claimedNodeIds for the change as a JSON string array of real ' +
            'architecture node ids. If prior violations or critic notes exist, fix them. ' +
            'Write only grounded ids.',
          intent: 'ask',
          outKey: 'claimedNodeIds',
        },
      },
      { id: 'fan', title: 'Risk council', kind: 'parallel' },
      {
        id: 'critic-spof',
        title: 'SPOF critic',
        kind: 'agent',
        agent: {
          prompt:
            'Score the proposed claimedNodeIds against single points of failure on the ' +
            'attached graph. Cite real node ids only. One short paragraph.',
          intent: 'ask',
          outKey: 'criticSpof',
        },
      },
      {
        id: 'critic-blast',
        title: 'Blast-radius critic',
        kind: 'agent',
        agent: {
          prompt:
            'Score the proposal against blast radius (impactedBy) on the attached graph. ' +
            'Cite real node ids only. One short paragraph.',
          intent: 'ask',
          outKey: 'criticBlast',
        },
      },
      {
        id: 'critic-cycles',
        title: 'Cycles critic',
        kind: 'agent',
        agent: {
          prompt:
            'Score the proposal against circular dependencies on the attached graph. ' +
            'Cite real node ids only. One short paragraph.',
          intent: 'ask',
          outKey: 'criticCycles',
        },
      },
      {
        id: 'synthesize',
        title: 'Synthesize council',
        kind: 'agent',
        agent: {
          prompt:
            'Merge criticSpof, criticBlast, and criticCycles into one grounded risk ' +
            'brief. Keep claimedNodeIds as the proposal under review.',
          intent: 'ask',
          outKey: 'synthesis',
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
      { id: 'end', title: 'Done', kind: 'end' },
    ],
    edges: [
      { id: 'e-start-state', from: 'start', to: 'state', kind: 'seq' },
      { id: 'e-state-verify', from: 'state', to: 'verify', kind: 'seq' },
      { id: 'e-verify-body', from: 'verify', to: 'propose', kind: 'loop-body' },
      { id: 'e-propose-fan', from: 'propose', to: 'fan', kind: 'seq' },
      { id: 'e-fan-spof', from: 'fan', to: 'critic-spof', kind: 'parallel' },
      { id: 'e-fan-blast', from: 'fan', to: 'critic-blast', kind: 'parallel' },
      { id: 'e-fan-cycles', from: 'fan', to: 'critic-cycles', kind: 'parallel' },
      { id: 'e-fan-synth', from: 'fan', to: 'synthesize', kind: 'seq' },
      { id: 'e-synth-check', from: 'synthesize', to: 'check', kind: 'seq' },
      { id: 'e-check-back', from: 'check', to: 'verify', kind: 'loop-back' },
      { id: 'e-verify-end', from: 'verify', to: 'end', kind: 'seq' },
    ],
  };
}
