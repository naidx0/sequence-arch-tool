import fs from 'node:fs';
import { pairPrompt } from '../../../../tools/bench/lesson-judge.mjs';
const S = process.argv[2];
const pairs = JSON.parse(fs.readFileSync(`${S}/cs-pairs.json`, 'utf8'));
// Blind: shuffle pairs deterministically, split into 3 batches; item ids are opaque, the map is kept apart.
const order = pairs.map((p, i) => ({ p, k: (i * 7919) % 101 })).sort((a, b) => a.k - b.k).map((x) => x.p);
const batches = [[], [], []];
order.forEach((p, i) => {
  batches[i % 3].push({ key: `${p.id}|AB`, prompt: pairPrompt({ question: p.question, first: p.A, second: p.B }) });
  batches[(i + 1) % 3].push({ key: `${p.id}|BA`, prompt: pairPrompt({ question: p.question, first: p.B, second: p.A }) });
});
fs.mkdirSync(`${S}/judge`, { recursive: true });
batches.forEach((b, i) => {
  const ids = b.map((_, j) => `b${i}-${j + 1}`);
  fs.writeFileSync(`${S}/judge/batch${i}.md`, b.map((x, j) => `########## ITEM ${ids[j]}\n${x.prompt}\n`).join('\n'));
  fs.writeFileSync(`${S}/judge/map${i}.json`, JSON.stringify(b.map((x, j) => [ids[j], x.key])));
  console.log(`batch${i}: ${b.length} prompts, ${fs.statSync(`${S}/judge/batch${i}.md`).size} bytes`);
});
