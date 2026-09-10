/**
 * A MANIFEST CAN BE TRUE AND STILL NAME NONE OF THE CODE.
 *
 * Both shapes below were found by `tools/qa-loop` on real repositories, and
 * both reported SUCCESS while producing an empty graph — the failure mode
 * `CLAUDE.md` calls the worst one:
 *
 *  - H1 `spring-projects/spring-petclinic`: a docker-compose.yml that declares
 *    only prebuilt `mysql` / `postgres` images. Discovery found no buildable
 *    app service, warned "nothing to analyze", and stopped — over a complete
 *    Java application.
 *  - H3 `sqlfluff/sqlfluff`: one service whose `dockerfile:` key narrows the
 *    build context to `docker/development`, a directory holding one Dockerfile.
 *    One app service, zero files, and the repo's real source untouched at the
 *    root.
 *
 * The fixtures are the REPORTED shapes, not shapes that were convenient to
 * build (HANDOFF §7.4). Each test fails on the pre-fix engine with `files: 0`.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name: string): string => path.resolve(here, '..', '..', 'test', 'fixtures', name);

test('H1: a compose file of image-only datastores still scans the app around it', async () => {
  const graph = await scanRepo(fx('image-only-compose'), { cluster: true });

  const files = graph.nodes.filter((n) => n.kind === 'file');
  assert.ok(files.length >= 3, `expected the Java sources to be scanned, got ${files.length} files`);
  assert.ok(
    files.some((f) => (f.path ?? '').endsWith('OrderController.java')),
    `expected OrderController.java in the graph, got ${files.map((f) => f.path).join(', ')}`
  );

  // The datastores compose really does declare stay — they are not replaced.
  const datastores = graph.nodes.filter((n) => n.kind === 'datastore').map((n) => n.label);
  assert.ok(datastores.length >= 2, `expected mysql + postgres to survive, got ${datastores.join(', ')}`);

  // ...and the scan SAYS why it went looking elsewhere. Silence is the failure.
  assert.ok(
    graph.warnings.some(
      (w) => w.includes('declares no buildable app service') && w.includes('package manifests')
    ),
    `expected an honest warning naming the reason, got: ${graph.warnings.join(' | ')}`
  );
});

test('H3: a build context that holds no code falls back to the repo, out loud', async () => {
  const graph = await scanRepo(fx('narrow-build-context'), { cluster: true });

  const files = graph.nodes.filter((n) => n.kind === 'file');
  assert.ok(files.length >= 2, `expected the Python sources to be scanned, got ${files.length} files`);
  assert.ok(
    files.some((f) => (f.path ?? '').endsWith('cli.py')) &&
      files.some((f) => (f.path ?? '').endsWith('rules.py')),
    `expected src/app/*.py in the graph, got ${files.map((f) => f.path).join(', ')}`
  );

  // No service is left rooted at the Dockerfile-only directory.
  const services = graph.nodes.filter((n) => n.kind === 'service');
  assert.ok(
    !services.some((s) => typeof s.meta?.dir === 'string' && s.meta.dir.startsWith('docker/development')),
    `no service may stay rooted at docker/development: ${services.map((s) => s.meta?.dir).join(', ')}`
  );

  assert.ok(
    graph.warnings.some(
      (w) => w.includes('docker/development') && w.includes('hold no code this scanner can read')
    ),
    `expected a warning naming the empty build context, got: ${graph.warnings.join(' | ')}`
  );
});

test('a deployment-only repo keeps its declared topology and is NOT given invented services', async () => {
  // k8s-mini/plain declares api + db from prebuilt images with no source in the
  // repo. The first version of the H1/H3 fallback replaced 22 real sock-shop
  // workloads with four package manifests that are not services — fabricating
  // an architecture over a true one. This locks that door.
  const graph = await scanRepo(fx('k8s-mini/plain'), { cluster: true });
  const services = graph.nodes.filter((n) => n.kind === 'service').map((n) => n.label);
  assert.ok(services.includes('api'), `expected the declared api workload, got ${services.join(', ')}`);
  assert.strictEqual(
    graph.nodes.filter((n) => n.kind === 'file').length,
    0,
    'this fixture genuinely has no source — inventing files would be worse than reporting none'
  );
  // FIRST, because every consumer that quotes "the scanner said" quotes
  // warnings[0] — including this harness's own hard-finding line, which was
  // reporting a valueFrom note as the reason a whole repo had no files.
  assert.ok(
    graph.warnings[0]?.includes('deployment-only repo'),
    `the repo-level explanation must lead, got: ${graph.warnings.join(' | ')}`
  );
});
