import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArchGraph } from '@sequence/schema';
import {
  agentsMdBlock,
  buildAgentMap,
  crossPair,
  mapHead,
  mapIndex,
  parseAgentMap,
  renderAgentMap,
  renderAgentMapModel,
  writeAgentMaps,
} from '../agentMap.js';
import { scanRepo } from '../scan.js';

/**
 * Lock for docs/research/overhaul-formats-v2.md §3.3 (map.md): the grammar
 * parses back (round trip), the budget holds at 1k / 4k / 16k with the
 * `omitted:` line always last, services come in PageRank order (a focus
 * first), and every edge line cites a file:line that is real evidence.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.resolve(here, '..', '..', 'test', 'fixtures', 'shopfront');

let shop: ArchGraph | null = null;
async function shopfront(): Promise<ArchGraph> {
  shop ??= await scanRepo(SHOPFRONT, { cluster: true });
  return shop;
}

const SVCS = 200;
/** A synthetic graph big enough that every budget cuts it. */
function bigGraph(): ArchGraph {
  const nodes: ArchGraph['nodes'] = [{ id: 'repo', kind: 'repo', label: 'big' }];
  const edges: ArchGraph['edges'] = [];
  for (let s = 0; s < SVCS; s++) {
    nodes.push({ id: `svc:s${s}`, kind: 'service', label: `s${s}`, parentId: 'repo', path: `svc/s${s}`, meta: { language: 'ts', framework: 'express' } });
    for (let f = 0; f < 8; f++) {
      nodes.push({ id: `file:svc/s${s}/src/f${f}.ts`, kind: 'file', label: `f${f}.ts`, parentId: `svc:s${s}`, path: `svc/s${s}/src/f${f}.ts`, meta: { pageRank: (SVCS - s) / 1000 + f / 1e5 } });
    }
  }
  nodes.push({ id: 'ds:main', kind: 'datastore', label: 'main', parentId: 'repo' });
  for (let s = 0; s < SVCS; s++) {
    for (let k = 1; k <= 6; k++) {
      const t = (s + k) % SVCS;
      edges.push({ id: `h${s}-${k}`, srcId: `file:svc/s${s}/src/f0.ts`, dstId: `file:svc/s${t}/src/f1.ts`, kind: 'http', confidence: 0.9, origin: 'deterministic', evidence: [{ file: `svc/s${s}/src/f0.ts`, line: 10 + k, snippet: 'fetch()' }], detail: { method: 'GET', pathPattern: `/r${k}/*` } });
    }
    edges.push({ id: `d${s}`, srcId: `file:svc/s${s}/src/f2.ts`, dstId: 'ds:main', kind: 'db_write', confidence: 0.8, origin: 'deterministic', evidence: [{ file: `svc/s${s}/src/f2.ts`, line: 3, snippet: 'insert' }], detail: { table: 'orders' } });
  }
  return { version: 1, scannedAt: '2026-10-05T00:00:00.000Z', repoRoot: '/big', repoName: 'big', nodes, edges, warnings: [], routes: [{ service: 'svc:s0', method: 'GET', path: '/r1/{id}', file: 'svc/s0/src/f1.ts', line: 4 }] };
}

test('the grammar round-trips: parse(render(model)) deep-equals the model', async () => {
  for (const g of [await shopfront(), bigGraph()]) {
    for (const budget of [1000, 4000, 16000]) {
      const model = buildAgentMap(g, { budget });
      const text = renderAgentMapModel(model);
      assert.deepStrictEqual(parseAgentMap(text), model, `${g.repoName} @ ${budget}`);
      assert.strictEqual(renderAgentMapModel(parseAgentMap(text)), text);
    }
  }
});

