import assert from 'node:assert';
import { test } from 'node:test';
import type { ArchGraph, ArchNode, ArchEdge } from '@sequence/schema';
import { validateGraph } from '@sequence/schema';
import { archToMarkdown, markdownToArch, projectEdges } from './index.js';

function graph(
  nodes: Partial<ArchNode>[],
  edges: Partial<ArchEdge>[],
  opts?: { mode?: 'scan' | 'design'; repoName?: string }
): ArchGraph {
  return {
    version: 1,
    ...(opts?.mode ? { mode: opts.mode } : {}),
    scannedAt: opts?.mode === 'design' ? '' : '2020-01-01T00:00:00.000Z',
    repoRoot: opts?.mode === 'design' ? '' : '/tmp/x',
    repoName: opts?.repoName ?? 'demo',
    nodes: nodes as ArchNode[],
    edges: edges.map((e, i) => ({
      id: e.id ?? `e${i}`,
      srcId: e.srcId!,
      dstId: e.dstId!,
      kind: e.kind!,
      confidence: e.confidence ?? 1,
      origin: e.origin ?? 'design',
      evidence: e.evidence ?? [],
      detail: e.detail,
    })) as ArchEdge[],
    warnings: [],
  };
}

interface ComponentView {
  label: string;
  kind: string;
  tech: string;
  description: string;
}

interface FlowView {
  src: string;
  dst: string;
  kind: string;
  detail: string;
}

function extractComponents(md: string): ComponentView[] {
  const out: ComponentView[] = [];
  let inSection = false;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (line === '## Components') {
      inSection = true;
      continue;
    }
    if (line.startsWith('## ') && line !== '## Components') {
      inSection = false;
      continue;
    }
    if (!inSection) continue;
    const m = /^- \*\*(.+)\*\* `(service|datastore|topic)`(?: \((.+)\))?(?: — (.+))?$/.exec(line);
    if (m) {
      out.push({
        label: m[1],
        kind: m[2],
        tech: m[3] ?? '',
        description: m[4] ?? '',
      });
    }
  }
  return out;
}

function extractFlows(md: string): FlowView[] {
  const out: FlowView[] = [];
  let inSection = false;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (line === '## Flows') {
      inSection = true;
      continue;
    }
    if (line.startsWith('## ') && line !== '## Flows') {
      inSection = false;
      continue;
    }
    if (!inSection) continue;
    const m = /^- (.+?) → (.+?): `(http|grpc|queue|db|import)`(?:\s+(.*))?$/.exec(line);
    if (m) {
      out.push({
        src: m[1],
        dst: m[2],
        kind: m[3],
        detail: (m[4] ?? '').trim(),
      });
    }
  }
  return out;
}

const designGraph = graph(
  [
    { id: 'repo', kind: 'repo', label: 'demo' },
    {
      id: 'svc:producer',
      kind: 'service',
      label: 'Event Producer',
      parentId: 'repo',
      meta: { tech: 'Python', description: 'synthetic click stream' },
    },
    {
      id: 'topic:kafka',
      kind: 'topic',
      label: 'Kafka',
      parentId: 'repo',
      meta: { tech: 'KRaft, Docker', description: 'event bus' },
    },
    {
      id: 'svc:consumer',
      kind: 'service',
      label: 'Consumer + Aggregator',
      parentId: 'repo',
      meta: { language: 'Python', framework: 'aiokafka', description: 'counters, sliding windows' },
    },
    {
      id: 'ds:redis',
      kind: 'datastore',
      label: 'Redis',
      parentId: 'repo',
      meta: { description: 'snapshot store' },
    },
    {
      id: 'svc:api',
      kind: 'service',
      label: 'FastAPI',
      parentId: 'repo',
      meta: { tech: 'Python' },
    },
  ],
  [
    {
      srcId: 'svc:producer',
      dstId: 'topic:kafka',
      kind: 'queue_publish',
      detail: { topic: 'events.clicks' },
    },
    {
      srcId: 'svc:consumer',
      dstId: 'topic:kafka',
      kind: 'queue_consume',
      detail: { topic: 'events.clicks' },
    },
    {
      srcId: 'svc:consumer',
      dstId: 'ds:redis',
      kind: 'db_write',
      detail: { table: 'counters' },
    },
    {
      srcId: 'svc:api',
      dstId: 'svc:consumer',
      kind: 'http',
      detail: { method: 'GET', pathPattern: '/health' },
    },
  ],
  { mode: 'design', repoName: 'click-pipeline' }
);

