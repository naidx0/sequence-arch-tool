/**
 * In-process MCP integration tests: drive the real wired server through the
 * SDK's InMemoryTransport + Client — no stdio, no network, no AI key. This
 * proves the tool surface (list + call), that the keyless tools return REAL
 * deterministic structure from the shopfront fixture, that a manifest-less path
 * yields the friendly no-manifest message (not a crash), and that design_suggest
 * refuses to fabricate without a key.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const SHOPFRONT = path.join(REPO_ROOT, 'packages/analyzer/test/fixtures/shopfront');
const MINIMAL_SEQD = path.join(REPO_ROOT, 'packages/analyzer/test/fixtures/minimal.seqd');
const INVALID_SEQD = path.join(REPO_ROOT, 'packages/analyzer/test/fixtures/invalid.seqd');
const TICKETING_SPEC = path.join(REPO_ROOT, 'examples/ticketing.spec.json');

/** Connect an in-memory Client to a fresh wired server; returns both + cleanup. */
async function connectClient(): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** Extract the concatenated text from a callTool result's content blocks. */
function textOf(result: unknown): string {
  const content = ((result as { content?: unknown }).content ?? []) as { type: string; text?: string }[];
  return content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n');
}

test('lists every Sequence tool, and each one describes itself', async () => {
  const { client, close } = await connectClient();
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    // The count is in the LIST, not in the test name — renaming this test every time
    // a tool is added is how the name and the assertion drift apart.
    assert.deepEqual(names, [
      // What a change did to the SHAPE of the system, at the service level.
      'architecture_changed',
      'classify_repo',
      // The claim no other tool here can make: how much of the repository an
      // answer built from this scan actually saw.
      'coverage',
      'design_suggest',
      'explain_repo',
      'export_diagram',
      // The four NEGATIVES: what is here that nothing uses. Every other tool in
      // this list reports a positive.
      'find_negatives',
      // The adoption wedge (2026-08-31): the logic engine and the board,
      // callable from any editor without switching harnesses.
      'impact',
      // The ROUTE, where who_calls returns neighbours and the impact engine
      // returns closures. Both are sets, and two services can each sit in the
      // other's set with the caller still unable to say what runs in between.
      'path_between',
      'plain_tree',
      'risks',
      'scan_repo',
      'validate_diagram',
      'whiteboard',
      // v3.2 (P6): the targeted query. scan_repo returns the WHOLE graph — ~1.1 MB on
      // the Sequence monorepo — so an agent with one question had to ingest a whole
      // codebase's topology. who_calls answers it at file:line, in the low kilobytes.
      // (The "0.47 MB / 4.6 KB" this comment carried was the shopfront fixture's,
      // retracted by docs/research/v32-scale-and-gaps.md §7.)
      'who_calls',
    ]);
    for (const t of tools) assert.ok(t.description && t.description.length > 0);
  } finally {
    await close();
  }
});

test('classify_repo types the shopfront fixture as microservices (keyless)', async () => {
  const { client, close } = await connectClient();
  try {
    const res = await client.callTool({ name: 'classify_repo', arguments: { repoPath: SHOPFRONT } });
    assert.notEqual(res.isError, true);
    const payload = JSON.parse(textOf(res));
    assert.equal(payload.type, 'microservices');
    assert.ok(Array.isArray(payload.matchedSignals) && payload.matchedSignals.length >= 1);
    // Honest/inspectable: the matched signals name the real shape that drove it.
    assert.ok(payload.matchedSignals.some((s: string) => s.startsWith('services:')));
  } finally {
    await close();
  }
});

test('scan_repo returns a real ArchGraph for the shopfront fixture', async () => {
  const { client, close } = await connectClient();
  try {
    const res = await client.callTool({ name: 'scan_repo', arguments: { repoPath: SHOPFRONT } });
    assert.notEqual(res.isError, true);
    const payload = JSON.parse(textOf(res));
    assert.equal(payload.repoName, 'shopfront');
    assert.ok(payload.counts.services >= 1, 'expected real services');
    assert.ok(payload.counts.nodes >= 1);
    assert.ok(Array.isArray(payload.graph.nodes) && payload.graph.nodes.length >= 1);
    assert.ok(Array.isArray(payload.graph.edges));
  } finally {
    await close();
  }
});

test('explain_repo returns a structural (keyless) plain-English outline', async () => {
  const { client, close } = await connectClient();
  try {
    const res = await client.callTool({ name: 'explain_repo', arguments: { repoPath: SHOPFRONT } });
    assert.notEqual(res.isError, true);
    const payload = JSON.parse(textOf(res));
    assert.equal(payload.mode, 'structural');
    assert.equal(typeof payload.outline, 'string');
    assert.ok(payload.outline.length > 0, 'expected a non-empty outline');
  } finally {
    await close();
  }
});

test('plain_tree returns a structural PlainTreeResult with a real root', async () => {
  const { client, close } = await connectClient();
  try {
    const res = await client.callTool({ name: 'plain_tree', arguments: { repoPath: SHOPFRONT } });
    assert.notEqual(res.isError, true);
    const payload = JSON.parse(textOf(res));
    assert.equal(payload.mode, 'structural');
    assert.ok(payload.tree && typeof payload.tree.title === 'string');
    assert.ok(Array.isArray(payload.tree.children) && payload.tree.children.length >= 1);
    // Honesty: the root traces to the real repo source.
    assert.ok(Array.isArray(payload.tree.sourceRefs));
  } finally {
    await close();
  }
});

