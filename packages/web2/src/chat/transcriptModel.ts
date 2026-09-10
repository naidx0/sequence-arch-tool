import { coverageSentence } from './coverageLine';
import { summarizeEditLedger, type EditLedgerSummary } from './editLedgerModel';
import {
  activePhaseRow,
  phaseLiveLabel,
  phaseSurfaceCrumb,
} from './phaseCardModel';
import { stripToolProse } from './stripToolProse';
import type { AskMetrics } from '@sequence/api-types';
import type {
  AssistantTurn,
  FileEditProposal,
  InFlightTurn,
  ProposalId,
  Turn,
  TurnId,
  UserTurn,
  WorkRow,
} from '../state/types';
import { formatElapsed } from './workRowModel';

/* ══════════════════════════════════════════════════════════════════════════
   ITEM 2.5 — THE TRANSCRIPT AS A FOLD
   packages/web2/src/chat/transcriptModel.ts

   Zero React, zero DOM, zero fetch.

   THE TRANSCRIPT IS A FOLD, NOT A SECOND COPY OF THE THREAD. The first finding
   of docs/research/ml-harness-adoption.md (§1.1, §1.10) is that MLH renders
   `foldEvents(events) -> TranscriptItem[]` and keeps no store at all, and that
   this is precisely why a dropped connection, a closed laptop or a reload
   cannot produce a transcript that disagrees with the record: "there is no
   second source of truth to disagree with the log". v1 has two stores and has
   to write the hydrated graph into both, with a comment saying why.

   So every ordering, splitting and ending rule in this product lives in this
   one pure function, and the component below it holds none of them. Changing
   what the transcript shows means changing a test.
   ══════════════════════════════════════════════════════════════════════════ */

/** Why a turn produced an ending row instead of, or as well as, an answer. */
export type EndingReason = 'no-words' | 'stopped' | 'error';

/**
 * One rendered object. The kinds are the sheet's own objects, not a
 * generalisation over them: sheet 12.1 says "a turn has three objects and they
 * nest in one order", and `opens` and `ending` are the two additions the sheet
 * draws and names.
 */
export type TranscriptItem =
  | { key: string; kind: 'user'; turn: UserTurn }
  | { key: string; kind: 'work'; turnId: TurnId; rows: WorkRow[] }
  | {
      key: string;
      kind: 'prose';
      turnId: TurnId;
      text: string;
      streaming: boolean;
      /**
       * DECISION 7 — THE ROWS THAT JUSTIFY THIS ANSWER, CARRIED INSIDE IT.
       * The narration rows (`opens === null`) fold into the answer flow and
       * render there; the affordance rows keep their own item below. Empty
       * for a turn that called no tools.
       */
      work: WorkRow[];
    }
  | { key: string; kind: 'opens'; turnId: TurnId; row: WorkRow }
  | { key: string; kind: 'ending'; turnId: TurnId; reason: EndingReason; text: string }
  /**
   * WHAT THE ANSWER DID NOT READ — its own item, not a decoration on the prose.
   *
   * It is a claim about the TURN, with the same standing as the answer itself,
   * and CANON calls it the one thing the competition structurally cannot say.
   * Folding it into the prose string would make it a sentence the model appears
   * to have written; it is a measurement the engine made.
   */
  | { key: string; kind: 'coverage'; turnId: TurnId; text: string }
  /**
   * WHAT THE TURN COST — its own item, for the coverage reason exactly.
   *
   * This is a bring-your-own-key product whose tool loop makes several
   * provider calls per turn, and no number appeared anywhere. The server has
   * summed real usage across rounds and streamed
   * `{type:'usage', inputTokens, outputTokens, estimated}` the whole time; the
   * store folded it onto the turn; nothing rendered it.
   *
   * `estimated` is carried rather than hidden, because a counted token and a
   * guessed one are different claims and a reader paying for one of them is
   * entitled to know which they are looking at.
   */
  | {
      key: string;
      kind: 'usage';
      turnId: TurnId;
      inputTokens: number;
      outputTokens: number;
      estimated: boolean;
      metrics?: AskMetrics | null;
    }
  /**
   * RESTORED-TURN HONESTY — one note for a stretch that came back from disk.
   *
   * Ids are prefixed `restored:`. Without a surface sentence, that answer looks
   * identical to a live turn. The note is a fold item, not a flag on every turn.
   */
  | { key: string; kind: 'restored'; text: string }
  /** B3.2 — earlier turns were omitted under HISTORY_CAP for this ask. */
  | { key: string; kind: 'memory-trim'; text: string; turnId: TurnId }
  | {
      key: string;
      kind: 'turn-elapsed';
      turnId: TurnId;
      ms: number;
      /** True while the turn is still streaming — label ticks in the view. */
      live?: boolean;
    }
  | {
      key: string;
      kind: 'phase';
      turnId: TurnId;
      crumb: string;
      label: string;
      ms: number;
    }
  | { key: string; kind: 'edits'; turnId: TurnId; summary: EditLedgerSummary };

