/* ══════════════════════════════════════════════════════════════════════════
   WHY THE ASK PATH DOES NOT CALL THIS — checked 2026-08-22
   ══════════════════════════════════════════════════════════════════════════

   A competitive survey listed this module as "BUILT BUT UNREACHABLE (orphaned
   library)" and recommended wiring it into the ask path "once history ships".
   History shipped the same day. This was then measured rather than wired, and
   the recommendation does not survive the measurement.

   Compaction exists for a context that grows WITHOUT BOUND — a long-lived
   session accumulating turns until it approaches the model's window. The ask
   path is not that shape:

     · the client sends at most `HISTORY_CAP` = 20 turns
       (`packages/web2/src/chat/askHistory.ts`), and
     · `renderAskHistorySection` slices to the last 20 again and truncates each
       turn at 1200 characters (`explain.ts`).

   So the history section is bounded at roughly 24KB no matter how long the
   conversation runs. Compacting a bounded section would spend a PROVIDER CALL
   — compaction is itself a model round — to shrink something that cannot grow,
   on every turn, forever.

   THIS IS NOT DEAD CODE. `modelSessionService` is the stateful path where
   context does accumulate, and `provider.ts` applies compaction there when a
   caller supplies `sessionKey` and `sessionService`. That is the shape this
   was written for.

   If the ask path ever removes the cap — and the reason to remove it would be
   a real one, since 20 turns is a short memory — this is what to reach for,
   and this note is why it was not reached for sooner.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ADR-013 Phase C — bounded multi-turn compaction for model sessions.
 *
 * Compacts only the oldest eligible turns before a context threshold, preserving
 * pinned decisions, grounded evidence references, and unresolved actions. Output
 * is a versioned structured record with source turn hashes for the prompt envelope.
 */

import { createHash } from 'node:crypto';
import { approxTokens, budgetChars, cutTextToBudget, omissionMarker } from './tokenBudget.js';
import { normalizeEnvelopeText } from './promptEnvelope.js';

export const COMPACTION_VERSION = 1;

/** One dialog turn stored in a model session. */
export interface SessionTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** User decisions that must survive compaction. */
  pinnedDecisions?: string[];
  /** Grounded evidence references (paths, edge ids — not raw repo content). */
  evidenceRefs?: string[];
  /** Unresolved follow-ups the model or user still owes. */
  unresolvedActions?: string[];
}

/** Structured compaction record — serialized into the envelope stable prefix. */
export interface CompactedSessionRecord {
  version: number;
  sourceTurnIds: string[];
  sourceTurnHashes: string[];
  preservedDecisions: string[];
  preservedEvidence: string[];
  unresolvedActions: string[];
  summary: string;
  omissionMarker?: string;
}

export interface CompactionBudgets {
  /** Max tokens fed to the summarizer for eligible turns. */
  summaryInputTokens: number;
  /** Max tokens the summarizer may return. */
  summaryOutputTokens: number;
  /** Hard byte cap on the serialized compacted state. */
  compactedStateMaxBytes: number;
}

export const DEFAULT_COMPACTION_BUDGETS: CompactionBudgets = {
  summaryInputTokens: 8_000,
  summaryOutputTokens: 2_000,
  compactedStateMaxBytes: 32_768,
};

export interface CompactionDiagnostics {
  version: number;
  tokensBefore: number;
  tokensAfter: number;
  preservedDecisionCount: number;
  preservedEvidenceCount: number;
  recentTurnsRetained: number;
  droppedTurnCount: number;
  compactionAttempts: number;
  compactionLatencyMs: number;
  failureReason?: string;
}

export type TurnSummarizer = (input: {
  turns: SessionTurn[];
  maxOutputTokens: number;
}) => Promise<{ summary: string } | { error: string }>;

/** Deterministic local summarizer — no extra model call on the compaction path. */
export const deterministicSummarizer: TurnSummarizer = async ({ turns, maxOutputTokens }) => {
  const lines = turns.map((t) => `[${t.role}] ${t.content}`);
  const joined = lines.join('\n');
  const { text } = cutTextToBudget(joined, maxOutputTokens);
  return { summary: text };
};

export class ContextLimitError extends Error {
  constructor(message = 'context limit exceeded — compacted state and recent turns still exceed the budget') {
    super(message);
    this.name = 'ContextLimitError';
  }
}

export class CompactionFailedError extends Error {
  readonly diagnostics: CompactionDiagnostics;
  constructor(message: string, diagnostics: CompactionDiagnostics) {
    super(message);
    this.name = 'CompactionFailedError';
    this.diagnostics = diagnostics;
  }
}

