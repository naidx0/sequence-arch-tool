/**
 * Dogfood scout → build → gate → review Program template (harness-plan W5).
 *
 * Honest minimal version of the internal R&D loop as a user-loadable Program:
 * scout grounded context → propose build ids → checker gate (loop) → review note.
 * Agents propose; only the checker commits. No fabricated web scrape.
 */

import type { Program } from '../program.js';

/** Max gate iterations before a loud loop-cap exit. */
export const DOGFOOD_MAX_ITERATIONS = 3;

/**
 * Build the dogfood-loop {@link Program}. validateProgram-clean.
 */
export function buildDogfoodLoopProgram(): Program {
  return {
    id: 'dogfood-loop',
    name: 'Dogfood scout→build→gate→review',
    description:
      'Minimal dogfood harness: scout the attached graph → propose build ids → ' +
      'grounded checker gate (loop until clean) → review note. Agents propose; ' +
      'the checker commits. Local-first — no network scrape.',
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
          prompt:
            'Scout the attached architecture graph. List real node ids and edges ' +
            'relevant to the user intent. Cite evidence only — say "not in scan" ' +
            'rather than invent. Write scoutNotes.',
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
          prompt:
            'Using scoutNotes (and violations if any), propose claimedNodeIds as a ' +
            'JSON array of real architecture node ids for the build step. Grounded only.',
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
      {
        id: 'review',
        title: 'Review note',
        kind: 'agent',
        agent: {
          prompt:
            'Write a short reviewNotes paragraph: what passed the checker, remaining ' +
            'risks on the real graph, and a promote-to-ship checklist. No fake claims.',
          intent: 'ask',
          outKey: 'reviewNotes',
        },
      },
      { id: 'end', title: 'Done', kind: 'end' },
    ],
    edges: [
      { id: 'e-start-state', from: 'start', to: 'state', kind: 'seq' },
      { id: 'e-state-scout', from: 'state', to: 'scout', kind: 'seq' },
      { id: 'e-scout-gate', from: 'scout', to: 'gate', kind: 'seq' },
      { id: 'e-gate-body', from: 'gate', to: 'build', kind: 'loop-body' },
      { id: 'e-build-check', from: 'build', to: 'check', kind: 'seq' },
      { id: 'e-check-back', from: 'check', to: 'gate', kind: 'loop-back' },
      { id: 'e-gate-review', from: 'gate', to: 'review', kind: 'seq' },
      { id: 'e-review-end', from: 'review', to: 'end', kind: 'seq' },
    ],
  };
}
