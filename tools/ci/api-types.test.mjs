/**
 * `packages/api-types` is the shared HTTP wire contract (build item W0.5, gap G12).
 *
 * Before it existed, every one of the ~60 request/response shapes on
 * `packages/analyzer/src/server/repoServer.ts` was re-derived by hand at both ends:
 * the server narrowed a `JSON.parse` result inline (`let body: { path?: unknown }`)
 * and the client re-declared the answer shape from memory. Nothing tied the two
 * together, so a field could be renamed on one side and the other side would keep
 * compiling.
 *
 * This test locks the three properties that make the package worth having:
 *
 *  1. It is TYPES ONLY. No runtime code, no dependency beyond `@sequence/schema`.
 *     The moment a `const` or a helper function lands in it, it stops being a
 *     contract and becomes a second implementation to keep in step.
 *  2. It is organised ONE FILE PER ROUTE GROUP, matching the groups enumerated in
 *     `docs/research/v2-architecture-and-gaps.md` §3.2, so a route can be found
 *     without reading 4,452 lines of server.
 *  3. It is REALLY USED. `repoServer.ts` must consume at least ten of these types
 *     in place of its hand-written narrowing — the acceptance criterion the plan
 *     names for W0.5. A types package nothing imports proves nothing.
 *
 * core.autocrlf=true — every file is normalised to LF before it is matched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'packages/api-types');
const SRC = path.join(PKG, 'src');

/** Read a file with CRLF normalised away (core.autocrlf=true on this repo). */
function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function readJson(file) {
  return JSON.parse(read(file));
}

