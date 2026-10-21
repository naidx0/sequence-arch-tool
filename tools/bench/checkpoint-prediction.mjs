#!/usr/bin/env node
/**
 * THE CHECKPOINT'S REGISTERED PREDICTION, card-free once the sessions exist.
 *
 *   node tools/bench/checkpoint-prediction.mjs [port]
 *
 * Registered in `docs/research/lesson-checkpoint.md` (from the design page's §4):
 *
 *   opening each of the thirteen sequence-condition lessons on the current build
 *   gives `migrated 0 of 13` and thirteen byte-identical charts; opening the
 *   journey lesson, written at an older build, gives `migrated 1 of 1`.
 *
 * The thirteen are written by `TEACH_EVAL_WRITE_SESSIONS=1` on the bench's last
 * run, so they carry that run's build stamp. This opens each through the RUNNING
 * APP — `GET /api/sessions/:id`, the route that migrates — rather than calling
 * the module, because the prediction is about what a reader gets, not about what
 * the rule would decide.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const port = Number(process.argv[2] ?? 4173);
const base = `http://127.0.0.1:${port}`;
const log = (...a) => console.log('[prediction]', ...a);

const stamp = await (await fetch(`${base}/api/build`)).json();
if (stamp.stale) {
  console.error('checkpoint-prediction: REFUSED — the app is older than its code. `pnpm restart:app`.');
  process.exit(2);
}
log(`app built ${stamp.builtAt}`);

const dir = path.join(ROOT, '.sequence', 'sessions');
const bench = fs.readdirSync(dir).filter((id) => id.startsWith('bench-'));
if (bench.length === 0) {
  console.error(
    'checkpoint-prediction: no bench-* sessions on disk. Run the bench with ' +
      'TEACH_EVAL_WRITE_SESSIONS=1 first — this measures what it wrote, and reporting 0 of 0 as a ' +
      'pass would be a share over an empty denominator.',
  );
  process.exit(2);
}
log(`${bench.length} bench session(s) on disk`);

let migrated = 0;
let unchanged = 0;
let noChart = 0;
const rows = [];
for (const id of bench) {
  const res = await fetch(`${base}/api/sessions/${encodeURIComponent(id)}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    rows.push({ id, error: res.status });
    continue;
  }
  const body = await res.json();
  if (body.migrated === undefined) {
    noChart += 1;
    rows.push({ id, chart: false });
    continue;
  }
  if (body.migrated.migrated) migrated += 1;
  else unchanged += 1;
  rows.push({ id, migrated: body.migrated.migrated, reason: body.migrated.reason, charts: (body.canvas?.charts ?? []).length });
}

const errors = rows.filter((r) => r.error !== undefined).length;
const withChart = migrated + unchanged;
/*
 * `0 of 0` IS NOT A RESULT. The first run of this reported "MIGRATED 0 of 0"
 * over thirteen sessions that all answered 404 — the guard above counted
 * DIRECTORIES and the line reported a different denominator, so a total failure
 * printed as a clean zero. The denominator that is reported is the one that has
 * to be guarded.
 */
if (errors > 0 || withChart === 0) {
  console.error('');
  console.error(
    `checkpoint-prediction: REFUSED — ${errors} of ${bench.length} session(s) could not be read ` +
      `(${rows.filter((r) => r.error).slice(0, 3).map((r) => `${r.id}: ${r.error}`).join(', ')})` +
      `${withChart === 0 ? ', and none carried a chart to migrate' : ''}.`,
  );
  console.error('  A zero over an empty denominator is not a passing prediction.');
  fs.writeFileSync(
    path.join(ROOT, 'tools/bench/out/checkpoint-prediction.json'),
    `${JSON.stringify({ refused: true, builtAt: stamp.builtAt, bench: bench.length, errors, rows }, null, 2)}
`,
  );
  process.exit(2);
}
console.log('');
log(`bench sessions          ${bench.length}`);
log(`  carrying a chart      ${withChart}`);
log(`  no chart to migrate   ${noChart}`);
log(`MIGRATED ${migrated} of ${withChart}   (registered: 0 of 13)`);
fs.writeFileSync(
  path.join(ROOT, 'tools/bench/out/checkpoint-prediction.json'),
  `${JSON.stringify({ builtAt: stamp.builtAt, bench: bench.length, withChart, migrated, unchanged, noChart, rows }, null, 2)}\n`,
);
log('written: tools/bench/out/checkpoint-prediction.json');
process.exitCode = 0;
