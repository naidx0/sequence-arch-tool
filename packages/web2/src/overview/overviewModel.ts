/* ══════════════════════════════════════════════════════════════════════════
   WHAT A CHAT CONTAINS
   packages/web2/src/overview/overviewModel.ts

   The right-hand overview reads this and nothing else: turns, the composer's
   chips and attachments, the session's proposals and the turn in flight go in;
   progress, context, files and artifacts come out. PURE. No React, no DOM, no
   store. Every row is derived from data the transcript already holds:

     progress   the running turn's work list (else the last turn's), and the
                step it is on now.
     context    the composer's chips, deduplicated.
     files      attachments, @mentioned files, files read and files edited.
                A path is ONE row however often it was touched; an edit wins
                over a read, and the row remembers that it was also read.
     artifacts  charts, diagrams, board marks, workflow loops, visual and
                genui fences, each pointing at the turn that holds it.

   The genui fence is detected here by a pure fence scan, not by importing the
   genui renderer.
   ══════════════════════════════════════════════════════════════════════════ */

import type {
  AssistantTurn,
  ComposerAttachment,
  ContextChip,
  FileEditProposal,
  InFlightTurn,
  TodoItem,
  Turn,
  WorkRow,
} from '../state/types';
import { parseWorkflowFence } from '../chat/workflowFence';
import type { SavedSurface } from '../genui/surfaceStore';

export type FileState = 'edited' | 'proposed' | 'read' | 'mentioned' | 'attached';

export interface OverviewFile {
  /** Stable row key: the path, or `attachment:<id>`. */
  key: string;
  /** Repo-relative, forward slashes. For an attachment, its name. */
  path: string;
  name: string;
  state: FileState;
  /** True when the file was also read (an edited file that was read first). */
  alsoRead: boolean;
  /** How many times a read or edit touched it. */
  touches: number;
  /** The turn that touched it last, or null (a composer chip or attachment). */
  turnId: string | null;
  line: number | null;
  /** Only repo paths open in Files; an attachment has no path to open. */
  openable: boolean;
}

export type ArtifactKind = 'chart' | 'diagram' | 'board' | 'workflow' | 'visual' | 'genui';

export interface OverviewArtifact {
  key: string;
  kind: ArtifactKind;
  title: string;
  turnId: string;
  /** A saved surface (genui/surfaceStore.ts): its final spec, for a row that draws it. */
  spec?: SavedSurface['spec'];
}

export interface OverviewRunStep {
  phase: string;
  /** What the turn is doing now ("Read a file src/a.ts"), or null. */
  step: string | null;
  round: number;
  roundCap: number;
}

export interface OverviewProgress {
  todos: TodoItem[];
  /** True when the list belongs to the turn still running. */
  live: boolean;
  run: OverviewRunStep | null;
}

export interface OverviewModel {
  progress: OverviewProgress;
  context: { chips: ContextChip[] };
  files: OverviewFile[];
  artifacts: OverviewArtifact[];
}

export interface OverviewInput {
  turns: readonly Turn[];
  chips?: readonly ContextChip[];
  attachments?: readonly ComposerAttachment[];
  proposals?: Readonly<Record<string, FileEditProposal>>;
  inFlight?: InFlightTurn | null;
  /** The chat's saved generated cards (listChatSurfaces). The fence's own surface is not listed twice. */
  saved?: readonly Pick<SavedSurface, 'turn' | 'surface' | 'title' | 'spec'>[];
}

const RANK: Record<FileState, number> = { edited: 0, proposed: 1, read: 2, mentioned: 3, attached: 4 };

