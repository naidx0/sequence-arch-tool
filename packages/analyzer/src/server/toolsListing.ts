/* ══════════════════════════════════════════════════════════════════════════
   WHAT THE BOARD'S MCP TOOLS COST, FOR THE SETTINGS PAYLOAD (claims T3)
   packages/analyzer/src/server/toolsListing.ts

   "Give coding agents every board tool" used to say "All 16 tools, about 4.1k
   tokens" in a string. The registry lives in packages/mcp, which depends on
   this package, so this package cannot import it. It asks the same stdio entry
   a session runs (sequenceMcp.ts finds it, in the workspace or the packaged
   one-file bundle) to print its own counts: `<entry> --listing` writes
   { all, core, allTokens, coreTokens } and exits. The figures are measured
   from the listing a client receives (packages/mcp toolListing.ts), so they
   cannot drift from the tools.

   One run per process, kept. No entry, a crash or a timeout is null and the
   Settings row then shows no figures instead of wrong ones.
   ══════════════════════════════════════════════════════════════════════════ */

import { execFile } from 'node:child_process';

import { sequenceMcpEntry } from './sequenceMcp.js';

export interface ToolsListing {
  /** Every tool the server registers. */
  all: number;
  /** The tool names a session gets by default. */
  core: string[];
  /** Listing tokens of every tool (ceil(JSON chars / 4), the s2a-session rule). */
  allTokens: number;
  /** Listing tokens of the core tools. */
  coreTokens: number;
}

export function parseToolsListing(out: string): ToolsListing | null {
  const line = out.trim().split('\n').filter(Boolean).pop();
  if (!line) return null;
  try {
    const o = JSON.parse(line) as Partial<ToolsListing>;
    const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
    if (!ok(o.all) || !ok(o.allTokens) || !ok(o.coreTokens) || !Array.isArray(o.core) || !o.core.every((n) => typeof n === 'string')) return null;
    return { all: o.all, core: o.core as string[], allTokens: o.allTokens, coreTokens: o.coreTokens };
  } catch {
    return null;
  }
}

const kept = new Map<string, Promise<ToolsListing | null>>();
/** An entry that failed or hung is not run again for this long, so a settings GET never starts a subprocess each time. */
export const FAILURE_RETRY_MS = 10 * 60 * 1000;
const failedAt = new Map<string, number>();

/** For tests: forget what was kept. */
export function resetToolsListing(): void {
  kept.clear();
  failedAt.clear();
}

/** The counts, from the MCP entry; null when there is no entry or it did not answer in time. Kept per entry; a failure is remembered for 10 minutes and not retried sooner. */
export function readToolsListing(entry: string | null = sequenceMcpEntry(), timeoutMs = 30_000, now: () => number = Date.now): Promise<ToolsListing | null> {
  if (!entry) return Promise.resolve(null);
  const have = kept.get(entry);
  if (have) return have;
  const failed = failedAt.get(entry);
  if (failed !== undefined && now() - failed < FAILURE_RETRY_MS) return Promise.resolve(null);
  const electron = typeof process.versions.electron === 'string';
  const run = new Promise<ToolsListing | null>((resolve) => {
    execFile(
      process.execPath,
      [entry, '--listing'],
      { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, env: { ...process.env, ...(electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) } },
      (err, stdout) => resolve(err ? null : parseToolsListing(stdout)),
    );
  }).then((r) => {
    if (r === null) {
      kept.delete(entry);
      failedAt.set(entry, now());
    } else failedAt.delete(entry);
    return r;
  });
  kept.set(entry, run);
  return run;
}
