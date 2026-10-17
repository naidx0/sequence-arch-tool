import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { TIMING_RATCHET_FILE, band, checkTiming, fromReleaseReport, fromScanBench, main } from './timing-ratchet.mjs';

/* The timing ratchet (handoff 24): per-class baselines, tolerance, one-way. Fixtures are result JSON in the
   shape the existing benches write; no bench runs here. */

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'timing-ratchet.mjs');
const spec = {
  metrics: {
    scanColdMs: { unit: 'ms', tolerance: { rel: 0.1, abs: 500 } },
    idleRssKb: { unit: 'KiB', tolerance: { rel: 0.1, abs: 1000 } },
  },
  classes: {
    local: { baselines: { scanColdMs: { value: 10000 }, idleRssKb: { value: 100000 } } },
    'linux-ci': { baselines: { scanColdMs: { value: null }, idleRssKb: { value: null } } },
  },
};

test('a regression past the tolerance exits 1 and names the metric', () => {
  const r = checkTiming(spec, 'local', { scanColdMs: 12000, idleRssKb: 100000 });
  assert.equal(r.code, 1);
  assert.match(r.lines.join('\n'), /FAIL\s+scanColdMs \[local\]: 12000 ms is worse than baseline 10000/);
});

test('inside the tolerance band passes with exit 0, on both sides', () => {
  assert.equal(checkTiming(spec, 'local', { scanColdMs: 10900, idleRssKb: 100000 }).code, 0);
  assert.equal(checkTiming(spec, 'local', { scanColdMs: 9100, idleRssKb: 109000 }).code, 0);
  assert.doesNotMatch(checkTiming(spec, 'local', { scanColdMs: 9100, idleRssKb: 100000 }).lines.join('\n'), /Lower the baseline/);
});

test('the band is the larger of relative and absolute (noise floor on small baselines)', () => {
  assert.equal(band(10000, { rel: 0.1, abs: 500 }), 1000);
  assert.equal(band(1000, { rel: 0.1, abs: 500 }), 500);
  // 1000 baseline, 1400 measured: +40 % but inside the 500 floor
  const small = { metrics: { m: { unit: 'ms', tolerance: { rel: 0.1, abs: 500 } } }, classes: { local: { baselines: { m: { value: 1000 } } } } };
  assert.equal(checkTiming(small, 'local', { m: 1400 }).code, 0);
  assert.equal(checkTiming(small, 'local', { m: 1501 }).code, 1);
});

test('a clear improvement exits 0 and says to lower the baseline to the new number', () => {
  const r = checkTiming(spec, 'local', { scanColdMs: 8000, idleRssKb: 100000 });
  assert.equal(r.code, 0);
  assert.match(r.lines.join('\n'), /scanColdMs \[local\]: 8000 ms beats baseline 10000\. Lower the baseline to 8000/);
});

test('an unknown machine class is a clear error (exit 2), not a pass', () => {
  const r = checkTiming(spec, 'mac-ci', { scanColdMs: 1 });
  assert.equal(r.code, 2);
  assert.match(r.lines[0], /unknown machine class "mac-ci"; known: local, linux-ci/);
});

test('a metric with a baseline but no measured value is reported and fails', () => {
  const r = checkTiming(spec, 'local', { scanColdMs: 10000 });
  assert.equal(r.code, 1);
  assert.match(r.lines.join('\n'), /FAIL\s+idleRssKb \[local\]: not measured/);
  // NaN and strings are not measurements either
  assert.equal(checkTiming(spec, 'local', { scanColdMs: Number.NaN, idleRssKb: '1' }).code, 1);
});

test('an unset (null) baseline passes and prints the first value to record; unmeasured+unset skips', () => {
  const r = checkTiming(spec, 'linux-ci', { scanColdMs: 31000 });
  assert.equal(r.code, 0);
  const text = r.lines.join('\n');
  assert.match(text, /UNSET scanColdMs \[linux-ci\]: measured 31000 ms; no baseline yet\. Record 31000/);
  assert.match(text, /SKIP\s+idleRssKb \[linux-ci\]: baseline unset and nothing measured/);
});

