import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { ArchGraph, FunctionGraph } from '@sequence/schema';
import { scanRepoCached, buildRepoFunctionGraph } from '@sequence/analyzer';
import {
  DEFAULT_MAX_HITS_PER_DIRECTION,
  queryNeighbours,
  renderAnswer,
} from '../graphQuery.js';
import { graphQueryShape } from '../index.js';

/**
 * `who_calls` against THIS repository — not a fixture.
 *
 * Every previous claim about this tool was measured on
 * `packages/analyzer/test/fixtures/shopfront` (43 files, one import each) and then
 * written up as though it described the monorepo. `docs/research/v32-scale-and-gaps.md`
 * retracted the lot: the "4.6 KB instead of 470 KB" demo, the "0.47 MB / 1326 nodes"
 * figure, and the `who_calls orders` transcript were all a different repo's numbers.
 *
 * So these tests run on the real corpus, and every expectation is DERIVED from the
 * live graph rather than pinned to a literal — a monorepo gains a file most weeks,
 * and a test that pins 1318 is a test that will be edited into agreement rather than
 * believed.
 *
 * Each invariant below was measured FALSE on this repo before the fix it locks:
 *
 *   1. A question about the most-imported `store.ts` is answered about the
 *      most-imported `store.ts`. It resolved to `packages/analyzer/src/server/store.ts`
 *      (25 importers) when asked about a name whose busiest bearer is
 *      `packages/web/src/state/store.ts` (78) — 0% recall, phrased as a complete answer.
 *   2. A path can disambiguate that. `resolveNode` matched ids and labels; no tier
 *      matched `path`, so the escape hatch returned null.
 *   3. The cap does not silently cost recall. At 40 per direction it dropped 57 of
 *      351 true callers across the twelve hottest targets.
 *   4. A function name resolves. `scanRepo`, `queryNeighbours`, `buildDigest` and
 *      `resolveNode` all returned `target: null`, while the FunctionGraph sitting in
 *      the same monorepo held the call edges that answer them.
 *   5. A rendered row names the node it is about. `calls` listed the TARGET's own
 *      path, because an import edge's evidence file is the importing file.
 *   6. A miss states which index was searched, and suggests only real near names —
 *      not `#ask` and `#round` for `MAX_ASK_TOOL_ROUNDS`.
 *   7. The claims the tool makes about this repository are true. Its own docblock
 *      advertised 0.47 MB / 1326 nodes; the graph is ~1.1 MB / ~1318. The `who_calls`
 *      schema advertised `includeImports` default false; the code defaults true.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Walk up to the workspace root — the tests run from `dist/`, so `../..` is not enough. */
function repoRoot(): string {
  let dir = HERE;
  for (let i = 0; i < 12; i += 1) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error('workspace root not found from ' + HERE);
}

const ROOT = repoRoot();
const norm = (p: string): string => p.replace(/\\/g, '/');

let archCache: ArchGraph | undefined;
async function arch(): Promise<ArchGraph> {
  archCache ??= await scanRepoCached(ROOT, { cluster: true });
  return archCache;
}
let fnCache: FunctionGraph | undefined;
async function fns(): Promise<FunctionGraph> {
  fnCache ??= await buildRepoFunctionGraph(ROOT, {}, await arch());
  return fnCache;
}

/** How many edges touch a node — the measure of "which `store.ts` did they mean". */
function degree(graph: ArchGraph, id: string): number {
  return graph.edges.filter((e) => e.srcId === id || e.dstId === id).length;
}

