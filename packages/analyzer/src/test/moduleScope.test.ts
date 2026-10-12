/**
 * U23 LOCK — "Show main flow" dead-ended on flask and express with *"the scan
 * recorded no calls out of it"*, and the reason was the same on both: the
 * entrypoint file's entire body is MODULE-LEVEL code, and every call was
 * attributed to its enclosing function, so an entry file's calls — the repo's
 * literal first hop — were dropped on the floor.
 *
 * The shapes below are the REPORTED ones, copied from the real repos:
 *
 *   flask/src/flask/__main__.py   `from .cli import main` + a bare `main()`
 *   express/index.js              `module.exports = require('./lib/express')`
 *
 * Each fails before the fix (zero function nodes in the entry file, zero edges
 * out of it) and each is checked here for exactly what the fix must and must
 * NOT do — no node is invented for a top level whose calls resolve to nothing.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildRepoFunctionGraph } from '../functions/repoFunctionGraph.js';
import { MODULE_SCOPE_NAME, buildFunctionGraph } from '../functions/buildFunctionGraph.js';
import { clearSharedFacts } from '../parse/sharedFacts.js';
import { scanRepo } from '../scan.js';

/**
 * `FunctionNode.file` carries OS-NATIVE separators: the builder produces it with
 * `path.relative` (`functions/repoFunctionGraph.ts:135`) and normalises nothing, so on
 * Windows it reads `src\flaskish\__main__.py`. Comparing it against a forward-slashed
 * literal can only pass on POSIX.
 *
 * That is the builder's contract, not a bug, and it is NOT changed here: every consumer
 * already normalises at its own boundary — see `packages/mcp/src/graphQuery.ts:351`
 * (`n.file.replace(/\/g, '/')`) and the several `relPosix` sites in
 * `server/repoServer.ts`. The tests are a consumer and do the same.
 *
 * Applied to BOTH sides so the assertion stays honest if a literal is ever written with
 * a backslash. Nothing is loosened: the comparison is still an exact path match.
 */
const norm = (p: string): string => p.replace(/\\/g, '/');


function tmpRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-u23-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return dir;
}

