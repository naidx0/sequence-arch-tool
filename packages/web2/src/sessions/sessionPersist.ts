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
let chatSessionId: string | null = null;
let canvasBody: string | null = null;
let canvasSessionId: string | null = null;
let boardBody: string | null = null;
let boardSessionId: string | null = null;

/**
 * THE CHAT WRITE NAMES ITS SESSION TOO — the last of the three to do so.
 *
 * `/api/chat-memory` resolves "the active session" on the server after it has
 * read the body, exactly the race the canvas write had: a flush issued as a
 * workspace switch or New Chat moves `activeId` writes this thread's turns
 * into another thread, or 404s when that thread is not in the new root. The
 * owner's switch logged a 404 and two 409s on this route. `PUT
 * /api/sessions/<id> {chat}` already exists and refuses a body whose
 * `sessionId` is not the path id, so the chat now goes there, like the board
 * and the canvas. With no id there is nothing to flush.
 */
export function rememberChatForFlush(turns: readonly Turn[], sessionId: string | null): void {
  if (!sessionId || !worthPersisting(turns)) {
    chatBody = null;
    chatSessionId = null;
    return;
  }
  chatSessionId = sessionId;
  chatBody = JSON.stringify({ chat: toChatMemory(sessionId, turns) });
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

/**
 * THE CANVAS WRITE NAMES ITS SESSION, LIKE THE BOARD'S ALREADY DID.
 *
 * `/api/canvas-doc` resolves "the active session" on the server after it has
 * read the body, so a flush issued a moment before New Chat moved `activeId`
 * wrote the OLD thread's blocks into the NEW thread's file. The board avoided
 * this from the start by PUTting `/api/sessions/<id>` with the id in the URL
 * (`ConnectedBoard`'s "New Chat race" guard); the canvas kept the id-less
 * compat shim. With no id there is nothing to flush — an anonymous canvas
 * write is exactly the write that lands in the wrong thread.
 */
export function rememberCanvasForFlush(doc: CanvasDoc, sessionId: string | null): void {
  if (!sessionId || !worthPersistingCanvas(doc)) {
    canvasBody = null;
    canvasSessionId = null;
    return;
  }
  canvasSessionId = sessionId;
  canvasBody = JSON.stringify({ canvas: toCanvasMemory(sessionId, doc) });
}

export function clearSessionFlush(): void {
  chatBody = null;
  chatSessionId = null;
  canvasBody = null;
  canvasSessionId = null;
  boardBody = null;
  boardSessionId = null;
}

/** Snapshot of pending bodies — for tests. */
export function peekSessionFlush(): {
  chat: string | null;
  chatSessionId: string | null;
  canvas: string | null;
  canvasSessionId: string | null;
  board: string | null;
  boardSessionId: string | null;
} {
  return { chat: chatBody, chatSessionId, canvas: canvasBody, canvasSessionId, board: boardBody, boardSessionId };
}

/**
 * Write pending memory with keepalive so a following reload still delivers.
 * Safe to call when nothing is pending (no-op). Bounded so a hung PUT cannot
 * block session switch forever (owner: leave session → must land on the next).
 */
export async function flushSessionMemory(timeoutMs = 1500): Promise<void> {
  const ops: Promise<unknown>[] = [];
  if (chatBody && chatSessionId) {
    const body = chatBody;
    const id = chatSessionId;
    ops.push(
      fetch(`/api/sessions/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined),
    );
  }
  if (canvasBody && canvasSessionId) {
    const body = canvasBody;
    const id = canvasSessionId;
    ops.push(
      fetch(`/api/sessions/${encodeURIComponent(id)}`, {
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
