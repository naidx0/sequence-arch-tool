/**
 * Customer autoresearch-style experiment log under `.sequence/runs/results.tsv`.
 *
 * Autoresearch logs `commit, val_bpb, memory_gb, status, description` (tab-separated,
 * git-untracked). Sequence adapts the shape for Program runs on the attached repo:
 * `run_id, program_id, metric, status, description` — persisted in gitignored
 * `.sequence/`, appended by the harness (not agent-writable via /api/file).
 *
 * Pure + browser-safe: parse/format/validate only. Disk I/O lives in the analyzer.
 */

/** Human-edited strategy markdown at `.sequence/program.md` (autoresearch `program.md`). */
export const PROGRAM_STRATEGY_FILE = 'program.md';

/** Tab-separated run log at `.sequence/runs/results.tsv` (autoresearch `results.tsv`). */
export const PROGRAM_RUNS_RESULTS_FILE = 'runs/results.tsv';

export const PROGRAM_RUN_LOG_COLUMNS = [
  'run_id',
  'program_id',
  'metric',
  'status',
  'description',
] as const;

export const PROGRAM_RUN_LOG_HEADER = PROGRAM_RUN_LOG_COLUMNS.join('\t');

export type ProgramRunLogStatus = 'keep' | 'discard' | 'crash';

export interface ProgramRunLogRow {
  runId: string;
  programId: string;
  metric: string;
  status: ProgramRunLogStatus;
  description: string;
}

const STATUSES = new Set<ProgramRunLogStatus>(['keep', 'discard', 'crash']);

function sanitizeField(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ').trim();
}

/** One TSV row (no trailing newline). */
export function formatProgramRunLogRow(row: ProgramRunLogRow): string {
  return [
    sanitizeField(row.runId),
    sanitizeField(row.programId),
    sanitizeField(row.metric),
    row.status,
    sanitizeField(row.description),
  ].join('\t');
}

/** Parse a results.tsv body; drops malformed rows, never throws. */
export function parseProgramRunLog(content: string): ProgramRunLogRow[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const start = lines[0] === PROGRAM_RUN_LOG_HEADER ? 1 : 0;
  const out: ProgramRunLogRow[] = [];
  for (let i = start; i < lines.length; i++) {
    const row = parseProgramRunLogLine(lines[i]!);
    if (row) out.push(row);
  }
  return out;
}

function parseProgramRunLogLine(line: string): ProgramRunLogRow | undefined {
  const parts = line.split('\t');
  if (parts.length < 5) return undefined;
  const [runId, programId, metric, status, ...rest] = parts;
  if (!runId || !programId || !metric) return undefined;
  if (!STATUSES.has(status as ProgramRunLogStatus)) return undefined;
  return {
    runId,
    programId,
    metric,
    status: status as ProgramRunLogStatus,
    description: rest.join('\t'),
  };
}

/** Append one row; creates header when `existing` is empty/undefined. */
export function appendProgramRunLogRow(
  existing: string | undefined,
  row: ProgramRunLogRow,
): string {
  const body = (existing ?? '').trimEnd();
  const line = formatProgramRunLogRow(row);
  if (body.length === 0) return `${PROGRAM_RUN_LOG_HEADER}\n${line}\n`;
  return `${body}\n${line}\n`;
}

export function isProgramRunLogRow(value: unknown): value is ProgramRunLogRow {
  if (value === null || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.runId === 'string' &&
    r.runId.length > 0 &&
    typeof r.programId === 'string' &&
    r.programId.length > 0 &&
    typeof r.metric === 'string' &&
    typeof r.description === 'string' &&
    STATUSES.has(r.status as ProgramRunLogStatus)
  );
}
