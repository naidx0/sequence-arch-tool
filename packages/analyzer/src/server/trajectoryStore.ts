/**
 * Trajectory persistence — Phase 1 (ask path).
 *
 * After `/api/ask/stream` completes, the run's streamed trace + a thin
 * event-bound graph are written to `.sequence/trajectory/<runId>.json`. The doc
 * lists ONLY real streamed events — no fabricated tool calls, no invented
 * decision nodes. The graph is linear over the intent/file/provider events that
 * actually fired; an empty trace yields an empty (still valid) graph.
 *
 * Program runs (kind `'program'`) are written by the client via POST /api/trajectory
 * using the same doc shape; the server only validates + persists.
 */

import path from 'node:path';
import { readJson, writeJson, SEQUENCE_DIR } from './store.js';

/** The trajectory sub-directory of `.sequence/`. */
export const TRAJECTORY_DIR = 'trajectory';

/** Harness run graph node carried in a trajectory doc (mirrors HarnessRunNode). */
export interface TrajectoryGraphNode {
  id: string;
  kind: 'decision' | 'action' | 'tool' | 'correction' | 'start' | 'end';
  title: string;
  order: number;
  status: 'idle' | 'queued' | 'running' | 'done' | 'error';
  evidence?: string;
  error?: string;
}

/** Harness run graph edge carried in a trajectory doc (mirrors HarnessRunEdge). */
export interface TrajectoryGraphEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

/** The graph embedded in a trajectory doc. */
export interface TrajectoryGraph {
  runId: string;
  programId?: string;
  nodes: TrajectoryGraphNode[];
  edges: TrajectoryGraphEdge[];
}

/** A per-run status transition recorded alongside the graph (program runs). */
export interface TrajectoryRunEvent {
  nodeId: string;
  status: string;
  at?: number;
  error?: string;
}

/** The persisted trajectory document. */
export interface TrajectoryDoc {
  version: 1;
  runId: string;
  kind: 'ask' | 'program';
  startedAt: string;
  finishedAt?: string;
  programId?: string;
  /** The user's ask question (ask runs only). */
  question?: string;
  askTrace: Array<Record<string, unknown>>;
  askTerminal?: { type: 'result' | 'error' } & Record<string, unknown>;
  /**
   * A0.3 — ask metrics lifted from the terminal `result` for scorecard export.
   * Absent on program runs and surface-only answers without a metrics payload.
   */
  askMetrics?: {
    wallMs?: number;
    rounds?: number;
    inputTokens?: number;
    outputTokens?: number;
    stopReason?: string;
    designMode?: boolean;
    intent?: string;
  };
  graph: TrajectoryGraph;
  runEvents?: TrajectoryRunEvent[];
}

/** Pull ask metrics off a terminal result event when present. */
export function askMetricsFromTerminal(
  terminal: { type: 'result' | 'error' } & Record<string, unknown>,
): TrajectoryDoc['askMetrics'] | undefined {
  if (terminal.type !== 'result') return undefined;
  const raw = terminal.metrics;
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as Record<string, unknown>;
  const out: NonNullable<TrajectoryDoc['askMetrics']> = {};
  if (typeof m.wallMs === 'number') out.wallMs = m.wallMs;
  if (typeof m.rounds === 'number') out.rounds = m.rounds;
  if (typeof m.inputTokens === 'number') out.inputTokens = m.inputTokens;
  if (typeof m.outputTokens === 'number') out.outputTokens = m.outputTokens;
  if (typeof m.stopReason === 'string') out.stopReason = m.stopReason;
  if (typeof m.designMode === 'boolean') out.designMode = m.designMode;
  if (typeof m.intent === 'string') out.intent = m.intent;
  return Object.keys(out).length > 0 ? out : undefined;
}

function trajectoryPath(repoRoot: string, runId: string): string {
  return path.join(TRAJECTORY_DIR, `${runId}.json`);
}

/** Write a trajectory doc to `.sequence/trajectory/<runId>.json`. */
export function writeTrajectory(repoRoot: string, doc: TrajectoryDoc): void {
  writeJson(repoRoot, trajectoryPath(repoRoot, doc.runId), doc);
}

