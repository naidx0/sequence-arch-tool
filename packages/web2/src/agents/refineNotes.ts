/* ══════════════════════════════════════════════════════════════════════════
   NOTES THE APP PROPOSES FROM WORK THAT FELL SHORT
   packages/web2/src/agents/refineNotes.ts

   The page half of the refine loop (analyzer harness/refineCards.ts). The
   server watches every finished turn, Claude, Codex or local, for the failures
   a person feels: a request the agent reported not done, the same request typed
   again, Edit from here, a discarded best-of-N answer, a stop. A group of them
   becomes one proposed note, one sentence. Nothing is added to the repo's notes
   until Accept, except under the Auto setting, which is off until the person
   turns it on.

     GET  /api/harness/refine/cards             what waits for a decision
     POST /api/harness/refine/:id/accept        add the note
     POST /api/harness/refine/:id/deny          Dismiss (remembered)
     POST /api/harness/refine/:id/rollback      Undo / Remove
     POST /api/harness/refine/:id/keep          keep an auto-added or flagged note
     PUT  /api/agent-settings { autoRefine }    the Auto switch
   ══════════════════════════════════════════════════════════════════════════ */

import type { Fetch } from './runNodeStream';

export interface NoteCardData {
  id: string;
  state: 'pending' | 'auto' | 'flagged';
  tip: string;
  why: { kinds: string[]; turns: string[]; asks: string[] };
  verdict?: 'helped' | 'no_change' | 'worse' | 'too_early';
  summary?: string;
}

export interface NoteCards {
  auto: boolean;
  cards: NoteCardData[];
}

/** What each signal kind means, in the words the card uses. */
export const KIND_WORDS: Record<string, string> = {
  ask_not_done: 'the agent said it did not do this',
  repeated_ask: 'you had to ask again',
  edit_from_here: 'you went back and rewrote the message',
  fanout_discarded: 'an answer to this was discarded',
  stopped: 'you stopped it midway',
};

export async function fetchNoteCards(f: Fetch = fetch): Promise<NoteCards | null> {
  try {
    const r = await f('/api/harness/refine/cards', { headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    const j = (await r.json()) as Partial<NoteCards>;
    return { auto: j.auto === true, cards: Array.isArray(j.cards) ? j.cards : [] };
  } catch {
    return null;
  }
}

export type NoteAction = 'accept' | 'deny' | 'rollback' | 'keep';

/** Send the person's decision. Resolves true when the server took it. */
export async function decideNote(id: string, action: NoteAction, f: Fetch = fetch): Promise<boolean> {
  try {
    const r = await f(`/api/harness/refine/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
    return r.ok;
  } catch {
    return false;
  }
}

export async function setAutoRefine(on: boolean, f: Fetch = fetch): Promise<boolean | null> {
  try {
    const r = await f('/api/agent-settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ autoRefine: on }) });
    if (!r.ok) return null;
    return ((await r.json()) as { autoRefine?: boolean }).autoRefine === true;
  } catch {
    return null;
  }
}
