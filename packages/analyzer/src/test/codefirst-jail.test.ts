import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanRepo } from '../scan.js';

/**
 * Security LOCK (FIX 1): a scanned repo's `workspaces` field is attacker-
 * influenced. A `..`-prefixed glob resolves OUTSIDE the repo root; without a
 * containment guard those escaped dirs become `service.dir` values the scanner
 * walks + ingests, breaking the "only read within the attached repo" invariant.
 *
 * These tests build a real on-disk layout with BOTH an escaping glob
 * (`../escapee/*`) and a normal in-repo glob (`packages/*`) and assert:
 *   - the escaped sibling package is NEVER ingested (no service, no file node),
 *   - the in-repo control member IS ingested unchanged.
 */

function write(p: string, body: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

/** Build tmpRoot/{repo, escapee} and return the scanned repo dir. */
function makeJailFixture(workspaces: string[]): { repo: string; cleanup: () => void } {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-jail-'));
  const repo = path.join(tmpRoot, 'repo');

  // Root package.json declares the workspaces under test.
  write(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'host', version: '1.0.0', private: true, workspaces }, null, 2)
  );

  // In-repo control member: packages/legit (must be ingested).
  write(path.join(repo, 'packages', 'legit', 'package.json'), JSON.stringify({ name: 'legit', private: true }));
  write(path.join(repo, 'packages', 'legit', 'src', 'index.ts'), 'export const legit = 1;\n');

  // Sibling OUTSIDE the repo root: tmpRoot/escapee/pkg (must NOT be ingested).
  write(path.join(tmpRoot, 'escapee', 'pkg', 'package.json'), JSON.stringify({ name: 'escapee-pkg', private: true }));
  write(path.join(tmpRoot, 'escapee', 'pkg', 'evil.ts'), 'export const EVIL_MARKER = 1;\n');

  return { repo, cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }) };
}

test('LOCK: a `..`-prefixed workspaces glob cannot escape the repo root', async () => {
  const { repo, cleanup } = makeJailFixture(['../escapee/*', 'packages/*']);
  try {
    const graph = await scanRepo(repo, { cluster: false });

    const services = graph.nodes.filter((n) => n.kind === 'service');
    const serviceLabels = services.map((s) => s.label);

    // The in-repo control member IS mapped to a service.
    assert.ok(serviceLabels.includes('legit'), `expected in-repo member 'legit' to be a service, got ${serviceLabels}`);

    // The escaped sibling is NEVER mapped to a service.
    assert.ok(
      !serviceLabels.includes('escapee-pkg'),
      `escaped member must not become a service, got ${serviceLabels}`
    );

    // No file node comes from outside the repo root — check by relative path.
    const rootReal = fs.realpathSync(repo);
    for (const n of graph.nodes.filter((f) => f.kind === 'file')) {
      const rel = n.path ?? '';
      assert.ok(!rel.startsWith('..'), `file node ${n.id} escapes the repo root (path=${rel})`);
      assert.ok(!/escapee|evil/i.test(rel), `file node ${n.id} ingested from the escaped dir (path=${rel})`);
      // realpath containment: the on-disk file must sit inside the repo root.
      const abs = fs.realpathSync(path.join(repo, rel));
      assert.ok(
        abs === rootReal || abs.startsWith(rootReal + path.sep),
        `file node ${n.id} realpath escapes the repo root (${abs})`
      );
    }

    // The control member's source WAS ingested (proves the jail didn't over-block).
    const legitFile = graph.nodes.find(
      (n) => n.kind === 'file' && (n.path ?? '').replace(/\\/g, '/') === 'packages/legit/src/index.ts'
    );
    assert.ok(legitFile, 'in-repo member source (packages/legit/src/index.ts) must be ingested');
  } finally {
    cleanup();
  }
});

test('LOCK: a normal in-repo workspaces glob (`packages/*`) still works unchanged', async () => {
  const { repo, cleanup } = makeJailFixture(['packages/*']);
  try {
    const graph = await scanRepo(repo, { cluster: false });
    const serviceLabels = graph.nodes.filter((n) => n.kind === 'service').map((s) => s.label);
    assert.deepStrictEqual(serviceLabels, ['legit'], `expected exactly the in-repo member, got ${serviceLabels}`);
    assert.ok(
      graph.nodes.some((n) => n.kind === 'file' && (n.path ?? '').replace(/\\/g, '/') === 'packages/legit/src/index.ts'),
      'in-repo member source must be ingested'
    );
  } finally {
    cleanup();
  }
});
