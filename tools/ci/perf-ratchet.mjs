#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   THE PERF RATCHET — counts that may only go down
   tools/ci/perf-ratchet.mjs

   tools/measure/perf-ratchet.json holds a ceiling per count. A measured file
   (written by tools/measure/perf-counts.mjs) is checked against it:

     above its ceiling   FAIL: the change made boot heavier or React busier
     below its ceiling   FAIL: it got better; lower the ceiling to the new
                         number (suggested only from 3 agreeing reads,
                         `$reads` in the measured file; fewer says BELOW)
                         in the same commit, so the gain is held
     equal               pass

   A CEILING MAY GO UP ONLY DELIBERATELY. A raise over the previous
   committed ceiling (the last version of the ratchet file that differs from
   this one, read from git) must carry a `$raised` note on that entry:
     { "date": "YYYY-MM-DD", "from": <old ceiling>, "to": <new ceiling>,
       "bytes": <to - from>, "reason": "..." }
   with `from` the previous ceiling, `to` this one, and a date newer than the
   previous entry's own `$raised` date. A raise without one, or with a note
   left over from an earlier raise, fails: silent raises still fail.

   The counts are deterministic (bytes, modules, requests, commits), never
   timings, so a rerun gives the same answer and a failure means a change.

     node tools/ci/perf-ratchet.mjs <measured.json> [--ratchet <file>] [--previous <file>]
   ══════════════════════════════════════════════════════════════════════════ */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RATCHET_FILE = path.join(ROOT, 'tools', 'measure', 'perf-ratchet.json');
/** Identical reads a measured file must carry (`$reads`) before a LOWER ceiling is suggested. */
export const MIN_READS_TO_LOWER = 3;

/**
 * @param {Record<string, { ceiling: number }>} ratchet
 * @param {Record<string, number>} measured
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function checkRatchet(ratchet, measured) {
  const lines = [];
  let ok = true;
  /* A lower ceiling is only ever suggested from agreed reads (perf-counts takes 3). */
  const reads = typeof measured.$reads === 'number' ? measured.$reads : 1;
  for (const [key, spec] of Object.entries(ratchet)) {
    if (key.startsWith('$')) continue;
    const value = measured[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      ok = false;
      lines.push(`FAIL  ${key}: not measured (the collector wrote no number for it)`);
      continue;
    }
    if (value > spec.ceiling) {
      ok = false;
      lines.push(`FAIL  ${key}: ${value} is above its ceiling ${spec.ceiling} (+${round(value - spec.ceiling)})`);
    } else if (value < spec.ceiling) {
      ok = false;
      lines.push(
        reads >= MIN_READS_TO_LOWER
          ? `LOWER ${key}: ${value} is below its ceiling ${spec.ceiling}; set "ceiling": ${value} in tools/measure/perf-ratchet.json`
          : `BELOW ${key}: ${value} is below its ceiling ${spec.ceiling} from ${reads} read(s); do not lower on this. Run tools/measure/perf-counts.mjs (${MIN_READS_TO_LOWER} agreeing reads) first`,
      );
    } else {
      lines.push(`ok    ${key}: ${value}`);
    }
  }
  for (const key of Object.keys(measured)) {
    if (key.startsWith('$')) continue;
    if (!(key in ratchet)) lines.push(`note  ${key}: measured (${measured[key]}) but not held by the ratchet`);
  }
  return { ok, lines };
}

const round = (n) => Math.round(n * 100) / 100;

const ISO_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * When a raise happened, in ms: its `at` (a full ISO timestamp with a zone,
 * e.g. 2026-10-06T08:10:00Z) when it has one, else its `date` at 00:00Z (the
 * notes written before `at` existed). Two raises on one day are ordered by
 * `at`. NaN when the note names neither.
 * @param {any} note
 */
export function raisedAt(note) {
  if (note && typeof note.at === 'string' && ISO_AT.test(note.at)) return Date.parse(note.at);
  if (note && /^\d{4}-\d{2}-\d{2}$/.test(String(note.date ?? ''))) return Date.parse(`${note.date}T00:00:00Z`);
  return NaN;
}

