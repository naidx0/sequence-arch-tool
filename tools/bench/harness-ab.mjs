#!/usr/bin/env node
/**
 * HARNESS A/B — what one prompt costs, measured, at two revisions of this repo.
 *
 *   node tools/bench/harness-ab.mjs --dist <pathA> --dist <pathB> [--repo <path>] [--json out.json]
 *
 * WHY THIS SHAPE. Every number here is produced WITHOUT calling a model, because a
 * model's reply is not reproducible and a benchmark nobody can re-run is marketing.
 * What is measured is the thing the harness actually controls: how many characters of
 * prompt it assembles for a given question against a given repository, and how much of
 * that is repo digest versus instruction. Two different builds of `buildAskPrompt` are
 * handed the SAME scanned digest and the SAME questions, so the only variable is the
 * harness.
 *
 * TOKENS ARE ESTIMATED AT chars/4 AND SAID TO BE. The exact tokenizer differs per
 * provider; the ratio between two prompts does not, and the ratio is the claim.
 *
 * WHAT THIS DOES NOT MEASURE, and must not be reported as if it did: answer quality,
 * task success, or anything about another vendor's harness. Comparing to Claude Code or
 * Cursor requires running them on the same tasks, which this script does not do.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const dists = [];
let repo = process.cwd();
let jsonOut = null;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--dist') dists.push(args[++i]);
  else if (args[i] === '--repo') repo = args[++i];
  else if (args[i] === '--json') jsonOut = args[++i];
}
if (dists.length === 0) {
  console.error('usage: harness-ab.mjs --dist <analyzer/dist> [--dist <other>] [--repo <path>] [--json out]');
  process.exit(2);
}

/* The battery. Deliberately a SPREAD of shapes, because the whole finding is that
   scoping works for some and not others — an average over one shape proves nothing. */
const QUESTIONS = [
  { id: 'greeting', shape: 'trivial', q: 'hi' },
  { id: 'one-package', shape: 'scoped', q: 'What does packages/ink do in this repo?' },
  { id: 'one-symbol', shape: 'scoped', q: 'Which file implements the staleness detection that /api/status reports?' },
  { id: 'cross-cutting', shape: 'broad', q: 'How does the ask pipeline assemble the prompt?' },
  { id: 'architecture', shape: 'broad', q: 'What are the main services in this repository and how do they depend on each other?' },
  { id: 'impact', shape: 'broad', q: 'What breaks if I change the schema package?' },
];

const load = async (dist) => {
  const abs = path.resolve(dist);
  const explain = await import(pathToFileURL(path.join(abs, 'explain', 'explain.js')).href);
  const scan = await import(pathToFileURL(path.join(abs, 'scan.js')).href);
  return { explain, scan, abs };
};

const est = (chars) => Math.round(chars / 4);

const run = async () => {
  const rows = [];
  for (const dist of dists) {
    const { explain, scan } = await load(dist);
    /* Scan ONCE per build, with that build's own scanner, because the digest is part
       of what changed. Cached scans are refused: a warm cache would measure the cache. */
    const graph = await scan.scanRepo(repo, { cluster: true });
    const digest = explain.buildDigest(graph);
    for (const item of QUESTIONS) {
      const prompt = explain.buildAskPrompt(digest, item.q);
      rows.push({
        dist,
        id: item.id,
        shape: item.shape,
        chars: prompt.length,
        estTokens: est(prompt.length),
      });
    }
    rows.push({
      dist,
      id: '_graph',
      shape: 'meta',
      nodes: graph.nodes.length,
      edges: graph.edges.length,
    });
  }
  return rows;
};

const rows = await run();
const byDist = new Map();
for (const r of rows) {
  if (!byDist.has(r.dist)) byDist.set(r.dist, []);
  byDist.get(r.dist).push(r);
}

const labels = [...byDist.keys()];
console.log(`repo: ${repo}`);
for (const [i, d] of labels.entries()) {
  const meta = byDist.get(d).find((r) => r.id === '_graph');
  console.log(`  ${String.fromCharCode(65 + i)} = ${d}   (scan: ${meta.nodes} nodes / ${meta.edges} edges)`);
}
console.log('');

const header = ['question', 'shape', ...labels.map((_, i) => String.fromCharCode(65 + i) + ' tok')];
if (labels.length === 2) header.push('delta', 'change');
console.log(header.map((h, i) => (i < 2 ? h.padEnd(i === 0 ? 16 : 9) : h.padStart(10))).join(''));

let totals = labels.map(() => 0);
for (const item of QUESTIONS) {
  const cells = labels.map((d) => byDist.get(d).find((r) => r.id === item.id));
  cells.forEach((c, i) => (totals[i] += c.estTokens));
  const line = [item.id.padEnd(16), item.shape.padEnd(9), ...cells.map((c) => String(c.estTokens).padStart(10))];
  if (labels.length === 2) {
    const delta = cells[1].estTokens - cells[0].estTokens;
    const pct = cells[0].estTokens === 0 ? 0 : (delta / cells[0].estTokens) * 100;
    line.push(String(delta).padStart(10), `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`.padStart(10));
  }
  console.log(line.join(''));
}
console.log('');
const tline = ['TOTAL'.padEnd(16), ''.padEnd(9), ...totals.map((t) => String(t).padStart(10))];
if (labels.length === 2) {
  const d = totals[1] - totals[0];
  tline.push(String(d).padStart(10), `${((d / totals[0]) * 100).toFixed(1)}%`.padStart(10));
}
console.log(tline.join(''));
console.log('');
console.log('tokens are chars/4 ESTIMATES; the ratio between builds is the claim, not the absolute.');

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({ repo, labels, rows, totals }, null, 1));
  console.log(`wrote ${jsonOut}`);
}