test('an ambiguous filename resolves to the one the repo actually imports', async () => {
  const g = await arch();
  // Derived, not pinned: whichever `store.ts` carries the most edges is the one a
  // question about "store.ts" is asking about. There are three in this repo.
  const named = g.nodes.filter((n) => n.kind === 'file' && n.label === 'store.ts');
  assert.ok(named.length > 1, 'this test needs a genuinely ambiguous name to be about anything');
  const busiest = [...named].sort((a, b) => degree(g, b.id) - degree(g, a.id))[0];

  const a = queryNeighbours(g, 'store.ts');
  assert.equal(a.target?.id, busiest.id, 'who_calls must answer about the busiest bearer of the name');

  // ...and must NEVER present an ambiguous resolution as the whole story. An agent
  // that cannot tell "the only store.ts" from "one of three" deletes the wrong file.
  const alsoIds = new Set(a.alsoNamed.map((n) => n.id));
  for (const other of named) {
    if (other.id === busiest.id) continue;
    assert.ok(alsoIds.has(other.id), `${other.id} must be named as an alternative`);
  }
  assert.match(renderAnswer(a, 'store.ts'), /also named/i);
});

test('a path-qualified question is answerable at all', async () => {
  const g = await arch();
  // web2, not web: `packages/web` was DELETED with the v1 UI on 2026-08-20, so the
  // file this test used to name is not in the graph and never will be again. The
  // property under test is unchanged — `store.ts` still has two bearers, so a
  // path is still the only way to disambiguate it.
  const WEB2_STORE = 'packages/web2/src/state/store.ts';
  const target = g.nodes.find((n) => norm(String(n.path ?? '')) === WEB2_STORE);
  assert.ok(target, `fixture assumption: ${WEB2_STORE} is in the graph`);
  // Disambiguating by path is the only escape hatch from an ambiguous name, and it
  // returned null: `resolveNode` matched ids and labels, never paths.
  assert.equal(queryNeighbours(g, WEB2_STORE).target?.id, target.id);
  assert.equal(
    queryNeighbours(g, 'web2/src/state/store.ts').target?.id,
    target.id,
    'a path SUFFIX is enough',
  );
});

test('the default cap does not lose callers on this repo\'s busiest file', async () => {
  const g = await arch();
  const indeg = new Map<string, number>();
  for (const e of g.edges) indeg.set(e.dstId, (indeg.get(e.dstId) ?? 0) + 1);
  const [hottestId, count] = [...indeg.entries()].sort((a, b) => b[1] - a[1])[0];
  assert.ok(count > 40, 'this repo must have a file with more than the OLD cap of callers');
  const node = g.nodes.find((n) => n.id === hottestId);
  assert.ok(node);

  const a = queryNeighbours(g, norm(String(node.path ?? node.id)));
  assert.equal(a.target?.id, hottestId);
  assert.equal(a.omitted.callers, 0, 'the busiest real target must fit under the default cap');
  assert.equal(a.callers.length, count, 'every caller the graph knows must be returned');
  assert.ok(
    count <= DEFAULT_MAX_HITS_PER_DIRECTION,
    'the default cap must be sized against the real distribution, not a guess',
  );
});

test('a function name resolves, and finds a caller relationship this repo really has', async () => {
  const g = await arch();
  const fg = await fns();
  // scanRepoCached calls scanRepo. That is a fact about this repository, checkable by
  // eye at packages/analyzer/src/server/graphCache.ts, and the tool answered `null`.
  const a = queryNeighbours(g, 'scanRepo', { functions: fg });
  assert.equal(a.target?.kind, 'function', 'a function name must resolve to a function');
  assert.equal(norm(String(a.target?.path)), 'packages/analyzer/src/scan.ts');

  const callers = a.callers.map((c) => `${norm(c.path ?? '')}#${c.label}`);
  assert.ok(
    callers.includes('packages/analyzer/src/server/graphCache.ts#scanRepoCached'),
    `scanRepoCached must appear as a caller of scanRepo; got ${callers.slice(0, 5).join(', ')}`,
  );

  // Derived completeness: every call edge the function graph holds must be reported.
  const target = fg.nodes.find((n) => n.id === a.target?.id);
  assert.ok(target);
  const truth = fg.edges.filter((e) => e.dstId === target.id).length;
  assert.equal(a.callers.length + a.omitted.callers, truth, 'no call edge may vanish');

  // Every hit cites a file and a line, or the tool has given up its only edge over rg.
  for (const c of a.callers) {
    assert.ok(c.evidence[0]?.file, 'every function hit must carry a file');
    assert.equal(typeof c.evidence[0]?.line, 'number', 'every function hit must carry a line');
  }
});

