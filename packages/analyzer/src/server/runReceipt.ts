/* ══════════════════════════════════════════════════════════════════════════
   THE CHANGE RECEIPT — one document per turn, assembled from what was
   already measured.
   packages/analyzer/src/server/runReceipt.ts

   Audit G3: rounds, stop reason, wall time, tokens, per-call ms, coverage,
   the executed tools, every command and its exit code, the files that reached
   disk, the instruction-belt hash, the checkpoint seq and the done-when
   verdict ALL existed at the end of a turn — in five places, and nothing put
   them in one. `sequence ask --json` emitted {text, coverage, usage} and the
   server kept a trajectory doc nobody could read as "what did this turn do
   to my repo, under which policy, at what cost". This is the one page.

   ── EVERY FIELD IS SOURCED, OR IT IS ABSENT ──────────────────────────────

   The rule this repo already applies to `AskPipelineResult.coverage` applies
   to every key here: a value that was not measured is NOT in the object.
   Not `null`, not `0`, not `[]` as a guess. A receipt with `providerRetries:
   0` must mean the retry loop ran and retried nothing; a turn whose provider
   path never reported has no such key. The reader's test is `'x' in receipt`,
   and {@link buildRunReceipt} is written so that test is honest.

   Two fields the audit wanted and this file deliberately does NOT carry:
   `policyVersion` — `PermissionPolicy` (the merged, live object) has no
   version; the number lives on the on-disk document only and nothing hands
   it forward — and `humanCorrections` — nothing produces one. A key with no
   producer is the thing `packages/schema/src/program.ts` deleted three of.

   ── THE KEY NEVER ENTERS ──────────────────────────────────────────────────

   `providerRoute.host` is the HOST of the configured base URL and nothing
   else: no path, no query, no userinfo. A base URL can carry a credential in
   any of those three places (`https://user:key@…`, `?api_key=…`), and a
   receipt is a file a reader forwards. {@link routeHost} goes through `URL`
   so the stripping is the platform's, not a regex of ours; a base URL that
   does not parse yields no host rather than a best-effort substring.

   ── BOUNDED, LIKE `askTurnLog` ───────────────────────────────────────────

   One file per run under `.sequence/receipts/`, swept to the newest
   {@link RUN_RECEIPT_KEEP} after each write — the same discipline
   `askTurnLog.ts` states for the same reason: a machine that never closes the
   app must not accumulate every turn it has ever run.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import type { AskCoverage } from '../explain/explain.js';
import type { AskVerifyResult } from '../harness/verifyGate.js';
import type { AskPipelineResult } from './askPipeline.js';
import type { AiConfig } from './provider.js';
import { isAskTurnId } from './askTurnLog.js';
import { SEQUENCE_DIR, writeJson } from './store.js';

/** The receipts sub-directory of `.sequence/`. */
export const RECEIPTS_DIR = 'receipts';

/** How many receipts are kept. Older ones are swept after each write. */
export const RUN_RECEIPT_KEEP = 50;

export interface RunReceiptCommand {
  cmd: string;
  /** `null` when the process ended without an exit code (killed, or refused before spawn). */
  exitCode: number | null;
  ok: boolean;
}

export interface RunReceiptMetrics {
  rounds: number;
  stopReason: string;
  wallMs?: number;
  /** From the summed provider usage; `estimated` says whether the provider counted or we approximated. */
  tokens?: { input: number; output: number; estimated: boolean };
  /** Per provider call, in order — the `providerCallMs` the metrics already carry. */
  perCallMs?: number[];
}

