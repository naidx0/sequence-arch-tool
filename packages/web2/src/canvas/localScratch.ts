/**
 * Session-scoped architecture scratch — a `.seqd` in localStorage when no repo
 * is attached. Accept on a topology proposal writes here instead of requiring
 * a scan.
 */

import type { SeqDiagramV1 } from '@sequence/schema';

export interface ScratchStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SCRATCH_PREFIX = 'sequence.arch-scratch.';

/** Resolve the session id used for scratch keys — store active id or workspace. */
export function resolveScratchSessionId(activeId: string | null): string {
  return activeId ?? 'workspace';
}

/** localStorage key for one session's scratch diagram. */
export function scratchKey(sessionId: string): string {
  return `${SCRATCH_PREFIX}${sessionId}`;
}

/** graphId prefix — distinguishes scratch docs from scanned repos. */
export const SCRATCH_GRAPH_PREFIX = 'scratch:';

export function isScratchDoc(doc: SeqDiagramV1): boolean {
  return doc.grounded.graphId.startsWith(SCRATCH_GRAPH_PREFIX);
}

/** Empty scratch board a proposal Accept can grow from. */
export function emptyScratchDoc(sessionId: string): SeqDiagramV1 {
  return {
    version: 1,
    kind: 'service-flow',
    title: 'Local workspace',
    grounded: { graphId: `${SCRATCH_GRAPH_PREFIX}${sessionId}` },
    nodes: [],
    edges: [],
  };
}

function parseScratch(raw: string): SeqDiagramV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const doc = parsed as Partial<SeqDiagramV1>;
  if (doc.version !== 1 || doc.kind !== 'service-flow') return null;
  if (typeof doc.title !== 'string' || !doc.grounded || typeof doc.grounded.graphId !== 'string') {
    return null;
  }
  if (!doc.grounded.graphId.startsWith(SCRATCH_GRAPH_PREFIX)) return null;
  if (!Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) return null;
  return doc as SeqDiagramV1;
}

/** Read persisted scratch, or null when missing or corrupt. */
export function readScratch(storage: ScratchStorage, sessionId: string): SeqDiagramV1 | null {
  return parseScratch(storage.getItem(scratchKey(sessionId)) ?? '');
}

/** Scratch for editing — persisted doc or a fresh empty one. */
export function loadScratchDoc(storage: ScratchStorage, sessionId: string): SeqDiagramV1 {
  return readScratch(storage, sessionId) ?? emptyScratchDoc(sessionId);
}

/** Persist scratch after Accept or autosave. Silent on storage failure. */
export function writeScratch(storage: ScratchStorage, sessionId: string, doc: SeqDiagramV1): void {
  try {
    storage.setItem(scratchKey(sessionId), JSON.stringify(doc));
  } catch {
    /* Persistence must not block the board — same stance as whiteboard. */
  }
}

/**
 * One-time move from the legacy shared key every thread used while `activeId`
 * stayed null. Only runs when the session key is missing and `workspace` has
 * data — never overwrites an existing per-session scratch.
 */
export function migrateLegacyWorkspaceScratch(
  storage: ScratchStorage,
  sessionId: string | null | undefined,
): boolean {
  if (!sessionId) return false;
  const legacy = storage.getItem(scratchKey('workspace'));
  if (!legacy) return false;
  const target = scratchKey(sessionId);
  if (storage.getItem(target)) return false;
  storage.setItem(target, legacy);
  storage.removeItem(scratchKey('workspace'));
  return true;
}

/** Browser storage when available; tests inject a memory implementation. */
export function scratchStorage(): ScratchStorage | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage;
}
