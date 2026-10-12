/* ══════════════════════════════════════════════════════════════════════════
   HANDOFF: A NEW AGENT JOINING A CHAT THAT ALREADY HAS TURNS
   packages/analyzer/src/server/agentHandoff.ts

   A chat keeps one provider thread per agent. Switching a chat from Claude to
   GPT opens a fresh GPT thread that knows nothing of what was said. The first
   prompt to that thread therefore carries a bounded plain-text handoff of the
   chat so far (oldest turns drop first) behind a one-line header. A thread
   that is resumed already has its history and is never handed this again.
   ══════════════════════════════════════════════════════════════════════════ */

import type { StoredAgentRun } from './agentChatStore.js';
import type { ChatMemoryShape } from './sessionsStore.js';

/**
 * The most handoff text carried, counted in UTF-16 code units (`String.length`),
 * not characters or bytes; older turns fall off first.
 */
export const HANDOFF_MAX_CHARS = 12_000;

export type HandoffKind = 'full' | 'delta';

export interface HandoffOptions {
  /** The agent about to receive it; its own earlier replies read "Assistant". */
  forAgent: string;
  /** The turn being sent now: it is the prompt, not history. */
  currentTurnId?: string;
  /** The text being sent now (an unmarked trailing copy of it is dropped). */
  currentPrompt?: string;
  max?: number;
}

const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

/** The first `n` UTF-16 units of `text`, never ending inside a surrogate pair. */
export function headUnits(text: string, n: number): string {
  if (text.length <= n) return text;
  let end = Math.max(0, n);
  if (end > 0 && isHigh(text.charCodeAt(end - 1))) end -= 1;
  return text.slice(0, end);
}

/** The last `n` UTF-16 units of `text`, never starting inside a surrogate pair. */
export function tailUnits(text: string, n: number): string {
  if (text.length <= n) return text;
  let start = text.length - Math.max(0, n);
  if (start < text.length && isLow(text.charCodeAt(start))) start += 1;
  return text.slice(start);
}

/** Whether a saved run is a real exchange the next agent should hear about: it reached the provider and said something, or finished. */
function worthHearing(r: StoredAgentRun): boolean {
  if (r.compact || r.reached === false || r.pturn === null) return false;
  return r.status === 'done' || r.text.trim() !== '';
}

/** Whether a saved run is in the agent's own provider thread (so the agent already knows it). */
function inAgentThread(r: StoredAgentRun): boolean {
  if (r.compact || r.reached === false || r.pturn === null) return false;
  return typeof r.pturn === 'string' || r.status === 'done' || r.text.trim() !== '';
}

interface Line { who: string; role: 'user' | 'assistant'; text: string; at: number }

function lineText(lines: Line[], max: number): string {
  const ordered = lines.map((l, i) => ({ l, i })).sort((x, y) => x.l.at - y.l.at || x.i - y.i).map((x) => x.l);
  const blocks: string[] = [];
  let used = 0;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const t = ordered[i]!;
    let text = t.text;
    const room = Math.max(200, max - t.who.length - 4);
    if (text.length > room) text = t.role === 'user' ? `${headUnits(text, room - 3)}...` : `...${tailUnits(text, room - 3)}`;
    const block = `${t.who}: ${text}`;
    if (used + block.length > max && blocks.length > 0) break;
    blocks.push(block);
    used += block.length + 2;
  }
  return blocks.reverse().join('\n\n');
}

/**
 * The chat as "User:/Assistant:" text, or '' when there is nothing to say.
 * With `since`, only what happened after it. Other agents' replies carry their
 * ref; the Sequence model's read "Sequence". Tool calls and attachments are not
 * carried; a run that never reached the provider, or failed without a word, is
 * not a turn (a Retry would otherwise send the person's message twice).
 */
export function buildHandoff(chat: Pick<ChatMemoryShape, 'turns'>, o: HandoffOptions, runs: readonly StoredAgentRun[] = [], since?: number): string {
  const max = o.max ?? HANDOFF_MAX_CHARS;
  const lines: Line[] = [];
  let clock = 0;
  for (const t of chat.turns) {
    if (t.role !== 'user' && t.role !== 'assistant') continue;
    const at = Date.parse(t.at ?? '');
    if (Number.isFinite(at)) clock = at;
    if (t.agentTurn || (t.text ?? '').trim() === '') continue;
    lines.push({ who: t.role === 'user' ? 'User' : 'Sequence', role: t.role, text: t.text.trim(), at: clock });
  }
  /* A trailing unmarked copy of the prompt being sent now is the prompt, not history. */
  const last = lines[lines.length - 1];
  if (last && last.role === 'user' && o.currentPrompt !== undefined && last.text === o.currentPrompt.trim()) lines.pop();
  for (const r of runs) {
    if (r.id === o.currentTurnId || !worthHearing(r)) continue;
    lines.push({ who: 'User', role: 'user', text: r.prompt.trim(), at: r.startedAt });
    lines.push({ who: r.agentRef === o.forAgent ? 'Assistant' : r.agentRef, role: 'assistant', text: r.text.trim() || '(no reply)', at: r.startedAt + 1 });
  }
  return lineText(since === undefined ? lines : lines.filter((l) => l.at > since), max);
}

/**
 * What the agent is owed before this prompt. It has never been in this chat's
 * provider thread (or the thread was lost): the chat so far ('full'). It was,
 * and the chat moved on without it: only what happened since it last spoke
 * ('delta'). Null when there is nothing to say.
 */
export function planHandoff(chat: Pick<ChatMemoryShape, 'turns'>, runs: readonly StoredAgentRun[], o: HandoffOptions & { threadReopened: boolean }): { kind: HandoffKind; text: string } | null {
  const mine = runs.filter((r) => r.agentRef === o.forAgent && r.id !== o.currentTurnId && inAgentThread(r));
  if (!o.threadReopened || mine.length === 0) {
    const text = buildHandoff(chat, o, runs);
    return text ? { kind: 'full', text } : null;
  }
  const since = Math.max(...mine.map((r) => r.startedAt));
  const text = buildHandoff(chat, o, runs.filter((r) => r.agentRef !== o.forAgent), since);
  return text ? { kind: 'delta', text } : null;
}

/** The prompt with the handoff ahead of it. */
export function handoffPrompt(handoff: string, prompt: string, kind: HandoffKind = 'full'): string {
  if (handoff.trim() === '') return prompt;
  if (kind === 'delta') return `Since you last spoke in this chat:\n\n${handoff}\n\n---\n\nContinue from here. The person now says:\n\n${prompt}`;
  return `Handoff: this chat was already under way with an earlier agent, and you are joining it now. The conversation so far:\n\n${handoff}

---

Continue from here. The person now says:

${prompt}`;
}
