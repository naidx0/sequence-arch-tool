/**
 * The architecture map in the agent's context (server/askAgentMap.ts).
 *
 * Locks: the prompt the provider receives carries the map section when the
 * setting is on and not when it is off; the section stays within the 4k
 * budget; a repo with no map.md falls back to no section; and the token count
 * GET /api/agent-settings reports equals the size of the section actually sent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArchGraph } from '@sequence/schema';
import { buildDigest } from '../explain/explain.js';
import { runAskPipeline, type AskPipelineInput } from '../server/askPipeline.js';
import {
  AGENT_MAP_HEADER,
  agentMapLinesFor,
  agentMapSection,
  readAgentSettings,
  tokensOfLines,
  writeAgentSettings,
} from '../server/askAgentMap.js';
import { createRepoServer } from '../server/repoServer.js';
import { renderAgentMap, writeAgentMaps } from '../agentMap.js';
import { scanRepo } from '../scan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.resolve(here, '..', '..', 'test', 'fixtures', 'shopfront');

function tmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function shopCopy(): string {
  const dir = tmp('ask-agent-map-');
  fs.cpSync(SHOPFRONT, dir, { recursive: true, filter: (p) => !/(^|[\\/])\.sequence([\\/]|$)/.test(path.relative(SHOPFRONT, p)) });
  return dir;
}

/** A graph big enough that its map.md fills the 4k budget. */
function bigGraph(): ArchGraph {
  const nodes: ArchGraph['nodes'] = [{ id: 'repo', kind: 'repo', label: 'big' }];
  const edges: ArchGraph['edges'] = [];
  const N = 200;
  for (let s = 0; s < N; s++) {
    nodes.push({ id: `svc:s${s}`, kind: 'service', label: `s${s}`, parentId: 'repo', path: `svc/s${s}`, meta: { language: 'ts', framework: 'express' } });
    nodes.push({ id: `file:svc/s${s}/a.ts`, kind: 'file', label: 'a.ts', parentId: `svc:s${s}`, path: `svc/s${s}/a.ts`, meta: { pageRank: (N - s) / 1000 } });
  }
  for (let s = 0; s < N; s++) {
    for (let k = 1; k <= 4; k++) {
      edges.push({ id: `h${s}-${k}`, srcId: `file:svc/s${s}/a.ts`, dstId: `file:svc/s${(s + k) % N}/a.ts`, kind: 'http', confidence: 0.9, origin: 'deterministic', evidence: [{ file: `svc/s${s}/a.ts`, line: k, snippet: 'x' }] });
    }
  }
  return { version: 1, scannedAt: '2026-10-06T00:00:00.000Z', repoRoot: '/big', repoName: 'big', nodes, edges, warnings: [] };
}

async function promptFor(graph: ArchGraph, agentMapLines: readonly string[] | undefined): Promise<string> {
  let sent = '';
  const input: AskPipelineInput = {
    question: 'which service writes the orders table?',
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: undefined,
    designMode: false,
    askMode: 'implementation',
    graph,
    digest: buildDigest(graph),
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: () => null,
    repoRoot: null,
    ...(agentMapLines ? { agentMapLines } : {}),
    callProvider: async (_cfg, prompt) => {
      if (!sent) sent = prompt;
      return { text: 'orders writes it.' };
    },
  };
  await runAskPipeline(input);
  return sent;
}

test('on by default: the prompt carries the map section; off: it does not', async () => {
  const repo = shopCopy();
  const graph = await scanRepo(repo, { cluster: true });
  writeAgentMaps(repo, graph);
  const store = tmp('ask-agent-map-store-');
  assert.equal(readAgentSettings(store).includeArchitectureMap, true, 'default is on');

  const on = agentMapLinesFor({ storeDir: store, repoRoot: repo, designMode: false });
  assert.equal(on[0], AGENT_MAP_HEADER);
  const withMap = await promptFor(graph, on);
  assert.ok(withMap.includes(on.join('\n')), 'the whole section reaches the provider, verbatim');
  assert.ok(withMap.includes(`# map ${path.basename(repo)} · `));

  writeAgentSettings(store, { includeArchitectureMap: false });
  const off = agentMapLinesFor({ storeDir: store, repoRoot: repo, designMode: false });
  assert.deepEqual(off, []);
  const without = await promptFor(graph, off);
  assert.ok(!without.includes(AGENT_MAP_HEADER) && !without.includes('# map '), 'nothing of the map when off');

  /* Design mode never carries it, whatever the setting. */
  writeAgentSettings(store, { includeArchitectureMap: true });
  assert.deepEqual(agentMapLinesFor({ storeDir: store, repoRoot: repo, designMode: true }), []);
});

test('the section stays within the 4k budget on a map that fills it', () => {
  const repo = tmp('ask-agent-map-big-');
  const g = bigGraph();
  writeAgentMaps(repo, g);
  assert.ok(Math.ceil(renderAgentMap(g, { budget: 4000 }).length / 4) > 3500, 'the specimen really fills the budget');
  const section = agentMapSection(repo)!;
  assert.ok(section.tokens <= 4000, `${section.tokens} tokens`);
  assert.equal(section.tokens, tokensOfLines(section.lines));
});

test('a repo with no map.md falls back to no section, and the ask still runs', async () => {
  const repo = shopCopy();
  const store = tmp('ask-agent-map-store-');
  assert.equal(agentMapSection(repo), null);
  assert.deepEqual(agentMapLinesFor({ storeDir: store, repoRoot: repo, designMode: false }), []);
  assert.deepEqual(agentMapLinesFor({ storeDir: store, repoRoot: null, designMode: false }), []);
  const prompt = await promptFor(await scanRepo(repo, {}), []);
  assert.ok(prompt.length > 0 && !prompt.includes(AGENT_MAP_HEADER));
});

test('the token count the settings pane shows is the size of the section sent', async () => {
  const repo = shopCopy();
  const store = tmp('ask-agent-map-cfg-');
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir: store });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    const got = (await (await fetch(`${base}/api/agent-settings`)).json()) as { includeArchitectureMap: boolean; map: { tokens: number } | null };
    assert.equal(got.includeArchitectureMap, true);
    const sent = agentMapLinesFor({ storeDir: store, repoRoot: repo, designMode: false });
    assert.ok(sent.length > 1, 'attach wrote map.md');
    assert.equal(got.map?.tokens, Math.ceil(sent.join('\n').length / 4));

    const put = await fetch(`${base}/api/agent-settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ includeArchitectureMap: false }) });
    assert.equal(put.status, 200);
    assert.equal(((await put.json()) as { includeArchitectureMap: boolean }).includeArchitectureMap, false);
    assert.equal(readAgentSettings(store).includeArchitectureMap, false);
    const bad = await fetch(`${base}/api/agent-settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"includeArchitectureMap":"yes"}' });
    assert.equal(bad.status, 400);
  } finally {
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }
});
