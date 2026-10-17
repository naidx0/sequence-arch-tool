/**
 * A2.1 / A3.6 locking tests — design-draw baseline + M3/M4 reporter.
 * Canned provider only; never asserts invented live M1 latency greens.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DESIGN_DRAW_BASELINE_N,
  buildDesignDrawScenarios,
  formatDesignDrawBaselineMarkdown,
  runDesignDrawBaseline,
} from '../harness/designDrawBaseline.js';
import {
  formatM3M4Markdown,
  reportM3Honesty,
  reportM3M4,
  residualLooksLikeRawToolOrSeqd,
  salvageResidualProse,
} from '../harness/m3m4Reporter.js';
import { loadAskHonestyFixture, wrapProse } from './ask-honesty-corpus.js';

test('A2.1 buildDesignDrawScenarios: 20 = 10 blank + 10 shopfront', () => {
  const scenarios = buildDesignDrawScenarios(DESIGN_DRAW_BASELINE_N);
  assert.equal(scenarios.length, 20);
  assert.equal(scenarios.filter((s) => s.workspace === 'blank-design').length, 10);
  assert.equal(scenarios.filter((s) => s.workspace === 'shopfront').length, 10);
});

test('A2.1 runDesignDrawBaseline: N=20, rounds≤2, board open proxy high', async () => {
  const report = await runDesignDrawBaseline({ n: 20, tipSha: 'test' });
  assert.equal(report.n, 20);
  assert.equal(report.providerKind, 'canned');
  assert.ok(report.honestyNote.includes('canned'));
  assert.equal(report.summary.rounds.le2Count, 20, 'canned scripts complete in ≤2 rounds');
  assert.equal(report.summary.rounds.le2Rate, 1);
  assert.ok(
    report.summary.boardOpenRate >= 0.9,
    `board open proxy should be ≥90% on successful scripts, got ${report.summary.boardOpenRate}`,
  );
  for (const row of report.rows) {
    assert.ok(typeof row.rounds === 'number');
    assert.ok((row.rounds ?? 99) <= 2);
    assert.ok(row.intent === 'draw' || row.intent === undefined || typeof row.intent === 'string');
  }
  const md = formatDesignDrawBaselineMarkdown(report);
  assert.ok(md.includes('A2.1'));
  assert.ok(md.includes('not M1') || md.includes('canned'));
});

test('A3.6 M3 reporter: honesty dumps salvage without residual raw JSON', () => {
  const m3 = reportM3Honesty();
  assert.ok(m3.n >= 7);
  assert.equal(m3.rawVisibleCount, 0, `residual raw dumps: ${JSON.stringify(m3.cases.filter((c) => c.rawVisibleAfterSalvage))}`);
  assert.equal(m3.rawVisibleRate, 0);
  const dump = wrapProse(loadAskHonestyFixture('process-sequence-bare'));
  assert.ok(residualLooksLikeRawToolOrSeqd(dump), 'fixture itself looks like raw before salvage');
  assert.equal(residualLooksLikeRawToolOrSeqd(salvageResidualProse(dump)), false);
});

test('A3.6 M3+M4 combined from baseline rows', async () => {
  const baseline = await runDesignDrawBaseline({ n: 6 });
  const combined = reportM3M4(baseline.rows);
  assert.equal(combined.m3.rawVisibleRate, 0);
  assert.ok(combined.m4.boardOpenRate >= 0.9);
  const md = formatM3M4Markdown(combined);
  assert.ok(md.includes('M3'));
  assert.ok(md.includes('M4'));
});
