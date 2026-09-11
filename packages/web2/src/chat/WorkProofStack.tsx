import { useState } from 'react';

import type { WorkRow } from '../state/types';
import type { AskLiveRoundTimer } from './askLiveStatus';
import { formatRoundTimer } from './askLiveStatus';
import { Icon } from './Icon';
import { WorkRowLine } from './WorkRowLine';
import { liveLabelFor } from './workRowModel';

/* ══════════════════════════════════════════════════════════════════════════
   PROOF + REASONING FOLDS
   packages/web2/src/chat/WorkProofStack.tsx

   Owner (2026-08-25): proof / files researched collapsed until asked.
   Owner (2026-08-27): fusion pick 1 — braille + accent wash on the live
   reasoning row only; glimmer + glyph pulse on other live rows; no AgentRunBar.
   Topology theater lives in Transcript (Option A) — this stack only folds proof.
   ══════════════════════════════════════════════════════════════════════════ */

export interface WorkProofStackProps {
  rows: readonly WorkRow[];
  /** When true, apply `.toolstack.inline` (Decision 7 fold into prose). */
  inline?: boolean;
  /** Live provider row shows which reasoning backend is working. */
  reasoningProvider?: string | null;
  /** Live `Round k/n · Xs` while the turn is in flight. */
  roundTimer?: AskLiveRoundTimer | null;
  /** Calm stall line when the provider has gone quiet. */
  stallNotice?: string | null;
}

function isLive(row: WorkRow): boolean {
  return row.status === 'running';
}

function isReason(row: WorkRow): boolean {
  return row.group === 'reason';
}

/**
 * Split work into live (always visible outside folds), landed reason
 * (Reasoning disclosure), and landed proof (files / other steps).
 * Pure so tests lock the fold without React.
 *
 * AN ANNOUNCEMENT ROW IS NEVER FOLDED. `announce` marks a row that tells the
 * user what the ENGINE decided about their turn — the teach mode a question
 * engaged with the Teach control untouched. It arrives as a settled
 * `group: 'reason'` row, which put it inside the Reasoning disclosure: closed
 * by default, headed "Reasoning" or "Drew on AI Canvas", never a word about
 * teaching. So the turn refused edit_file/propose_files/propose_topology/
 * run_command, paced itself to 150 words and ended in a check-in question,
 * while the only explanation sat one click deep behind a label that does not
 * mention it — the same invisible-mode defect the row was added to fix. It
 * goes in `live` because that is the bucket this component renders unfolded.
 */
export function partitionWorkRows(rows: readonly WorkRow[]): {
  live: WorkRow[];
  reason: WorkRow[];
  proof: WorkRow[];
} {
  const live: WorkRow[] = [];
  const reason: WorkRow[] = [];
  const proof: WorkRow[] = [];
  for (const row of rows) {
    if (row.announce === true) {
      live.push(row);
      continue;
    }
    if (isLive(row)) {
      if (isReason(row)) reason.push(row);
      else live.push(row);
      continue;
    }
    if (isReason(row)) reason.push(row);
    else proof.push(row);
  }
  return { live, reason, proof };
}

/** @deprecated Use {@link partitionWorkRows}. Kept for older test imports. */
export function partitionProofReads(rows: readonly WorkRow[]): {
  proof: WorkRow[];
  rest: WorkRow[];
} {
  const { live, reason, proof } = partitionWorkRows(rows);
  return {
    proof: [...reason.filter((r) => !isLive(r)), ...proof],
    rest: [...live, ...reason.filter((r) => isLive(r))],
  };
}

function proofSummaryLabel(proof: readonly WorkRow[]): string {
  const files = proof.filter((r) => r.group === 'read' && r.identifier).length;
  if (files === proof.length && files >= 2) {
    return `${files.toLocaleString('en-US')} files researched`;
  }
  return `${proof.length.toLocaleString('en-US')} steps`;
}

function reasoningHeaderLabel(
  reason: readonly WorkRow[],
  reasoningProvider: string | null | undefined,
): string {
  const live = reason.find((r) => isLive(r));
  if (live) return liveLabelFor(live, reasoningProvider);
  if (reason.some((r) => r.from === 'canvas:block' || /canvas\.write_/.test(r.verb))) {
    return 'Drew on AI Canvas';
  }
  if (reason.some((r) => r.from === 'topology:proposal' || /propose_topology/.test(r.verb))) {
    return 'Drew on Architecture';
  }
  return 'Reasoning';
}

function ReasoningFold({
  rows,
  reasoningProvider,
}: {
  rows: readonly WorkRow[];
  reasoningProvider?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const label = reasoningHeaderLabel(rows, reasoningProvider);

  return (
    <div className="reasonfold" data-testid="chat-reason-fold">
      <button
        type="button"
        className="reasonfold-trigger"
        data-testid="chat-reason-toggle"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <Icon name="clock" size={14} />
        <span className="name">{label}</span>
        <Icon name={open ? 'chevdown' : 'chevright'} size={12} />
      </button>
      {open ? (
        <div className="reasonfold-body" data-testid="chat-reason-body">
          {rows.map((row) => (
            <WorkRowLine key={row.id} row={row} reasoningProvider={reasoningProvider} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function WorkProofStack({
  rows,
  inline = false,
  reasoningProvider,
  roundTimer = null,
  stallNotice = null,
}: WorkProofStackProps) {
  const { live, reason, proof } = partitionWorkRows(rows);
  const liveReason = reason.filter(isLive);
  const landedReason = reason.filter((r) => !isLive(r));
  const [proofOpen, setProofOpen] = useState(false);

  const collapseProof = proof.length >= 2;
  const stackClass = ['toolstack', inline ? 'inline' : ''].filter(Boolean).join(' ');
  const showLiveStatus = roundTimer !== null || stallNotice !== null;

  return (
    <div className={stackClass} data-testid="chat-tool-stack">
      {showLiveStatus ? (
        <div className="ask-live-status" data-testid="chat-ask-live-status">
          {roundTimer ? (
            <p className="ask-round-status" data-testid="chat-round-timer">
              {formatRoundTimer(roundTimer.current, roundTimer.max, roundTimer.elapsedMs)}
            </p>
          ) : null}
          {stallNotice ? (
            <p className="ask-stall-notice" data-testid="chat-provider-stall">
              {stallNotice}
            </p>
          ) : null}
        </div>
      ) : null}
      {live.map((row) => (
        <WorkRowLine key={row.id} row={row} reasoningProvider={reasoningProvider} />
      ))}
      {liveReason.map((row) => (
        <WorkRowLine key={row.id} row={row} reasoningProvider={reasoningProvider} />
      ))}
      {landedReason.length > 0 ? (
        <ReasoningFold rows={landedReason} reasoningProvider={reasoningProvider} />
      ) : null}
      {collapseProof ? (
        <div className="prooffold" data-testid="chat-proof-fold">
          <button
            type="button"
            className="prooffold-trigger"
            data-testid="chat-proof-toggle"
            aria-expanded={proofOpen}
            onClick={() => setProofOpen((was) => !was)}
          >
            <Icon name="file" size={12} />
            <span className="name">{proofSummaryLabel(proof)}</span>
            <Icon name={proofOpen ? 'chevdown' : 'chevright'} size={12} />
          </button>
          {proofOpen ? (
            <div className="prooffold-body" data-testid="chat-proof-body">
              {proof.map((row) => (
                <WorkRowLine key={row.id} row={row} reasoningProvider={reasoningProvider} />
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        proof.map((row) => <WorkRowLine key={row.id} row={row} reasoningProvider={reasoningProvider} />)
      )}
    </div>
  );
}
