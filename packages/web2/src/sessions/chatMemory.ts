/* ══════════════════════════════════════════════════════════════════════════
   THE TRANSCRIPT, ACROSS A RELOAD
   packages/web2/src/sessions/chatMemory.ts

   Refresh the tab, or click another session, and the conversation must come
   back. v1 stored prose only — work rows, tool evidence and coverage vanished,
   so a restored answer looked like a live turn that did no grounded work.

   v2 (P3) persists work + evidence + coverage on assistant turns. v1 files
   still restore as prose with empty work/evidence (honest emptiness). Effect
   stays `{ kind: 'answer' }` on restore — replaying focus/propose would move
   the canvas from a reload.

   PURE. Turns in, wire shape out, and back.
   ══════════════════════════════════════════════════════════════════════════ */

import type {
  AssistantTurn,
  Coverage,
  Turn,
  TurnEvidence,
  WorkOutcome,
  WorkRow,
} from '../state/types';

/** Wire/disk turn — prose always; v2 may carry grounded fields on assistants. */
export interface ChatMemoryTurnV1 {
  role: string;
  text: string;
  at?: string;
}

export interface ChatMemoryTurnV2 extends ChatMemoryTurnV1 {
  work?: WorkRow[];
  evidence?: TurnEvidence;
  coverage?: Coverage | null;
}

export type ChatMemoryTurn = ChatMemoryTurnV1 | ChatMemoryTurnV2;

/** The wire and disk shape. v1 = prose only; v2 = + work/evidence/coverage. */
export type ChatMemory =
  | { version: 1; sessionId: string; turns: ChatMemoryTurnV1[] }
  | { version: 2; sessionId: string; turns: ChatMemoryTurnV2[] };

/**
 * The committed transcript, as the server stores it (v2).
 *
 * Empty turns are dropped for the reason `askHistory` drops them: a stored
 * turn with no text restores as a speaker who said nothing.
 */
export function toChatMemory(sessionId: string, turns: readonly Turn[]): ChatMemory {
  return {
    version: 2,
    sessionId,
    turns: turns
      .filter((t) => typeof t.text === 'string' && t.text.trim() !== '')
      .map((t) => {
        const base: ChatMemoryTurnV2 = {
          role: t.role,
          text: t.text,
          at: new Date(t.at).toISOString(),
        };
        if (t.role !== 'assistant') return base;
        return {
          ...base,
          work: t.work,
          evidence: t.evidence,
          coverage: t.coverage,
        };
      }),
  };
}

/**
 * Read a stored transcript back as real turns.
 *
 * TOTAL ON BAD INPUT. Accepts version 1 (prose) and version 2 (grounded).
 */
export function fromChatMemory(raw: unknown): Turn[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const memory = raw as { version?: unknown; turns?: unknown };
  if (memory.version !== 1 && memory.version !== 2) return [];
  if (!Array.isArray(memory.turns)) return [];
  const version = memory.version as 1 | 2;

  const out: Turn[] = [];
  let lastQuestion: string | null = null;

  for (const [index, turn] of memory.turns.entries()) {
    if (typeof turn !== 'object' || turn === null) continue;
    const role = (turn as { role?: unknown }).role;
    const text = (turn as { text?: unknown }).text;
    if (role !== 'user' && role !== 'assistant') continue;
    if (typeof text !== 'string' || text.trim() === '') continue;

    const parsed = Date.parse(String((turn as { at?: unknown }).at ?? ''));
    const at = Number.isFinite(parsed) ? parsed : 0;
    const id = `restored:${index}` as Turn['id'];

    if (role === 'user') {
      lastQuestion = id;
      out.push({
        id,
        role: 'user',
        text,
        intents: [],
        chips: [],
        contextLines: [],
        surface: null,
        memoryTrim: null,
        at,
      });
      continue;
    }

    const work = version === 2 ? parseWorkRows((turn as ChatMemoryTurnV2).work) : [];
    const evidence =
      version === 2 ? parseEvidence((turn as ChatMemoryTurnV2).evidence) : emptyEvidence();
    const coverage = version === 2 ? parseCoverage((turn as ChatMemoryTurnV2).coverage) : null;

    out.push({
      id,
      role: 'assistant',
      replyTo: lastQuestion ?? id,
      text,
      work,
      effect: { kind: 'answer' },
      coverage,
      evidence,
      usage: null,
      metrics: null,
      contextBreakdown: null,
      advisor: null,
      diagram: null,
      source: null,
      runId: null,
      failure: null,
      at,
    } satisfies AssistantTurn);
  }
  return out;
}

