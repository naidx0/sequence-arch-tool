/**
 * ROOT-CONTEXT COMPOSE + WORKSPACE PACKAGES — ONE OWNER PER TREE.
 *
 * Measured on hoppscotch (2026-08-28, Windows): compose declares services with
 * `build.context: .` plus services rooted at `packages/<x>`, and
 * pnpm-workspace declares `packages/**`. The code-first supplement
 * (`uncoveredAppRoots`) emitted its dirs with the HOST separator, so
 * `packages\hoppscotch-backend` never equalled compose's
 * `packages/hoppscotch-backend`: the cover check missed, the same package tree
 * was walked under two services, and `validateGraph` refused the whole scan on
 * duplicate `file:` ids. The user saw "The scan stopped part way" on a real
 * repository that scans fine on Linux.
 *
 * The fix is the repo's own stated invariant — POSIX at birth (`relPosix`) —
 * applied to code-first dirs, plus a separator-proof `norm` in the cover
 * check. This test builds the exact colliding shape in a temp repo and locks:
 * zero duplicate node ids, and the compose-covered package NOT re-adopted as
 * a second service.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanRepo } from '../scan.js';

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-compose-ws-'));
  const w = (rel: string, body: string): void => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
  };
  // Compose: one service building from the repo ROOT, one rooted at a package —
  // the hoppscotch shape reduced to its collision.
  w(
    'docker-compose.yml',
    [
      'services:',
      '  aio:',
      '    build:',
      '      context: .',
      '  old-backend:',
      '    build:',
      '      context: ./packages/backend',
      '',
    ].join('\n'),
  );
  w('Dockerfile', 'FROM node:22\n');
  w('pnpm-workspace.yaml', "packages:\n  - 'packages/**'\n");
  w('package.json', JSON.stringify({ name: 'root', private: true }));
  w('packages/backend/package.json', JSON.stringify({ name: 'backend', version: '1.0.0' }));
  w('packages/backend/src/index.ts', "import { helper } from './helper';\nexport const run = () => helper();\n");
  w('packages/backend/src/helper.ts', 'export const helper = () => 1;\n');
  w('packages/web/package.json', JSON.stringify({ name: 'web', version: '1.0.0' }));
  w('packages/web/src/main.ts', 'export const main = () => 2;\n');
  return dir;
}

test('root-context compose + workspaces: every file node has ONE owner, no duplicate ids', async () => {
  const repo = makeRepo();
  // Before the fix this THREW on Windows: "graph failed validation: duplicate
  // node id: file:packages/backend/src/index.ts …".
  const graph = await scanRepo(repo, { cluster: false });

  const seen = new Map<string, number>();
  for (const node of graph.nodes) seen.set(node.id, (seen.get(node.id) ?? 0) + 1);
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  assert.deepStrictEqual(dupes, [], 'no node id is emitted twice');

  // The compose service already owns packages/backend; the workspace supplement
  // must not re-adopt it as a shadow ("backend-2"-style) service.
  const services = graph.nodes.filter((n) => n.kind === 'service').map((n) => n.id);
  const backendOwners = services.filter((id) => /backend/.test(id));
  assert.strictEqual(
    backendOwners.length,
    1,
    `exactly one service owns packages/backend, got: ${backendOwners.join(', ')}`,
  );

  // And the uncovered sibling IS adopted — the supplement still does its job.
  assert.ok(
    services.some((id) => /web/.test(id)),
    `packages/web (compose does not deploy it) is mapped, got: ${services.join(', ')}`,
  );
});
