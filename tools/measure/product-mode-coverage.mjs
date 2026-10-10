#!/usr/bin/env node
/**
 * How many of a convo set's first questions reach product mode, with the repo-pointing
 * rule off (0) and on (1). Convos: [{id, repo: "ml-harness"|"sequence", questions}].
 *
 *   node tools/measure/product-mode-coverage.mjs <convos.json>...
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dist = (rel) => new URL(`../../packages/analyzer/dist/${rel}`, import.meta.url).href;
const { scanRepo } = await import(dist('scan.js'));
const { buildTeachContext, newLesson } = await import(dist('server/lessonState.js'));
const { teachProductTurn } = await import(dist('server/askPipeline.js'));
const repos = { 'ml-harness': fs.realpathSync(path.join(os.homedir(), 'Projects/mlh-adapter')), sequence: fs.realpathSync('.') };
const graphs = {}; for (const [k, v] of Object.entries(repos)) graphs[k] = await scanRepo(v, { cluster: true });
for (const f of process.argv.slice(2)) {
  const C = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const flag of ['0', '1']) { process.env.SEQUENCE_TEACH_PRODUCT_POINTS_AT_REPO = flag; let on = 0;
    for (const c of C) { const g = graphs[c.repo]; const q = c.questions[0]; if (teachProductTurn({ teach: true, question: q, repoRoot: repos[c.repo], teachContext: buildTeachContext({ lesson: newLesson(c.id, q, g), graph: g }) })) on++; }
    console.log(f.split('/').pop(), 'pointsAtRepo', flag, 'product mode', on + '/' + C.length); }
}