test('--only limits the check, and an unknown metric name is an error', () => {
  assert.equal(checkTiming(spec, 'local', { scanColdMs: 10000 }, ['scanColdMs']).code, 0);
  assert.equal(checkTiming(spec, 'local', { scanColdMs: 10000 }, ['nope']).code, 2);
});

test('the bench extractors read the real output shapes', () => {
  const scan = { repos: [{ cliColdMs: { median: 1 }, attachColdMs: { median: 2 }, oneFileRescanMs: { median: 3 }, settledRssKb: { median: 4 } }] };
  assert.deepEqual(fromScanBench(scan), { scanColdMs: 1, attachColdMs: 2, oneFileRescanMs: 3, idleRssKb: 4 });
  assert.deepEqual(fromScanBench({ repos: [] }), {});
  const rel = { rows: [{ id: 'window-shown', status: 'FAIL', reason: 'window shown 3176 ms after launch (budget < 2000 ms)' }] };
  assert.deepEqual(fromReleaseReport(rel), { windowShownMs: 3176 });
  assert.deepEqual(fromReleaseReport({ rows: [{ id: 'window-shown', status: 'FAIL', reason: 'no window-shown time was reported' }] }), {});
});

test('the committed ratchet file is well formed: every class baseline names a metric, with a source', () => {
  const j = JSON.parse(fs.readFileSync(TIMING_RATCHET_FILE, 'utf8'));
  assert.ok(Object.keys(j.classes).includes('local') && Object.keys(j.classes).includes('linux-ci'));
  for (const [m, s] of Object.entries(j.metrics)) {
    assert.ok(s.unit && s.measuredBy && s.tolerance.rel > 0 && s.tolerance.abs > 0, `metric ${m} incomplete`);
  }
  for (const [c, k] of Object.entries(j.classes)) {
    for (const [m, b] of Object.entries(k.baselines)) {
      assert.ok(m in j.metrics, `${c}: baseline for unknown metric ${m}`);
      assert.ok(b.value === null || (typeof b.value === 'number' && b.value > 0), `${c}.${m}: value must be null or positive`);
      assert.ok(typeof b.source === 'string' && b.source.length > 0, `${c}.${m}: a baseline names its source`);
    }
  }
  // linux-ci is seeded unset: no fabricated CI numbers
  for (const b of Object.values(j.classes['linux-ci'].baselines)) assert.equal(b.value, null);
});

test('the CLI exit codes: 1 on regression, 0 in band, 2 on an unknown class (real process)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timing-ratchet-'));
  try {
    const run = (results, cls) => {
      const f = path.join(dir, 'r.json');
      fs.writeFileSync(f, JSON.stringify(results));
      return spawnSync(process.execPath, [SCRIPT, '--results', f, '--class', cls, '--only', 'scanColdMs'], { encoding: 'utf8' });
    };
    const base = JSON.parse(fs.readFileSync(TIMING_RATCHET_FILE, 'utf8')).classes.local.baselines.scanColdMs.value;
    const bad = run({ scanColdMs: base * 2 }, 'local');
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /FAIL\s+scanColdMs/);
    assert.equal(run({ scanColdMs: base }, 'local').status, 0);
    const unk = run({ scanColdMs: base }, 'nowhere');
    assert.equal(unk.status, 2);
    assert.match(unk.stderr, /unknown machine class "nowhere"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('main reads a scan-bench file end to end and an unreadable input is an error, not a pass', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timing-ratchet-'));
  try {
    const f = path.join(dir, 'scan.json');
    fs.writeFileSync(f, JSON.stringify({ repos: [{ cliColdMs: { median: 99999 }, attachColdMs: { median: 1 }, oneFileRescanMs: { median: 1 }, settledRssKb: { median: 1 } }] }));
    const out = [];
    const code = main(['--scan', f, '--class', 'local', '--only', 'scanColdMs'], { log: (l) => out.push(l), err: (l) => out.push(l) });
    assert.equal(code, 1);
    assert.match(out.join('\n'), /scanColdMs \[local\]: 99999 ms is worse/);
    const out2 = [];
    assert.equal(main(['--scan', path.join(dir, 'missing.json')], { log: (l) => out2.push(l), err: (l) => out2.push(l) }), 2);
    assert.match(out2.join('\n'), /cannot read an input/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