test('round-trip lossless: hand-built design graph recovers components and flows', () => {
  const md = archToMarkdown(designGraph);
  const parsed = markdownToArch(md);
  const md2 = archToMarkdown(parsed);

  const beforeC = extractComponents(md);
  const afterC = extractComponents(md2);
  assert.deepStrictEqual(afterC, beforeC);
  assert.ok(beforeC.some((c) => c.label === 'Event Producer' && c.tech === 'Python'));
  assert.ok(beforeC.some((c) => c.label === 'Consumer + Aggregator' && c.tech === 'Python, aiokafka'));
  assert.ok(beforeC.some((c) => c.label === 'Kafka' && c.kind === 'topic'));
  assert.ok(beforeC.some((c) => c.label === 'Redis' && c.description === 'snapshot store'));

  const beforeF = extractFlows(md);
  const afterF = extractFlows(md2);
  assert.deepStrictEqual(afterF, beforeF);
  assert.ok(beforeF.some((f) => f.src === 'Event Producer' && f.dst === 'Kafka' && f.kind === 'queue'));
  assert.ok(beforeF.some((f) => f.src === 'Consumer + Aggregator' && f.dst === 'Kafka' && f.kind === 'queue'));
  assert.ok(beforeF.some((f) => f.src === 'Consumer + Aggregator' && f.dst === 'Redis' && f.kind === 'db'));
  assert.ok(beforeF.some((f) => f.src === 'FastAPI' && f.dst === 'Consumer + Aggregator' && f.kind === 'http'));
});

test('grounded projection: scan graph emits only service-level components, no file leaves', () => {
  const scanGraph = graph(
    [
      { id: 'repo', kind: 'repo', label: 'x' },
      { id: 'svc:a', kind: 'service', label: 'gateway', parentId: 'repo' },
      { id: 'file:a1', kind: 'file', label: 'index.ts', parentId: 'svc:a', path: 'gateway/index.ts' },
      { id: 'svc:api', kind: 'service', label: 'api', parentId: 'repo' },
      { id: 'file:api1', kind: 'file', label: 'routes.ts', parentId: 'svc:api', path: 'api/routes.ts' },
      { id: 'ds:pg', kind: 'datastore', label: 'postgres', parentId: 'repo' },
    ],
    [
      {
        srcId: 'file:a1',
        dstId: 'file:api1',
        kind: 'http',
        origin: 'deterministic',
        evidence: [{ file: 'gateway/index.ts', line: 1, snippet: 'fetch' }],
        detail: { method: 'GET', pathPattern: '/tickets' },
      },
      {
        srcId: 'file:api1',
        dstId: 'ds:pg',
        kind: 'db_read',
        origin: 'deterministic',
        evidence: [{ file: 'api/routes.ts', line: 2, snippet: 'query' }],
        detail: { table: 'tickets' },
      },
    ],
    { mode: 'scan', repoName: 'shopfront' }
  );

  const md = archToMarkdown(scanGraph);
  const components = extractComponents(md);
  const flows = extractFlows(md);

  assert.ok(!md.includes('index.ts'), 'file leaf must not appear');
  assert.ok(!md.includes('routes.ts'), 'file leaf must not appear');
  assert.deepStrictEqual(
    components.map((c) => c.label).sort(),
    ['api', 'gateway', 'postgres']
  );
  assert.ok(flows.some((f) => f.src === 'gateway' && f.dst === 'api' && f.kind === 'http'));
  assert.ok(flows.some((f) => f.src === 'api' && f.dst === 'postgres' && f.kind === 'db'));

  const projected = projectEdges(scanGraph);
  assert.strictEqual(flows.length, projected.length);
});

test('validateGraph: markdownToArch output passes design-mode validation', () => {
  const md = archToMarkdown(designGraph);
  const parsed = markdownToArch(md);
  const problems = validateGraph(parsed);
  assert.deepStrictEqual(problems, [], problems.join('\n'));
  assert.strictEqual(parsed.mode, 'design');
  for (const e of parsed.edges) {
    assert.strictEqual(e.origin, 'design');
    assert.deepStrictEqual(e.evidence, []);
    assert.strictEqual(e.confidence, 1);
  }
});