/** Every `.ts` file under `packages/api-types/src`, sorted. */
function srcFiles() {
  return fs
    .readdirSync(SRC, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.ts'))
    .map((d) => d.name)
    .sort();
}

/**
 * Strip block and line comments so a comment mentioning `function` or a `const`
 * in prose cannot fail the types-only check, and a type named in a comment cannot
 * satisfy the export check either. Deliberately simple: the package is hand-written
 * type declarations, so there are no regex literals or template strings to confuse it.
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/* ------------------------------------------------------------------ package -- */

test('packages/api-types exists as a workspace package', () => {
  assert.ok(fs.existsSync(PKG), 'packages/api-types is missing');
  assert.ok(fs.existsSync(SRC), 'packages/api-types/src is missing');
  const ws = read(path.join(ROOT, 'pnpm-workspace.yaml'));
  assert.match(
    ws,
    /^\s*-\s*['"]?packages\/\*['"]?\s*$/m,
    'pnpm-workspace.yaml no longer globs packages/* — api-types would not be in the workspace',
  );
});

test('api-types declares no dependency beyond @sequence/schema', () => {
  const pkg = readJson(path.join(PKG, 'package.json'));
  assert.equal(pkg.name, '@sequence/api-types');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.types, 'dist/index.d.ts');
  const deps = Object.keys(pkg.dependencies ?? {});
  assert.deepEqual(
    deps,
    ['@sequence/schema'],
    `api-types must depend on @sequence/schema and nothing else, got: ${deps.join(', ') || '(none)'}`,
  );
  assert.equal(pkg.dependencies['@sequence/schema'], 'workspace:*');
});

test('api-types has its own tsconfig extending the shared base', () => {
  const tsconfig = readJson(path.join(PKG, 'tsconfig.json'));
  assert.equal(tsconfig.extends, '../../tsconfig.base.json');
  assert.equal(tsconfig.compilerOptions.rootDir, 'src');
  assert.equal(tsconfig.compilerOptions.outDir, 'dist');
});

/* ---------------------------------------------------------------- types only -- */

test('api-types contains no runtime code', () => {
  for (const name of srcFiles()) {
    const body = stripComments(read(path.join(SRC, name)));
    for (const [lineNo, line] of body.split('\n').entries()) {
      const where = `${name}:${lineNo + 1}`;
      assert.doesNotMatch(
        line,
        /^\s*(?:export\s+)?(?:const|let|var|function|class|enum|abstract\s+class)\s/,
        `${where} declares runtime code — api-types is types only: ${line.trim()}`,
      );
      // A value import would emit a real `require`/`import` into the built JS.
      if (/^\s*(?:export\s+)?import\s/.test(line) || /^\s*export\s+\{/.test(line)) {
        assert.match(
          line,
          /^\s*(?:import|export)\s+type\s|^\s*export\s+\{\s*type\s/,
          `${where} is a value import/export — every cross-file reference must be \`import type\` / \`export type\`: ${line.trim()}`,
        );
      }
    }
  }
});

test('api-types imports nothing but @sequence/schema and its own files', () => {
  for (const name of srcFiles()) {
    const body = stripComments(read(path.join(SRC, name)));
    for (const m of body.matchAll(/from\s+'([^']+)'/g)) {
      const spec = m[1];
      const ok = spec === '@sequence/schema' || spec.startsWith('./');
      assert.ok(ok, `${name} imports '${spec}' — only @sequence/schema and sibling files are allowed`);
    }
  }
});

/* --------------------------------------------------- one file per route group -- */

test('api-types has one file per route group in §3.2', () => {
  const expected = [
    'ask.ts',
    'attach.ts',
    'auth.ts',
    'common.ts',
    'files.ts',
    'graph.ts',
    'harness.ts',
    'index.ts',
    'integrations.ts',
    'permissions.ts',
    'programs.ts',
    'provider.ts',
    'sessions.ts',
    'terminal.ts',
  ];
  assert.deepEqual(srcFiles(), expected);
});

/**
 * The contract manifest. Each entry is a type the new shell codes against; the
 * plan's acceptance note is that "a wrong type is worse than a missing one", so the
 * set is asserted explicitly rather than counted.
 */
const REQUIRED_EXPORTS = {
  'common.ts': ['ApiErrorResponse', 'Unvalidated', 'OkPathResponse'],
  'auth.ts': ['GetMeResponse', 'PostAuthLogoutResponse', 'AuthProviderId'],
  'attach.ts': [
    'GetStatusResponse',
    'GetBrowseQuery',
    'GetBrowseResponse',
    'BrowseEntry',
    'PostAttachRequest',
    'PostAttachResponse',
    'PostAttachNoManifestsError',
    'PostDetachResponse',
    'GetRecentResponse',
    'GetPoliciesResponse',
    'GraphSummary',
  ],
  'graph.ts': [
    'GetArchGraphResponse',
    'PostScanResponse',
    'GetTreeResponse',
    'TreeNode',
    'GetFunctionsResponse',
    'PostExplainRequest',
    'PostExplainResponse',
    'PostAnnotateRequest',
    'PostAnnotateResponse',
    'PostDdlRequest',
    'PostDdlResponse',
  ],
  'files.ts': [
    'GetFileQuery',
    'GetFileResponse',
    'PutFileRequest',
    'PutFileResponse',
    'GetGitStatusResponse',
    'GetGitDiffResponse',
    'PostGitCommitRequest',
    'PostGitCommitResponse',
  ],
  'ask.ts': ['PostAskRequest', 'PostAskResponse', 'AskStreamEvent', 'PostAskStreamRequest'],
  'sessions.ts': [
    'GetSessionsResponse',
    'PostSessionsRequest',
    'PostSessionsResponse',
    'PutActiveSessionRequest',
    'PutActiveSessionResponse',
    'GetSessionResponse',
    'PutSessionRequest',
    'PutSessionResponse',
    'DeleteSessionResponse',
    'GetChatMemoryResponse',
    'PutChatMemoryRequest',
    'GetBoardResponse',
    'PutBoardRequest',
    'GetTrajectoryResponse',
    'PostTrajectoryRequest',
    'PostTrajectoryResponse',
  ],
  'provider.ts': [
    'GetAiConfigResponse',
    'PutAiConfigRequest',
    'PutAiConfigResponse',
    'GetUsageResponse',
    'PostGenerateRequest',
    'PostGenerateResponse',
    'PostPromptFileRequest',
    'PostDesignSuggestRequest',
    'PostDesignSuggestResponse',
    'PostResearchRequest',
    'PostResearchResponse',
  ],
  'integrations.ts': [
    'GetAcpAvailableResponse',
    'GetAcpAgentsResponse',
    'PostAcpRunNodeRequest',
    'PostAcpRunNodeResponse',
    'GetMcpToolsResponse',
    'PostMcpCallRequest',
    'PostMcpCallResponse',
    'GetGithubResponse',
    'PutGithubRequest',
    'GetGithubReposResponse',
    'PostGithubCloneRequest',
    'PostGithubCloneResponse',
  ],
  'harness.ts': [
    'PostDistillSkillsResponse',
    'PostRefinePlanResponse',
    'GetRefineResponse',
    'PostRefineAcceptResponse',
    'PostRefineVerifyFailedResponse',
  ],
  'programs.ts': [
    'GetProgramStrategyResponse',
    'PostProgramRunLogRequest',
    'PostProgramRunLogResponse',
    'GetProgramRunLogResponse',
  ],
  'permissions.ts': [
    'PermissionsDocument',
    'GetPermissionsResponse',
    'PutPermissionsRequest',
    'PutPermissionsResponse',
  ],
  'terminal.ts': ['TerminalControlMessage', 'TerminalWsPath', 'TerminalUpgradeRefusal'],
};

test('every route group exports the request and response types the shell codes against', () => {
  for (const [file, names] of Object.entries(REQUIRED_EXPORTS)) {
    const body = stripComments(read(path.join(SRC, file)));
    for (const name of names) {
      assert.match(
        body,
        new RegExp(`export\\s+(?:interface|type)\\s+${name}\\b`),
        `packages/api-types/src/${file} does not export ${name}`,
      );
    }
  }
});

test('index.ts re-exports every route group', () => {
  const body = stripComments(read(path.join(SRC, 'index.ts')));
  for (const file of Object.keys(REQUIRED_EXPORTS)) {
    if (file === 'index.ts') continue;
    const stem = file.replace(/\.ts$/, '');
    assert.match(
      body,
      new RegExp(`from\\s+'\\./${stem}\\.js'`),
      `index.ts does not re-export ./${stem}.js`,
    );
  }
});

/* ------------------------------------------------------------- really used -- */

test('analyzer depends on @sequence/api-types', () => {
  const pkg = readJson(path.join(ROOT, 'packages/analyzer/package.json'));
  assert.equal(
    pkg.dependencies?.['@sequence/api-types'],
    'workspace:*',
    'packages/analyzer must declare @sequence/api-types as a workspace dependency',
  );
});

test('repoServer.ts substitutes the shared types on at least 10 routes', () => {
  const server = read(path.join(ROOT, 'packages/analyzer/src/server/repoServer.ts'));
  const importBlock = /import\s+type\s+\{([\s\S]*?)\}\s+from\s+'@sequence\/api-types'/.exec(server);
  assert.ok(importBlock, "repoServer.ts does not `import type { … } from '@sequence/api-types'`");

  const imported = importBlock[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Count the ROUTES covered, not the identifiers: a route counts once whether it
  // contributed a request type, a response type, or both.
  const routeTypes = imported.filter((n) => /^(?:Get|Post|Put|Delete)[A-Z]/.test(n));
  const routes = new Set(
    routeTypes.map((n) => n.replace(/^(Get|Post|Put|Delete)/, '$1|').replace(/(Request|Response)$/, '')),
  );
  assert.ok(
    routes.size >= 10,
    `repoServer.ts must use the shared types on >= 10 routes, found ${routes.size}: ${[...routes].join(', ')}`,
  );

  // Each imported type must actually appear in a type position in the body, not
  // just in the import list — an unused import would satisfy the count and change
  // nothing about the server.
  const body = server.slice(importBlock.index + importBlock[0].length);
  for (const name of imported) {
    assert.match(
      body,
      new RegExp(`\\b${name}\\b`),
      `repoServer.ts imports ${name} from @sequence/api-types but never uses it`,
    );
  }
});

test('repoServer.ts no longer hand-narrows the routes it now shares types for', () => {
  const server = read(path.join(ROOT, 'packages/analyzer/src/server/repoServer.ts'));
  // The exact inline shapes W0.5 replaced. Each one reappearing means a route
  // quietly went back to re-deriving its own wire shape.
  const retired = [
    'let body: { path?: unknown };',
    'let body: { path?: unknown; content?: unknown };',
    'let body: { spec?: unknown; scope?: unknown };',
    'let body: { server?: unknown; tool?: unknown; args?: unknown };',
    'let body: { message?: unknown; paths?: unknown };',
    'let body: { agentRef?: unknown; prompt?: unknown; cwd?: unknown; sessionKey?: unknown };',
  ];
  for (const snippet of retired) {
    assert.ok(
      !server.includes(snippet),
      `repoServer.ts still hand-narrows with \`${snippet}\` — it should use Unvalidated<…> from @sequence/api-types`,
    );
  }
});
