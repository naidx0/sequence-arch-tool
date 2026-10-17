#!/usr/bin/env node
/**
 * WHAT THE CARRY WOULD HAND THE NEXT TURN — computed offline, before the card.
 *
 *   node tools/bench/referent-list.mjs [target] [repoRoot]
 *
 * The seat instrument runs in a browser and cannot see a prompt-side block. It
 * does not need to: the referent list is a deterministic function of the
 * scanned graph, so the carried set can be computed here and the transcript
 * attributed against it afterwards.
 *
 * THIS DUPLICATES NOTHING. It calls the same `who_calls` the product calls, so
 * the list printed here is the list the product would carry — a rule in two
 * handlers is one rule until measured, and this house has paid for that once
 * today already.
 *
 * It also answers a question that must be settled BEFORE the arms run: is the
 * caller list longer than the cap? If it is not, every item is carried, the
 * cap never bites, and a run designed around what falls outside it measures
 * nothing.
 */
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const target = process.argv[2] ?? 'packages/analyzer/src/scan.ts';
const root = path.resolve(process.argv[3] ?? REPO);

const { scanRepo } = await import(
  url.pathToFileURL(path.join(REPO, 'packages/analyzer/dist/scan.js')).href
);
const { executeAskTool } = await import(
  url.pathToFileURL(path.join(REPO, 'packages/analyzer/dist/server/askTools.js')).href
);
const { MAX_REFERENTS } = await import(
  url.pathToFileURL(path.join(REPO, 'packages/analyzer/dist/server/turnCarry.js')).href
);

console.log(`[referents] scanning ${root} …`);
const graph = await scanRepo(root, { cluster: true });
console.log(`[referents] ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

const result = await executeAskTool(
  'who_calls',
  { target },
  { graph, repoRoot: root, resolveReadable: () => null },
);

if (!result.ok) {
  console.error(`[referents] who_calls refused: ${result.evidence}`);
  process.exit(1);
}
if (!result.referents) {
  console.error('[referents] who_calls returned no referents — the slot is not wired');
  process.exit(2);
}

const { items, total } = result.referents;
console.log(`\n[referents] ${result.evidence}`);
console.log(`[referents] DISTINCT callers: ${total}`);
console.log(`[referents] cap: ${MAX_REFERENTS}`);

if (total <= MAX_REFERENTS) {
  console.log(
    `\n[referents] REFUSE-WORTHY: ${total} distinct callers is at or under the cap of ` +
      `${MAX_REFERENTS}, so every caller is carried and nothing falls outside it. A run whose ` +
      'design turns on what the cap excludes would measure nothing here. Pick a target with more ' +
      'callers, or say plainly that the cap never bit.',
  );
} else {
  console.log(`\n[referents] CARRIED (the first ${MAX_REFERENTS}, what turn 2 would see):`);
  for (const [i, name] of items.slice(0, MAX_REFERENTS).entries()) console.log(`  ${i + 1}. ${name}`);
  console.log(
    `\n[referents] ${total - MAX_REFERENTS} caller(s) fall OUTSIDE the cap and are not carried.`,
  );
}
