/* ══════════════════════════════════════════════════════════════════════════
   CONVERSATION HISTORY — prose + grounded prior work
   packages/web2/src/chat/askHistory.ts

   THE DEFECT THIS CLOSES, stated plainly: the second message in any thread was
   answered as if it were the first. Ask "what does scan.ts do", then ask "and
   its callers?", and the model received the second question with no idea what
   "its" referred to.

   B3.1 — chat memory v2 already persists work/evidence on assistant turns, but
   history used to strip to role+text. A follow-up that referred to "that file
   you read" then had no grounded prior tool work in the prompt. We keep the
   wire small: compact verb + path lists, not full tool payloads.

   ── AND EVERY OTHER PIECE WAS ALREADY BUILT ──────────────────────────────

   `PostAskRequest.history?: AskHistoryTurn[]` is in the shared contract.
   `repoServer.ts` parses it, filters it to the two legal roles, and hands it to
   `renderAskHistorySection`, which renders "--- PRIOR CHAT (same workspace;
   continue coherently) ---" into the prompt. All of it tested.

   The client simply never sent the field. `connect.tsx` built
   `{ question, context }` and stopped. So this is a mapping step, not a
   feature — which is exactly why it went unnoticed for so long: nothing was
   broken, something was merely absent, and absence throws no error.

   ── WHY THE CAP IS HERE AS WELL AS ON THE SERVER ─────────────────────────

   `renderAskHistorySection` already slices to the last 20 and truncates each
   turn at 1200 characters. Duplicating that here is not belt-and-braces: it
   stops the client putting a 400-turn thread on the wire so the server can
   throw 380 of them away. The numbers are deliberately the same, and named,
   so a future change to one is an obvious prompt to change the other.

   PURE. Turns in, wire turns out.
   ══════════════════════════════════════════════════════════════════════════ */

import type { AskHistoryEvidence, AskHistoryTurn } from '@sequence/api-types';

import type { AssistantTurn, Turn, TurnEvidence, WorkRow } from '../state/types';

/**
 * The server's own cap, mirrored.
 *
 * `renderAskHistorySection(turns, cap = 20)` — see
 * `packages/analyzer/src/explain/explain.ts`.
 */
export const HISTORY_CAP = 20;

/** Cap on work verbs / evidence paths per turn — enough to ground, not dump. */
export const HISTORY_WORK_CAP = 12;
export const HISTORY_FILES_CAP = 20;
export const HISTORY_TOOLS_CAP = 12;
export const HISTORY_PROPOSALS_CAP = 8;

/**
 * Compact work verbs from a prior assistant turn.
 *
 * Running rows are omitted — they are in-flight noise, not a record the next
 * ask should treat as done work.
 */
export function summarizeHistoryWork(work: readonly WorkRow[]): string[] {
  const out: string[] = [];
  for (const row of work) {
    if (row.status === 'running') continue;
    const verb = row.verb.trim();
    if (!verb) continue;
    const id = row.identifier?.trim();
    out.push(id ? `${verb} (${id})` : verb);
    if (out.length >= HISTORY_WORK_CAP) break;
  }
  return out;
}

/** Compact evidence lists for the wire. */
export function summarizeHistoryEvidence(evidence: TurnEvidence | undefined): AskHistoryEvidence | undefined {
  if (!evidence) return undefined;
  const filesRead = (evidence.filesRead ?? []).filter((p) => typeof p === 'string' && p.trim()).slice(0, HISTORY_FILES_CAP);
  const tools = (evidence.tools ?? [])
    .map((t) => (typeof t.name === 'string' ? t.name.trim() : ''))
    .filter(Boolean)
    .slice(0, HISTORY_TOOLS_CAP);
  const proposals = (evidence.proposals ?? [])
    .filter((p) => typeof p === 'string' && p.trim())
    .slice(0, HISTORY_PROPOSALS_CAP);
  if (filesRead.length === 0 && tools.length === 0 && proposals.length === 0) return undefined;
  return {
    ...(filesRead.length ? { filesRead } : {}),
    ...(tools.length ? { tools } : {}),
    ...(proposals.length ? { proposals } : {}),
  };
}

/**
 * The committed transcript as wire history, plus how many usable turns the
 * cap dropped (B3.2 honesty).
 */
export function askHistoryMeta(
  turns: readonly Turn[],
  cap: number = HISTORY_CAP,
): { turns: AskHistoryTurn[]; droppedTurns: number } {
  const usable = turns.filter((t) => typeof t.text === 'string' && t.text.trim().length > 0);
  const droppedTurns = Math.max(0, usable.length - cap);
  const sliced = usable.slice(-cap);
  return {
    droppedTurns,
    turns: sliced.map((t) => {
      if (t.role === 'user') return { role: 'user' as const, text: t.text };
      const assistant = t as AssistantTurn;
      const out: AskHistoryTurn = { role: 'assistant', text: t.text };
      const work = summarizeHistoryWork(assistant.work ?? []);
      if (work.length > 0) out.work = work;
      const evidence = summarizeHistoryEvidence(assistant.evidence);
      if (evidence) out.evidence = evidence;
      return out;
    }),
  };
}

/**
 * The committed transcript as wire history.
 *
 * TAKES THE LAST N, not the first: a conversation's most recent turns are the
 * ones "it" and "that" refer to, and dropping the tail to keep the head would
 * discard exactly the context the follow-up depends on.
 *
 * Empty turns are dropped. A turn with no text is a turn where the user sent
 * chips alone or the assistant produced nothing but tool work; rendering
 * "User:" with nothing after it tells the model a question was asked and
 * withheld. (Work-only assistants are still dropped — the model needs prose
 * to continue coherently; work alone is not a reply.)
 */
export function askHistory(turns: readonly Turn[], cap: number = HISTORY_CAP): AskHistoryTurn[] {
  return askHistoryMeta(turns, cap).turns;
}
