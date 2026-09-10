import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo, NoManifestsError } from '../scan.js';
import { projectToServiceLevel } from '../score.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, '..', '..', 'test', 'fixtures');
const fx = (name: string): string => path.join(FIXTURES, name);

function svc(graph: Awaited<ReturnType<typeof scanRepo>>) {
  return graph.nodes.filter((n) => n.kind === 'service');
}

test('manifest-less SPA: scans into a real graph, no NoManifestsError, react detected', async () => {
  const graph = await scanRepo(fx('spa-dashboard'));

  // a repo node + exactly one service (single-package repo ⇒ one service)
  const repo = graph.nodes.find((n) => n.kind === 'repo');
  assert.ok(repo, 'missing repo node');
  const services = svc(graph);
  assert.strictEqual(services.length, 1, 'expected exactly one service');
  assert.strictEqual(services[0].label, 'spa-dashboard');

  // enriched framework signals
  assert.strictEqual(services[0].meta?.framework, 'react');
  assert.ok(
    Array.isArray(services[0].meta?.frameworks) && (services[0].meta!.frameworks as string[]).includes('react'),
    'meta.frameworks should include react'
  );
  assert.ok(
    Array.isArray(services[0].meta?.signals) && (services[0].meta!.signals as string[]).includes('frontend'),
    'meta.signals should include frontend'
  );

  // real file tree — the 4 source files are present as file nodes
  const files = graph.nodes.filter((n) => n.kind === 'file');
  assert.strictEqual(files.length, 4, `expected 4 file nodes, got ${files.length}`);

  // real import edges (main->App, App->Header, App->client)
  const imports = graph.edges.filter((e) => e.kind === 'import');
  assert.ok(imports.length >= 3, `expected >=3 import edges, got ${imports.length}`);
  for (const e of imports) assert.ok(e.evidence.length > 0, `import edge ${e.id} missing evidence`);

  // honesty: a pure client-side SPA has NO fabricated interaction edges
  const interactions = graph.edges.filter((e) => e.kind !== 'import');
  assert.strictEqual(interactions.length, 0, `SPA must not fabricate interaction edges: ${interactions.map((e) => e.id)}`);
});

test('manifest-less React-Native mobile app: scans, framework react-native + mobile signal', async () => {
  const graph = await scanRepo(fx('mobile-rn'));
  const services = svc(graph);
  assert.strictEqual(services.length, 1);
  assert.strictEqual(services[0].meta?.framework, 'react-native');
  const signals = services[0].meta?.signals as string[];
  assert.ok(signals.includes('mobile'), `expected mobile signal, got ${signals}`);
  // real file tree + import edges
  assert.ok(graph.nodes.some((n) => n.kind === 'file'), 'expected file nodes');
  assert.ok(graph.edges.some((e) => e.kind === 'import'), 'expected import edges');
});

test('manifest-less Flutter app (pubspec + Dart): scans, framework flutter + mobile signal', async () => {
  const graph = await scanRepo(fx('mobile-flutter'));
  const services = svc(graph);
  assert.strictEqual(services.length, 1);
  assert.strictEqual(services[0].meta?.framework, 'flutter');
  assert.ok((services[0].meta?.signals as string[]).includes('mobile'));
});

test('manifest-less CLI (package.json bin): scans, framework cli + cli signal', async () => {
  const graph = await scanRepo(fx('cli-tool'));
  const services = svc(graph);
  assert.strictEqual(services.length, 1);
  assert.strictEqual(services[0].meta?.framework, 'cli');
  assert.ok((services[0].meta?.signals as string[]).includes('cli'));
});

// ---- the byte-identical LOCK: a manifest repo never touches the code-first path ----
test('LOCK: manifest repo (shopfront) is unchanged — code-first path never fires', async () => {
  const graph = await scanRepo(fx('shopfront'));

  // 1. The 15 reference service-level edges are exactly as before.
  const predicted = projectToServiceLevel(graph);
  const expected = [
    'gateway -> orders [http]',
    'gateway -> payments [http]',
    'orders -> payments [http]',
    'orders -> inventory [grpc]',
    'orders -> topic:order.created [queue_publish]',
    'notifications -> topic:order.created [queue_consume]',
    'orders -> postgres [db_access]',
    'payments -> postgres [db_access]',
    'gateway -> shipping [http]',
    'shipping -> postgres [db_access]',
    'shipping -> topic:order.created [queue_consume]',
    'edge -> gateway [http]',
    'gateway -> invoices [http]',
    'invoices -> payments [http]',
    'invoices -> postgres [db_access]',
  ];
  for (const e of expected) assert.ok(predicted.has(e), `missing expected edge: ${e}`);
  assert.strictEqual(predicted.size, expected.length, 'unexpected extra service-level edges');

  // 2. The code-first enrichment fields NEVER leak onto a manifest repo's nodes.
  for (const n of graph.nodes) {
    assert.ok(!('frameworks' in (n.meta ?? {})), `manifest node ${n.id} must not carry meta.frameworks`);
    assert.ok(!('signals' in (n.meta ?? {})), `manifest node ${n.id} must not carry meta.signals`);
  }

  // 3. Manifest-derived framework labels are byte-identical (express/fastapi/…
  //    still derived exactly as before — the shared derivation is untouched).
  const frameworks = new Map(
    graph.nodes.filter((n) => n.kind === 'service').map((n) => [n.label, n.meta?.framework])
  );
  assert.strictEqual(frameworks.get('gateway'), 'express');
});

test('LOCK: manifest repo (plainapp) is unchanged — no code-first leakage', async () => {
  const graph = await scanRepo(fx('plainapp'));
  for (const n of graph.nodes) {
    assert.ok(!('frameworks' in (n.meta ?? {})), `plainapp node ${n.id} must not carry meta.frameworks`);
    assert.ok(!('signals' in (n.meta ?? {})), `plainapp node ${n.id} must not carry meta.signals`);
  }
});

test('truly empty dir (no manifest, no source) still throws NoManifestsError', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-empty-'));
  fs.writeFileSync(path.join(tmp, 'NOTES.txt'), 'just a note, nothing to scan\n');
  try {
    await assert.rejects(
      () => scanRepo(tmp),
      (e: unknown) => {
        assert.ok(e instanceof NoManifestsError, `expected NoManifestsError, got ${e}`);
        assert.strictEqual((e as NoManifestsError).code, 'no-manifests');
        return true;
      }
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
