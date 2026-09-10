import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { scanRepo } from '../scan.js';

/**
 * A BACKEND AND A FRONTEND ARE TWO SERVICES, NOT ONE.
 *
 * `collectManifestRoots` stopped at the first manifest it found and returned:
 *
 *     if (hasManifest(dirAbs)) { found.push(...); return; }
 *
 * with a comment explaining that a repo root holding sibling app roots is
 * "handled by workspace mode earlier". Workspace mode covers a declared monorepo
 * (`pnpm-workspace.yaml`, `workspaces:`). It does NOT cover the commonest shape
 * there is: a Python or Go service at the root with a JavaScript UI in a
 * subdirectory, declared by nothing.
 *
 * MEASURED on ml-harness — a FastAPI backend (`app/`, 59 files) plus a React SPA
 * (`frontend/`, 60 files). `pyproject.toml` sits at the root, so the walk stopped
 * there and `frontend/package.json` was never read. The scan returned ONE
 * service, labelled with the backend's framework, containing the frontend.
 *
 * That is not only a naming problem. An http edge in `join.ts` needs a SECOND
 * named service to point at, so with one service the frontend→backend call is
 * unrepresentable before any detection question is asked — which is why a real
 * two-tier app produced zero http edges and zero http warnings.
 *
 * THE RULE IS ECOSYSTEM CHANGE, NOT DEPTH. Descending past every manifest would
 * turn an undeclared JS monorepo into a service per package, changing behaviour
 * nobody asked to change. A nested root is admitted only when its ecosystem
 * DIFFERS from the ancestor that already claimed it — so python-then-js splits
 * and js-then-js does not.
 */

function tree(spec: Record<string, string>): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-nested-')));
  for (const [rel, body] of Object.entries(spec)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return dir;
}

const serviceLabels = (g: { nodes: { kind: string; label: string }[] }): string[] =>
  g.nodes.filter((n) => n.kind === 'service').map((n) => n.label).sort();

test('a python root with a javascript UI beneath it is TWO services', async () => {
  const repo = tree({
    'pyproject.toml': '[project]\nname = "harness"\n',
    'app/main.py': 'from fastapi import FastAPI\napp = FastAPI()\n',
    'app/db.py': 'import sqlite3\n',
    'frontend/package.json': JSON.stringify({ name: 'ui', dependencies: { react: '^18' } }),
    'frontend/src/App.tsx': 'export function App() { return null; }\n',
  });
  try {
    const g = await scanRepo(repo, { cluster: true });
    const labels = serviceLabels(g);
    assert.equal(labels.length, 2, `expected a backend and a frontend, got ${JSON.stringify(labels)}`);
    assert.ok(
      labels.some((l) => /front|ui/i.test(l)),
      `one service must be the JS app; got ${JSON.stringify(labels)}`,
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a go root with a javascript UI beneath it is TWO services', async () => {
  const repo = tree({
    'go.mod': 'module example.com/svc\n\ngo 1.21\n',
    'main.go': 'package main\n\nfunc main() {}\n',
    'web/package.json': JSON.stringify({ name: 'web', dependencies: { react: '^18' } }),
    'web/src/index.tsx': 'export const x = 1;\n',
  });
  try {
    const g = await scanRepo(repo, { cluster: true });
    assert.equal(serviceLabels(g).length, 2, 'a Go service and a JS UI are two services');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

/*
 * THE GUARD. An undeclared JS monorepo must behave EXACTLY as it did — one root.
 * This is the assertion that stops the fix above from becoming "a service per
 * package.json", which would fragment every JS repo in existence.
 */
test('a javascript root with javascript packages beneath it stays ONE service', async () => {
  const repo = tree({
    'package.json': JSON.stringify({ name: 'root', dependencies: { react: '^18' } }),
    'src/index.ts': 'export const a = 1;\n',
    'packages/a/package.json': JSON.stringify({ name: 'a' }),
    'packages/a/src/index.ts': 'export const b = 2;\n',
    'packages/b/package.json': JSON.stringify({ name: 'b' }),
    'packages/b/src/index.ts': 'export const c = 3;\n',
  });
  try {
    const g = await scanRepo(repo, { cluster: true });
    assert.equal(
      serviceLabels(g).length,
      1,
      'same-ecosystem nesting is unchanged — only a DIFFERENT ecosystem splits',
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
