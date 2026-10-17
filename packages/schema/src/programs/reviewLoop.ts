/**
 * Grounded review-loop Program template (harness-plan W5).
 *
 * Shape: propose claimed graph ids → deterministic checker → loop until pass
 * (or maxIterations). Fixture-runnable with a mock agent + real ArchGraph —
 * no LLM required for the gate.
 *
 * Honesty: the agent proposes ids into shared state; only the checker (pure
 * checkGraphMutation) decides pass/fail. Ungrounded ids never apply.
 */

import type { Program } from '../program.js';

/** Max verify iterations before a loud loop-cap exit. */
export const REVIEW_LOOP_MAX_ITERATIONS = 3;

/**
 * Build the review-loop {@link Program}. validateProgram-clean.
 *
 * Shared state:
 *  - claimedNodeIds: agent proposal (string[] or JSON)
 *  - checkerOk: 'yes' | 'no' (checker outKey)
 *  - violations: human-readable join of checker failures
 */
export function buildReviewLoopProgram(): Program {
  return {
    id: 'review-loop',
    name: 'Review loop (grounded)',
    description:
      'Propose graph node ids → grounded checker → re-loop until clean or max ' +
      `${REVIEW_LOOP_MAX_ITERATIONS} attempts. Agents propose; the checker commits.`,
    state: {
      shape: {
        claimedNodeIds: 'json',
        checkerOk: 'string',
        violations: 'string',
      },
      initial: {
        checkerOk: 'no',
        claimedNodeIds: [],
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
            checkerOk: 'string',
            violations: 'string',
          },
          initial: {
            checkerOk: 'no',
            claimedNodeIds: [],
            violations: '',
          },
        },
      },
      {
        id: 'verify',
        title: 'Verify until clean',
        kind: 'loop',
        loop: {
          condition: { left: 'checkerOk', op: '!=', right: 'yes' },
          maxIterations: REVIEW_LOOP_MAX_ITERATIONS,
        },
      },
      {
        id: 'propose',
        title: 'Propose ids',
        kind: 'agent',
        agent: {
          prompt:
            'Propose claimedNodeIds for the change as a JSON string array of real ' +
            'architecture node ids from the attached graph. If prior violations ' +
            'exist in state, fix them. Write only grounded ids.',
          intent: 'ask',
          outKey: 'claimedNodeIds',
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
      { id: 'e-propose-check', from: 'propose', to: 'check', kind: 'seq' },
      { id: 'e-check-back', from: 'check', to: 'verify', kind: 'loop-back' },
      { id: 'e-verify-end', from: 'verify', to: 'end', kind: 'seq' },
    ],
  };
}
