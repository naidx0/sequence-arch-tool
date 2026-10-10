/**
 * ADR-013 Phase C — capped model session service.
 *
 * Generalizes {@link module:acpSessionCache} lifecycle for multi-turn model
 * requests: per-key serialization, race-free creation, idle TTL, LRU eviction,
 * pending+live cap, and bounded queues/bytes/turn duration.
 */

import { createHash } from 'node:crypto';
import {
  compactSessionTurns,
  formatRecentTurns,
  type CompactedSessionRecord,
  type CompactionDiagnostics,
  type SessionTurn,
  ContextLimitError,
  CompactionFailedError,
  type TurnSummarizer,
  type CompactionBudgets,
} from './compaction.js';
import type { PromptEnvelopeSections } from './promptEnvelope.js';
import { approxTokens } from './tokenBudget.js';

/** Default idle TTL — matches ACP session cache. */
export const MODEL_SESSION_IDLE_TTL_MS = 10 * 60 * 1000;
/** Default cap on pending + live sessions. */
export const MODEL_SESSION_MAX = 8;

export class SessionCapacityError extends Error {
  readonly retryable = true;
  constructor(message = 'model session capacity reached — retry shortly') {
    super(message);
    this.name = 'SessionCapacityError';
  }
}

export class SessionTurnTimeoutError extends Error {
  constructor(message = 'model session turn exceeded the wall-clock duration bound') {
    super(message);
    this.name = 'SessionTurnTimeoutError';
  }
}

export interface ModelSessionLimits {
  idleTtlMs?: number;
  maxSessions?: number;
  /** Max turns waiting behind an in-flight turn on one key. */
  maxQueuedTurns?: number;
  /** Hard cap on assembled prompt bytes for one turn. */
  maxPromptBytes?: number;
  /** Hard cap on serialized compacted-state bytes. */
  maxCompactedStateBytes?: number;
  /** Wall-clock bound for one turn handler. */
  maxTurnDurationMs?: number;
  /** Brief wait when at session cap before rejecting. */
  admissionWaitMs?: number;
  /** Recent tail preserved verbatim during compaction. */
  recentTailCount?: number;
  /** Token threshold that triggers compaction. */
  contextThresholdTokens?: number;
  compactionBudgets?: Partial<CompactionBudgets>;
}

export const DEFAULT_SESSION_LIMITS: Required<
  Omit<ModelSessionLimits, 'compactionBudgets'>
> & { compactionBudgets: CompactionBudgets | undefined } = {
  idleTtlMs: MODEL_SESSION_IDLE_TTL_MS,
  maxSessions: MODEL_SESSION_MAX,
  maxQueuedTurns: 4,
  maxPromptBytes: 512 * 1024,
  maxCompactedStateBytes: 32_768,
  maxTurnDurationMs: 5 * 60 * 1000,
  admissionWaitMs: 50,
  recentTailCount: 4,
  contextThresholdTokens: 12_000,
  compactionBudgets: undefined,
};

/** Secret-free per-session diagnostics (ADR-013 §6). */
export interface ModelSessionDiagnostics {
  sessionKeyHash: string;
  liveSessions: number;
  pendingSessions: number;
  queuedTurns: number;
  compactedStateBytes: number;
  promptBytesEstimate: number;
  turnCount: number;
  compaction?: CompactionDiagnostics;
  evicted?: boolean;
}

export interface ModelSessionServiceDiagnostics {
  liveSessions: number;
  pendingSessions: number;
  totalEvictions: number;
}

export interface SessionTurnRequest {
  /** Stable envelope sections excluding volatile dialog state. */
  baseEnvelope: Omit<PromptEnvelopeSections, 'recentTurns' | 'compactedState' | 'currentRequest'>;
  currentRequest: string;
  pinnedDecisions?: string[];
  evidenceRefs?: string[];
  unresolvedActions?: string[];
  volatileMetadata?: Record<string, string>;
}

export interface SessionTurnResult<T> {
  result: T;
  sessionDiagnostics: ModelSessionDiagnostics;
}

interface Entry {
  readonly key: string;
  readonly keyHash: string;
  turns: SessionTurn[];
  compacted?: CompactedSessionRecord;
  compactedState: string;
  turnLock: Promise<unknown>;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  disposed: boolean;
  queuedTurns: number;
  activeTurn: boolean;
}

export interface ModelSessionService {
  /**
   * Run one serialized turn on `key`, preparing compaction + envelope state,
   * then invoking `execute` with the assembled envelope sections.
   */
  runTurn<T>(
    key: string,
    turn: SessionTurnRequest,
    execute: (envelope: PromptEnvelopeSections) => Promise<T>,
  ): Promise<SessionTurnResult<T>>;
  disposeAll(): Promise<void>;
  /** Live session count (excludes pending creations). */
  size(): number;
  pendingCount(): number;
  diagnostics(): ModelSessionServiceDiagnostics;
  /** Recover session state after dispose (tests / explicit re-open). */
  getSessionState(key: string): { turns: SessionTurn[]; compactedState: string } | undefined;
}