test('a symbol question that is NOT a filename still answers', async () => {
  const g = await arch();
  const fg = await fns();
  // Four of the five names the research doc tried. Each returned null.
  // `acceptFileEditProposal` was the fourth; it lived in `packages/web` and was
  // deleted with the v1 UI on 2026-08-20. `resolveImport` replaces it: same
  // shape of question — a symbol that is not a filename — against living code.
  for (const name of ['queryNeighbours', 'buildDigest', 'resolveNode', 'resolveImport']) {
    const a = queryNeighbours(g, name, { functions: fg });
    assert.ok(a.target, `who_calls ${name} must resolve to something`);
    assert.equal(a.target?.kind, 'function', `who_calls ${name} must resolve to the function`);
  }
});

test('a callee row names the callee, not the file the citation lives in', async () => {
  const g = await arch();
  const a = queryNeighbours(g, 'packages/analyzer/src/explain/explain.ts');
  assert.ok(a.callees.length > 3, 'this target must import several files for the test to bite');
  const rendered = renderAnswer(a, 'explain.ts');
  const calls = rendered.split('\n');
  const start = calls.findIndex((l) => l.startsWith('calls '));
  assert.ok(start >= 0);
  const rows = calls.slice(start + 1).filter((l) => l.startsWith('  '));

  // The defect: an import edge's evidence file is the IMPORTING file, so in the
  // callee direction it is the target itself. Printing the evidence path verbatim
  // rendered `calls: packages/.../explain.ts:33` — the target listed as its own
  // callee, at a line that belongs to neither claim an agent would draw from it.
  const targetPath = String(a.target?.path);
  // A cross-service row is prefixed `service -> `. Strip it before looking at the
  // path, because BOTH assertions below would otherwise stop biting rather than
  // fail: `startsWith(targetPath)` becomes trivially false once anything precedes
  // the path, and the path extraction picks up the service name instead.
  const body = (row: string) => row.trim().replace(/^[^\s]+ → /, '');
  for (const row of rows) {
    assert.ok(
      !body(row).startsWith(targetPath),
      `a callee row must name the callee, not the target: ${row.trim()}`,
    );
  }
  // Every callee named must be a real callee of this target.
  const named = new Set(a.callees.map((c) => c.path));
  for (const row of rows) {
    const first = body(row).split(/[\s:]/)[0];
    assert.ok(named.has(first), `unrecognised callee row: ${row.trim()}`);
  }
  // ...and the line marker is explained rather than left to be guessed at.
  assert.match(calls[start], /@N is a line in/);
});

test('a symbol miss says which index was searched, and suggests only real near names', async () => {
  const g = await arch();
  const fg = await fns();

  // `MAX_ASK_TOOL_ROUNDS` is a const, so the function index genuinely cannot hold it.
  // The failure mode being locked out is the tool implying the REPO lacks it.
  const miss = queryNeighbours(g, 'MAX_ASK_TOOL_ROUNDS', { functions: fg });
  assert.equal(miss.target, null);
  assert.match(String(miss.note), /function definitions only/i);
  // Measured while building this: the suggester matched any name of 3+ characters
  // contained in the query, so this answered with `#ask` and `#round`, and
  // `propose_files` answered with `#file`. Junk with a file path attached reads as
  // grounded, which is worse than nothing from a tool that sells groundedness.
  for (const s of miss.didYouMean) {
    assert.ok(
      s.toLowerCase().includes('ask_tool') || s.toLowerCase().includes('rounds'),
      `unrelated suggestion for MAX_ASK_TOOL_ROUNDS: ${s}`,
    );
  }
  // ...and the 9-service list is not an answer to a symbol question either.
  assert.ok(!miss.didYouMean.includes('analyzer'), 'no service list behind a symbol miss');

  // A typo must still land on the real function.
  const typo = queryNeighbours(g, 'scanRepoo', { functions: fg });
  assert.equal(typo.target, null);
  assert.ok(
    typo.didYouMean.some((s) => s.endsWith('scan.ts#scanRepo')),
    `scanRepoo should suggest scanRepo; got ${typo.didYouMean.join(', ')}`,
  );
});

