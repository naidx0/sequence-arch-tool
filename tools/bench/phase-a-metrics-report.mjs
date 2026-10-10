#!/usr/bin/env node
/**
 * Phase A metrics harness CLI (A2.1 + A3.6).
 *
 * Usage (repo root, after analyzer build):
 *   node tools/bench/phase-a-metrics-report.mjs
 *   node tools/bench/phase-a-metrics-report.mjs --n 20 --write-docs
 *
 * Writes JSON (+ optional markdown under docs/research/). Never invents M1 greens.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '../..');
const DIST = path.join(REPO_ROOT, 'packages/analyzer/dist/harness');

function tipSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return undefined;
  }
}

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
}

const writeDocs = process.argv.includes('--write-docs');
const n = Number(argValue('--n', '20')) || 20;

/*
 * `import()` TAKES A URL, NOT A PATH.
 *
 * These were `await import(path.join(DIST, '...'))`, which works on POSIX
 * because an absolute path there looks like a bare specifier the loader
 * resolves. On Windows `C:\...` parses as protocol `c:` and the loader refuses:
 * ERR_UNSUPPORTED_ESM_URL_SCHEME.
 *
 * So this harness — the one that fills the Phase A scorecard, which the handoff
 * lists as blocking the public beta claim — had never run on this machine at
 * all. It failed on its first import, before measuring anything.
 */
const loadDist = (file) => import(pathToFileURL(path.join(DIST, file)).href);
const { runDesignDrawBaseline, formatDesignDrawBaselineMarkdown } = await loadDist(
  'designDrawBaseline.js',
);
const { reportM3M4, formatM3M4Markdown } = await loadDist('m3m4Reporter.js');

const baseline = await runDesignDrawBaseline({ n, tipSha: tipSha() });
const m3m4 = reportM3M4(baseline.rows);

const outDir = writeDocs
  ? path.join(REPO_ROOT, 'docs/research')
  : path.join(REPO_ROOT, 'tmp');
fs.mkdirSync(outDir, { recursive: true });

const payload = {
  version: 1,
  tipSha: tipSha(),
  measuredAt: new Date().toISOString(),
  baseline,
  m3m4,
};

const jsonPath = path.join(outDir, 'phase-a-metrics-harness-report.json');
fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n');

const md =
  formatDesignDrawBaselineMarkdown(baseline) +
  '\n---\n\n' +
  formatM3M4Markdown(m3m4);
const mdPath = path.join(outDir, 'phase-a-metrics-harness-report.md');
fs.writeFileSync(mdPath, md);

process.stdout.write(
  JSON.stringify(
    {
      ok: true,
      jsonPath,
      mdPath,
      n: baseline.n,
      roundsLe2Rate: baseline.summary.rounds.le2Rate,
      boardOpenRate: baseline.summary.boardOpenRate,
      m3RawVisibleRate: m3m4.m3.rawVisibleRate,
      honesty: baseline.honestyNote,
    },
    null,
    2,
  ) + '\n',
);
