/* ══════════════════════════════════════════════════════════════════════════
   REWIND — undo a turn's edits, after seeing exactly what that means
   packages/web2/src/rewind/RewindPanel.tsx

   The engine has been able to do this the entire time. `PUT /api/file` takes a
   pre-write baseline, `POST /api/checkpoint` freezes it, `/api/checkpoints`
   lists them and `/api/checkpoint/{plan,restore}` puts the tree back. Every
   route is built, typed and tested. Nothing in the product ever opened one.

   THE PANEL IS BUILT AROUND THE ENGINE'S OWN RULE, stated in
   `api-types/sessions.ts`: "There is no route that acts without stating
   first." So selecting a checkpoint asks for the PLAN — which touches nothing
   — and the plan is what you read. Restore is a second, deliberate press
   against a sentence you have already seen. A panel that restored first and
   reported afterwards would take the safest undo in the product and make it
   the scariest one.

   ── AND IT NEVER CLAIMS MORE THAN THE ENGINE DID ─────────────────────────

   `applied` comes back ABSENT when the plan was not ok, and the engine answers
   409 with the plan still in the body so the client can render exactly what
   stopped it. This renders that, rather than a generic failure — the whole
   reason the route answers that way is so the reader does not have to guess.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useState } from 'react';

import type { CheckpointRecord, RestorePlan, RestoreScope } from '@sequence/api-types';

import type { ReviewClient } from '../review/reviewClient';
import { planReading, rewindRows } from './rewindModel';

export interface RewindPanelProps {
  client: ReviewClient;
  /** Injected so a test can pin every relative time. */
  now?: () => number;
  /** Called after a restore actually changed the tree, so the host can rescan. */
  onRestored?: (wrote: string[], deleted: string[]) => void;
}

type Listing =
  | { state: 'loading' }
  | { state: 'ok'; checkpoints: CheckpointRecord[]; tracked: string[] }
  /** The engine's own sentence, never rewritten. */
  | { state: 'failed'; message: string };

function errorText(answer: unknown, fallback: string): string {
  const body = (answer as { body?: { error?: string } }).body;
  return typeof body?.error === 'string' && body.error.trim() !== '' ? body.error : fallback;
}