export function normalizePath(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function splitLine(ref: string): { path: string; line: number | null } {
  const m = /^(.*?):(\d+)(?:-\d+)?$/.exec(ref.trim());
  if (m && m[1] && !/^[A-Za-z]$/.test(m[1])) return { path: normalizePath(m[1]), line: Number(m[2]) };
  return { path: normalizePath(ref), line: null };
}

const looksLikePath = (s: string): boolean => /[\\/]/.test(s) || /\.[A-Za-z0-9]{1,8}$/.test(s);

/* ── what a read_file evidence says ───────────────────────────────────────── */

/** The server's cache marker, in front of the evidence it repeats. */
const CACHED_MARK = /^\(cached\)\s*/i;
/** The verb the server writes in front of the path it read. */
const READ_VERB = /^read\s+/i;
/** The range note the server adds when the file was longer than the window it read. */
const RANGE_NOTE = /\s*\(lines[^)]*\)\s*$/i;
/** A refused call, in the server's own words. It names no file. */
const REFUSAL = /^\s*refused\s*:\s*/i;

/**
 * THE PATH A READ_FILE EVIDENCE NAMES.
 *
 * The evidence of a read is a SENTENCE, not a path: the server writes `read src/a.ts`, with a
 * range note `read src/a.ts (lines 1-50 of 120 - more remains)`, and for a call it has already
 * answered `(cached) read src/a.ts`. Taking that sentence for a path put a row named
 * "read src/a.ts" in the panel beside the real "src/a.ts": the panel said four files where the
 * chat had touched two, two rows read exactly alike, and the phantom row was a BUTTON that
 * opened a path that does not exist.
 *
 * So the path is read OUT of the sentence, and a sentence that names no file names no file: a
 * refused read is not a read, and what is left after the verb, the cache marker and the range
 * note have come off must still look like a path.
 */
export function readEvidencePath(evidence: string | null | undefined): { path: string; line: number | null } | null {
  if (!evidence) return null;
  let text = evidence.trim().replace(CACHED_MARK, '');
  if (REFUSAL.test(text)) return null;
  text = text.replace(READ_VERB, '').replace(RANGE_NOTE, '');
  const { path, line } = splitLine(text);
  if (!path || !looksLikePath(path)) return null;
  return { path, line };
}

/* ── fences ──────────────────────────────────────────────────────────────── */

export interface Fence {
  language: string | null;
  body: string;
  closed: boolean;
}

