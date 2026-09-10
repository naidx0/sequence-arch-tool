/**
 * P3 — APPLY proposed file edits when Auto-edit / Full is on.
 *
 * `propose_files` still validates and stages; this module is the half that
 * actually writes when the user's permission mode says Accept is not required.
 * Jail + reserved-dir refusal mirror PUT /api/file: every path goes through the
 * caller's `resolveWritable` (same choke point as propose_files), then
 * `pre-write` hooks, then mkdir + writeFileSync.
 *
 * ALL-OR-NOTHING on hook block: if any pre-write hook refuses, nothing is
 * written and the refusal reason is returned. Partial writes would leave the
 * repo in a state neither Accept nor Deny can name.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface AskFileWrite {
  path: string;
  content: string;
}

export interface ApplyAskFileWritesOpts {
  /** Absolute repo root (already canonical). */
  repoRoot: string;
  /**
   * Same jail as propose_files / GET /api/file. Returns the absolute path to
   * write, or null when the relative path escapes or is reserved.
   */
  resolveWritable: (rel: string) => string | null;
  /**
   * `pre-write` hook gate. Returning `allowed: false` refuses the WHOLE batch.
   */
  runPreWriteHook: (rel: string) => Promise<{ allowed: boolean; reason?: string }>;
  /**
   * P10 checkpoint tracking for the agent's own writes (audit gap G1).
   *
   * Called once per ACCEPTED path, after the hook gate has passed for the
   * whole batch and BEFORE that path's `writeFileSync` — the same position
   * `trackSessionWrite` holds in PUT /api/file, and for the same reason: the
   * store records the file's PRE-write state as the rewind baseline, so a call
   * after the write would baseline the new content and make every rewind past
   * the first touch a silent no-op. Absent ⇒ nothing is tracked, which is how
   * every caller written before this hook behaved.
   */
  trackWrite?: (rel: string) => void;
}

export interface ApplyAskFileWritesResult {
  written: string[];
  refused: { path: string; reason: string }[];
  /** Present when a hook blocked — nothing was written. */
  blockedByHook?: string;
  /**
   * The subset of `written` that ALREADY EXISTED before this batch — i.e. the
   * files this turn actually CHANGED, as opposed to created.
   *
   * WHY THE DISTINCTION EARNS A FIELD. The pipeline's two salvage paths (the
   * prose-diff rescue and the last-chance diff round) both fire only when the
   * turn "has not written anything", and both read that off a write COUNT.
   * Measured on mini-50 v17, django-11790: the model wrote a throwaway
   * `repro_maxlength.py` to reproduce the bug — a reasonable thing to do — and
   * that one write flipped the count, so the round that would have demanded
   * the actual fix never fired. It then spent all 32 rounds and 662k input
   * tokens and shipped the repro script as its patch. Sixteen of that run's
   * 25 empty patches are that shape.
   *
   * A new file is a repro, a scratch note or a test; it is not a fix to a bug
   * in code that already exists. This is the signal those guards actually
   * wanted, and reading it here is free — the write loop already has to know
   * whether it is creating or overwriting.
   */
  modified: string[];
}

export async function applyAskFileWrites(
  files: readonly AskFileWrite[],
  opts: ApplyAskFileWritesOpts,
): Promise<ApplyAskFileWritesResult> {
  const prepared: { abs: string; rel: string; content: string }[] = [];
  const refused: { path: string; reason: string }[] = [];

  for (const file of files) {
    const rel = file.path.replace(/\\/g, '/');
    const abs = opts.resolveWritable(rel);
    if (!abs) {
      refused.push({ path: rel, reason: 'path escapes repo root or is reserved' });
      continue;
    }
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        refused.push({ path: rel, reason: 'path is a directory' });
        continue;
      }
    } catch {
      /* missing is fine — create */
    }
    prepared.push({ abs, rel, content: file.content });
  }

  if (refused.length > 0) {
    return { written: [], refused, modified: [] };
  }

  for (const item of prepared) {
    const hook = await opts.runPreWriteHook(item.rel);
    if (!hook.allowed) {
      return {
        written: [],
        refused: [],
        blockedByHook: hook.reason ?? 'pre-write hook refused',
        modified: [],
      };
    }
  }

  const written: string[] = [];
  const modified: string[] = [];
  for (const item of prepared) {
    /* Read BEFORE the write, obviously, and before `trackWrite` so a tracking
       throw cannot cost us the answer. `existsSync` is the same question the
       directory guard above already asked. */
    let existed = false;
    try {
      existed = fs.existsSync(item.abs);
    } catch {
      /* unreadable ⇒ treat as new; the write below is the real test */
    }
    /*
     * Tracking runs here — every hook has already allowed the batch, so no
     * refused path is ever baselined, and this path has not been written yet.
     * A tracking failure NEVER fails the write, the posture PUT /api/file
     * takes: the user opted into auto-writes and the edit is the request;
     * refusing it because the safety net could not be hung would trade a real
     * loss for a hypothetical one. It is surfaced on stderr instead.
     */
    if (opts.trackWrite) {
      try {
        opts.trackWrite(item.rel);
      } catch (e) {
        process.stderr.write(
          `sequence: checkpoint tracking failed for ${item.rel}: ${(e as Error).message}\n`,
        );
      }
    }
    fs.mkdirSync(path.dirname(item.abs), { recursive: true });
    fs.writeFileSync(item.abs, item.content, 'utf8');
    written.push(item.rel);
    if (existed) modified.push(item.rel);
  }
  return { written, refused: [], modified };
}

/** Modes that write without waiting for Accept. */
export function permissionAutoWrites(permission: string | undefined): boolean {
  return permission === 'autoEdit' || permission === 'full';
}
