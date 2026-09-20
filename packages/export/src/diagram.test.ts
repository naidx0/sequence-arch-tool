import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { ArchGraph } from '@sequence/schema';
import { graphToSequenceModel, macOsTheme } from './diagramModel.js';
import { renderSequenceSvg } from './renderSvg.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TICKETING = path.resolve(here, '..', '..', '..', 'examples', 'ticketing.spec.json');

function loadTicketing(): ArchGraph {
  return JSON.parse(fs.readFileSync(TICKETING, 'utf8')) as ArchGraph;
}

test('graphToSequenceModel: ticketing fixture has entry-point services first', () => {
  const model = graphToSequenceModel(loadTicketing());
  // gateway + worker are both entry points (no inbound http); redis has no lifted edges.
  assert.deepStrictEqual(
    model.participants.map((p) => p.label),
    ['gateway', 'worker', 'api', 'postgres', 'topic:ticket.created']
  );
  assert.ok(model.messages.some((m) => m.family === 'http' && m.from === 'gateway'));
  assert.ok(model.messages.some((m) => m.family === 'db_access'));
});

test('renderSequenceSvg: structural locks on ticketing fixture', () => {
  const svg = renderSequenceSvg(graphToSequenceModel(loadTicketing()), macOsTheme());
  assert.match(svg, /viewBox="/);
  assert.match(svg, />gateway</);
  assert.match(svg, />api</);
  assert.match(svg, /stroke="#4b6e9e"/);
  assert.match(svg, /stroke="#3f7d5a"/);
  assert.match(svg, /fill="#191919"/);
  assert.match(svg, /font-weight="600"/);
  assert.doesNotMatch(svg, /<script/i);
  assert.doesNotMatch(svg, /&lt;script/i);
});

test('renderSequenceSvg: deterministic byte match on a small fixture', () => {
  const model = graphToSequenceModel({
    version: 1,
    mode: 'design',
    scannedAt: '',
    repoRoot: '',
    repoName: 'x',
    nodes: [
      { id: 'repo', kind: 'repo', label: 'x' },
      { id: 'svc:a', kind: 'service', label: 'a', parentId: 'repo' },
      { id: 'svc:b', kind: 'service', label: 'b', parentId: 'repo' },
    ],
    edges: [
      {
        id: 'e1',
        srcId: 'svc:a',
        dstId: 'svc:b',
        kind: 'http',
        confidence: 1,
        origin: 'design',
        evidence: [],
        detail: { method: 'GET', pathPattern: '/x' },
      },
    ],
    warnings: [],
  });
  const a = renderSequenceSvg(model, macOsTheme());
  const b = renderSequenceSvg(model, macOsTheme());
  assert.strictEqual(a, b);
  assert.match(a, /GET \/x/);
});

test('renderSequenceSvg: escapes user-controlled labels', () => {
  const svg = renderSequenceSvg(
    {
      participants: [{ id: 'a', label: '<bad&"x">', kind: 'service' }],
      messages: [{ from: 'a', to: 'a', label: '<script>alert(1)</script>', family: 'http' }],
    },
    macOsTheme()
  );
  assert.doesNotMatch(svg, /<script/i);
  assert.match(svg, /&lt;bad&amp;&quot;x&quot;&gt;/);
  assert.match(svg, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('renderSequenceSvg: animate adds journey dot on last message', () => {
  const model = graphToSequenceModel(loadTicketing());
  const svg = renderSequenceSvg(model, macOsTheme(), { animate: true });
  assert.match(svg, /<animateMotion/);
  assert.match(svg, /journey-path-/);
});
