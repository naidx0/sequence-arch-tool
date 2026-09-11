/**
 * Session memory flush — last known chat/canvas payloads for the active
 * session, so a switch/reload can finish writing before the page tears down.
 *
 * Continuous PUT from ConnectedChatColumn is best-effort; leaving a session
 * via reload raced that write. Hosts call `flushSessionMemory()` first.
 */

import type { SeqDiagramV1 } from '@sequence/schema';

import type { CanvasDoc, Turn } from '../state/types';
import { toBoardSeqd, worthPersistingBoard } from './boardMemory';
import { toCanvasMemory, worthPersistingCanvas } from './canvasMemory';
import { toChatMemory, worthPersisting } from './chatMemory';

let chatBody: string | null = null;
let canvasBody: string | null = null;
let boardBody: string | null = null;
let boardSessionId: string | null = null;

export function rememberChatForFlush(turns: readonly Turn[]): void {
  if (!worthPersisting(turns)) {
    chatBody = null;
    return;
  }
  chatBody = JSON.stringify(toChatMemory('active', turns));
}

export function rememberBoardForFlush(sessionId: string, doc: SeqDiagramV1 | null, edits: number): void {
  if (!worthPersistingBoard(doc, edits)) {
    boardBody = null;
    boardSessionId = null;
    return;
  }
  boardSessionId = sessionId;
  boardBody = JSON.stringify({ boardSeqd: toBoardSeqd(doc!) });
}

export function rememberCanvasForFlush(doc: CanvasDoc): void {
  if (!worthPersistingCanvas(doc)) {
    canvasBody = null;
    return;
  }
  canvasBody = JSON.stringify(toCanvasMemory('active', doc));
}

export function clearSessionFlush(): void {
  chatBody = null;
  canvasBody = null;
  boardBody = null;
  boardSessionId = null;
}

/** Snapshot of pending bodies — for tests. */
export function peekSessionFlush(): {
  chat: string | null;
  canvas: string | null;
  board: string | null;
  boardSessionId: string | null;
} {
  return { chat: chatBody, canvas: canvasBody, board: boardBody, boardSessionId };
}

/**
 * Write pending memory with keepalive so a following reload still delivers.
 * Safe to call when nothing is pending (no-op). Bounded so a hung PUT cannot
 * block session switch forever (owner: leave session → must land on the next).
 */
export async function flushSessionMemory(timeoutMs = 1500): Promise<void> {
  const ops: Promise<unknown>[] = [];
  if (chatBody) {
    const body = chatBody;
    ops.push(
      fetch('/api/chat-memory', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined),
    );
  }
  if (canvasBody) {
    const body = canvasBody;
    ops.push(
      fetch('/api/canvas-doc', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined),
    );
  }
  if (boardBody && boardSessionId) {
    const body = boardBody;
    const id = boardSessionId;
    ops.push(
      fetch(`/api/sessions/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined),
    );
  }
  if (ops.length === 0) return;
  await Promise.race([
    Promise.allSettled(ops),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeoutMs);
    }),
  ]);
}

/** Reload after the panel already flushed the previous session. */
export function reloadAfterSessionChange(): void {
  window.location.reload();
}

/** Reload after flushing — the switch / open-repo path when flush still needed at host. */
export async function flushAndReload(): Promise<void> {
  await flushSessionMemory();
  clearSessionFlush();
  window.location.reload();
}