test('scan_repo on a manifest-less dir returns the friendly no-manifest message', async () => {
  const { client, close } = await connectClient();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-nomanifest-'));
  fs.writeFileSync(path.join(tmp, 'README.md'), '# just a readme, no manifests\n');
  try {
    const res = await client.callTool({ name: 'scan_repo', arguments: { repoPath: tmp } });
    assert.equal(res.isError, true);
    const text = textOf(res);
    assert.match(text, /no.*manifest/i);
    assert.match(text, /manifest-less code repos/i);
    assert.match(text, /empty or unrecognized/i);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    await close();
  }
});

test('design_suggest with no key returns the connect-a-key message (never fabricates)', async () => {
  const savedKey = process.env.SEQUENCE_AI_KEY;
  delete process.env.SEQUENCE_AI_KEY;
  const { client, close } = await connectClient();
  try {
    const res = await client.callTool({
      name: 'design_suggest',
      arguments: { description: 'a todo app with login and a notes database' },
    });
    assert.equal(res.isError, true);
    const text = textOf(res);
    assert.match(text, /connect an ai key/i);
    // Never leaks or fabricates: no proposed nodes came back.
    assert.doesNotMatch(text, /"proposed"/);
  } finally {
    if (savedKey !== undefined) process.env.SEQUENCE_AI_KEY = savedKey;
    await close();
  }
});

test('validate_diagram: valid fixture passes', async () => {
  const { client, close } = await connectClient();
  try {
    const res = await client.callTool({
      name: 'validate_diagram',
      arguments: { filePath: MINIMAL_SEQD },
    });
    assert.notEqual(res.isError, true);
    const payload = JSON.parse(textOf(res));
    assert.equal(payload.valid, true);
    assert.equal(payload.nodes, 2);
    assert.equal(payload.edges, 1);
    assert.equal(payload.kind, 'service-sequence');
  } finally {
    await close();
  }
});

test('validate_diagram: invalid fixture reports schema problems', async () => {
  const { client, close } = await connectClient();
  try {
    const res = await client.callTool({
      name: 'validate_diagram',
      arguments: { filePath: INVALID_SEQD },
    });
    assert.equal(res.isError, true);
    assert.match(textOf(res), /grounded\.graphId/);
  } finally {
    await close();
  }
});

test('export_diagram: graphPath seqd returns content (no disk write)', async () => {
  const { client, close } = await connectClient();
  try {
    const res = await client.callTool({
      name: 'export_diagram',
      arguments: { graphPath: TICKETING_SPEC, format: 'seqd' },
    });
    assert.notEqual(res.isError, true);
    const payload = JSON.parse(textOf(res));
    assert.equal(payload.format, 'seqd');
    assert.equal(typeof payload.content, 'string');
    const doc = JSON.parse(payload.content);
    assert.equal(doc.version, 1);
    assert.ok(Array.isArray(doc.nodes));
  } finally {
    await close();
  }
});

test('export_diagram: --out equivalent writes file', async () => {
  const { client, close } = await connectClient();
  const outPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-export-')), 'out.seqd');
  try {
    const res = await client.callTool({
      name: 'export_diagram',
      arguments: { graphPath: TICKETING_SPEC, format: 'seqd', outPath },
    });
    assert.notEqual(res.isError, true);
    const payload = JSON.parse(textOf(res));
    assert.equal(payload.wrote, path.resolve(outPath));
    assert.ok(fs.existsSync(outPath));
  } finally {
    fs.rmSync(path.dirname(outPath), { recursive: true, force: true });
    await close();
  }
});

test('export_diagram: svg and mermaid smoke', async () => {
  const { client, close } = await connectClient();
  try {
    for (const format of ['svg', 'mermaid'] as const) {
      const res = await client.callTool({
        name: 'export_diagram',
        arguments: { graphPath: TICKETING_SPEC, format },
      });
      assert.notEqual(res.isError, true);
      const payload = JSON.parse(textOf(res));
      assert.ok(payload.content.length > 0, `${format} produced output`);
      if (format === 'svg') assert.match(payload.content, /^<\?xml|<svg/);
      if (format === 'mermaid') assert.match(payload.content, /^(flowchart|sequenceDiagram)/);
    }
  } finally {
    await close();
  }
});

test('export_diagram: repoPath scans shopfront fixture', async () => {
  const { client, close } = await connectClient();
  try {
    const res = await client.callTool({
      name: 'export_diagram',
      arguments: { repoPath: SHOPFRONT, format: 'seqd' },
    });
    assert.notEqual(res.isError, true);
    const payload = JSON.parse(textOf(res));
    const doc = JSON.parse(payload.content);
    assert.ok(doc.nodes.length >= 1);
  } finally {
    await close();
  }
});

test('export_diagram: does not auto-write into repo .sequence/diagrams/', async () => {
  const { client, close } = await connectClient();
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-nodiagrams-'));
  const diagramsDir = path.join(repoRoot, '.sequence', 'diagrams');
  fs.mkdirSync(diagramsDir, { recursive: true });
  const before = fs.readdirSync(diagramsDir);
  try {
    const res = await client.callTool({
      name: 'export_diagram',
      arguments: { graphPath: TICKETING_SPEC, format: 'seqd' },
    });
    assert.notEqual(res.isError, true);
    assert.deepEqual(fs.readdirSync(diagramsDir), before);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    await close();
  }
});