function hashUtf8(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

/** Content-addressed hash of a turn body (role + content). */
export function hashTurn(turn: Pick<SessionTurn, 'id' | 'role' | 'content'>): string {
  return hashUtf8(`${turn.id}:${turn.role}:${normalizeEnvelopeText(turn.content)}`);
}

/** Serialize a compaction record for the prompt envelope stable prefix. */
export function serializeCompactedState(record: CompactedSessionRecord): string {
  const parts: string[] = [];
  parts.push(`@seq-compaction v${record.version}`);
  if (record.preservedDecisions.length > 0) {
    parts.push('--- PRESERVED DECISIONS ---');
    for (const d of [...record.preservedDecisions].sort()) parts.push(normalizeEnvelopeText(d));
  }
  if (record.preservedEvidence.length > 0) {
    parts.push('--- PRESERVED EVIDENCE ---');
    for (const e of [...record.preservedEvidence].sort()) parts.push(normalizeEnvelopeText(e));
  }
  if (record.unresolvedActions.length > 0) {
    parts.push('--- UNRESOLVED ACTIONS ---');
    for (const a of [...record.unresolvedActions].sort()) parts.push(normalizeEnvelopeText(a));
  }
  parts.push('--- SUMMARY ---');
  parts.push(normalizeEnvelopeText(record.summary));
  if (record.sourceTurnIds.length > 0) {
    parts.push('--- SOURCE TURNS ---');
    for (let i = 0; i < record.sourceTurnIds.length; i++) {
      parts.push(`${record.sourceTurnIds[i]}:${record.sourceTurnHashes[i]}`);
    }
  }
  if (record.omissionMarker) {
    parts.push('--- OMISSION ---');
    parts.push(record.omissionMarker);
  }
  return parts.join('\n');
}

function uniqueSorted(items: string[]): string[] {
  return [...new Set(items.map((s) => s.trim()).filter((s) => s !== ''))].sort();
}

function collectPreserved(turns: SessionTurn[]): {
  decisions: string[];
  evidence: string[];
  actions: string[];
} {
  const decisions: string[] = [];
  const evidence: string[] = [];
  const actions: string[] = [];
  for (const t of turns) {
    if (t.pinnedDecisions) decisions.push(...t.pinnedDecisions);
    if (t.evidenceRefs) evidence.push(...t.evidenceRefs);
    if (t.unresolvedActions) actions.push(...t.unresolvedActions);
  }
  return {
    decisions: uniqueSorted(decisions),
    evidence: uniqueSorted(evidence),
    actions: uniqueSorted(actions),
  };
}

function estimateTurnTokens(turns: SessionTurn[]): number {
  return approxTokens(turns.map((t) => `${t.role}: ${t.content}`).join('\n'));
}

export interface CompactSessionInput {
  turns: SessionTurn[];
  existingCompacted?: CompactedSessionRecord;
  /** Recent tail kept verbatim (not compacted). */
  recentTailCount: number;
  /** Trigger compaction when estimated tokens exceed this. */
  contextThresholdTokens: number;
  budgets?: Partial<CompactionBudgets>;
  summarizer?: TurnSummarizer;
}

export interface CompactSessionResult {
  compacted: CompactedSessionRecord;
  compactedState: string;
  recentTurns: SessionTurn[];
  droppedTurnIds: string[];
  diagnostics: CompactionDiagnostics;
}

/**
 * Compact the oldest eligible turns when over the context threshold.
 * Returns the input unchanged when compaction is not needed.
 */
export async function compactSessionTurns(input: CompactSessionInput): Promise<CompactSessionResult> {
  const budgets: CompactionBudgets = { ...DEFAULT_COMPACTION_BUDGETS, ...input.budgets };
  const summarizer = input.summarizer ?? deterministicSummarizer;
  const startMs = Date.now();
  const tail = Math.max(0, input.recentTailCount);
  const allTurns = input.turns;
  const tokensBefore = estimateTurnTokens(allTurns) + (input.existingCompacted ? approxTokens(input.existingCompacted.summary) : 0);

  if (tokensBefore <= input.contextThresholdTokens) {
    const empty: CompactedSessionRecord = input.existingCompacted ?? {
      version: COMPACTION_VERSION,
      sourceTurnIds: [],
      sourceTurnHashes: [],
      preservedDecisions: [],
      preservedEvidence: [],
      unresolvedActions: [],
      summary: '',
    };
    const compactedState = input.existingCompacted ? serializeCompactedState(input.existingCompacted) : '';
    return {
      compacted: empty,
      compactedState,
      recentTurns: allTurns,
      droppedTurnIds: [],
      diagnostics: {
        version: COMPACTION_VERSION,
        tokensBefore,
        tokensAfter: tokensBefore,
        preservedDecisionCount: empty.preservedDecisions.length,
        preservedEvidenceCount: empty.preservedEvidence.length,
        recentTurnsRetained: allTurns.length,
        droppedTurnCount: 0,
        compactionAttempts: 0,
        compactionLatencyMs: Date.now() - startMs,
      },
    };
  }

  if (allTurns.length <= tail) {
    throw new ContextLimitError();
  }

  const eligible = allTurns.slice(0, allTurns.length - tail);
  const recentTurns = allTurns.slice(allTurns.length - tail);
  const preserved = collectPreserved(eligible);
  const sourceTurnIds = eligible.map((t) => t.id);
  const sourceTurnHashes = eligible.map((t) => hashTurn(t));

  const inputText = eligible.map((t) => `[${t.role}] ${t.content}`).join('\n');
  const { text: boundedInput, omitted: inputOmitted } = (() => {
    const limit = budgetChars(budgets.summaryInputTokens);
    if (inputText.length <= limit) return { text: inputText, omitted: 0 };
    const { text, omitted } = cutTextToBudget(inputText, budgets.summaryInputTokens);
    return { text, omitted };
  })();

  let attempts = 0;
  let summary = '';
  let lastError: string | undefined;

  const outputBudgets = [budgets.summaryOutputTokens, Math.floor(budgets.summaryOutputTokens / 2)];

  for (const outputBudget of outputBudgets) {
    attempts++;
    const turnsForSummary: SessionTurn[] = boundedInput.split('\n').map((line, i) => ({
      id: eligible[i]?.id ?? `line-${i}`,
      role: (line.startsWith('[assistant]') ? 'assistant' : 'user') as SessionTurn['role'],
      content: line.replace(/^\[(user|assistant)\]\s*/, ''),
    }));
    const result = await summarizer({ turns: turnsForSummary.length > 0 ? turnsForSummary : eligible, maxOutputTokens: outputBudget });
    if ('error' in result) {
      lastError = result.error;
      continue;
    }
    summary = result.summary;
    break;
  }

  if (!summary) {
    throw new CompactionFailedError('compaction summarizer failed after bounded retries', {
      version: COMPACTION_VERSION,
      tokensBefore,
      tokensAfter: tokensBefore,
      preservedDecisionCount: preserved.decisions.length,
      preservedEvidenceCount: preserved.evidence.length,
      recentTurnsRetained: recentTurns.length,
      droppedTurnCount: eligible.length,
      compactionAttempts: attempts,
      compactionLatencyMs: Date.now() - startMs,
      failureReason: lastError ?? 'unknown summarizer failure',
    });
  }

  let omission: string | undefined;
  if (inputOmitted > 0) {
    omission = omissionMarker(inputOmitted, 'characters');
  }

  let compacted: CompactedSessionRecord = {
    version: COMPACTION_VERSION,
    sourceTurnIds,
    sourceTurnHashes,
    preservedDecisions: preserved.decisions,
    preservedEvidence: preserved.evidence,
    unresolvedActions: preserved.actions,
    summary,
    omissionMarker: omission,
  };

  let compactedState = serializeCompactedState(compacted);
  if (compactedState.length > budgets.compactedStateMaxBytes) {
    const reserve = omissionMarker(1, 'characters').length + 64;
    const keep = Math.max(0, budgets.compactedStateMaxBytes - reserve);
    const { text: trimmedSummary } = cutTextToBudget(summary, Math.floor(keep / 4));
    compacted.summary = trimmedSummary;
    compacted.omissionMarker = omissionMarker(compactedState.length - keep, 'characters');
    compactedState = serializeCompactedState(compacted);
    if (compactedState.length > budgets.compactedStateMaxBytes) {
      throw new ContextLimitError('compacted state still exceeds the hard byte budget after trimming');
    }
  }

  let tokensAfter = approxTokens(compactedState) + estimateTurnTokens(recentTurns);
  let trimGuard = 0;
  while (tokensAfter > input.contextThresholdTokens && compacted.summary.length > 0 && trimGuard++ < 8) {
    compacted.summary = compacted.summary.slice(0, Math.max(0, Math.floor(compacted.summary.length * 0.6)));
    compacted.omissionMarker = omission ?? omissionMarker(1, 'characters');
    compactedState = serializeCompactedState(compacted);
    tokensAfter = approxTokens(compactedState) + estimateTurnTokens(recentTurns);
  }

  if (tokensAfter > input.contextThresholdTokens) {
    throw new ContextLimitError();
  }

  return {
    compacted,
    compactedState,
    recentTurns,
    droppedTurnIds: sourceTurnIds,
    diagnostics: {
      version: COMPACTION_VERSION,
      tokensBefore,
      tokensAfter,
      preservedDecisionCount: preserved.decisions.length,
      preservedEvidenceCount: preserved.evidence.length,
      recentTurnsRetained: recentTurns.length,
      droppedTurnCount: eligible.length,
      compactionAttempts: attempts,
      compactionLatencyMs: Date.now() - startMs,
    },
  };
}

/** Format recent turns for the prompt envelope volatile suffix. */
export function formatRecentTurns(turns: SessionTurn[]): string[] {
  return turns.map((t) => `[${t.role}] ${normalizeEnvelopeText(t.content)}`);
}
