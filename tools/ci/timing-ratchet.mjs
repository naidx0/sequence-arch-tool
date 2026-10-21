#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   TIMING RATCHET — startup, scan, attach, idle RSS and size may only get better
   tools/ci/timing-ratchet.mjs  (baselines: tools/ci/timing-ratchet.json)

   Not tools/ci/perf-ratchet.mjs, which holds deterministic boot COUNTS. This one
   reads numbers that move with the machine, so each machine class has its own
   baselines and each metric a tolerance (relative, with an absolute floor):

     worse than baseline + tolerance   FAIL  (exit 1)
     better than baseline - tolerance  pass, and prints "lower the baseline to X"
     inside the band                   pass
     baseline null (unset)             pass, prints the first value to record
     baseline set, value missing       FAIL  (a metric that did not run is not a pass)
     unknown machine class             exit 2

   Inputs are what the existing benches already write, never a second harness:
     --scan <scan-bench-*.json>      pnpm bench:scan   (scan, attach, rescan, idle RSS)
     --release <report.json>         pnpm test:release (window shown, from the row's reason text)
     --server-dir <dir>              resources/server  (dirSize, as the server-size budget)
     --installer <file>              the uploaded installer
     --results <flat.json>           { metric: number } merged over the above
   Other flags: --class <name> (default: PERF_CLASS, else <os>-ci under CI=true, else local)
                --only a,b (check just these)  --ratchet <file>
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { dirSize } from '../release-smoke/lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TIMING_RATCHET_FILE = path.join(HERE, 'timing-ratchet.json');

/** Band around a baseline: the larger of the relative and the absolute tolerance. */
export function band(baseline, tol) {
  return Math.max(baseline * tol.rel, tol.abs);
}

/**
 * @param {{metrics: Record<string, any>, classes: Record<string, any>}} spec
 * @param {string} cls
 * @param {Record<string, number|undefined>} results
 * @param {string[]|null} only
 * @returns {{ code: 0|1|2, lines: string[] }}
 */
export function checkTiming(spec, cls, results, only = null) {
  const klass = spec.classes?.[cls];
  if (!klass) return { code: 2, lines: [`ERROR  unknown machine class "${cls}"; known: ${Object.keys(spec.classes ?? {}).join(', ')}`] };
  for (const o of only ?? []) {
    if (!(o in spec.metrics)) return { code: 2, lines: [`ERROR  unknown metric "${o}"; known: ${Object.keys(spec.metrics).join(', ')}`] };
  }
  const lines = [];
  let failed = false;
  const names = Object.keys(spec.metrics).filter((n) => !only || only.includes(n));
  for (const name of names) {
    const m = spec.metrics[name];
    const base = klass.baselines?.[name]?.value ?? null;
    const v = results[name];
    const have = typeof v === 'number' && Number.isFinite(v);
    if (base === null) {
      lines.push(have
        ? `UNSET ${name} [${cls}]: measured ${v} ${m.unit}; no baseline yet. Record ${v} in tools/ci/timing-ratchet.json (first value, not checked).`
        : `SKIP  ${name} [${cls}]: baseline unset and nothing measured`);
      continue;
    }
    if (!have) {
      failed = true;
      lines.push(`FAIL  ${name} [${cls}]: not measured (baseline ${base} ${m.unit}); the bench did not produce it`);
      continue;
    }
    const b = band(base, m.tolerance);
    if (v > base + b) {
      failed = true;
      lines.push(`FAIL  ${name} [${cls}]: ${v} ${m.unit} is worse than baseline ${base} by ${v - base} (allowed ${Math.round(b)}). Fix the regression; do not raise the baseline to hide it.`);
    } else if (v < base - b) {
      lines.push(`OK    ${name} [${cls}]: ${v} ${m.unit} beats baseline ${base}. Lower the baseline to ${v} in tools/ci/timing-ratchet.json so the gain is held.`);
    } else {
      lines.push(`OK    ${name} [${cls}]: ${v} ${m.unit} within ${Math.round(b)} of baseline ${base}`);
    }
  }
  return { code: failed ? 1 : 0, lines };
}

/** Flat metrics from a pnpm bench:scan JSON (first repo row). */
export function fromScanBench(j) {
  const r = j?.repos?.[0];
  const out = {};
  if (!r) return out;
  const put = (k, v) => { if (typeof v === 'number') out[k] = v; };
  put('scanColdMs', r.cliColdMs?.median);
  put('attachColdMs', r.attachColdMs?.median);
  put('oneFileRescanMs', r.oneFileRescanMs?.median);
  put('idleRssKb', r.settledRssKb?.median);
  return out;
}

/** Flat metrics from a tools/bench/client/run.mjs JSON (the median of each summary row; see CLIENT_METRICS). */
export const CLIENT_METRICS = {
  clientColdStartMs: 'coldStartMs',
  clientWarmStartMs: 'warmStartMs',
  clientSettingsOpenMs: 'open.settings.firstMs',
  clientSearchOpenMs: 'open.search.firstMs',
  clientHelpOpenMs: 'open.help.firstMs',
  clientFilesOpenMs: 'open.files.firstMs',
  clientBoardOpenMs: 'open.board.firstMs',
  clientTerminalOpenMs: 'open.terminal.firstMs',
};
export function fromClientBench(j) {
  const out = {};
  for (const [metric, row] of Object.entries(CLIENT_METRICS)) {
    const v = j?.summary?.[row]?.median;
    if (typeof v === 'number' && Number.isFinite(v)) out[metric] = v;
  }
  return out;
}

/** window-shown ms from a pnpm test:release report.json (the row's reason carries the number). */
export function fromReleaseReport(j) {
  const row = (j?.rows ?? []).find((x) => x.id === 'window-shown');
  const m = row && /window shown (\d+) ms/.exec(row.reason ?? '');
  return m ? { windowShownMs: Number(m[1]) } : {};
}

export function main(argv, io = { log: console.log, err: console.error }) {
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) {
      io.err(`ERROR  bad argument ${argv[i]}`);
      return 2;
    }
    opt[argv[i].slice(2)] = argv[i + 1];
  }
  const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  let spec;
  const results = {};
  try {
    spec = readJson(opt.ratchet ?? TIMING_RATCHET_FILE);
    if (opt.scan) Object.assign(results, fromScanBench(readJson(opt.scan)));
    if (opt.client) Object.assign(results, fromClientBench(readJson(opt.client)));
    if (opt.release) Object.assign(results, fromReleaseReport(readJson(opt.release)));
    if (opt['server-dir']) results.serverBytes = dirSize(opt['server-dir']);
    if (opt.installer) results.installerBytes = fs.statSync(opt.installer).size;
    if (opt.results) Object.assign(results, readJson(opt.results));
  } catch (e) {
    io.err(`ERROR  cannot read an input: ${e.message}`);
    return 2;
  }
  const ciClass = `${process.platform === 'win32' ? 'windows' : 'linux'}-ci`;
  const cls = opt.class ?? process.env.PERF_CLASS ?? (process.env.CI === 'true' ? ciClass : 'local');
  const only = opt.only ? opt.only.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const { code, lines } = checkTiming(spec, cls, results, only);
  for (const l of lines) (code === 1 || code === 2 ? io.err : io.log)(l);
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
