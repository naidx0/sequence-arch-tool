import assert from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverKubernetes } from '../discovery/kubernetes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAIN = path.resolve(here, '..', '..', 'test', 'fixtures', 'k8s-mini', 'plain');
const HELM = path.resolve(here, '..', '..', 'test', 'fixtures', 'k8s-mini', 'helm');

test('plain Kubernetes manifests: workloads, roles, configmap-resolved env, addr wire', () => {
  const d = discoverKubernetes(PLAIN);
  assert.ok(d, 'expected a Discovery for the plain k8s-mini fixture');
  assert.strictEqual(d!.manifestKind, 'kubernetes');

  const names = d!.services.map((s) => s.name).sort();
  assert.deepStrictEqual(names, ['api', 'db']);

  const api = d!.services.find((s) => s.name === 'api')!;
  const db = d!.services.find((s) => s.name === 'db')!;
  assert.strictEqual(api.role, 'app');
  assert.strictEqual(db.role, 'datastore', 'postgres image should classify as a datastore');
  assert.strictEqual(db.tech, 'postgres');

  // configMapKeyRef resolved against the collected ConfigMap
  assert.strictEqual(api.env.FEATURE_FLAG, 'on');
  // literal env value present as-is
  assert.strictEqual(api.env.DB_ADDR, 'db:5432');
  // unsupported valueFrom (secretKeyRef) is skipped, not crashed on
  assert.strictEqual(api.env.SECRET_TOKEN, undefined);
  assert.ok(
    d!.warnings.some((w) => /SECRET_TOKEN/.test(w) && /valueFrom/.test(w)),
    'expected a warning about the unsupported secretKeyRef'
  );

  const wire = d!.wires.find((w) => w.service === 'api' && w.targetService === 'db');
  assert.ok(wire, 'expected an api -> db wire from DB_ADDR');
  assert.strictEqual(wire!.kind, 'addr');
  assert.strictEqual(wire!.envKey, 'DB_ADDR');
  assert.ok(wire!.sourceFile?.endsWith('api.yaml'), `expected sourceFile to point at api.yaml, got ${wire!.sourceFile}`);
  assert.ok(typeof wire!.composeLine === 'number' && wire!.composeLine! > 0);
});

test('Helm chart: metadata.name and `| default` env resolve against values.yaml', () => {
  const d = discoverKubernetes(HELM);
  assert.ok(d, 'expected a Discovery for the helm k8s-mini fixture');
  assert.strictEqual(d!.manifestKind, 'helm');

  const names = d!.services.map((s) => s.name).sort();
  assert.deepStrictEqual(names, ['api', 'db'], 'workload names should render from .Values, not stay templated');

  const api = d!.services.find((s) => s.name === 'api')!;
  const db = d!.services.find((s) => s.name === 'db')!;
  assert.strictEqual(db.role, 'datastore');

  // `.Values.api.dbAddr` is absent from values.yaml, so the `| default "db:5432"`
  // fallback should be used, not a literal hole.
  assert.strictEqual(api.env.DB_ADDR, 'db:5432');

  // `| quote` is a no-op on the already-resolved raw string (no YAML
  // re-quoting needed — we substitute straight into text).
  assert.strictEqual(api.env.LOG_LEVEL, 'debug');

  // `| default "x" | quote` — default fires first (region unset in
  // values.yaml), then quote is a no-op on the resulting literal.
  assert.strictEqual(api.env.REGION, 'us-east-1');

  const wire = d!.wires.find((w) => w.service === 'api' && w.targetService === 'db');
  assert.ok(wire, 'expected an api -> db wire resolved from the Helm-default env value');
  assert.strictEqual(wire!.kind, 'addr');

  // if/else on serviceAccountName must not survive as duplicate mapping keys
  for (const w of d!.warnings) {
    assert.ok(!/YAML parse error/.test(w), `unexpected YAML parse failure: ${w}`);
  }
});