/** Fenced blocks of a text, in order. An unclosed fence (a stream in progress) is reported with closed=false. */
export function fencesIn(text: string): Fence[] {
  const out: Fence[] = [];
  const lines = text.split(/\r?\n/);
  let cur: { marker: string; language: string | null; body: string[] } | null = null;
  for (const line of lines) {
    if (!cur) {
      const m = /^\s{0,3}(`{3,}|~{3,})\s*([A-Za-z0-9_+.-]*)/.exec(line);
      if (m) cur = { marker: m[1]!, language: m[2] ? m[2].toLowerCase() : null, body: [] };
      continue;
    }
    const ch = cur.marker[0] === '`' ? '`' : '~';
    const close = new RegExp(`^\\s{0,3}${ch}{${cur.marker.length},}\\s*$`);
    if (close.test(line)) {
      out.push({ language: cur.language, body: cur.body.join('\n'), closed: true });
      cur = null;
    } else cur.body.push(line);
  }
  if (cur) out.push({ language: cur.language, body: cur.body.join('\n'), closed: false });
  return out;
}

function jsonTitle(body: string): string | null {
  try {
    const v = JSON.parse(body) as Record<string, unknown>;
    for (const k of ['title', 'name']) {
      const s = v?.[k];
      if (typeof s === 'string' && s.trim()) return s.trim().slice(0, 80);
    }
  } catch {
    /* not JSON */
  }
  return null;
}

/** A tool dump a fence carries: {"name":"read_file","arguments":{"path":"a.ts"}}. */
function toolDumpPath(body: string): { name: string; path: string } | null {
  try {
    const v = JSON.parse(body.trim()) as { name?: unknown; arguments?: unknown; args?: unknown };
    if (typeof v?.name !== 'string') return null;
    const a = (v.arguments ?? v.args) as { path?: unknown } | undefined;
    return typeof a?.path === 'string' && a.path ? { name: v.name, path: a.path } : null;
  } catch {
    return null;
  }
}

/* ── progress ────────────────────────────────────────────────────────────── */

function currentStep(work: readonly WorkRow[]): string | null {
  for (let i = work.length - 1; i >= 0; i--) {
    const r = work[i]!;
    if (r.status === 'running') return r.identifier ? `${r.verb} ${r.identifier}` : r.verb;
  }
  return null;
}

function progressOf(turns: readonly Turn[], inFlight: InFlightTurn | null | undefined): OverviewProgress {
  if (inFlight && inFlight.phase !== 'done' && inFlight.phase !== 'error') {
    return {
      todos: [...inFlight.todos],
      live: true,
      run: { phase: inFlight.phase, step: currentStep(inFlight.work), round: inFlight.providerRound, roundCap: inFlight.roundCap },
    };
  }
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]!;
    if (t.role === 'assistant') return { todos: [...t.todos], live: false, run: null };
  }
  return { todos: [], live: false, run: null };
}

/* ── files ───────────────────────────────────────────────────────────────── */

class FileBook {
  private readonly rows = new Map<string, OverviewFile>();
  private seq = 0;
  private readonly order = new Map<string, number>();

  touch(rawPath: string, state: 'edited' | 'proposed' | 'read' | 'mentioned', turnId: string | null, line: number | null = null): void {
    const path = normalizePath(rawPath);
    if (!path) return;
    const cur = this.rows.get(path);
    const counts = state !== 'mentioned';
    if (!cur) {
      this.rows.set(path, {
        key: path,
        path,
        name: path.split('/').pop() || path,
        state,
        alsoRead: state === 'read',
        touches: counts ? 1 : 0,
        turnId,
        line,
        openable: true,
      });
    } else {
      if (RANK[state] < RANK[cur.state]) cur.state = state;
      if (state === 'read') cur.alsoRead = true;
      if (counts) cur.touches += 1;
      if (turnId !== null) cur.turnId = turnId;
      if (line !== null) cur.line = line;
    }
    this.order.set(path, this.seq++);
  }

  attach(a: ComposerAttachment): void {
    const key = `attachment:${a.id}`;
    if (this.rows.has(key)) return;
    this.rows.set(key, { key, path: a.name, name: a.name, state: 'attached', alsoRead: false, touches: 0, turnId: null, line: null, openable: false });
    this.order.set(key, this.seq++);
  }

  list(): OverviewFile[] {
    return [...this.rows.values()].sort((a, b) => RANK[a.state] - RANK[b.state] || (this.order.get(b.key) ?? 0) - (this.order.get(a.key) ?? 0));
  }
}

function filesOf(input: OverviewInput): OverviewFile[] {
  const book = new FileBook();
  const proposals = input.proposals ?? {};
  for (const t of input.turns) {
    if (t.role === 'user') {
      for (const c of t.chips) {
        if (c.kind !== 'file') continue;
        const s = splitLine(c.ref);
        book.touch(s.path, 'mentioned', t.id, s.line);
      }
      continue;
    }
    const seen = new Set<string>();
    const read = (p: string, line: number | null = null): void => {
      const path = normalizePath(p);
      if (!path || seen.has(path)) return;
      seen.add(path);
      book.touch(path, 'read', t.id, line);
    };
    for (const p of t.evidence.filesRead) read(p);
    for (const tool of t.evidence.tools) {
      if (tool.name !== 'read_file') continue;
      const found = readEvidencePath(tool.evidence);
      if (found) read(found.path, found.line);
    }
    for (const f of fencesIn(t.text)) {
      const d = f.closed ? toolDumpPath(f.body) : null;
      if (d?.name === 'read_file') read(d.path);
    }
    const edited = new Set<string>();
    const edit = (p: string, state: 'edited' | 'proposed'): void => {
      const path = normalizePath(p);
      if (!path || edited.has(path)) return;
      edited.add(path);
      book.touch(path, state, t.id);
    };
    for (const id of t.evidence.proposals) {
      const p = proposals[id];
      if (!p) continue;
      for (const f of p.files) {
        if (p.status === 'applied' || (p.status === 'partial' && f.decision === 'accepted')) edit(f.path, 'edited');
        else if (p.status === 'pending' || p.status === 'applying') edit(f.path, 'proposed');
      }
    }
    for (const r of t.work) {
      if (r.group === 'change' && r.outcome?.kind === 'diff' && r.identifier && looksLikePath(r.identifier)) edit(r.identifier, 'edited');
    }
  }
  const fl = input.inFlight;
  if (fl) for (const p of fl.evidence.filesRead) book.touch(p, 'read', fl.turnId);
  for (const c of input.chips ?? []) {
    if (c.kind !== 'file') continue;
    const s = splitLine(c.ref);
    book.touch(s.path, 'mentioned', null, s.line);
  }
  for (const a of input.attachments ?? []) book.attach(a);
  return book.list();
}

/* ── artifacts ───────────────────────────────────────────────────────────── */

function artifactsOf(turns: readonly Turn[], saved: OverviewInput['saved'] = []): OverviewArtifact[] {
  const out: OverviewArtifact[] = [];
  for (const t of turns) {
    if (t.role !== 'assistant') continue;
    const a: AssistantTurn = t;
    (a.charts ?? []).forEach((c, i) => out.push({ key: `${a.id}:chart:${i}`, kind: 'chart', title: c.title || 'Chart', turnId: a.id }));
    if (a.diagram) out.push({ key: `${a.id}:diagram`, kind: 'diagram', title: a.diagram.type === 'sequence' ? 'Sequence diagram' : 'Flow diagram', turnId: a.id });
    const marks = a.boardMarks?.length ?? 0;
    if (marks > 0) out.push({ key: `${a.id}:board`, kind: 'board', title: `${marks} mark${marks === 1 ? '' : 's'} on the board`, turnId: a.id });
    fencesIn(a.text).forEach((f, i) => {
      if (!f.closed) return;
      if (f.language === 'workflow') {
        const spec = parseWorkflowFence(f.body);
        if (spec) out.push({ key: `${a.id}:workflow:${i}`, kind: 'workflow', title: spec.name, turnId: a.id });
      } else if (f.language === 'genui') {
        out.push({ key: `${a.id}:genui:${i}`, kind: 'genui', title: jsonTitle(f.body) ?? 'Generated UI', turnId: a.id });
      } else if (f.language === 'visual') {
        out.push({ key: `${a.id}:visual:${i}`, kind: 'visual', title: jsonTitle(f.body) ?? 'Visual', turnId: a.id });
      }
    });
  }
  /* A saved surface is a row of its own, unless it is the one a genui fence of the same turn already lists ('fence' is that surface's id). */
  const fenced = new Set(out.filter((a) => a.kind === 'genui').map((a) => a.turnId));
  for (const r of saved) {
    if (r.surface === 'fence' && fenced.has(r.turn)) continue;
    out.push({ key: `${r.turn}:saved:${r.surface}`, kind: 'genui', title: r.title.trim() || 'Generated UI', turnId: r.turn, spec: r.spec });
  }
  /* In turn order; a turn this list does not hold (an agent run's id) goes last. */
  const at = new Map(turns.map((t, i) => [t.id, i]));
  return out.map((a, i) => ({ a, i })).sort((x, y) => (at.get(x.a.turnId) ?? Infinity) - (at.get(y.a.turnId) ?? Infinity) || x.i - y.i).map((x) => x.a);
}

/* ── the model ───────────────────────────────────────────────────────────── */

export function buildOverview(input: OverviewInput): OverviewModel {
  const seen = new Set<string>();
  const chips = (input.chips ?? []).filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  return {
    progress: progressOf(input.turns, input.inFlight),
    context: { chips },
    files: filesOf(input),
    artifacts: artifactsOf(input.turns, input.saved),
  };
}
