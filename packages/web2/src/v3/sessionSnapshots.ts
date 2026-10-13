/* ══════════════════════════════════════════════════════════════════════════
   CHAT SWITCH SNAPSHOTS (speed lane)
   packages/web2/src/v3/sessionSnapshots.ts

   Clicking another chat used to flip the rail row, keep the OLD transcript on
   screen, and wait on a round trip (activate, then read) before drawing the new
   one, then draw it in a cascade of commits. A snapshot is what the page knew
   of a chat the last time it held it: its turns, its AI Canvas doc and the
   server's body. A chat that has a snapshot is drawn in the click's own frame;
   the read that follows only repaints if the server says something different.

   Taken at two moments:
     - when a chat is read (softLoadSession), the restored turns and the body;
     - when the reader leaves a chat, its LIVE turns and canvas (so coming back
       shows what they saw, not what the disk had when they first opened it).
   A chat that is streaming when it is left is not captured (its live turns are
   still moving; the read on return puts them right).

   The idea (stale-while-revalidate over a per-thread cache) is the one T3
   Code's client-runtime uses for thread detail (orchestrationCache.ts,
   state/threads.ts: a cached snapshot is shown while the thread re-syncs).
   ══════════════════════════════════════════════════════════════════════════ */

import type { CanvasDocShape, GetSessionResponse } from '@sequence/api-types';

import { toChatMemory } from '../sessions/chatMemory';
import type { CanvasDoc, Turn } from '../state/types';

export interface SessionSnapshot {
  turns: readonly Turn[];
  canvasDoc: CanvasDoc | null;
  /** A server read has been kept (below), so the chat can be drawn from memory. */
  hasBody: boolean;
  /** The server's canvas and board overlay as last read. The wire transcript is NOT kept: `turns` is it. */
  canvas: CanvasDocShape | undefined;
  boardSeqd: string | undefined;
  /** How many turns `chatKey` covers. */
  turnCount: number;
  /** A short identity for the transcript text (length and a 32-bit hash of count, roles, text, time). */
  chatKey: string;
  canvasKey: string;
  boardKey: string;
  /** The turns array that was put on screen from this snapshot, to tell if the reader has moved on. */
  applied: readonly Turn[] | null;
  /** `applied` came from this snapshot (a switch drawn from memory), so the next read only revalidates it. */
  drawnFromSnapshot: boolean;
}

/** Chats held. `turns` is shared with the store while the chat is open; a held chat costs about 0.9 MB at 500 turns. */
export const SNAPSHOT_LIMIT = 24;
const held = new Map<string, SessionSnapshot>();

/** Length and FNV-1a of the joined text: the whole transcript is not kept just to be compared. */
function hashKey(joined: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${joined.length}:${(h >>> 0).toString(36)}`;
}

const line = (role: string, at: string | undefined, text: string): string => `${role}\u0001${at ?? ''}\u0001${text}`;

/** The key of the first `limit` persisted turns of a live transcript. */
export function chatKeyOfTurns(turns: readonly Turn[], limit = Infinity): string {
  const memory = toChatMemory('', turns);
  return hashKey(memory.turns.slice(0, limit).map((t) => line(t.role, t.at, t.text)).join('\u0002'));
}

export function turnCountOf(turns: readonly Turn[]): number {
  return toChatMemory('', turns).turns.length;
}

function wireTurns(chat: unknown): { role: string; text: string; at?: string }[] {
  const turns = (chat as { turns?: { role?: string; text?: string; at?: string }[] } | null)?.turns;
  if (!Array.isArray(turns)) return [];
  return turns.filter((t) => typeof t?.text === 'string' && (t.role === 'user' || t.role === 'assistant') && (t.text!.trim() !== '' || t.role === 'assistant')) as { role: string; text: string; at?: string }[];
}

export function chatKeyOfWire(chat: unknown): string {
  return hashKey(wireTurns(chat).map((t) => line(t.role, t.at, t.text)).join('\u0002'));
}

export function turnCountOfWire(chat: unknown): number {
  return wireTurns(chat).length;
}

const keyOf = (v: unknown): string => (v === undefined || v === null ? '' : JSON.stringify(v));
export const canvasKeyOf = (body: GetSessionResponse): string => keyOf(body.canvas);
export const boardKeyOf = (body: GetSessionResponse): string => body.boardSeqd ?? '';

export function getSnapshot(id: string): SessionSnapshot | undefined {
  const s = held.get(id);
  if (s) {
    held.delete(id);
    held.set(id, s);
  }
  return s;
}

function put(id: string, s: SessionSnapshot): void {
  held.delete(id);
  held.set(id, s);
  while (held.size > SNAPSHOT_LIMIT) held.delete(held.keys().next().value as string);
}

/** A chat was read from the server and drawn (or prefetched): keep what came back. */
export function rememberRead(id: string, body: GetSessionResponse, turns: readonly Turn[], applied: boolean): void {
  put(id, {
    turns,
    canvasDoc: null,
    hasBody: true,
    canvas: body.canvas,
    boardSeqd: body.boardSeqd,
    turnCount: turnCountOfWire(body.chat),
    chatKey: chatKeyOfWire(body.chat),
    canvasKey: canvasKeyOf(body),
    boardKey: boardKeyOf(body),
    applied: applied ? turns : null,
    drawnFromSnapshot: false,
  });
}

/** The reader is leaving `id`: keep the turns and canvas as they are now. */
export function rememberLeaving(id: string, turns: readonly Turn[], canvasDoc: CanvasDoc | null): void {
  const prev = held.get(id);
  put(id, {
    turns,
    canvasDoc: canvasDoc && canvasDoc.forSession === id ? canvasDoc : (prev?.canvasDoc ?? null),
    hasBody: prev?.hasBody ?? false,
    canvas: prev?.canvas,
    boardSeqd: prev?.boardSeqd,
    turnCount: turnCountOf(turns),
    chatKey: chatKeyOfTurns(turns),
    canvasKey: prev?.canvasKey ?? '',
    boardKey: prev?.boardKey ?? '',
    applied: null,
    drawnFromSnapshot: false,
  });
}

export function markApplied(id: string, turns: readonly Turn[]): void {
  const s = held.get(id);
  if (s) {
    s.applied = turns;
    s.drawnFromSnapshot = true;
  }
}

export function forgetSnapshot(id: string): void {
  held.delete(id);
}

/** A different workspace: chat ids are only unique inside one, so no held copy may stand in for another workspace's chat. */
export function clearSnapshots(): void {
  held.clear();
}

export function resetSnapshotsForTest(): void {
  held.clear();
}
