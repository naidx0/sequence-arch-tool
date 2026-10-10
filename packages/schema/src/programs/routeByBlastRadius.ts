/**
 * Grounded route-by-blast-radius Program template (harness-plan W5).
 *
 * Honesty: control flow branches on a SUPPLIED typed state slot `blastBand`
 * ('high' | 'low'), not on a score parsed from agent text — same discipline as
 * PR-triage `mode`. The runner (or a prior grounded compute) seeds blastBand
 * from real impact data; the graph does not invent it.
 *
 * Shape: start → branch(blastBand==high) → smart deep path | cheap mechanical
 * path → both write claimedNodeIds → checker → end.
 */

import type { Program } from '../program.js';

/** Blast band that routes to the smart / deep review path. */
export const HIGH_BLAST_BAND = 'high';
/** Default band when no input is supplied — cheap mechanical path. */
export const DEFAULT_BLAST_BAND = 'low';

/**
 * Build the route-by-blast-radius {@link Program}. validateProgram-clean.
 */
export function buildRouteByBlastRadiusProgram(): Program {
  return {
    id: 'route-by-blast-radius',
    name: 'Route by blast radius',
    description:
      'Task routing decided by grounded blastBand input (high → smart deep review; ' +
      'low → cheap mechanical). Both paths end at the grounded checker. Supply ' +
      'blastBand from real impact data — the graph does not invent it.',
    state: {
      shape: {
        blastBand: 'string',
        claimedNodeIds: 'json',
        routeNote: 'string',
        checkerOk: 'string',
        violations: 'string',
      },
      initial: {
        blastBand: DEFAULT_BLAST_BAND,
        claimedNodeIds: [],
        routeNote: '',
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
            blastBand: 'string',
            claimedNodeIds: 'json',
            routeNote: 'string',
            checkerOk: 'string',
            violations: 'string',
          },
          initial: {
            blastBand: DEFAULT_BLAST_BAND,
            claimedNodeIds: [],
            routeNote: '',
            checkerOk: 'no',
            violations: '',
          },
        },
      },
      {
        id: 'band-gate',
        title: 'Blast-band gate',
        kind: 'branch',
        branch: {
          condition: { left: 'blastBand', op: '==', right: HIGH_BLAST_BAND },
        },
      },
      {
        id: 'deep-route',
        title: 'Deep smart review',
        kind: 'agent',
        agent: {
          prompt:
            'High blast radius: carefully propose claimedNodeIds (JSON array of real ' +
            'graph node ids) for the change. Prefer minimal, grounded scope. Write ' +
            'routeNote summarizing why this is high-impact.',
          intent: 'ask',
          outKey: 'claimedNodeIds',
        },
      },
      {
        id: 'cheap-route',
        title: 'Cheap mechanical',
        kind: 'agent',
        agent: {
          prompt:
            'Low blast radius: mechanically list claimedNodeIds (JSON array of real ' +
            'graph node ids) for the change. Keep scope narrow. Write routeNote as one line.',
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
      { id: 'e-state-gate', from: 'state', to: 'band-gate', kind: 'seq' },
      { id: 'e-gate-deep', from: 'band-gate', to: 'deep-route', kind: 'branch-true' },
      { id: 'e-gate-cheap', from: 'band-gate', to: 'cheap-route', kind: 'branch-false' },
      { id: 'e-deep-check', from: 'deep-route', to: 'check', kind: 'seq' },
      { id: 'e-cheap-check', from: 'cheap-route', to: 'check', kind: 'seq' },
      { id: 'e-check-end', from: 'check', to: 'end', kind: 'seq' },
    ],
  };
}
