/**
 * H2 — ONE UNREADABLE MANIFEST MUST COST ONE MANIFEST.
 *
 * Found by `tools/qa-loop` on `microservices-demo` (sock-shop): the scan's
 * first warning was a YAML parse error and the summary read "22 services,
 * 0 files". The parse error itself was already isolated per document, but the
 * directory it came from was a HELM CHART nested inside the plain-manifest
 * directory (`deploy/kubernetes/helm-chart/templates`), walked and parsed as if
 * it were plain YAML — 21 templates, 21 parse errors, and every warning that
 * mattered pushed out of sight.
 *
 * The fixture is that shape at three files' scale: two good plain manifests,
 * one unparseable file sitting among them, and a nested chart whose template is
 * not valid YAML. Both rules below fail on the pre-fix engine.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverKubernetes } from '../discovery/kubernetes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name: string): string => path.resolve(here, '..', '..', 'test', 'fixtures', name);

test('an unparseable manifest is skipped by NAME, and the rest of the tree still loads', () => {
  const d = discoverKubernetes(fx('k8s-nested-helm'));
  assert.ok(d, 'expected kubernetes discovery to fire');

  const names = d.services.map((s) => s.name).sort();
  // db.yaml sorts AFTER broken.yaml: its presence is the proof the walk carried
  // on past the bad file rather than abandoning the tree.
  assert.deepStrictEqual(names, ['api', 'db'], `expected api + db, got ${names.join(', ')}`);

  const named = d.warnings.filter((w) => w.includes('broken.yaml'));
  assert.strictEqual(named.length, 1, `the skipped file must be named exactly once: ${d.warnings.join(' | ')}`);
  assert.ok(named[0].includes('skipped'), `the warning must say it was skipped: ${named[0]}`);
});

test('a Helm chart nested in a plain-manifest directory is not read as plain YAML', () => {
  const d = discoverKubernetes(fx('k8s-nested-helm'));
  assert.ok(d);

  const fromChart = d.warnings.filter((w) => w.includes('helm-chart/templates'));
  assert.strictEqual(
    fromChart.length,
    0,
    `no template inside the chart may be parsed as plain YAML: ${fromChart.join(' | ')}`
  );
  assert.ok(
    d.warnings.some((w) => w.includes('helm-chart') && w.includes('Helm chart nested')),
    `the skipped chart must name itself once: ${d.warnings.join(' | ')}`
  );
});