/** Structural signal from `fromChatMemory` — never collides with a live turn id. */
export function isRestoredTurnId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('restored:');
}

const RESTORED_NOTE_GROUNDED =
  'Came back from disk — reloaded from the saved session.';
const RESTORED_NOTE_PROSE =
  'Came back from disk — words only. Work and evidence were not saved.';

function restoredHonestyText(turns: readonly Turn[]): string {
  const grounded = turns.some((t) => {
    if (t.role !== 'assistant') return false;
    const work = t.work ?? [];
    const evidence = t.evidence ?? { tools: [], filesRead: [], proposals: [] };
    return (
      work.length > 0 ||
      (evidence.tools?.length ?? 0) > 0 ||
      (evidence.filesRead?.length ?? 0) > 0 ||
      t.coverage != null
    );
  });
  return grounded ? RESTORED_NOTE_GROUNDED : RESTORED_NOTE_PROSE;
}
/**
 * THE SIX PURPOSE-WRITTEN SENTENCES ARE THE POINT OF THIS BLOCK.
 *
 * Ported from MLH's `SILENT_TURN` (conductor.py:170-205) and its doctrine: a
 * turn ALWAYS ends in words. Its docstring cites the real incident — events
 * 4104-4111, four tool calls, zero words, stream ended at 5.296s — and the fix
 * is that the surface refuses to render nothing.
 *
 * This is a live Sequence bug, not a hypothetical: askPipeline.ts:307-312
 * strips fenced tool blocks out of `text` and then breaks the loop, so a final
 * round that emitted tool blocks only leaves `text === ''` and the user gets a
 * blank answer with no explanation. The existing engine test misses it because
 * its canned fourth reply carries prose.
 *
 * The sentence says what happened and points at the evidence that is on screen.
 * It never apologises and never guesses at a cause.
 */
const NO_WORDS =
  'That turn ended without words. Everything it did is in the rows above, and nothing was written.';

const STOPPED = 'You stopped this turn. Everything above had already happened.';

export function workedForLabel(ms: number): string {
  if (ms < 60_000) {
    const s = Math.max(1, Math.round(ms / 1000));
    return `Worked for ${s}s ›`;
  }
  return `Worked for ${formatElapsed(ms)} ›`;
}

export interface FoldContext {
  proposals?: Record<ProposalId, FileEditProposal>;
  now?: number;
  reasoningProvider?: string | null;
}

/**
 * Fold committed turns plus the in-flight turn into what the column draws.
 *
 * THE IN-FLIGHT TURN IS FOLDED IN, NEVER SPLICED IN. types.ts holds it outside
 * `turns` because "a partially streamed answer is not a turn yet: appending it
 * and then mutating it in place is how a cancelled stream leaves half a
 * sentence in the transcript that reloads as fact". This function renders it at
 * the tail without changing that; the array it reads is still the record.
 */