export interface ModelSessionServiceOptions extends ModelSessionLimits {
  summarizer?: TurnSummarizer;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16);
}

function nextTurnId(): string {
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createModelSessionService(opts: ModelSessionServiceOptions = {}): ModelSessionService {
  const limits = { ...DEFAULT_SESSION_LIMITS, ...opts };
  const summarizer = opts.summarizer;
  const ttlMs = limits.idleTtlMs;
  const maxSessions = Math.max(1, limits.maxSessions);

  const pending = new Map<string, Promise<Entry>>();
  const live = new Map<string, Entry>();
  let totalEvictions = 0;

  function clearIdle(entry: Entry): void {
    if (entry.idleTimer !== undefined) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }
  }

  function scheduleIdle(entry: Entry): void {
    clearIdle(entry);
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;
    const t = setTimeout(() => {
      void disposeEntry(entry);
    }, ttlMs);
    (t as { unref?: () => void }).unref?.();
    entry.idleTimer = t;
  }

  async function disposeEntry(entry: Entry): Promise<void> {
    if (entry.disposed) return;
    if (entry.activeTurn) return;
    entry.disposed = true;
    clearIdle(entry);
    if (live.get(entry.key) === entry) live.delete(entry.key);
  }

  function evictOneIdleIfAtCap(): void {
    if (live.size + pending.size < maxSessions) return;
    for (const oldest of live.values()) {
      if (!oldest.activeTurn) {
        totalEvictions++;
        void disposeEntry(oldest);
        return;
      }
    }
  }

  function enforceCap(): void {
    while (live.size + pending.size > maxSessions) {
      const oldestKey = live.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = live.get(oldestKey);
      if (!oldest || oldest.activeTurn) break;
      totalEvictions++;
      void disposeEntry(oldest);
    }
  }

  async function waitForAdmission(): Promise<void> {
    const deadline = Date.now() + limits.admissionWaitMs;
    while (live.size + pending.size >= maxSessions) {
      evictOneIdleIfAtCap();
      if (live.size + pending.size < maxSessions) return;
      if (Date.now() >= deadline) throw new SessionCapacityError();
      await new Promise((r) => setTimeout(r, 5));
      enforceCap();
    }
  }

  function createEntry(key: string): Entry {
    const keyHash = hashKey(key);
    return {
      key,
      keyHash,
      turns: [],
      compactedState: '',
      turnLock: Promise.resolve(),
      idleTimer: undefined,
      disposed: false,
      queuedTurns: 0,
      activeTurn: false,
    };
  }

  async function ensure(key: string): Promise<Entry> {
    const existing = live.get(key);
    if (existing && !existing.disposed) return existing;

    let p = pending.get(key);
    if (!p) {
      evictOneIdleIfAtCap();
      if (live.size + pending.size >= maxSessions) {
        await waitForAdmission();
      }
      p = Promise.resolve(createEntry(key));
      pending.set(key, p);
      p.then(
        (entry) => {
          if (pending.get(key) === p) pending.delete(key);
          if (entry.disposed) return;
          live.set(key, entry);
          scheduleIdle(entry);
          enforceCap();
        },
        () => {
          if (pending.get(key) === p) pending.delete(key);
        },
      );
    }
    return p;
  }

  async function prepareEnvelope(
    entry: Entry,
    turn: SessionTurnRequest,
  ): Promise<{ envelope: PromptEnvelopeSections; diagnostics: ModelSessionDiagnostics }> {
    let turns = [...entry.turns];
    let compactedState = entry.compactedState;
    let compactionDiagnostics: CompactionDiagnostics | undefined;

    const tokenEstimate = approxTokens(turns.map((t) => t.content).join('\n'));
    const needsCompaction =
      tokenEstimate > limits.contextThresholdTokens && turns.length > limits.recentTailCount;

    if (needsCompaction) {
      const compacted = await compactSessionTurns({
        turns,
        existingCompacted: entry.compacted,
        recentTailCount: limits.recentTailCount,
        contextThresholdTokens: limits.contextThresholdTokens,
        budgets: {
          compactedStateMaxBytes: limits.maxCompactedStateBytes,
          ...limits.compactionBudgets,
        },
        summarizer,
      });
      entry.compacted = compacted.compacted;
      entry.compactedState = compacted.compactedState;
      entry.turns = compacted.recentTurns;
      turns = compacted.recentTurns;
      compactedState = compacted.compactedState;
      compactionDiagnostics = compacted.diagnostics;
    }

    const envelope: PromptEnvelopeSections = {
      ...turn.baseEnvelope,
      compactedState: compactedState || undefined,
      recentTurns: turns.length > 0 ? formatRecentTurns(turns) : undefined,
      currentRequest: turn.currentRequest,
      volatileMetadata: turn.volatileMetadata,
    };

    const promptEstimate =
      (compactedState?.length ?? 0) +
      turns.reduce((n, t) => n + t.content.length, 0) +
      turn.currentRequest.length;

    if (promptEstimate > limits.maxPromptBytes) {
      throw new ContextLimitError('assembled prompt exceeds the per-session byte bound');
    }
    if ((compactedState?.length ?? 0) > limits.maxCompactedStateBytes) {
      throw new ContextLimitError('compacted state exceeds the per-session byte bound');
    }

    return {
      envelope,
      diagnostics: {
        sessionKeyHash: entry.keyHash,
        liveSessions: live.size,
        pendingSessions: pending.size,
        queuedTurns: entry.queuedTurns,
        compactedStateBytes: compactedState?.length ?? 0,
        promptBytesEstimate: promptEstimate,
        turnCount: entry.turns.length,
        compaction: compactionDiagnostics,
      },
    };
  }

  async function runTurn<T>(
    key: string,
    turn: SessionTurnRequest,
    execute: (envelope: PromptEnvelopeSections) => Promise<T>,
  ): Promise<SessionTurnResult<T>> {
    const entry = await ensure(key);

    clearIdle(entry);
    if (live.get(key) === entry) {
      live.delete(key);
      live.set(key, entry);
    }

    if (entry.queuedTurns >= limits.maxQueuedTurns) {
      throw new SessionCapacityError('turn queue depth exceeded for this session');
    }
    entry.queuedTurns++;

    const prior = entry.turnLock;
    let release!: () => void;
    entry.turnLock = new Promise<void>((r) => {
      release = r;
    });

    try {
      await prior.catch(() => undefined);
      if (entry.disposed) {
        release();
        entry.queuedTurns = Math.max(0, entry.queuedTurns - 1);
        return runTurn(key, turn, execute);
      }

      entry.activeTurn = true;
      const { envelope, diagnostics } = await prepareEnvelope(entry, turn);

      const runWithTimeout = async (): Promise<T> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            execute(envelope),
            new Promise<T>((_, reject) => {
              timer = setTimeout(
                () => reject(new SessionTurnTimeoutError()),
                limits.maxTurnDurationMs,
              );
              (timer as { unref?: () => void }).unref?.();
            }),
          ]);
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      };

      const result = await runWithTimeout();

      const userTurn: SessionTurn = {
        id: nextTurnId(),
        role: 'user',
        content: turn.currentRequest,
        pinnedDecisions: turn.pinnedDecisions,
        evidenceRefs: turn.evidenceRefs,
        unresolvedActions: turn.unresolvedActions,
      };
      entry.turns.push(userTurn);

      const assistantText =
        typeof result === 'string'
          ? result
          : result && typeof result === 'object' && 'text' in result && typeof result.text === 'string'
            ? result.text
            : undefined;
      if (assistantText !== undefined) {
        entry.turns.push({
          id: nextTurnId(),
          role: 'assistant',
          content: assistantText,
        });
      }

      return { result, sessionDiagnostics: { ...diagnostics, turnCount: entry.turns.length } };
    } catch (e) {
      if (e instanceof CompactionFailedError || e instanceof ContextLimitError) {
        await disposeEntry(entry);
      }
      throw e;
    } finally {
      entry.activeTurn = false;
      entry.queuedTurns = Math.max(0, entry.queuedTurns - 1);
      release();
      if (!entry.disposed) scheduleIdle(entry);
    }
  }

  async function disposeAll(): Promise<void> {
    const liveEntries = [...live.values()];
    live.clear();
    const pendingCreations = [...pending.values()];
    pending.clear();
    await Promise.all([
      ...liveEntries.map((e) => {
        e.disposed = true;
        clearIdle(e);
        return Promise.resolve();
      }),
      ...pendingCreations.map((p) => p.catch(() => {})),
    ]);
  }

  function getSessionState(key: string): { turns: SessionTurn[]; compactedState: string } | undefined {
    const entry = live.get(key);
    if (!entry || entry.disposed) return undefined;
    return { turns: [...entry.turns], compactedState: entry.compactedState };
  }

  return {
    runTurn,
    disposeAll,
    size: () => live.size,
    pendingCount: () => pending.size,
    diagnostics: () => ({
      liveSessions: live.size,
      pendingSessions: pending.size,
      totalEvictions,
    }),
    getSessionState,
  };
}

export { ContextLimitError, CompactionFailedError };