export interface RunReceipt {
  version: 1;
  runId: string;
  startedAt: string;
  finishedAt: string;
  /** How the turn ended: the type of the terminal event the stream carried. */
  terminal: 'result' | 'error';
  /** The error terminal's message, when the turn ended in one. */
  error?: string;
  /** sha256 (truncated) of the instruction belt — the policy-version stamp `trajectory:start` streams. */
  instructionHash?: string;
  model?: string;
  providerRoute?: { provider: AiConfig['provider']; host?: string };
  /**
   * `mode` is what the caller asked for (absent when it asked for nothing —
   * a words-only turn); `sources` are the permission files that actually
   * contributed, which exist whether or not a mode was named.
   */
  permission?: { mode?: string; sources?: string[] };
  coverage?: AskCoverage;
  /**
   * Tool name → how many times the model asked for it this turn. One entry per
   * `tool:done` the turn streamed — a request the model made, whether it ran
   * or was refused — which is the same set the pipeline's own
   * `executedToolNames` counts (it records every request before the
   * permission branch decides).
   */
  tools?: Record<string, number>;
  /** Every `command:log` the turn streamed — run_command and the done-when gate alike. */
  commands?: RunReceiptCommand[];
  metrics?: RunReceiptMetrics;
  /** Sum of the provider layer's retry counts over this turn's calls. Absent when no call reported one. */
  providerRetries?: number;
  /** Paths that actually reached disk this turn. Absent when the turn ended before it could be measured. */
  filesWritten?: string[];
  /** The checkpoint seq taken before this turn's first agent write (`checkpointStore`). Absent when the turn wrote nothing or had no session. */
  rollbackPoint?: number;
  verify?: AskVerifyResult;
}

/** What a caller has in hand at the terminal. Everything optional is absent when that caller could not measure it. */
export interface RunReceiptParts {
  runId: string;
  startedAt: string;
  finishedAt: string;
  terminal: 'result' | 'error';
  error?: string;
  /** The streamed events of the turn — the askTrace, or the CLI's collected emit. */
  events: ReadonlyArray<Record<string, unknown>>;
  /** The pipeline result on an ok terminal; absent on an error terminal. */
  result?: Pick<AskPipelineResult, 'coverage' | 'metrics' | 'usage' | 'verify' | 'filesWritten' | 'permissionSources'>;
  instructionHash?: string;
  /** Only these three are read. The key is neither read nor copied. */
  cfg?: Pick<AiConfig, 'provider' | 'model' | 'baseUrl'>;
  permissionMode?: string;
  providerRetries?: number;
  rollbackPoint?: number;
}

/**
 * The host of a base URL and nothing else. `URL.host` is hostname plus port —
 * never userinfo, path or query — so a credential embedded anywhere in the URL
 * cannot survive. Unparseable ⇒ undefined: no host is better than a guess.
 */
export function routeHost(baseUrl: string | undefined): string | undefined {
  if (baseUrl === undefined || baseUrl.trim() === '') return undefined;
  try {
    const host = new URL(baseUrl).host;
    return host === '' ? undefined : host;
  } catch {
    return undefined;
  }
}