export function foldTranscript(
  turns: Turn[],
  inFlight: InFlightTurn | null,
  ctx: FoldContext = {},
): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let notedRestored = false;
  const restoredText = restoredHonestyText(turns);
  const now = ctx.now ?? 0;

  for (const turn of turns) {
    if (!notedRestored && isRestoredTurnId(turn.id)) {
      items.push({ key: 'restored-honesty', kind: 'restored', text: restoredText });
      notedRestored = true;
    }
    if (turn.role === 'user') {
      const dropped = turn.memoryTrim?.droppedTurns ?? 0;
      if (dropped > 0) {
        items.push({
          key: `${turn.id}:memory-trim`,
          kind: 'memory-trim',
          turnId: turn.id,
          text:
            dropped === 1
              ? 'Memory trimmed — 1 earlier turn was omitted from this ask to save tokens.'
              : `Memory trimmed — ${dropped} earlier turns were omitted from this ask to save tokens.`,
        });
      }
      items.push({ key: `${turn.id}:u`, kind: 'user', turn });
      continue;
    }
    pushAssistant(items, turn, ctx);
  }

  if (inFlight) pushInFlight(items, inFlight, ctx, now);

  return items;
}

function pushAssistant(
  items: TranscriptItem[],
  turn: AssistantTurn,
  ctx: FoldContext,
): void {
  if (turn.durationMs !== undefined && turn.durationMs > 0) {
    items.push({
      key: `${turn.id}:elapsed`,
      kind: 'turn-elapsed',
      turnId: turn.id,
      ms: turn.durationMs,
    });
  }

  pushWorkWithProse(items, turn.id, turn.work, false, turn.text);

  const edits = summarizeEditLedger(turn.evidence.proposals ?? [], ctx.proposals ?? {});
  if (edits) {
    items.push({ key: `${turn.id}:edits`, kind: 'edits', turnId: turn.id, summary: edits });
  }

  /*
   * THE CUT IS STATED DIRECTLY UNDER THE ANSWER IT IS ABOUT.
   *
   * Not in the rail, where it lived until now as a per-file tint and never as a
   * sentence: a reader looking at an answer cannot be expected to go and find
   * out what that answer could not see. Withheld entirely when there is no
   * denominator — see `coverageSentence`.
   */
  const coverage = coverageSentence(turn.coverage);
  if (coverage) {
    items.push({ key: `${turn.id}:c`, kind: 'coverage', turnId: turn.id, text: coverage });
  }

  /*
   * AND WHAT IT COST, on the same footing.
   *
   * Withheld entirely when the turn carries no usage — a turn answered from
   * cache or interrupted before a provider call has no cost, and rendering
   * "0 tokens" would be a measurement nobody made.
   */
  if (turn.usage) {
    items.push({
      key: `${turn.id}:u`,
      kind: 'usage',
      turnId: turn.id,
      inputTokens: turn.usage.inputTokens,
      outputTokens: turn.usage.outputTokens,
      estimated: turn.usage.estimated,
      metrics: turn.metrics ?? null,
    });
  }

  /*
   * THE AFFORDANCE ROWS SIT BELOW THE ANSWER.
   *
   * Sheet 12.1 draws "Selected ‹n› nodes on the board" after the prose,
   * bordered, with a chevron and the words "opens the canvas". It is not
   * narration of work already described — it is the door to the thing the
   * answer just talked about, and it reads as one only where the answer has
   * already been read. Sheet 12.2 states the rule generally: "anything wider
   * than the row becomes a right-hand affordance that opens the canvas or the
   * index rail — never an expanded block inside the transcript".
   */
  for (const row of turn.work) {
    if (row.opens === null) continue;
    items.push({ key: `${turn.id}:o:${row.id}`, kind: 'opens', turnId: turn.id, row });
  }

  const ending = endingFor(turn);
  if (ending) items.push({ key: `${turn.id}:e`, kind: 'ending', turnId: turn.id, ...ending });
}

