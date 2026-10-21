// Read-only parent-folder measurement. No graph cache, facts cache, agent maps,
// git excludes or user state are written. Output goes only to the named file.
import fs from 'node:fs';
import { computeSignature, takeFileSnapshot } from '../../packages/analyzer/dist/server/graphCache.js';
import { scanRepo } from '../../packages/analyzer/dist/scan.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('usage: node tools/bench/0184-launch-scan.mjs <input> <output.json>');
const data = { input, readOnly: true, stages: [] };
const start = performance.now();
const note = (stage, extra = {}) => {
  data.stages.push({ stage, ms: Math.round(performance.now() - start), ...extra });
  fs.writeFileSync(output, JSON.stringify(data, null, 2));
};
const signature = await computeSignature(input);
const snapshot = takeFileSnapshot(signature);
if (!snapshot) throw new Error('input changed during the signature walk; no complete snapshot');
note('signature', { files: snapshot.rels.length });
let last = -1;
const graph = await scanRepo(input, { cluster: true, fileSnapshot: snapshot, onProgress: (done, total) => {
  if (done === 0 || done === total || done - last >= 1000) { last = done; note('progress', { done, total }); }
} });
note('scanned', { nodes: graph.nodes.length, edges: graph.edges.length, warnings: graph.warnings.length });
console.log(JSON.stringify(data, null, 2));
