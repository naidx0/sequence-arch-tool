/* ══════════════════════════════════════════════════════════════════════════
   THE ENVIRONMENT A MEASUREMENT RUNS THE APP IN
   tools/measure/lib/isolatedEnv.mjs

   The analyzer keeps its user store (recent repos, last-place.json, usage,
   ai.json) in SEQUENCE_USER_DIR, else ~/.sequence. SEQUENCE_HOME is NOT what
   it reads for that, so a tool that set only SEQUENCE_HOME ran against the
   real store: on 2026-10-05 board-legibility overwrote the real
   ~/.sequence/last-place.json with a temp shopfront path.

   Every tool under tools/measure that starts the CLI passes
   `env: isolatedEnv(...)` (tools/ci/measure-isolation.test.mjs fails a spawn
   of the CLI that does not). The user store is a fresh temp dir unless the
   caller names another one, and it is never the real ~/.sequence.
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REAL_STORE = path.resolve(os.homedir(), '.sequence');
const made = [];

/**
 * `base` (default: this process's env) with SEQUENCE_USER_DIR, and
 * SEQUENCE_HOME unless `base` names one, pointed at an isolated dir.
 * `userDir` picks the dir (it must not be the real store); otherwise a temp
 * dir is made and removed when this process exits.
 */
export function isolatedEnv(base = process.env, { userDir } = {}) {
  const dir = path.resolve(userDir ?? mkTemp());
  if (dir === REAL_STORE) throw new Error(`isolatedEnv: refusing the real user store ${REAL_STORE}`);
  fs.mkdirSync(dir, { recursive: true });
  const env = { ...base, SEQUENCE_USER_DIR: dir };
  if (!base.SEQUENCE_HOME || path.resolve(base.SEQUENCE_HOME) === REAL_STORE) env.SEQUENCE_HOME = dir;
  return env;
}

function mkTemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-measure-user-'));
  if (made.length === 0) {
    process.on('exit', () => {
      for (const d of made) {
        try {
          fs.rmSync(d, { recursive: true, force: true });
        } catch {}
      }
    });
  }
  made.push(dir);
  return dir;
}

/**
 * The spawns of the CLI in a source text that do not go through
 * isolatedEnv: each `spawn(` / `spawnSync(` / `execFile(` / `execFileSync(`
 * call whose argument list names the CLI (`cli.js`, or an identifier set to
 * a path ending in cli.js) and does not contain `isolatedEnv(`. Returns the
 * line numbers. Used by tools/ci/measure-isolation.test.mjs.
 */
export function unisolatedCliSpawns(source) {
  /* Identifiers that hold the CLI's path, or a list built from one
     (`const cliArgs = [CLI, 'app', ...]`), to a fixpoint. */
  const cliNames = new Set(['cli.js']);
  const defs = [...source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*)/g)].map((m) => [m[1], m[2]]);
  const mentions = (text) =>
    [...cliNames].some((n) => (n === 'cli.js' ? text.includes('cli.js') : new RegExp(`(^|[^\\w$])${n.replace(/\$/g, '\\$')}([^\\w$]|$)`).test(text)));
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, rhs] of defs) {
      if (!cliNames.has(name) && mentions(rhs)) {
        cliNames.add(name);
        grew = true;
      }
    }
  }
  const out = [];
  for (const m of source.matchAll(/\b(spawn|spawnSync|execFile|execFileSync)\s*\(/g)) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < source.length && depth > 0; i++) {
      const c = source[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    const call = source.slice(start, i);
    if (!mentions(call)) continue;
    if (call.includes('isolatedEnv(')) continue;
    out.push(source.slice(0, m.index).split('\n').length);
  }
  return out;
}