export function RewindPanel({ client, now = Date.now, onRestored }: RewindPanelProps) {
  const [listing, setListing] = useState<Listing>({ state: 'loading' });
  const [selected, setSelected] = useState<number | null>(null);
  const [scope, setScope] = useState<RestoreScope>('code');
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(async () => {
    setListing({ state: 'loading' });
    const answer = await client.checkpoints();
    if (answer.outcome === 'ok') {
      setListing({ state: 'ok', checkpoints: answer.body.checkpoints, tracked: answer.body.tracked });
      return;
    }
    setListing({
      state: 'failed',
      message:
        answer.outcome === 'unreachable'
          ? 'the engine did not answer'
          : /* The server said why. Rewriting it would hide the one line that
               tells the reader what to fix. */
            errorText(answer, 'the engine refused'),
    });
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  /* THE PLAN IS RE-ASKED WHENEVER THE SCOPE CHANGES, because the scope is part
     of the question. Showing a files-only plan beside a "Both" selector would
     be a sentence about a restore nobody is about to perform. */
  useEffect(() => {
    if (selected === null) {
      setPlan(null);
      return undefined;
    }
    let live = true;
    setPlanning(true);
    setApplied(null);
    void client.planRestore(selected, scope).then((answer) => {
      if (!live) return;
      setPlanning(false);
      if (answer.outcome === 'ok') {
        setPlan(answer.body.plan);
        return;
      }
      /* A refusal still carries the plan — that is the whole point of the
         route answering that way — so render it rather than a bare failure. */
      const body = (answer as { body?: { plan?: RestorePlan } }).body;
      setPlan(body?.plan ?? null);
    });
    return () => {
      live = false;
    };
  }, [client, selected, scope]);

  const reading = planReading(plan);

  async function doRestore() {
    if (selected === null || !reading.canRestore) return;
    setRestoring(true);
    const answer = await client.restore(selected, scope);
    setRestoring(false);

    if (answer.outcome !== 'ok') {
      const body = (answer as { body?: { plan?: RestorePlan } }).body;
      if (body?.plan) setPlan(body.plan);
      setApplied(errorText(answer, 'the engine refused the restore'));
      return;
    }

    const done = answer.body.applied;
    if (!done || !done.ok) {
      setApplied(done?.error ?? 'the engine refused the restore');
      return;
    }

    /* WHAT IT ACTUALLY DID, not what it planned to do. They agree today, but a
       panel that reported the plan as the outcome would go on saying so on the
       day they stop agreeing. */
    const parts: string[] = [];
    if (done.wrote.length > 0) {
      parts.push(`put back ${done.wrote.length} ${done.wrote.length === 1 ? 'file' : 'files'}`);
    }
    if (done.deleted.length > 0) {
      parts.push(`deleted ${done.deleted.length} ${done.deleted.length === 1 ? 'file' : 'files'}`);
    }
    if (done.conversationRestored) parts.push('restored the conversation');
    setApplied(parts.length === 0 ? 'Nothing needed changing.' : `Done — ${parts.join(', ')}.`);
    onRestored?.(done.wrote, done.deleted);
    void load();
  }

  const rows = listing.state === 'ok' ? rewindRows(listing.checkpoints, now()) : [];

  return (
    <div className="rewind-scope rewindpanel" data-testid="rewind-panel" role="region" aria-label="Rewind">
      <h2 className="rewind-title">Rewind</h2>

      {listing.state === 'loading' ? (
        <p className="rewind-note" data-testid="rewind-loading">
          Looking for checkpoints…
        </p>
      ) : null}

      {listing.state === 'failed' ? (
        <p className="rewind-note" data-testid="rewind-failed" role="alert">
          {listing.message}
        </p>
      ) : null}

      {listing.state === 'ok' && rows.length === 0 ? (
        /* NOT AN ERROR, and it must not read as one. Having no checkpoints is
           the ordinary state of a session that has not edited anything yet, so
           this says what would produce one rather than only saying "none". */
        <p className="rewind-note" data-testid="rewind-empty">
          No checkpoints yet. One is taken before a turn edits files, and this list is where you undo back to it.
        </p>
      ) : null}

      {rows.length > 0 ? (
        <ul className="rewind-list" data-testid="rewind-list">
          {rows.map((row) => (
            <li key={row.seq}>
              <button
                type="button"
                className="rewind-row"
                data-testid="rewind-row"
                data-seq={row.seq}
                data-selected={selected === row.seq ? 'true' : undefined}
                aria-pressed={selected === row.seq}
                onClick={() => setSelected(selected === row.seq ? null : row.seq)}
              >
                <span className="rewind-row-label">{row.label ?? `Checkpoint ${row.seq}`}</span>
                <span className="rewind-row-meta">
                  {row.when} · {row.files} {row.files === 1 ? 'file' : 'files'} ·{' '}
                  {row.conversation === 'captured'
                    ? 'conversation'
                    : row.conversation === 'empty'
                      ? 'empty conversation'
                      : 'no conversation'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {selected !== null ? (
        <section className="rewind-section" data-testid="rewind-detail">
          <div className="rewind-scopes" role="group" aria-label="What to put back">
            {(['code', 'conversation', 'both'] as RestoreScope[]).map((s) => (
              <button
                key={s}
                type="button"
                className="rewind-scope-btn"
                data-testid={`rewind-scope-${s}`}
                data-selected={scope === s ? 'true' : undefined}
                aria-pressed={scope === s}
                onClick={() => setScope(s)}
              >
                {s === 'code' ? 'Files' : s === 'conversation' ? 'Conversation' : 'Both'}
              </button>
            ))}
          </div>

          {planning ? (
            <p className="rewind-note" data-testid="rewind-planning">
              Working out what this would change…
            </p>
          ) : (
            <>
              <p className="rewind-headline" data-testid="rewind-headline">
                {reading.headline}
              </p>
              {reading.lines.length > 0 ? (
                <ul className="rewind-lines" data-testid="rewind-lines">
                  {reading.lines.map((line, i) => (
                    <li key={i} className="mono">
                      {line}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}

          <div className="rewind-actions">
            <button
              type="button"
              className="solid"
              data-testid="rewind-restore"
              disabled={!reading.canRestore || restoring || planning}
              onClick={() => void doRestore()}
            >
              {restoring ? 'Restoring…' : 'Restore'}
            </button>
            {/* THE REASON THE BUTTON IS OFF, BESIDE THE BUTTON. A disabled
                control with no sentence next to it is a dead end for the
                reader — sheet 12.5 forbids state carried by appearance alone. */}
            {!reading.canRestore && !planning ? (
              <span className="rewind-note" data-testid="rewind-refusal">
                {reading.refusal}
              </span>
            ) : null}
          </div>

          {applied !== null ? (
            <p className="rewind-note" data-testid="rewind-applied" role="status">
              {applied}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
