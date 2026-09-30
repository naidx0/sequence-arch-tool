/**
 * Active program-run overlay state for Architecture board node status.
 */

import type { ProgramRunEvent } from '@sequence/api-types';

export type BoardRunNodeStatus = 'pending' | 'running' | 'done' | 'failed' | 'waiting_human';

export interface BoardRunOverlay {
  runId: string;
  programId: string;
  startedAt: number;
  elapsedMs: number;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'stopped';
  nodeStatus: Readonly<Record<string, BoardRunNodeStatus>>;
  activeEdgeId: string | null;
  lastEventSeq: number;
}

type Listener = (overlay: BoardRunOverlay | null) => void;

let overlay: BoardRunOverlay | null = null;
const listeners = new Set<Listener>();

export function getBoardRunOverlay(): BoardRunOverlay | null {
  return overlay;
}

export function subscribeBoardRunOverlay(fn: Listener): () => void {
  listeners.add(fn);
  fn(overlay);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) fn(overlay);
}

export function clearBoardRunOverlay(): void {
  overlay = null;
  lastRunningNodeId = null;
  emit();
}

export function initBoardRunOverlay(input: {
  runId: string;
  programId: string;
  nodeIds: string[];
}): void {
  const nodeStatus: Record<string, BoardRunNodeStatus> = {};
  for (const id of input.nodeIds) nodeStatus[id] = 'pending';
  overlay = {
    runId: input.runId,
    programId: input.programId,
    startedAt: Date.now(),
    elapsedMs: 0,
    status: 'running',
    nodeStatus,
    activeEdgeId: null,
    lastEventSeq: 0,
  };
  emit();
}

let lastRunningNodeId: string | null = null;

export function applyBoardRunEvent(event: ProgramRunEvent): void {
  if (!overlay) return;
  let next: BoardRunOverlay = { ...overlay, lastEventSeq: event.seq };
  if (event.type === 'node:status') {
    const status =
      event.status === 'running'
        ? 'running'
        : event.status === 'done'
          ? 'done'
          : event.status === 'error'
            ? 'failed'
            : 'pending';
    const nextStatus: Record<string, BoardRunNodeStatus> = {
      ...next.nodeStatus,
      [event.nodeId]: status,
    };
    let activeEdgeId = next.activeEdgeId;
    if (event.status === 'running') {
      if (lastRunningNodeId && lastRunningNodeId !== event.nodeId) {
        activeEdgeId = `${lastRunningNodeId}->${event.nodeId}`;
      }
      lastRunningNodeId = event.nodeId;
    }
    if (event.status === 'done' || event.status === 'error') {
      if (lastRunningNodeId === event.nodeId) lastRunningNodeId = null;
    }
    next = {
      ...next,
      nodeStatus: nextStatus,
      activeEdgeId,
    };
  }
  if (event.type === 'run:note' && event.kind === 'paused') {
    if (lastRunningNodeId) {
      next = {
        ...next,
        status: 'paused',
        nodeStatus: { ...next.nodeStatus, [lastRunningNodeId]: 'waiting_human' },
      };
    } else {
      next = { ...next, status: 'paused' };
    }
  }
  /* ══ A FINISHED RUN HAS NO ACTIVE EDGE ═════════════════════════════════

     `activeEdgeId` is the connector the run is CURRENTLY crossing, and
     `ConnectedBoard` tags it `runActive` with no status check, which board.css
     turns into `animation: board-run-edge 0.9s linear infinite`. Neither
     terminal branch used to clear it, so the last hop of the last run kept
     pulsing at 0.9s intervals for as long as the tab stayed open — on a board
     that looks, and is, idle.

     `lastRunningNodeId` is module state carried between events; leaving it set
     across the end of a run would let the FIRST node of the next run inherit an
     edge from the previous one, which is a connector nothing ever traversed. */
  if (event.type === 'run:finished') {
    next = {
      ...next,
      status: event.status === 'completed' ? 'completed' : 'failed',
      elapsedMs: Date.now() - next.startedAt,
      activeEdgeId: null,
    };
    lastRunningNodeId = null;
  }
  if (event.type === 'run:cancelled') {
    next = { ...next, status: 'stopped', elapsedMs: Date.now() - next.startedAt, activeEdgeId: null };
    lastRunningNodeId = null;
  }
  overlay = next;
  emit();
}

export function tickBoardRunElapsed(): void {
  if (!overlay || overlay.status !== 'running') return;
  overlay = { ...overlay, elapsedMs: Date.now() - overlay.startedAt };
  emit();
}

/** Map program node id to board node id when prefixed with wf:. */
export function boardNodeIdForProgramNode(programNodeId: string): string | null {
  if (programNodeId.startsWith('wf:')) return programNodeId.slice(3);
  return null;
}

export function programNodeStatusForBoardNode(
  boardNodeId: string,
  o: BoardRunOverlay | null,
): BoardRunNodeStatus | null {
  if (!o) return null;
  const direct = o.nodeStatus[`wf:${boardNodeId}`] ?? o.nodeStatus[boardNodeId];
  return direct ?? null;
}
