import fs from 'node:fs';
import path from 'node:path';
import {
  PROGRAM_RUNS_RESULTS_FILE,
  PROGRAM_STRATEGY_FILE,
  appendProgramRunLogRow,
  isProgramRunLogRow,
  parseProgramEditAllowlist,
  parseProgramRunLog,
  type ProgramRunLogRow,
} from '@sequence/schema';
import { SEQUENCE_DIR } from './store.js';

const MAX_STRATEGY_BYTES = 64 * 1024;
const MAX_RUN_LOG_BYTES = 512 * 1024;

function sequenceFile(repoRoot: string, rel: string): string {
  return path.join(repoRoot, SEQUENCE_DIR, rel);
}

/** Scoped edit globs from program strategy; undefined when absent or not declared. */
export function readProgramEditAllowlist(repoRoot: string): string[] | undefined {
  const text = readProgramStrategy(repoRoot);
  if (!text) return undefined;
  return parseProgramEditAllowlist(text);
}

/** Read `.sequence/program.md` when present; undefined when absent or unreadable. */
export function readProgramStrategy(repoRoot: string): string | undefined {
  const p = sequenceFile(repoRoot, PROGRAM_STRATEGY_FILE);
  try {
    if (!fs.existsSync(p)) return undefined;
    const st = fs.statSync(p);
    if (!st.isFile() || st.size > MAX_STRATEGY_BYTES) return undefined;
    const text = fs.readFileSync(p, 'utf8').trim();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

/** Append one validated row to `.sequence/runs/results.tsv` (creates dirs + header). */
export function appendProgramRunLog(repoRoot: string, row: ProgramRunLogRow): void {
  if (!isProgramRunLogRow(row)) return;
  const p = sequenceFile(repoRoot, PROGRAM_RUNS_RESULTS_FILE);
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  let existing: string | undefined;
  try {
    if (fs.existsSync(p)) {
      const st = fs.statSync(p);
      if (st.size > MAX_RUN_LOG_BYTES) return;
      existing = fs.readFileSync(p, 'utf8');
    }
  } catch {
    existing = undefined;
  }
  const next = appendProgramRunLogRow(existing, row);
  fs.writeFileSync(p, next, 'utf8');
}

/** Read parsed rows from `.sequence/runs/results.tsv`; empty when absent. */
export function readProgramRunLog(repoRoot: string): ProgramRunLogRow[] {
  const p = sequenceFile(repoRoot, PROGRAM_RUNS_RESULTS_FILE);
  try {
    if (!fs.existsSync(p)) return [];
    const st = fs.statSync(p);
    if (!st.isFile() || st.size > MAX_RUN_LOG_BYTES) return [];
    return parseProgramRunLog(fs.readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}
