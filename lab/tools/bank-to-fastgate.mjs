// Turns two release-bank runs into fastgate `ab` score files.
// Item = convo/run; family = the question text (a question's runs and repos move together).
// usage: node tools/bank-to-fastgate.mjs BASE.json CAND.json OUTDIR
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [baseFile, candFile, out] = process.argv.slice(2);
const convos = JSON.parse(fs.readFileSync(process.env.BANK_CONVOS ?? path.join(os.homedir(), 'Projects', 'heldout13', 'bank-v1-convos.json'), 'utf8'));
const question = Object.fromEntries(convos.map((c) => [c.id, c.questions[0]]));
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8')).results.filter((r) => !r.error);
fs.mkdirSync(out, { recursive: true });
for (const [metric, score] of [['full', (r) => (r.productShape ? 1 : 0)], ['time', (r) => -r.ms / 1000]]) {
  for (const [side, f] of [['BASE', baseFile], ['CAND', candFile]]) {
    const items = Object.fromEntries(load(f).map((r) => [`${r.convo}/r${r.run}`, { score: score(r), family: question[r.convo] }]));
    fs.writeFileSync(path.join(out, `${side}-${metric}.json`), JSON.stringify(items, null, 1));
  }
}