test("flask's `__main__.py` shape: a module-level call is a grounded first hop", async () => {
  const dir = tmpRepo({
    'pyproject.toml': '[project]\nname = "flaskish"\nversion = "1.0"\n',
    'src/flaskish/__init__.py': '',
    'src/flaskish/__main__.py': 'from .cli import main\n\nmain()\n',
    'src/flaskish/cli.py': 'def main():\n    return run_cli()\n\n\ndef run_cli():\n    return 1\n',
  });

  clearSharedFacts();
  const graph = await buildRepoFunctionGraph(dir);

  const moduleNode = graph.nodes.find(
    (n) => norm(n.file) === norm('src/flaskish/__main__.py') && n.name === MODULE_SCOPE_NAME
  );
  assert.ok(moduleNode, '`__main__.py` must have a module-scope node — it is all module scope');
  assert.equal(moduleNode.startLine, 1, 'the module scope starts at line 1');

  const target = graph.nodes.find(
    (n) => norm(n.file) === norm('src/flaskish/cli.py') && n.name === 'main',
  );
  assert.ok(target, 'the imported `main` must be in the graph');
  const edge = graph.edges.find((e) => e.srcId === moduleNode.id && e.dstId === target.id);
  assert.ok(edge, '`main()` at module level must produce a grounded call edge into cli.py');
  assert.equal(edge.kind, 'call');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a module scope is never invented when its top-level calls resolve to nothing', async () => {
  // express's real `index.js`: one `require`, which names no function this scan
  // knows. Honest answer is still "no calls out of it" — not a manufactured hop.
  const dir = tmpRepo({
    'package.json': JSON.stringify({ name: 'expressish', version: '1.0.0', main: 'index.js' }),
    'index.js': "'use strict';\n\nmodule.exports = require('./lib/expressish');\n",
    'lib/expressish.js': 'function createApplication() {\n  return {};\n}\nmodule.exports = createApplication;\n',
  });

  clearSharedFacts();
  const graph = await buildRepoFunctionGraph(dir);
  assert.equal(
    graph.nodes.filter((n) => norm(n.file) === norm('index.js')).length,
    0,
    'a top level that resolves nothing must not gain a node'
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('module scope is Python/JS/TS only — a Go or Java top level declares, it does not run', () => {
  const goGraph = buildFunctionGraph([
    {
      file: 'main.go',
      lang: 'go',
      loc: 10,
      functions: [{ name: 'run', startLine: 4, endLine: 6 }],
      calls: [{ callee: 'run', args: [], kwargs: {}, line: 1 }],
      imports: [],
    },
  ]);
  assert.equal(
    goGraph.nodes.filter((n) => n.name === MODULE_SCOPE_NAME).length,
    0,
    'Go must not gain a module scope'
  );

  const pyGraph = buildFunctionGraph([
    {
      file: 'main.py',
      lang: 'py',
      loc: 10,
      functions: [{ name: 'run', startLine: 4, endLine: 6 }],
      calls: [{ callee: 'run', args: [], kwargs: {}, line: 9 }],
      imports: [],
    },
  ]);
  const mod = pyGraph.nodes.find((n) => n.name === MODULE_SCOPE_NAME);
  assert.ok(mod, 'Python must gain one');
  assert.deepStrictEqual([mod.startLine, mod.endLine], [1, 10], 'the module spans the whole file');
  assert.equal(pyGraph.edges.length, 1);
  assert.equal(pyGraph.edges[0].srcId, mod.id);
});

test('the module scope never swallows a call that sits inside a real function', () => {
  const g = buildFunctionGraph([
    {
      file: 'a.py',
      lang: 'py',
      loc: 20,
      functions: [
        { name: 'outer', startLine: 1, endLine: 10 },
        { name: 'helper', startLine: 12, endLine: 14 },
      ],
      calls: [{ callee: 'helper', args: [], kwargs: {}, line: 5 }],
      imports: [],
    },
  ]);
  assert.equal(
    g.nodes.filter((n) => n.name === MODULE_SCOPE_NAME).length,
    0,
    'every call was inside a function — no module scope is needed'
  );
  assert.equal(g.edges.length, 1);
  assert.ok(g.edges[0].srcId.includes('#outer@1'), 'the caller is the enclosing function, not the module');
});

test('sqlfluff shape: a compose build context with no code still yields a function graph', async () => {
  // The manifest names `docker/development`, which holds one Dockerfile. The
  // scan falls back to the repo's own package manifests; the function graph
  // used to keep walking the Dockerfile directory and return ZERO nodes.
  const dir = tmpRepo({
    'docker-compose.yml': 'services:\n  development:\n    build:\n      context: .\n      dockerfile: ./docker/development/Dockerfile\n',
    'docker/development/Dockerfile': 'FROM python:3.12\n',
    'pyproject.toml': '[project]\nname = "sqlfluffish"\nversion = "1.0"\n',
    'src/sqlfluffish/__init__.py': '',
    'src/sqlfluffish/core.py': 'def lint():\n    return parse()\n\n\ndef parse():\n    return 1\n',
  });

  clearSharedFacts();
  const scanned = await scanRepo(dir, { cluster: true });
  assert.ok(
    scanned.nodes.some((n) => n.kind === 'file'),
    'precondition: the scan finds the code the manifest missed'
  );

  const graph = await buildRepoFunctionGraph(dir, {}, scanned);
  assert.ok(
    graph.nodes.some((n) => norm(n.file) === norm('src/sqlfluffish/core.py')),
    'the function graph must map the same code the scan did, not the Dockerfile directory'
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a file reachable from two nested app services is ingested exactly once', async () => {
  const dir = tmpRepo({
    'docker-compose.yml': 'services:\n  root:\n    build: .\n',
    'package.json': JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['apps/*'] }),
    'apps/web/package.json': JSON.stringify({ name: 'web', version: '1.0.0' }),
    'apps/web/index.js': 'function helper() { return 1; }\nfunction outer() { return helper(); }\n',
  });

  clearSharedFacts();
  const graph = await buildRepoFunctionGraph(dir);
  const ids = graph.nodes.map((n) => n.id);
  assert.deepStrictEqual(
    ids,
    [...new Set(ids)],
    'no function node id may appear twice, however many services reach the file'
  );

  fs.rmSync(dir, { recursive: true, force: true });
});