function pushInFlight(items: TranscriptItem[], turn: InFlightTurn, ctx: FoldContext, now: number): void {
  const tick = now > 0 ? now : turn.startedAt;
  const elapsedMs = Math.max(0, tick - turn.startedAt);
  items.push({
    key: `${turn.turnId}:elapsed:live`,
    kind: 'turn-elapsed',
    turnId: turn.turnId,
    ms: elapsedMs,
    live: true,
  });

  const phaseRow = activePhaseRow(turn.work);
  if (phaseRow) {
    items.push({
      key: `${turn.turnId}:phase`,
      kind: 'phase',
      turnId: turn.turnId,
      crumb: phaseSurfaceCrumb(phaseRow),
      label: phaseLiveLabel(phaseRow, ctx.reasoningProvider),
      ms: Math.max(0, tick - turn.startedAt),
    });
  }

  const edits = summarizeEditLedger(turn.evidence.proposals ?? [], ctx.proposals ?? {});
  if (edits) {
    items.push({ key: `${turn.turnId}:edits:live`, kind: 'edits', turnId: turn.turnId, summary: edits });
  }

  pushWorkWithProse(items, turn.turnId, turn.work, true, turn.text);

  /*
   * NO ENDING WHILE THE STREAM IS OPEN, and no placeholder either. A turn in
   * `queued` has produced no event, so it draws nothing: every row names the
   * event that made it, and inventing a "thinking" row here would be the one
   * lie this surface exists to refuse. The composer already shows stop, which
   * is where "something is happening" is told.
   */
}

/**
 * THE FOLD POINT OF DECISION 7.
 *
 * A turn with an answer carries its narration rows ON the prose item, so the
 * renderer can fold them into the answer flow (artifact B: quiet, indented,
 * left rule) instead of standing a detached trail block beside the answer. The
 * detached stack survives in exactly one case — rows that precede ANY prose:
 * a wordless turn, or an in-flight turn whose first frames arrived before the
 * model said anything. Once text exists, the rows move inside it.
 *
 * Affordance rows (`opens !== null`) never fold; they stay sheet 12.1's doors
 * below the answer.
 */
function pushWorkWithProse(
  items: TranscriptItem[],
  turnId: TurnId,
  work: WorkRow[],
  live: boolean,
  text: string,
): void {
  const stack = work.filter((row) => row.opens === null);
  const { stripped, tools } = stripToolProse(text);
  const hasVisibleProse = stripped.trim() !== '';
  const hasToolStory = tools.length > 0 || text.trim() !== '';

  /* Always keep the raw text on the prose item — Transcript strips for display
     and needs the dump to mint tool-call cards. Deciding "is there prose?"
     still uses the stripped form so a tools-only turn can fold to work rows. */
  if (hasVisibleProse || (live && hasToolStory) || (!live && tools.length > 0)) {
    items.push({
      key: `${turnId}:p`,
      kind: 'prose',
      turnId,
      text,
      streaming: live,
      work: stack,
    });
    return;
  }

  if (stack.length === 0) return;
  items.push({ key: `${turnId}:w${live ? ':live' : ''}`, kind: 'work', turnId, rows: stack });
}

function endingFor(turn: AssistantTurn): { reason: EndingReason; text: string } | null {
  if (turn.failure?.kind === 'stopped') return { reason: 'stopped', text: STOPPED };

  if (turn.failure?.kind === 'error') {
    /*
     * A FAILED TURN IN THE RECORD IS A LINE, NOT A MESSAGE.
     *
     * Graphite page 20.4 and adoption §3.6 make the law: an error is a strip
     * above the composer, never a message in the thread — v1 violates it at
     * ProductChat.tsx:646-651 by turning a failed ask into an ASSISTANT
     * MESSAGE, which is an error permanently in the artifact you hand to
     * someone else. The strip is for the failure that just happened; a turn
     * that already failed and was committed still has to be readable a week
     * later, so it keeps ONE muted line in the tool-row register carrying the
     * message verbatim. It is a record. It does not shout and it does not
     * pretend to be the assistant speaking.
     */
    return { reason: 'error', text: turn.failure.message };
  }

  if (turn.text.trim() === '') return { reason: 'no-words', text: NO_WORDS };

  return null;
}