test('the tool states no false fact about this repository\'s topology', async () => {
  const g = await arch();
  const liveMb = JSON.stringify(g).length / (1024 * 1024);
  const sources = ['graphQuery.ts', 'index.ts', 'test/graphQuery.test.ts'].map((f) => ({
    f,
    text: fs
      .readFileSync(path.join(ROOT, 'packages/mcp/src', f), 'utf8')
      // core.autocrlf=true — the checkout carries \r\n; normalise before matching.
      .replace(/\r\n/g, '\n')
      // A figure inside double quotes is being QUOTED, not asserted: these files
      // carry their own retractions ("0.47 MB / 1326 nodes") so the next reader
      // learns what was wrong rather than rediscovering it. Deleting the history to
      // satisfy a regex would be the worse outcome, so the regex excludes quotes.
      .replace(/"[^"\n]*"/g, '""'),
  }));

  // The package describes TWO graphs of this repo, so a count is true if it measures
  // either one. Tolerances, not literals: a monorepo gains a file most weeks, and a
  // test pinned to 1318 is a test that gets edited into agreement instead of believed.
  const fg = await fns();
  const near = (claimed: number, actual: number, tol: number): boolean =>
    Math.abs(claimed - actual) / actual < tol;

  for (const { f, text } of sources) {
    for (const m of text.matchAll(/~?([\d.]+)\s*MB/g)) {
      const claimed = Number(m[1]);
      assert.ok(
        near(claimed, liveMb, 0.25),
        `${f} claims ${claimed} MB for this repo's graph; measured ${liveMb.toFixed(2)} MB`,
      );
    }
    for (const m of text.matchAll(/~?([\d,]{3,})\s+nodes\b/g)) {
      const claimed = Number(m[1].replace(/,/g, ''));
      assert.ok(
        near(claimed, g.nodes.length, 0.05) || near(claimed, fg.nodes.length, 0.05),
        `${f} claims ${claimed} nodes; this repo has ${g.nodes.length} arch / ${fg.nodes.length} function nodes`,
      );
    }
    for (const m of text.matchAll(/~?([\d,]{3,})\s+(?:call\s+)?edges\b/g)) {
      const claimed = Number(m[1].replace(/,/g, ''));
      assert.ok(
        near(claimed, g.edges.length, 0.05) || near(claimed, fg.edges.length, 0.05),
        `${f} claims ${claimed} edges; this repo has ${g.edges.length} arch / ${fg.edges.length} function edges`,
      );
    }
    assert.ok(!/470\s*KB/.test(text), `${f} still cites the retracted 470 KB figure`);
  }
});

test('the who_calls schema describes the default the code actually has', async () => {
  const g = await arch();
  const described = graphQueryShape.includeImports.description ?? '';
  // The schema is the only thing an MCP client reads before calling. It said
  // "default false" while `queryNeighbours` had defaulted to true since iteration 7,
  // so a client reasoning from the contract reasons about a tool that does not exist.
  const withImports = queryNeighbours(g, 'packages/analyzer/src/scan.ts');
  const withoutImports = queryNeighbours(g, 'packages/analyzer/src/scan.ts', { includeImports: false });
  assert.ok(withImports.callers.length > withoutImports.callers.length, 'imports are in by default');
  assert.ok(/default\s*:?\s*true/i.test(described), `includeImports description is wrong: ${described}`);
});
