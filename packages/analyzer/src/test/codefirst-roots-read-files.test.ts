/**
 * A CODE-FIRST APP ROOT MUST ACTUALLY READ ITS FILES.
 *
 * The full-tier QA run reported, for django, spring-boot and skaffold:
 *
 *   "no docker-compose / Kubernetes / Helm manifest found — mapped 1 app
 *    root(s) from package manifests (code-first)"
 *
 * …followed by **0 files**. A mapped root that reads nothing is the shape
 * `CLAUDE.md` calls the worst failure: it reports success and shows an empty
 * picture of a real system.
 *
 * The cause turned out to be upstream of discovery (`parser-lifetime.test.ts`),
 * but the *contract* those three rows violated has no test of its own, and each
 * of them is a manifest shape nothing here covered: a `pyproject.toml`/`setup.cfg`
 * Python monolith, a `go.mod` Go module, and a Gradle-rooted Java project. This
 * locks the statement the warning makes — one app root mapped, and its parseable
 * files in the graph with real import edges between them.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import type { ArchGraph } from '@sequence/schema';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name: string): string => path.resolve(here, '..', '..', 'test', 'fixtures', name);

function filesOf(graph: ArchGraph): string[] {
  return graph.nodes.filter((n) => n.kind === 'file').map((n) => n.path ?? n.label ?? '');
}

/** Every one of these rows said "mapped N app root(s) … (code-first)" and then
 * produced nothing. The warning and the file list have to agree. */
function assertCodeFirstAndRead(graph: ArchGraph, expected: string[]): void {
  const mapped = graph.warnings.find((w) => w.includes('(code-first)'));
  assert.ok(mapped, `expected the code-first warning, got: ${graph.warnings.join(' | ')}`);
  const files = filesOf(graph);
  assert.ok(
    files.length > 0,
    `"${mapped}" — but the graph has ZERO files. A mapped root that reads nothing is a false success.`,
  );
  for (const want of expected) {
    assert.ok(
      files.some((f) => f.endsWith(want)),
      `expected ${want} among the read files, got: ${files.join(', ')}`,
    );
  }
}

test('a pyproject/setup.cfg-rooted Python repo reads its sources', async () => {
  const graph = await scanRepo(fx('pyproject-root'), { cluster: true });
  assertCodeFirstAndRead(graph, ['src/reporting/cli.py', 'src/reporting/render.py']);
});

test('a go.mod-rooted Go module reads its sources', async () => {
  const graph = await scanRepo(fx('gomod-root'), { cluster: true });
  assertCodeFirstAndRead(graph, ['main.go', 'internal/store/store.go']);
});

test('a Gradle-rooted Java project reads its sources', async () => {
  const graph = await scanRepo(fx('gradle-root'), { cluster: true });
  assertCodeFirstAndRead(graph, ['InvoiceService.java', 'InvoiceRepository.java']);
});
