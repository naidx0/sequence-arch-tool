/**
 * Ordered tool-theater steps for propose_topology — Option A cleanliness.
 * No JSON, no strikethrough decoys; steps advance from work rows + stream hints.
 */

import type { WorkRow } from '../state/types';
import { looksLikeTopologyDump } from './stripToolProse';

export type TheaterStepStatus = 'done' | 'running' | 'pending';

export interface TheaterStep {
  id: 'called' | 'nodes' | 'edges' | 'checking';
  label: string;
  status: TheaterStepStatus;
}

export const TOPOLOGY_THEATER_TITLE = 'Drawing on Architecture';

export const TOPOLOGY_STEP_LABELS = {
  called: 'Topology tool called',
  nodes: 'Building nodes…',
  edges: 'Connecting edges',
  checking: 'Checking against request',
} as const;

export type TopologyStreamPhase = 'none' | 'called' | 'nodes' | 'edges';

export function isTopologyToolName(name: string): boolean {
  return name === 'propose_topology';
}

export function isTopologyWorkRow(row: Pick<WorkRow, 'from' | 'verb'>): boolean {
  if (row.from === 'topology:proposal') return true;
  return /propose_topology/.test(row.verb);
}

/** Running or landed tool row that called propose_topology. */
export function topologyToolRow(rows: readonly WorkRow[]): WorkRow | null {
  return rows.find((r) => /propose_topology/.test(r.verb)) ?? null;
}

/**
 * How far a mid-stream propose_topology / bare SeqDiagram dump has gotten —
 * used only to advance theater steps, never shown as prose.
 */
export function topologyStreamPhase(text: string): TopologyStreamPhase {
  const hasTool = /propose_topology/.test(text);
  const hasShape =
    looksLikeTopologyDump(text) ||
    (/"nodes"\s*:\s*\[/.test(text) &&
      (/"kind"\s*:\s*"[^"]*(?:sequence|workflow|flow|map)/i.test(text) ||
        /"id"\s*:\s*"(?:proposal|design):/.test(text)));
  if (!hasTool && !hasShape) return 'none';
  if (/"edges"\s*:/.test(text)) return 'edges';
  if (/"nodes"\s*:/.test(text)) return 'nodes';
  return 'called';
}

export interface TopologyTheaterActiveOpts {
  streaming?: boolean;
  hasOrphanTool?: boolean;
  streamText?: string;
}

/**
 * True while the Architecture theater should paint.
 * Live stream: advance with the dump. Settled: still show a landed theater
 * when the turn had propose_topology / topology:proposal / stripped dump —
 * never fall back to raw JSON (owner seat 2026-08-27).
 */
export function topologyTheaterActive(
  rows: readonly WorkRow[],
  opts: TopologyTheaterActiveOpts = {},
): boolean {
  const streaming = opts.streaming !== false;
  if (!streaming) {
    if (opts.hasOrphanTool) return true;
    if (rows.some(isTopologyWorkRow)) return true;
    if (opts.streamText && topologyStreamPhase(opts.streamText) !== 'none') return true;
    return false;
  }
  if (rows.some((r) => r.from === 'topology:proposal' && r.status !== 'running')) {
    return false;
  }
  if (rows.some((r) => isLiveTopoTool(r))) return true;
  if (opts.hasOrphanTool) return true;
  if (opts.streamText && topologyStreamPhase(opts.streamText) !== 'none') return true;
  return false;
}

function isLiveTopoTool(row: WorkRow): boolean {
  return row.status === 'running' && /propose_topology/.test(row.verb);
}

export interface DeriveTopologyStepsOpts {
  streamText?: string;
  /** Settled turn — all steps complete (landed theater). */
  landed?: boolean;
}

/**
 * Build ordered steps. Phase ladder:
 *   called → nodes → edges → checking → all done (proposal landed)
 */
export function deriveTopologySteps(
  rows: readonly WorkRow[],
  opts: DeriveTopologyStepsOpts = {},
): TheaterStep[] {
  const ids = ['called', 'nodes', 'edges', 'checking'] as const;
  const doneAll = (): TheaterStep[] =>
    ids.map((id) => ({
      id,
      label: TOPOLOGY_STEP_LABELS[id],
      status: 'done' as const,
    }));

  if (opts.landed) return doneAll();
  if (rows.some((r) => r.from === 'topology:proposal')) return doneAll();

  const tool = topologyToolRow(rows);
  const toolRunning = tool?.status === 'running';
  const toolDone = tool !== null && tool.status !== 'running';
  const stream = topologyStreamPhase(opts.streamText ?? '');

  /* Phase index of the RUNNING step (0=called … 3=checking). */
  let runningAt = 0;
  if (toolDone) runningAt = 3;
  else if (stream === 'edges') runningAt = 2;
  else if (stream === 'nodes' || (toolRunning && stream !== 'called')) runningAt = 1;
  else if (toolRunning) runningAt = 1;
  else if (stream === 'called' || opts.streamText) runningAt = 0;

  return ids.map((id, index) => {
    let status: TheaterStepStatus = 'pending';
    if (index < runningAt) status = 'done';
    else if (index === runningAt) status = 'running';
    return { id, label: TOPOLOGY_STEP_LABELS[id], status };
  });
}

/** Drop live propose_topology narration rows; keep landed proposal affordance. */
export function filterTopologyTheaterRows(rows: readonly WorkRow[]): WorkRow[] {
  return rows.filter((r) => {
    if (r.from === 'topology:proposal') return true;
    if (/propose_topology/.test(r.verb)) return false;
    return true;
  });
}
