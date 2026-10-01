#!/usr/bin/env node
/**
 * WHY DID THIS TURN HAVE NO VISUAL? — the four answers, told apart.
 *
 * "visual present: 0%" is a number with at least four different causes behind
 * it, and every one of them implies a different fix:
 *
 *   refused          the model called a chart tool and the validator said no
 *   wrong-tool       it reached for propose_topology (a write) instead
 *   wrong-format     it drew SOMETHING -- mermaid, ascii, a json blob -- that
 *                    is not a validated chart, so the harness never saw a call
 *   never-attempted  it did not reach for a visual at all
 *
 * The first three are harness problems and the fourth is not, so reporting the
 * bare percentage decides nothing. This probe exists because a shell one-off
 * answered it once and would have had to be rewritten to answer it again.
 *
 * AND IT PRINTS WHAT IT LOOKED FOR. A probe reporting an absence has to say
 * what it failed to look at, or it is one regex away from a confident zero --
 * which has happened four times in this repository and is on the record in
 * docs/research/ten-from-the-night.md.
 *
 *   node tools/bench/visual-absence-probe.mjs <report.json> [more.json ...]
 */
import fs from 'node:fs';

/*
 * The drawn-in-prose test is IMPORTED, not re-written.
 *
 * The first version of this probe guessed at the glyph set, included prose
 * arrows, and duly reported four ASCII "diagrams" that were an arrow inside an
 * explanation and a weight-update formula. The product's rule was right and
 * this one was looser -- the third time in one session that two copies of a
 * rule drifted with the copy outside the product being the wrong one.
 */
const dist = (rel) =>
  new URL(`../../packages/analyzer/dist/${rel}`, import.meta.url).href;
const { drewInProse } = await import(dist('server/askPipeline.js'));

/** Every way a chart attempt could show up in visible text, named. */
const SIGNALS = [
  ['names the chart tool', (t) => /propose_chart/i.test(t)],
  ['names the topology tool', (t) => /propose_topology/i.test(t)],
  ['a sequence-tool fence', (t) => /sequence-tool/i.test(t)],
  ['items-shaped JSON', (t) => /"items"\s*:/.test(t)],
  ['a chart kind field', (t) => /"kind"\s*:/.test(t)],
  ['provider tool-call syntax', (t) => /tool_call|function_call|<tool/i.test(t)],
  ['a mermaid fence', (t) => /```\s*mermaid/i.test(t)],
  ['a diagram drawn in prose (the PRODUCT rule)', drewInProse],
];

const classify = (turn) => {
  if (turn.visual) return 'visual';
  const calls = turn.chartCalls ?? 0;
  const proposals = turn.chartProposals ?? 0;
  if (calls > 0 && proposals === 0) return 'refused';
  if (calls > 0) return 'called-but-no-visual';
  const text = String(turn.text ?? '');
  if (/propose_topology/i.test(text)) return 'wrong-tool';
  for (const [, hit] of SIGNALS.slice(2)) if (hit(text)) return 'wrong-format';
  return 'never-attempted';
};

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: visual-absence-probe.mjs <report.json> [...]');
  process.exit(2);
}

console.log('signals scanned for, in visible turn text:');
for (const [name] of SIGNALS) console.log(`  - ${name}`);
console.log('');

for (const file of files) {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const turns = (report.results ?? []).flatMap((c) => c.turns ?? []).filter((t) => !t.error);
  const counts = {};
  const hits = {};
  for (const turn of turns) {
    const verdict = classify(turn);
    counts[verdict] = (counts[verdict] ?? 0) + 1;
    if (verdict === 'visual') continue;
    for (const [name, hit] of SIGNALS) {
      if (hit(String(turn.text ?? ''))) hits[name] = (hits[name] ?? 0) + 1;
    }
  }
  const order = [
    'visual',
    'refused',
    'wrong-tool',
    'wrong-format',
    'called-but-no-visual',
    'never-attempted',
  ];
  console.log(`${file}  (${turns.length} clean turns)`);
  for (const k of order) if (counts[k]) console.log(`  ${k.padEnd(22)} ${counts[k]}`);
  /* Signal hits among turns WITHOUT a visual: the evidence behind the verdicts
     above, so a reader can disagree with the classification rather than take
     it. Silence here is the finding, not the absence of one. */
  const found = Object.entries(hits);
  console.log(
    found.length === 0
      ? '  no attempt signal of any kind in any turn without a visual'
      : `  signals seen: ${found.map(([k, v]) => `${k} x${v}`).join(', ')}`,
  );
  console.log('');
}
