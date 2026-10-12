// Offline A/B pairs for SEQUENCE_TEACH_CONCEPT_STEPS: every stored teach turn whose chart is a
// concept chart, rebuilt flag off (control: must equal the stored chart) and flag on, same text.
// usage: node tools/bench/concept-steps-pairs.mjs OUT.json run1.json [run2.json ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = (p) => pathToFileURL(path.join(root, 'packages/analyzer/dist', p)).href;
const { scanRepoCached } = await import(dist('index.js'));
const { buildConceptChart } = await import(dist('server/conceptChart.js'));
const { scoreChart } = await import('./lesson-quality.mjs');

const [out, ...runs] = process.argv.slice(2);
const graph = await scanRepoCached(path.join(root, 'packages/analyzer/test/fixtures/shopfront'), { cluster: true });
const build = (flag, chart) => {
  if (flag) process.env.SEQUENCE_TEACH_CONCEPT_STEPS = '1';
  else delete process.env.SEQUENCE_TEACH_CONCEPT_STEPS;
  return buildConceptChart(graph, { title: chart.title, nodeId: chart.focusItemId });
};
const isConcept = (c) => c && c.focusItemId && !c.steps && (c.items ?? []).every((i) => i.nodeId);

export function chartText(c) {
  const name = new Map(c.items.map((i) => [i.id, i.label]));
  const lines = [`[Picture on the canvas: "${c.title}"]`, 'Boxes: ' + c.items.map((i) => i.label).join(', ')];
  for (const l of c.links ?? []) lines.push(`  ${name.get(l.from)} -> ${name.get(l.to)}${l.label ? ` (${l.label})` : ''}`);
  if (c.steps?.length) {
    lines.push('Steps, played in order on the canvas:');
    c.steps.forEach((s, i) => lines.push(`  ${i + 1}. ${name.get(s.from)} -> ${name.get(s.to)}: ${s.says}`));
  }
  return lines.join('\n');
}

const pairs = [];
let seen = 0, control = 0;
const dedupe = new Set();
for (const file of runs) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const r of j.results ?? []) {
    if (r.repo !== 'shopfront') continue;
    for (const t of r.turns ?? []) {
      const c = (t.charts ?? []).find(isConcept);
      if (!c || !t.text) continue;
      seen++;
      const off = build(false, c);
      const on = build(true, c);
      delete process.env.SEQUENCE_TEACH_CONCEPT_STEPS;
      if (!off || JSON.stringify(off) !== JSON.stringify(c)) continue;
      control++;
      const key = `${r.id}|${t.turn}|${t.text}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      pairs.push({
        id: `${path.basename(file, '.json')}/${r.id}/t${t.turn}`,
        family: r.id,
        question: r.lesson?.subject?.ask ?? r.id,
        A: `${t.text}\n\n${chartText(off)}`,
        B: `${t.text}\n\n${chartText(on)}`,
        chartScore: [scoreChart(off), scoreChart(on)],
        steps: on.steps?.length ?? 0,
      });
    }
  }
}
fs.writeFileSync(out, JSON.stringify(pairs, null, 1));
console.log(`concept-chart turns ${seen}, control matches ${control}, pairs ${pairs.length}, families ${new Set(pairs.map((p) => p.family)).size}`);