/** Read a trajectory doc by runId; undefined when absent or unparseable. */
export function readTrajectory(repoRoot: string, runId: string): TrajectoryDoc | undefined {
  return readJson<TrajectoryDoc>(repoRoot, trajectoryPath(repoRoot, runId));
}

/** Light structural validation of a trajectory doc. */
export function isTrajectoryDoc(value: unknown): value is TrajectoryDoc {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return false;
  if (typeof v.runId !== 'string' || v.runId.length === 0) return false;
  if (v.kind !== 'ask' && v.kind !== 'program') return false;
  if (typeof v.startedAt !== 'string') return false;
  const g = v.graph;
  if (!g || typeof g !== 'object') return false;
  const gr = g as Record<string, unknown>;
  if (typeof gr.runId !== 'string') return false;
  if (!Array.isArray(gr.nodes) || !Array.isArray(gr.edges)) return false;
  return true;
}

/**
 * Build a linear harness graph from an ask stream trace. Nodes come ONLY from
 * intent / file / provider events that actually fired — kind `action` for intents
 * and the provider call, kind `tool` for file reads (with `evidence` = the path).
 * A node that completed (`:done`) is `done`; one that only started is `running`.
 * No decision nodes are invented; an empty trace yields an empty node list.
 * Edges chain the nodes in encounter order so the graph reads top-down linearly.
 */
export function buildAskTrajectoryGraph(
  runId: string,
  askTrace: ReadonlyArray<Record<string, unknown>>,
): TrajectoryGraph {
  const order: string[] = [];
  const seen = new Set<string>();
  const done = new Set<string>();
  const titles = new Map<string, string>();
  const evidences = new Map<string, string>();
  const kinds = new Map<string, 'action' | 'tool'>();

  const ensure = (id: string, kind: 'action' | 'tool', title: string, evidence?: string): void => {
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
      kinds.set(id, kind);
      titles.set(id, title);
      if (evidence !== undefined) evidences.set(id, evidence);
    }
  };

  for (const ev of askTrace) {
    const t = ev.type;
    if (t === 'intent:start' || t === 'intent:done') {
      const id = ev.id;
      if (typeof id !== 'string' || id.length === 0) continue;
      const nodeId = `intent:${id}`;
      ensure(nodeId, 'action', `Intent: ${id}`);
      if (t === 'intent:done') done.add(nodeId);
    } else if (t === 'file:read' || t === 'file:done') {
      const p = ev.path;
      if (typeof p !== 'string' || p.length === 0) continue;
      const nodeId = `file:${p}`;
      ensure(nodeId, 'tool', p, p);
      if (t === 'file:done') done.add(nodeId);
    } else if (t === 'provider:start' || t === 'provider:done') {
      const nodeId = 'provider';
      ensure(nodeId, 'action', 'Provider');
      if (t === 'provider:done') done.add(nodeId);
    } else if (t === 'step:start' || t === 'step:done') {
      const id = ev.id;
      if (typeof id !== 'string' || id.length === 0) continue;
      const nodeId = `step:${id}`;
      ensure(nodeId, 'action', `Step: ${id}`);
      if (t === 'step:done') done.add(nodeId);
    } else if (t === 'tool:start' || t === 'tool:done') {
      const id = ev.id;
      if (typeof id !== 'string' || id.length === 0) continue;
      const nodeId = `tool:${id}`;
      const title = typeof ev.name === 'string' && ev.name.length > 0 ? ev.name : id;
      ensure(nodeId, 'tool', title, typeof ev.evidence === 'string' ? ev.evidence : undefined);
      if (t === 'tool:done') done.add(nodeId);
    }
  }

  const nodes: TrajectoryGraphNode[] = order.map((id, i) => ({
    id,
    kind: kinds.get(id)!,
    title: titles.get(id)!,
    order: i,
    status: done.has(id) ? 'done' : 'running',
    ...(evidences.has(id) ? { evidence: evidences.get(id) } : {}),
  }));

  const edges: TrajectoryGraphEdge[] = [];
  for (let i = 1; i < order.length; i++) {
    edges.push({ id: `e${i}`, from: order[i - 1], to: order[i] });
  }

  return { runId, nodes, edges };
}