test('every budget holds, and the omitted line is always last and counts what was cut', () => {
  const g = bigGraph();
  for (const budget of [1000, 4000, 16000]) {
    const text = renderAgentMap(g, { budget });
    assert.ok(Math.ceil(text.length / 4) <= budget, `${Math.ceil(text.length / 4)} tokens > ${budget}`);
    const lines = text.trimEnd().split('\n');
    assert.match(lines.at(-1)!, /^omitted: \d+ services, \d+ edges\. Ask with neighbors\(<id>\) or path\(<a>,<b>\)\.$/);
    const m = parseAgentMap(text);
    const shown = m.entries.reduce((n, s) => n + s.edges.length, 0);
    assert.strictEqual(m.omitted.edges, m.edges - shown);
    assert.strictEqual(m.omitted.services, m.services - m.entries.length);
    assert.ok(m.omitted.services > 0, `${budget} should cut a ${SVCS}-service graph`);
  }
  /* A bigger budget never shows less. */
  const shownAt = (b: number) => parseAgentMap(renderAgentMap(g, { budget: b })).entries.length;
  assert.ok(shownAt(1000) < shownAt(4000) && shownAt(4000) < shownAt(16000));
});

test('services in PageRank order; a focus goes first, then its neighbours', () => {
  const g = bigGraph();
  const labels = parseAgentMap(renderAgentMap(g, { budget: 4000 })).entries.map((e) => e.label);
  assert.deepStrictEqual(labels.slice(0, 3), ['s0', 's1', 's2']);
  const focused = parseAgentMap(renderAgentMap(g, { budget: 4000, focus: 'file:svc/s30/src/f3.ts' })).entries.map((e) => e.label);
  assert.strictEqual(focused[0], 's30');
  /* s30's neighbours are s24..s29 (they call it) and s31..s36 (it calls them). */
  assert.deepStrictEqual(new Set(focused.slice(1, 13)), new Set(['s24', 's25', 's26', 's27', 's28', 's29', 's31', 's32', 's33', 's34', 's35', 's36']));
});

test('shopfront: every edge line is real evidence, with the arrow its kind calls for', async () => {
  const g = await shopfront();
  const text = renderAgentMap(g, { budget: 16000 });
  const m = parseAgentMap(text);
  assert.strictEqual(m.omitted.services, 0, text);
  assert.strictEqual(m.omitted.edges, 0, text);
  const cited = new Set(g.edges.flatMap((e) => e.evidence.map((x) => `${x.file}:${x.line}`)));
  const arrows = new Set<string>();
  for (const s of m.entries) {
    for (const e of s.edges) {
      assert.ok(cited.has(e.at), `${e.at} is not evidence on any edge`);
      arrows.add(`${e.arrow} ${e.what.split(' ')[0]}`);
    }
  }
  for (const want of ['-> http', '~> read', '~> write']) assert.ok(arrows.has(want), `${want} missing from ${[...arrows]}`);
  const crossing = g.edges.filter((e) => crossPair(g, e)).length;
  assert.strictEqual(m.edges, crossing);
  assert.ok(mapIndex(g).rank('svc:gateway') >= 0);
});

test('mapHead cuts at a line and never past the token count', async () => {
  const text = renderAgentMap(bigGraph(), { budget: 16000 });
  const head = mapHead(text, 1000);
  assert.ok(head.length <= 4000 && text.startsWith(head) && head.endsWith('\n'));
});

test('writeAgentMaps writes map.md (4k), 1k, 16k and the six-line AGENTS.md block', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-map-'));
  const files = writeAgentMaps(dir, await shopfront());
  assert.deepStrictEqual(files.map((f) => path.basename(f)), ['map-1k.md', 'map.md', 'map-16k.md', 'agents-block.md']);
  assert.match(fs.readFileSync(path.join(dir, '.sequence', 'map.md'), 'utf8'), /· budget 4000 ·/);
  const block = agentsMdBlock().trimEnd().split('\n');
  assert.strictEqual(block.length, 6);
  assert.ok(block.some((l) => l.includes('.sequence/map.md')) && block.some((l) => l.includes('sequence://map')));
});
