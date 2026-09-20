#!/usr/bin/env node
/**
 * THE GROUNDING BENCH — how often does the harness refuse a claim the repository
 * does not support, and how often does it wrongly refuse one it does?
 *
 *   node tools/bench/grounding.mjs [--repo <path>] [--json out.json]
 *
 * WHY THIS EXISTS. Every public coding benchmark scores whether a patch passes tests.
 * None of them score whether the assistant's DESCRIPTION of your system is true. That
 * is the failure this product is built against, and it is measurable: hand the harness
 * architecture claims that are false about a real scanned repository and count how many
 * it lets through.
 *
 * BOTH DIRECTIONS ARE SCORED, and the second is the one that keeps this honest. A
 * harness that refuses everything scores 100% on fabrications and is useless. So the
 * fixtures include TRUE claims about the same repository, and a refusal there is
 * counted as a false positive.
 *
 * Deterministic: no model is called. What is under test is the harness's own
 * validators, which are pure functions over a real scan.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
let repo = process.cwd();
let jsonOut = null;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--repo') repo = args[++i];
  else if (args[i] === '--json') jsonOut = args[++i];
}

const { scanRepo } = await import('../../packages/analyzer/dist/scan.js');
const { executeAskTool } = await import('../../packages/analyzer/dist/server/askTools.js');
const { answerEchoesUntrustedBlock } = await import('../../packages/analyzer/dist/llm/untrusted.js');
const { UNTRUSTED_OPEN } = await import('../../packages/analyzer/dist/llm/untrusted.js');

const graph = await scanRepo(repo, { cluster: true });
const services = graph.nodes.filter((n) => n.kind === 'service').map((n) => n.id);
const realA = services[0];
const realB = services[1];

/*
 * THE ATTACHED GRAPH GOES IN THE CONTEXT. `executeProposeTopology` validates an
 * endpoint against the proposal’s own ids UNION `ctx.topologyNodeIds` — the scanned
 * graph's id set. A bench that omits it measures a harness with no repository
 * attached and scores every legitimate edge onto a real service as a refusal. That
 * is a broken fixture, not a finding, and it read like a finding on the first run.
 */
const ctx = {
  topologyNodeIds: new Set(graph.nodes.map((n) => n.id)),
  repoRoot: path.resolve(repo),
  designMode: true,
  question: 'draw a compact overview on the board',
  resolveReadable: (rel) => {
    const abs = path.resolve(repo, rel);
    return abs.startsWith(path.resolve(repo)) ? abs : null;
  },
};

const topology = (nodes, edges) =>
  executeAskTool('propose_topology', { title: 'T', nodes, edges }, ctx);

const node = (id, label = id) => ({ id, label, kind: 'service' });

/* FABRICATIONS — every one is false about THIS repository. */
const FABRICATED = [
  {
    id: 'edge-to-nowhere',
    why: 'an edge whose target is a service the scan never found',
    run: () =>
      topology([node('proposal:a'), node('proposal:b')], [
        { id: 'e1', from: 'proposal:a', to: 'svc:stripe-billing', family: 'call' },
      ]),
  },
  {
    id: 'edge-from-nowhere',
    why: 'an edge whose source is invented',
    run: () =>
      topology([node('proposal:a')], [
        { id: 'e1', from: 'svc:kafka-cluster', to: 'proposal:a', family: 'call' },
      ]),
  },
  {
    id: 'scan-citation-on-a-proposal',
    why: 'a proposed node wearing a scan citation it cannot have',
    run: () =>
      topology(
        [{ id: 'proposal:x', label: 'X', kind: 'service', evidenceRef: 'scan:packages/analyzer/src/scan.ts:1' }],
        [],
      ),
  },
  {
    id: 'unknown-node-kind',
    why: 'a node kind the schema does not define',
    run: () => topology([{ id: 'proposal:y', label: 'Y', kind: 'lambda-function' }], []),
  },
  {
    id: 'duplicate-node-id',
    why: 'the same id twice, which makes an edge ambiguous',
    run: () => topology([node('proposal:d'), node('proposal:d', 'D2')], []),
  },
  {
    id: 'answer-is-the-prompt',
    why: 'the model returns the repo digest it was given instead of an answer',
    run: async () => ({
      ok: !answerEchoesUntrustedBlock(`${UNTRUSTED_OPEN} {"repo":{"id":"repo"}}`),
      evidence: 'untrusted echo guard',
    }),
  },
];

/* TRUE claims about the same repository — a refusal here is a FALSE POSITIVE. */
const LEGITIMATE = [
  {
    id: 'two-proposed-services',
    why: 'an ordinary proposal joining two nodes it declares',
    run: () =>
      topology([node('proposal:a'), node('proposal:b')], [
        { id: 'e1', from: 'proposal:a', to: 'proposal:b', family: 'call' },
      ]),
  },
  {
    id: 'edge-onto-a-real-service',
    why: 'an edge onto a service the scan DID find',
    run: () =>
      topology([node('proposal:a')], [{ id: 'e1', from: 'proposal:a', to: realA, family: 'call' }]),
  },
  {
    id: 'two-real-services',
    why: 'both endpoints are scanned services',
    run: () =>
      topology([node(realA), node(realB)], [{ id: 'e1', from: realA, to: realB, family: 'call' }]),
  },
  {
    id: 'ordinary-answer',
    why: 'prose that cites a real file and carries no sentinel',
    run: async () => ({
      ok: !answerEchoesUntrustedBlock('The scanner lives in packages/analyzer/src/scan.ts.'),
      evidence: 'untrusted echo guard',
    }),
  },
];

const rows = [];
let caught = 0;
let falsePositives = 0;

console.log(`repo: ${repo}  (${graph.nodes.length} nodes, ${graph.edges.length} edges, ${services.length} services)`);
console.log('');
console.log('FABRICATED CLAIMS — the harness should refuse every one');
for (const c of FABRICATED) {
  const r = await c.run();
  const refused = r.ok === false;
  if (refused) caught += 1;
  rows.push({ group: 'fabricated', id: c.id, refused, evidence: String(r.evidence || '').slice(0, 120) });
  console.log(`  ${refused ? 'REFUSED ' : 'LET IN  '} ${c.id.padEnd(28)} ${c.why}`);
  if (refused) console.log(`             ${String(r.evidence || '').slice(0, 110)}`);
}
console.log('');
console.log('TRUE CLAIMS — a refusal here is a false positive');
for (const c of LEGITIMATE) {
  const r = await c.run();
  const refused = r.ok === false;
  if (refused) falsePositives += 1;
  rows.push({ group: 'legitimate', id: c.id, refused, evidence: String(r.evidence || '').slice(0, 120) });
  console.log(`  ${refused ? 'REFUSED*' : 'ACCEPTED'} ${c.id.padEnd(28)} ${c.why}`);
  if (refused) console.log(`             * FALSE POSITIVE: ${String(r.evidence || '').slice(0, 100)}`);
}

console.log('');
console.log(`fabrications refused : ${caught}/${FABRICATED.length}`);
console.log(`false positives      : ${falsePositives}/${LEGITIMATE.length}`);
if (jsonOut) {
  fs.writeFileSync(
    jsonOut,
    JSON.stringify({ repo, nodes: graph.nodes.length, edges: graph.edges.length, caught, total: FABRICATED.length, falsePositives, legitimate: LEGITIMATE.length, rows }, null, 1),
  );
  console.log(`wrote ${jsonOut}`);
}
process.exit(caught === FABRICATED.length && falsePositives === 0 ? 0 : 1);
