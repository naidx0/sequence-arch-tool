import assert from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover } from '../discovery/compose.js';
import { scanRepo } from '../scan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '..', '..', 'test', 'fixtures', 'dockerfile-env-mini');

// Two services build from Dockerfiles that both set `ENV REDIS_URL=...`:
//   - svc-a: no compose `environment:` block at all — the Dockerfile's
//     `ENV REDIS_URL=redis://cache` is the only source, and should be merged
//     into svc-a's env at the Dockerfile's own file:line.
//   - svc-b: compose sets `environment: REDIS_URL: redis://cache`, which must
//     win over its Dockerfile's `ENV REDIS_URL=redis://legacy-cache` default —
//     compose env is always highest precedence, regardless of the service's
//     own source language (v3: Dockerfile ENV is a first-class,
//     language-independent manifest source, no longer scoped to nginx-conf
//     services).
test('discover(): Dockerfile ENV merges at lowest precedence, with Dockerfile sourceFile/line evidence', () => {
  const d = discover(FIXTURE);
  assert.strictEqual(d.manifestKind, 'compose');

  const wireFor = (service: string) =>
    d.wires.find((w) => w.service === service && w.envKey === 'REDIS_URL');

  // svc-a: only the Dockerfile declares REDIS_URL — compose never overrides.
  const a = wireFor('svc-a');
  assert.ok(a, 'expected a REDIS_URL wire for svc-a');
  assert.strictEqual(a!.targetService, 'cache');
  assert.strictEqual(a!.kind, 'broker');
  assert.ok(
    a!.sourceFile?.endsWith(path.join('svc-a', 'Dockerfile')),
    `expected svc-a's wire sourceFile to point at its Dockerfile, got ${a!.sourceFile}`
  );
  assert.strictEqual(a!.composeLine, 2, 'ENV REDIS_URL=... is the second line of svc-a/Dockerfile');

  // svc-b: compose's `environment:` block sets REDIS_URL too — it must win
  // over the Dockerfile's conflicting `ENV REDIS_URL=redis://legacy-cache`
  // default, and the wire's evidence should point at the compose file, not
  // the Dockerfile.
  const b = wireFor('svc-b');
  assert.ok(b, 'expected a REDIS_URL wire for svc-b');
  assert.strictEqual(b!.targetService, 'cache', 'compose env must win over the Dockerfile default');
  assert.strictEqual(b!.sourceFile, undefined, 'compose-sourced wire should not carry a Dockerfile sourceFile');
  assert.ok(typeof b!.composeLine === 'number' && b!.composeLine! > 0);
});

test('scan(): manifest db_access edge cites Dockerfile ENV evidence when no code locates the connection', async () => {
  const graph = await scanRepo(FIXTURE);

  const edgeBetween = (src: string, dst: string) =>
    graph.edges.find(
      (e) => e.kind === 'db_access' && e.srcId === `svc:${src}` && e.dstId === `ds:${dst}`
    );

  // svc-a has no source code at all — the only way to see its connection to
  // `cache` is the Dockerfile ENV default, so this must be a manifest-only
  // db_access edge whose evidence names the Dockerfile.
  const aEdge = edgeBetween('svc-a', 'cache');
  assert.ok(aEdge, 'expected a svc-a -> cache db_access edge');
  assert.strictEqual(aEdge!.confidence, 0.7);
  assert.strictEqual(aEdge!.evidence.length, 1);
  assert.ok(
    aEdge!.evidence[0].file.endsWith(path.join('svc-a', 'Dockerfile')),
    `expected evidence file to be svc-a's Dockerfile, got ${aEdge!.evidence[0].file}`
  );
  assert.strictEqual(aEdge!.evidence[0].line, 2);
  assert.ok(
    /Dockerfile ENV/.test(aEdge!.evidence[0].note ?? ''),
    `expected evidence note to name the Dockerfile as the source, got: ${aEdge!.evidence[0].note}`
  );

  // svc-b's edge is also manifest-only (no code either), but its evidence
  // must point at the compose file (compose won precedence), not the
  // Dockerfile — and it must never wire to `legacy-cache`, the Dockerfile's
  // shadowed default.
  const bEdge = edgeBetween('svc-b', 'cache');
  assert.ok(bEdge, 'expected a svc-b -> cache db_access edge sourced from compose env');
  assert.ok(
    bEdge!.evidence[0].file.endsWith('docker-compose.yml'),
    `expected evidence file to be the compose file, got ${bEdge!.evidence[0].file}`
  );
  assert.ok(
    !/Dockerfile/.test(bEdge!.evidence[0].note ?? ''),
    `svc-b's edge should not cite the Dockerfile as its source: ${bEdge!.evidence[0].note}`
  );
  assert.ok(!edgeBetween('svc-b', 'legacy-cache'), 'compose env must override the Dockerfile default entirely');
  assert.ok(!edgeBetween('svc-a', 'legacy-cache'));
});
