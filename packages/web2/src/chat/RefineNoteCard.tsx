/* ══════════════════════════════════════════════════════════════════════════
   THE NOTE CARD: ACCEPT, DISMISS, UNDO
   packages/web2/src/chat/RefineNoteCard.tsx

   Drawn only when a person has a decision to make, one card at a time, under
   the last reply of the chat:

     pending   "A note for this project": the one sentence, Accept or Dismiss.
               Why opens the person's own words it rests on.
     accepted  "Added. The agent reads it from now on." Undo, until the card
               is left.

   One decision per turn: after Accept, Dismiss, Keep or Undo the card goes,
   and a next waiting note is shown only once the next turn has ended. (A note added later stays undoable from the next card
               that names it; the server keeps the record.)
     auto      the same, for a note the Auto setting added: Undo or OK.
     flagged   a note that has not stopped the failure (or made it worse), with
               the tracker's own numbers: Remove or Keep.

   Quiet by rule (sequence-design): bordered, ink only, no accent text, no
   badge, nothing that moves. Nothing here is sent unless a button is pressed.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { agentRuns } from '../agents/agentRuns';
import { KIND_WORDS, decideNote, fetchNoteCards, type NoteAction, type NoteCardData } from '../agents/refineNotes';
import type { Fetch } from '../agents/runNodeStream';
import './refineNote.css';

/** The server writes a turn's signals just after it ends; look a moment later. */
const LOOK_AFTER_MS = 700;

export function RefineNoteCard({
  sessionId,
  lastEndedKey,
  busy: turnBusy,
  fetchImpl = fetch,
  lookAfterMs = LOOK_AFTER_MS,
}: {
  sessionId: string | null;
  /** The chat's last ended turn of either kind (the parent reads both stores); null: none yet. Absent: read the agent runs here. */
  lastEndedKey?: string | null;
  /** A turn of either kind is running: no look until it ends. */
  busy?: boolean;
  fetchImpl?: Fetch;
  lookAfterMs?: number;
}) {
  const runs = useSyncExternalStore(agentRuns.subscribe, agentRuns.get, agentRuns.get);
  const last = [...runs.runs].reverse().find((r) => r.sessionId === sessionId);
  /* One look per ended turn (and one on mount): the key changes when a turn ends. */
  const settled =
    lastEndedKey !== undefined
      ? turnBusy
        ? 'busy'
        : (lastEndedKey ?? 'none')
      : last && last.status !== 'running' && !last.queued
        ? `${last.id}:${last.status}`
        : last
          ? 'busy'
          : 'none';
  const [cards, setCards] = useState<NoteCardData[]>([]);
  const [done, setDone] = useState<{ id: string; what: 'accepted' | 'removed' } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const live = useRef(true);

  const look = useCallback(async () => {
    const got = await fetchNoteCards(fetchImpl);
    if (live.current && got) setCards(got.cards);
  }, [fetchImpl]);

  useEffect(() => {
    live.current = true;
    if (settled === 'busy') return () => void (live.current = false);
    const t = window.setTimeout(() => void look(), settled === 'none' ? 0 : lookAfterMs);
    return () => {
      live.current = false;
      window.clearTimeout(t);
    };
  }, [settled, look, lookAfterMs]);

  const decide = async (card: NoteCardData, action: NoteAction): Promise<void> => {
    setBusy(true);
    setFailed(false);
    const ok = await decideNote(card.id, action, fetchImpl);
    setBusy(false);
    if (!ok) {
      setFailed(true);
      return;
    }
    setOpen(false);
    if (action === 'accept') {
      setDone({ id: card.id, what: 'accepted' });
      return;
    }
    /* One decision per turn: the next waiting note shows after the next turn ends, not now. */
    setDone(null);
    setCards([]);
  };

  /* After Accept the card stays as "Added", with Undo, until the next look replaces it. */
  if (done?.what === 'accepted') {
    const undo = async (): Promise<void> => {
      setBusy(true);
      const ok = await decideNote(done.id, 'rollback', fetchImpl);
      setBusy(false);
      if (!ok) return setFailed(true);
      setDone(null);
      setCards([]);
    };
    return (
      <div className="s2-note" role="status" data-testid="refine-note" data-state="accepted">
        <span className="s2-note-lab">Added. The agent reads it from now on.</span>
        <span className="s2-note-actions">
          <button type="button" className="s2-btn s2-btn-sm" disabled={busy} onClick={() => void undo()} data-testid="refine-note-undo">
            Undo
          </button>
          <button type="button" className="s2-btn s2-btn-sm" onClick={() => (setDone(null), setCards([]))} data-testid="refine-note-ok">
            OK
          </button>
        </span>
        {failed ? <span className="s2-note-err" role="alert">That did not go through.</span> : null}
      </div>
    );
  }

  const card = cards[0];
  if (!card) return null;
  const label =
    card.state === 'pending' ? 'A note for this project' : card.state === 'auto' ? 'A note was added automatically' : card.summary ?? 'This note has not stopped the failure';
  return (
    <div className="s2-note" role="group" aria-label="Note for this project" data-testid="refine-note" data-state={card.state}>
      <p className="s2-note-lab">{label}</p>
      <p className="s2-note-tip" data-testid="refine-note-tip">{card.tip}</p>
      {open ? (
        <ul className="s2-note-why" data-testid="refine-note-why">
          {card.why.kinds.map((k) => (
            <li key={k}>{KIND_WORDS[k] ?? k}</li>
          ))}
          {card.why.asks.map((a) => (
            <li key={a} className="s2-note-ask">{a}</li>
          ))}
        </ul>
      ) : null}
      <span className="s2-note-actions">
        {card.state === 'pending' ? (
          <>
            <button type="button" className="s2-btn s2-btn-sm s2-blue" disabled={busy} onClick={() => void decide(card, 'accept')} data-testid="refine-note-accept">
              Accept
            </button>
            <button type="button" className="s2-btn s2-btn-sm" disabled={busy} onClick={() => void decide(card, 'deny')} data-testid="refine-note-dismiss">
              Dismiss
            </button>
          </>
        ) : (
          <>
            <button type="button" className="s2-btn s2-btn-sm" disabled={busy} onClick={() => void decide(card, 'rollback')} data-testid="refine-note-undo">
              {card.state === 'flagged' ? 'Remove' : 'Undo'}
            </button>
            <button type="button" className="s2-btn s2-btn-sm" disabled={busy} onClick={() => void decide(card, 'keep')} data-testid="refine-note-keep">
              {card.state === 'flagged' ? 'Keep' : 'OK'}
            </button>
          </>
        )}
        <button type="button" className="s2-btn s2-btn-sm s2-note-why-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="refine-note-why-btn">
          Why
        </button>
        {failed ? <span className="s2-note-err" role="alert">That did not go through.</span> : null}
      </span>
    </div>
  );
}