/**
 * Every ceiling above `previous`'s must be explained by a fresh `$raised`
 * note, and any `$raised` note must describe the ceiling it sits on.
 * @param {Record<string, any>} ratchet
 * @param {Record<string, any> | null} previous the last committed ratchet that differs, or null
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function checkRaises(ratchet, previous) {
  const lines = [];
  let ok = true;
  for (const [key, spec] of Object.entries(ratchet)) {
    if (key.startsWith('$') || !spec || typeof spec !== 'object') continue;
    const note = spec.$raised;
    const prev = previous && previous[key] && typeof previous[key] === 'object' ? previous[key] : null;
    const raised = prev !== null && typeof prev.ceiling === 'number' && spec.ceiling > prev.ceiling;
    if (note !== undefined) {
      const problems = [];
      if (!note || typeof note !== 'object') problems.push('is not an object');
      else {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(note.date ?? ''))) problems.push('has no YYYY-MM-DD date');
        else if (note.at !== undefined) {
          if (typeof note.at !== 'string' || !ISO_AT.test(note.at) || Number.isNaN(Date.parse(note.at))) problems.push(`has an \`at\` that is not a full ISO timestamp with a zone (${note.at})`);
          else if (new Date(note.at).toISOString().slice(0, 10) !== note.date) problems.push(`has \`at\` ${note.at} on another day than its date ${note.date} (UTC)`);
        }
        /* A ceiling LOWERED since its raise keeps the note as history; one
           raised past its note, or raised now with an old note, does not. */
        if (typeof note.to !== 'number' || (raised ? note.to !== spec.ceiling : note.to < spec.ceiling)) {
          problems.push(`says to=${note.to}, the ceiling is ${spec.ceiling}`);
        }
        if (typeof note.from !== 'number' || typeof note.to !== 'number' || note.from >= note.to) problems.push('has no `from` below its `to`');
        else if (note.bytes !== note.to - note.from) problems.push(`says bytes=${note.bytes}, to - from is ${note.to - note.from}`);
        if (typeof note.reason !== 'string' || note.reason.trim() === '') problems.push('gives no reason');
        if (raised) {
          if (note.from !== prev.ceiling) problems.push(`says from=${note.from}, the previous ceiling was ${prev.ceiling}`);
          /* Strictly newer than the previous raise, by `at` (a date-only note is its midnight UTC). */
          const prevAt = prev.$raised ? raisedAt(prev.$raised) : NaN;
          const when = (n) => (typeof n.at === 'string' ? n.at : n.date);
          if (!Number.isNaN(prevAt) && !(raisedAt(note) > prevAt)) problems.push(`is dated ${when(note)}, not newer than the previous raise (${when(prev.$raised)})`);
        }
      }
      if (problems.length) {
        ok = false;
        lines.push(`FAIL  ${key}: its $raised note ${problems.join('; ')}`);
        continue;
      }
    }
    if (raised && note === undefined) {
      ok = false;
      lines.push(`FAIL  ${key}: ceiling raised ${prev.ceiling} -> ${spec.ceiling} with no $raised note (date, from, to, bytes, reason)`);
    } else if (raised) {
      lines.push(`raise ${key}: ${prev.ceiling} -> ${spec.ceiling} on ${note.date}: ${note.reason}`);
    }
  }
  return { ok, lines };
}

/**
 * The last committed version of the ratchet file whose text differs from the
 * working copy: the ceilings before this change. Null when git cannot say.
 * @param {string} file
 */
export function previousRatchet(file = RATCHET_FILE) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const run = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  const log = run(['log', '--format=%H', '--', rel]);
  if (log.status !== 0) return null;
  const norm = (t) => t.replace(/\r\n/g, '\n').trim();
  const current = norm(fs.readFileSync(file, 'utf8'));
  for (const sha of log.stdout.split(/\s+/).filter(Boolean)) {
    const shown = run(['show', `${sha}:${rel}`]);
    if (shown.status !== 0) continue;
    if (norm(shown.stdout) !== current) {
      try {
        return JSON.parse(shown.stdout);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export const BOOT_KEYS = ['bootJsBytes', 'bootModules', 'bootRequests'];

/**
 * Do `rows` (first-board runs) agree on every boot count, and are there at
 * least MIN_READS_TO_LOWER of them? Returns the reads' keys for the message.
 * @param {Record<string, number>[]} rows
 */
export function agreedBootReads(rows) {
  const keys = rows.map((r) => BOOT_KEYS.map((k) => r[k]).join('/'));
  return { ok: rows.length >= MIN_READS_TO_LOWER && new Set(keys).size === 1, keys };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const file = process.argv[2];
  const at = process.argv.indexOf('--ratchet');
  const ratchetPath = at > 0 ? process.argv[at + 1] : RATCHET_FILE;
  if (!file) {
    console.error('usage: node tools/ci/perf-ratchet.mjs <measured.json> [--ratchet <file>]');
    process.exit(2);
  }
  const ratchet = JSON.parse(fs.readFileSync(ratchetPath, 'utf8'));
  const measured = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pv = process.argv.indexOf('--previous');
  const previous = pv > 0 ? JSON.parse(fs.readFileSync(process.argv[pv + 1], 'utf8')) : previousRatchet(ratchetPath);
  const counts = checkRatchet(ratchet, measured);
  const raises = checkRaises(ratchet, previous);
  const ok = counts.ok && raises.ok;
  for (const l of [...counts.lines, ...raises.lines]) console.log(l);
  console.log(ok ? 'PASS  perf-ratchet' : 'FAIL  perf-ratchet');
  process.exit(ok ? 0 : 1);
}
