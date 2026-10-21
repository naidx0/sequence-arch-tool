import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cutGraphWire, releaseGraphWire } from '../scan/graphWire.js';

/** perf P6-2: a scan gives its memory back. The worker keeps no text copy of the graph once it is on the wire. */

test('the wire texts are copied by the post, then released: the frame no longer holds the graph as text', () => {
  const graph = { nodes: Array.from({ length: 2000 }, (_, i) => ({ id: `n${i}`, label: 'x'.repeat(40) })), edges: [], gone: undefined };
  const wire = cutGraphWire(graph, () => ({ detail: 'y'.repeat(1000) }));
  const bytes = wire.parts.reduce((n, [, s]) => n + s.length, 0) + wire.detail.length;
  assert.ok(bytes > 100_000, `positive control: the wire holds the graph as text (${bytes} chars)`);
  assert.deepEqual(wire.parts.map(([k]) => k), ['nodes', 'edges']);
  const posted = structuredClone({ parts: wire.parts, detail: wire.detail }); // what postMessage does, at the call
  releaseGraphWire(wire);
  assert.equal(wire.parts.length, 0);
  assert.equal(wire.detail, '');
  assert.equal(posted.parts.length, 2, 'the message already holds its own copy');
  assert.equal(JSON.parse(posted.parts[0]![1]).length, 2000);
});

test('the scan worker releases the wire right after it posts the graph, before the function graph is built', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../../src/scan/scanWorker.ts', import.meta.url)), 'utf8');
  const post = src.indexOf("post({ type: 'graph'");
  const release = src.indexOf('releaseGraphWire(wire)');
  const functions = src.indexOf('buildRepoFunctionGraphCached(wd.root');
  assert.ok(post > 0 && release > post && functions > release, `post ${post} < release ${release} < functions ${functions}`);
});
