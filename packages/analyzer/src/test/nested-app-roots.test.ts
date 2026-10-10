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

/*
 * A WORKSPACES-ONLY package.json DOES NOT MAKE A PYTHON ROOT A JAVASCRIPT ONE —
 * owner walk 2026-09-22, "the gates" could not be drawn on ML Harness.
 *
 * ML Harness declares `"workspaces": ["web"]` at its root so npm hoists
 * node_modules above a vendored UI. Workspace mode then returned the members
 * and the ecosystem walk never ran, so the root — a `[project]` pyproject with
 * app/, tests/, scripts/gate.py and evals/ — was not a service at all. Those
 * files sat in `graph.unscanned` and the scan said one service, `web/`.
 */
type PerService = { dir: string; files: string[] };
async function scanPerService(repo: string) {
  let per: PerService[] = [];
  const g = await scanRepo(repo, {
    cluster: true,
    onServiceFacts: (ps) => {
      per = ps.map((s) => ({
        dir: s.service.dir ?? '',
        files: s.facts.map((f) => f.file.replace(/\\/g, '/')).sort(),
      }));
    },
  });
  return { g, per: per.sort((a, b) => a.dir.localeCompare(b.dir)) };
}

test('a python root whose package.json only declares workspaces scans the python side as a service', async () => {
  const repo = tree({
    'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['web'] }),
    'pyproject.toml': '[project]\nname="harness"\n',
    'web/package.json': JSON.stringify({ name: 'web' }),
    'web/src/index.ts': 'export const x = 1;\n',
    'app/__init__.py': '',
    'app/main.py': 'import os\n',
    'scripts/gate.py': 'import sys\n',
    'tests/test_x.py': 'def test_x():\n    assert True\n',
  });
  try {
    const { g, per } = await scanPerService(repo);
    assert.deepEqual(
      per.map((s) => s.dir),
      ['.', 'web'],
      `expected the python root and the web member, got ${JSON.stringify(per.map((s) => s.dir))}`,
    );
    assert.deepEqual(per[1].files, ['web/src/index.ts']);
    assert.deepEqual(per[0].files, ['app/__init__.py', 'app/main.py', 'scripts/gate.py', 'tests/test_x.py']);
    assert.ok(g.nodes.some((n) => n.id === 'file:scripts/gate.py'), 'the gate script is a file node');
    assert.deepEqual(g.unscanned ?? [], [], `nothing is left unscanned: ${JSON.stringify(g.unscanned)}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

/*
 * THE BOUND. A pyproject that only configures tools (ruff, black) is not a
 * Python project; claiming the root for it would turn every JS monorepo that
 * lints a helper script into one huge root service.
 */
test('a tooling-only pyproject at a javascript workspace root does not create a root service', async () => {
  const repo = tree({
    'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['web'] }),
    'pyproject.toml': '[tool.ruff]\nline-length = 100\n\n[tool.black]\nline-length = 100\n',
    'web/package.json': JSON.stringify({ name: 'web' }),
    'web/src/index.ts': 'export const x = 1;\n',
    'scripts/lint.py': 'import sys\n',
  });
  try {
    const { per } = await scanPerService(repo);
    assert.deepEqual(per.map((s) => s.dir), ['web'], 'tooling config is not a project: 1 service');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a pure javascript workspace root still yields exactly its members', async () => {
  const repo = tree({
    'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] }),
    'scripts/build.js': 'console.log(1);\n',
    'packages/a/package.json': JSON.stringify({ name: 'a' }),
    'packages/a/src/index.ts': 'export const a = 1;\n',
    'packages/b/package.json': JSON.stringify({ name: 'b' }),
    'packages/b/src/index.ts': 'export const b = 2;\n',
  });
  try {
    const { g, per } = await scanPerService(repo);
    assert.deepEqual(per.map((s) => s.dir), ['packages/a', 'packages/b']);
    assert.deepEqual(serviceLabels(g), ['a', 'b']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