/** PURE. Reads only the parts it is given; every optional key is present only when its source was. */
export function buildRunReceipt(parts: RunReceiptParts): RunReceipt {
  const receipt: RunReceipt = {
    version: 1,
    runId: parts.runId,
    startedAt: parts.startedAt,
    finishedAt: parts.finishedAt,
    terminal: parts.terminal,
  };
  if (parts.error !== undefined) receipt.error = parts.error;
  if (parts.instructionHash !== undefined) receipt.instructionHash = parts.instructionHash;
  if (parts.cfg) {
    receipt.model = parts.cfg.model;
    const host = routeHost(parts.cfg.baseUrl);
    receipt.providerRoute = { provider: parts.cfg.provider, ...(host !== undefined ? { host } : {}) };
  }
  {
    const sources = parts.result?.permissionSources;
    if (parts.permissionMode !== undefined || sources !== undefined) {
      receipt.permission = {
        ...(parts.permissionMode !== undefined ? { mode: parts.permissionMode } : {}),
        ...(sources !== undefined ? { sources: [...sources] } : {}),
      };
    }
  }

  const tools: Record<string, number> = {};
  const commands: RunReceiptCommand[] = [];
  for (const ev of parts.events) {
    if (ev.type === 'tool:done' && typeof ev.name === 'string') {
      tools[ev.name] = (tools[ev.name] ?? 0) + 1;
    } else if (ev.type === 'command:log' && typeof ev.cmd === 'string') {
      commands.push({
        cmd: ev.cmd,
        exitCode: typeof ev.exitCode === 'number' ? ev.exitCode : null,
        ok: ev.ok === true,
      });
    }
  }
  if (Object.keys(tools).length > 0) receipt.tools = tools;
  if (commands.length > 0) receipt.commands = commands;

  const r = parts.result;
  if (r?.coverage) receipt.coverage = r.coverage;
  if (r?.metrics) {
    const m = r.metrics;
    const metrics: RunReceiptMetrics = { rounds: m.rounds, stopReason: m.stopReason };
    if (typeof m.wallMs === 'number') metrics.wallMs = m.wallMs;
    if (r.usage) {
      metrics.tokens = { input: r.usage.inputTokens, output: r.usage.outputTokens, estimated: r.usage.estimated };
    }
    if (m.providerCallMs && m.providerCallMs.length > 0) metrics.perCallMs = [...m.providerCallMs];
    receipt.metrics = metrics;
  }
  if (parts.providerRetries !== undefined) receipt.providerRetries = parts.providerRetries;
  if (r?.filesWritten !== undefined) receipt.filesWritten = [...r.filesWritten];
  if (parts.rollbackPoint !== undefined) receipt.rollbackPoint = parts.rollbackPoint;
  if (r?.verify) receipt.verify = r.verify;
  return receipt;
}

function receiptsRoot(repoRoot: string): string {
  return path.join(repoRoot, SEQUENCE_DIR, RECEIPTS_DIR);
}

/** Where a run's receipt lives. Throws on an id that is not a usable file name — the same jail `askTurnLog` applies. */
export function runReceiptPath(repoRoot: string, runId: string): string {
  if (!isAskTurnId(runId)) throw new Error(`not a usable run id: ${String(runId)}`);
  return path.join(receiptsRoot(repoRoot), `${runId}.json`);
}

/** Write `.sequence/receipts/<runId>.json`, then keep only the newest {@link RUN_RECEIPT_KEEP}. */
export function writeRunReceipt(repoRoot: string, receipt: RunReceipt): void {
  if (!isAskTurnId(receipt.runId)) throw new Error(`not a usable run id: ${String(receipt.runId)}`);
  writeJson(repoRoot, path.join(RECEIPTS_DIR, `${receipt.runId}.json`), receipt);
  sweep(repoRoot);
}

/** Read a receipt by run id; undefined when absent or unparseable. */
export function readRunReceipt(repoRoot: string, runId: string): RunReceipt | undefined {
  if (!isAskTurnId(runId)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(runReceiptPath(repoRoot, runId), 'utf8')) as RunReceipt;
  } catch {
    return undefined;
  }
}

/** Keep the newest {@link RUN_RECEIPT_KEEP} receipts by mtime; delete the rest. */
function sweep(repoRoot: string): void {
  let names: string[];
  try {
    names = fs.readdirSync(receiptsRoot(repoRoot)).filter((n) => n.endsWith('.json'));
  } catch {
    return;
  }
  if (names.length <= RUN_RECEIPT_KEEP) return;
  const dated = names
    .map((name) => {
      try {
        return { name, at: fs.statSync(path.join(receiptsRoot(repoRoot), name)).mtimeMs };
      } catch {
        return { name, at: 0 };
      }
    })
    .sort((a, b) => b.at - a.at);
  for (const old of dated.slice(RUN_RECEIPT_KEEP)) {
    try {
      fs.rmSync(path.join(receiptsRoot(repoRoot), old.name), { force: true });
    } catch {
      /* Already gone. Sweeping is best effort and must never fail the turn
         whose receipt was just written. */
    }
  }
}