test('slug collisions: labels that slugify the same get distinct ids; flows resolve', () => {
  const md = `# x — Architecture

## Components
- **API** \`service\`
- **api** \`datastore\`

## Flows
- API → api: \`db\` read things
`;
  const g = markdownToArch(md);
  const ids = g.nodes.map((n) => n.id).sort();
  assert.deepStrictEqual(ids, ['api', 'api-2']);
  assert.strictEqual(g.edges[0].srcId, 'api');
  assert.strictEqual(g.edges[0].dstId, 'api-2');
  assert.deepStrictEqual(validateGraph(g), []);
});

test('tolerant parse: extra prose, blank lines, unknown headers still parse', () => {
  const md = `
Some intro prose that should be ignored.

# tolerant — Architecture

Preamble paragraph.

## Components

- **alpha** \`service\` (Go) — entry

## Unknown section
noise

## Flows

- alpha → alpha: \`http\` GET /ping

`;
  const g = markdownToArch(md);
  assert.strictEqual(g.repoName, 'tolerant');
  assert.strictEqual(g.nodes.length, 1);
  assert.strictEqual(g.nodes[0].label, 'alpha');
  assert.strictEqual(g.nodes[0].meta?.tech, 'Go');
  assert.strictEqual(g.edges.length, 1);
});

test('empty / header-only markdown parses to an empty graph', () => {
  const g1 = markdownToArch('# empty — Architecture\n');
  assert.strictEqual(g1.repoName, 'empty');
  assert.deepStrictEqual(g1.nodes, []);
  assert.deepStrictEqual(g1.edges, []);

  const g2 = markdownToArch('');
  assert.strictEqual(g2.repoName, 'architecture');
  assert.deepStrictEqual(g2.nodes, []);
});

test('honest lossy set: parsed graph has no evidence and no file leaves', () => {
  const scanGraph = graph(
    [
      { id: 'repo', kind: 'repo', label: 'x' },
      { id: 'svc:a', kind: 'service', label: 'a', parentId: 'repo' },
      { id: 'file:a1', kind: 'file', label: 'a.ts', parentId: 'svc:a' },
      { id: 'svc:b', kind: 'service', label: 'b', parentId: 'repo' },
    ],
    [
      {
        srcId: 'file:a1',
        dstId: 'svc:b',
        kind: 'http',
        origin: 'deterministic',
        confidence: 0.9,
        evidence: [{ file: 'a.ts', line: 1, snippet: 'x' }],
        detail: { method: 'GET', pathPattern: '/x' },
      },
    ],
    { mode: 'scan' }
  );

  const parsed = markdownToArch(archToMarkdown(scanGraph));
  assert.ok(parsed.nodes.every((n) => n.kind !== 'file' && n.kind !== 'module'));
  assert.ok(parsed.edges.every((e) => e.evidence.length === 0));
  assert.ok(parsed.edges.every((e) => e.origin === 'design'));
  assert.ok(!('pageRank' in (parsed.nodes[0]?.meta ?? {})));
});

test('label hygiene: embedded newline and arrow are sanitized on emit', () => {
  const g = graph(
    [
      { id: 'svc:a', kind: 'service', label: 'line\nbreak', meta: { description: 'ok' } },
      { id: 'svc:b', kind: 'service', label: 'has → arrow' },
    ],
    [{ srcId: 'svc:a', dstId: 'svc:b', kind: 'http', detail: { method: 'GET', pathPattern: '/x' } }],
    { mode: 'design' }
  );
  const md = archToMarkdown(g);
  assert.ok(!md.includes('\nbreak'), 'newline collapsed in component label');
  assert.match(md, /\*\*line break\*\*/);
  assert.ok(!md.includes('has → arrow'), 'arrow sanitized in label');
  assert.match(md, /has -> arrow/);
  const parsed = markdownToArch(md);
  assert.deepStrictEqual(validateGraph(parsed), []);
});

test('flow-only endpoint: undeclared component becomes a bare service', () => {
  const md = `# x — Architecture

## Flows
- ghost → real: \`grpc\` ping
`;
  const g = markdownToArch(md);
  assert.strictEqual(g.nodes.length, 2);
  const ghost = g.nodes.find((n) => n.label === 'ghost');
  assert.ok(ghost);
  assert.strictEqual(ghost!.kind, 'service');
});
