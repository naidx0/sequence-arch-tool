/* ══════════════════════════════════════════════════════════════════════════
   THE RUN STORE, AS THE SIDEBAR NEEDS IT (speed lane)
   packages/web2/src/agents/railRuns.ts

   The rail reads two things from the run store: which chats have subagents (and
   how they are doing) and which agent each chat uses. It subscribed to the whole
   store, so every streamed chunk of every chat re-drew every row of the rail:
   90 ms of 6 s with three chats streaming (tools/measure/stream-bench.mjs).

   This hook hands the rail the store only when one of those two changes.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useSyncExternalStore } from 'react';

import { agentRuns, type AgentRun, type AgentRunsState } from './agentRuns';

function signature(s: AgentRunsState): string {
  let out = '';
  for (const r of s.runs) {
    for (const i of r.items) {
      if (i.kind === 'tool' && i.subagent) out += `${r.id}|${r.sessionId}|${i.id}|${i.status}|${i.endedAt ?? ''}|${typeof i.subagent === 'string' ? i.subagent : JSON.stringify(i.subagent)};`;
    }
  }
  return out;
}

let last: { state: AgentRunsState; sig: string; agents: AgentRunsState['agents'] } | null = null;

/** The same object while no subagent and no chat-to-agent binding has changed. */
function snapshot(): AgentRunsState {
  const s = agentRuns.get();
  if (last && last.state === s) return last.state;
  const sig = signature(s);
  if (last && last.sig === sig && last.agents === s.agents) return last.state;
  last = { state: s, sig, agents: s.agents };
  return s;
}

export function useRailRuns(): AgentRunsState {
  return useSyncExternalStore(agentRuns.subscribe, snapshot, snapshot);
}

export function resetRailRunsForTest(): void {
  last = null;
}

/** Whether an agent run is running in one chat (the radar's "something is working here"): a boolean, so streamed text does not re-render the caller. */
export function useAgentRunningIn(sessionId: string | null): boolean {
  return useSyncExternalStore(
    agentRuns.subscribe,
    () => agentRuns.get().runs.some((r) => r.status === 'running' && r.sessionId === sessionId),
    () => false,
  );
}

/** Whether any agent run is running: a boolean, so a chunk of streamed text does not re-render the caller. */
export function useAgentsRunning(): boolean {
  return useSyncExternalStore(
    agentRuns.subscribe,
    () => agentRuns.get().runs.some((r) => r.status === 'running'),
    () => false,
  );
}

/* ── EVERY CHAT'S AGENT, ON THE RAIL ──────────────────────────────────────
   With several chats running agents at once, the rail is where the reader
   sees which are still going and which finished while they were elsewhere.
   `running`: a run of the chat is going. `unseen`: its newest run ended
   (done or failed) after the reader last had the chat open. History read
   back from disk is never news, and the open chat is never unseen. Like the
   hooks above, the rail re-renders only when a mark changes, never per
   streamed chunk. */

export type ChatRunMark = 'attention' | 'running' | 'unseen';

/** Pure: each chat's mark, from the runs, the open chat, and when the reader last had each chat open. `attention`: a running run waits on the person (an approval or a question). */
export function chatRunMarks(
  runs: readonly (Pick<AgentRun, 'sessionId' | 'status' | 'endedAt' | 'restored' | 'approvals'> & { questions?: AgentRun['questions'] })[],
  activeId: string | null,
  seenAt: (chatId: string) => number,
): Record<string, ChatRunMark> {
  const out: Record<string, ChatRunMark> = {};
  for (const r of runs) {
    const sid = r.sessionId;
    if (!sid) continue;
    if (r.status === 'running') {
      const waits = (r.approvals ?? []).some((a) => a.decision === null) || (r.questions ?? []).some((q) => !q.settled);
      if (waits) out[sid] = 'attention';
      else if (out[sid] !== 'attention') out[sid] = 'running';
      continue;
    }
    if (out[sid] === 'running' || out[sid] === 'attention' || r.restored || sid === activeId || r.endedAt === null) continue;
    if (r.endedAt > seenAt(sid)) out[sid] = 'unseen';
  }
  return out;
}

/** When the reader last had each chat open (the page's clock). Kept for the page's life, so a remounted rail keeps it. */
const seenAt = new Map<string, number>();
const seenListeners = new Set<() => void>();

/** The reader has (or had, until now) this chat open. */
export function markChatSeen(chatId: string, at: number = Date.now()): void {
  if ((seenAt.get(chatId) ?? 0) >= at) return;
  seenAt.set(chatId, at);
  for (const l of [...seenListeners]) l();
}

let marksLast: { key: string; marks: Readonly<Record<string, ChatRunMark>> } | null = null;

function marksSnapshot(activeId: string | null): Readonly<Record<string, ChatRunMark>> {
  const marks = chatRunMarks(agentRuns.get().runs, activeId, (id) => seenAt.get(id) ?? 0);
  const key = Object.keys(marks)
    .sort()
    .map((k) => `${k}=${marks[k]}`)
    .join('|');
  if (marksLast && marksLast.key === key) return marksLast.marks;
  marksLast = { key, marks };
  return marks;
}

function subscribeMarks(fn: () => void): () => void {
  const off = agentRuns.subscribe(fn);
  seenListeners.add(fn);
  return () => {
    off();
    seenListeners.delete(fn);
  };
}

/** Each chat's mark. The open chat is recorded as seen while it is open and again when it is left. */
export function useChatRunMarks(activeId: string | null): Readonly<Record<string, ChatRunMark>> {
  useEffect(() => {
    if (!activeId) return undefined;
    markChatSeen(activeId);
    return () => markChatSeen(activeId);
  }, [activeId]);
  const read = () => marksSnapshot(activeId);
  return useSyncExternalStore(subscribeMarks, read, read);
}
