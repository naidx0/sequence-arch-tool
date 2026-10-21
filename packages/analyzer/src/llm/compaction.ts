/* ══════════════════════════════════════════════════════════════════════════
   THE ASK PATH CALLS THIS NOW (item 019-10, 2026-10)
   ══════════════════════════════════════════════════════════════════════════

   This header used to explain why it did not: the client sent at most 20 turns
   and the history section was bounded, so there was nothing to compact. That
   reasoning ended the moment the cap did. The ask path now builds its history
   on the server from the whole stored transcript (`server/askHistory.ts`),
   keeps the newest turns that fit the model's window, and hands the rest to
   `compactSessionTurns` with a summarizer backed by the chat's own model (or
   an extractive one when none is available). The result is cached on disk by
   the hash of the turns it covers, so the provider call is made once per set.
   `modelSessionService` still applies compaction on the stateful path.
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
  /** Turns folded in all, including ids rolled off the capped lists above. */
  sourceTurnTotal?: number;
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

/** Newest entries kept per provenance list. Older turn ids roll up into `sourceTurnTotal`; older items are dropped. */
export const MAX_SOURCE_TURNS = 64;
export const MAX_PRESERVED_ITEMS = 64;

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
    const rolled = (record.sourceTurnTotal ?? record.sourceTurnIds.length) - record.sourceTurnIds.length;
    if (rolled > 0) parts.push(`(${rolled} earlier turns rolled up)`);
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

/** Dedupe keeping the LAST occurrence's position (oldest first, newest last), so a cap can keep the newest. */
function uniqueRecent(items: string[]): string[] {
  const out = new Map<string, true>();
  for (const raw of items) {
    const s = raw.trim();
    if (s === '') continue;
    out.delete(s);
    out.set(s, true);
  }
  return [...out.keys()];
}

function newest<T>(items: T[], max: number): T[] {
  return items.length > max ? items.slice(items.length - max) : items;
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
    decisions: uniqueRecent(decisions),
    evidence: uniqueRecent(evidence),
    actions: uniqueRecent(actions),
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
  /** Tokens the prompt carries that compaction cannot shrink (policy, tools, snapshot, the request). Counted against the threshold. */
  reservedTokens?: number;
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
  const reserved = Math.max(0, input.reservedTokens ?? 0);
  const tokensBefore = estimateTurnTokens(allTurns) + (input.existingCompacted ? approxTokens(input.existingCompacted.summary) : 0) + reserved;

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
  const earlier = input.existingCompacted;
  const preserved = collectPreserved(eligible);
  /* A second compaction FOLDS the first: its decisions, evidence, open actions and source turns stay on the record. */
  if (earlier) {
    preserved.decisions = uniqueRecent([...earlier.preservedDecisions, ...preserved.decisions]);
    preserved.evidence = uniqueRecent([...earlier.preservedEvidence, ...preserved.evidence]);
    preserved.actions = uniqueRecent([...earlier.unresolvedActions, ...preserved.actions]);
  }
  /* Every fold used to carry every earlier id, hash and item, so the state grew without bound and threw ContextLimitError
     on each compaction. Keep the newest of each and roll the rest into a count. */
  preserved.decisions = newest(preserved.decisions, MAX_PRESERVED_ITEMS);
  preserved.evidence = newest(preserved.evidence, MAX_PRESERVED_ITEMS);
  preserved.actions = newest(preserved.actions, MAX_PRESERVED_ITEMS);
  const sourceTurnTotal = (earlier?.sourceTurnTotal ?? earlier?.sourceTurnIds.length ?? 0) + eligible.length;
  const sourceTurnIds = newest([...(earlier?.sourceTurnIds ?? []), ...eligible.map((t) => t.id)], MAX_SOURCE_TURNS);
  const sourceTurnHashes = newest([...(earlier?.sourceTurnHashes ?? []), ...eligible.map((t) => hashTurn(t))], MAX_SOURCE_TURNS);
  /* The summarizer reads the earlier summary first, as a turn, so nothing it said is dropped. */
  const summarizable: SessionTurn[] = earlier && earlier.summary.trim() !== ''
    ? [{ id: 'earlier-summary', role: 'assistant', content: `Summary of earlier conversation: ${earlier.summary}` }, ...eligible]
    : eligible;

  const inputText = summarizable.map((t) => `[${t.role}] ${t.content}`).join('\n');
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
    /* Nothing cut from the input: hand the summarizer the real turns. Re-deriving them by splitting
       on newlines made every multi-line turn several, relabelled by guesswork. */
    const turnsForSummary: SessionTurn[] = inputOmitted === 0 ? summarizable : boundedInput.split('\n').map((line, i) => ({
      id: eligible[i]?.id ?? `line-${i}`,
      role: (line.startsWith('[assistant]') ? 'assistant' : 'user') as SessionTurn['role'],
      content: line.replace(/^\[(user|assistant)\]\s*/, ''),
    }));
    const result = await summarizer({ turns: turnsForSummary.length > 0 ? turnsForSummary : summarizable, maxOutputTokens: outputBudget });
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
    sourceTurnTotal,
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
    /* Oversized items (not just many): shed the oldest preserved entries before giving up. */
    while (compactedState.length > budgets.compactedStateMaxBytes) {
      const lists = [compacted.preservedDecisions, compacted.preservedEvidence, compacted.unresolvedActions, compacted.sourceTurnIds];
      const biggest = lists.reduce((a, b) => (b.length > a.length ? b : a));
      if (biggest.length <= 1) break;
      if (biggest === compacted.sourceTurnIds) compacted.sourceTurnHashes.shift();
      biggest.shift();
      compactedState = serializeCompactedState(compacted);
    }
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
    droppedTurnIds: eligible.map((t) => t.id),
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