export function worthPersisting(turns: readonly Turn[]): boolean {
  return turns.some((t) => typeof t.text === 'string' && t.text.trim() !== '');
}

function emptyEvidence(): TurnEvidence {
  return { tools: [], filesRead: [], proposals: [] };
}

function parseEvidence(raw: unknown): TurnEvidence {
  if (typeof raw !== 'object' || raw === null) return emptyEvidence();
  const e = raw as Partial<TurnEvidence>;
  const tools = Array.isArray(e.tools)
    ? e.tools.filter((t): t is TurnEvidence['tools'][number] => {
        if (typeof t !== 'object' || t === null) return false;
        const r = t as unknown as Record<string, unknown>;
        return (
          typeof r.id === 'string' &&
          typeof r.name === 'string' &&
          typeof r.text === 'string' &&
          typeof r.at === 'number' &&
          (r.evidence === null || typeof r.evidence === 'string')
        );
      })
    : [];
  const filesRead = Array.isArray(e.filesRead)
    ? e.filesRead.filter((p): p is string => typeof p === 'string')
    : [];
  const proposals = Array.isArray(e.proposals)
    ? e.proposals.filter((p): p is string => typeof p === 'string')
    : [];
  return { tools, filesRead, proposals };
}

function parseCoverage(raw: unknown): Coverage | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.edgesSeen !== 'number' || typeof c.edgesTotal !== 'number') return null;
  if (!Array.isArray(c.packagesSeen) || !Array.isArray(c.packagesMissed)) return null;
  return {
    edgesSeen: c.edgesSeen,
    edgesTotal: c.edgesTotal,
    packagesSeen: c.packagesSeen.filter((p): p is string => typeof p === 'string'),
    packagesMissed: c.packagesMissed.filter((p): p is string => typeof p === 'string'),
  };
}

const WORK_GROUPS = new Set(['read', 'reason', 'change', 'run']);
const WORK_STATUS = new Set(['running', 'done', 'error']);

function parseWorkRows(raw: unknown): WorkRow[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkRow[] = [];
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.verb !== 'string') continue;
    if (typeof r.group !== 'string' || !WORK_GROUPS.has(r.group)) continue;
    if (typeof r.status !== 'string' || !WORK_STATUS.has(r.status)) continue;
    if (typeof r.from !== 'string') continue;
    const opens =
      r.opens === 'canvas' ||
      r.opens === 'ai-canvas' ||
      r.opens === 'rail' || r.opens === 'review' || r.opens === null
        ? r.opens
        : null;
    const provenance =
      r.provenance === 'measured' || r.provenance === 'declared' || r.provenance === null
        ? r.provenance
        : null;
    out.push({
      id: r.id,
      group: r.group as WorkRow['group'],
      verb: r.verb,
      identifier: typeof r.identifier === 'string' ? r.identifier : null,
      outcome: parseOutcome(r.outcome),
      provenance,
      status: r.status as WorkRow['status'],
      from: r.from as WorkRow['from'],
      opens,
      /* An announcement survives reload or it was never an announcement: this
         is the row that says the engine treated the question as a lesson, and
         dropping the flag would re-fold it into the closed Reasoning
         disclosure the moment the thread came back. */
      ...(r.announce === true ? { announce: true as const } : {}),
    });
  }
  return out;
}

function parseOutcome(raw: unknown): WorkOutcome | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  switch (o.kind) {
    case 'count':
      return typeof o.n === 'number' && typeof o.unit === 'string'
        ? { kind: 'count', n: o.n, unit: o.unit }
        : null;
    case 'diff':
      return typeof o.added === 'number' && typeof o.removed === 'number'
        ? { kind: 'diff', added: o.added, removed: o.removed }
        : null;
    case 'exit': {
      if (!(o.code === null || typeof o.code === 'number')) return null;
      return {
        kind: 'exit',
        code: o.code as number | null,
        ...(typeof o.output === 'string' && o.output.length > 0 ? { output: o.output } : {}),
      };
    }
    case 'elapsed':
      return typeof o.ms === 'number' ? { kind: 'elapsed', ms: o.ms } : null;
    case 'note':
      return typeof o.text === 'string' ? { kind: 'note', text: o.text } : null;
    default:
      return null;
  }
}
