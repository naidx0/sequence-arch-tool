import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * THE SERVER BUNDLE LOSES ONLY WHAT NEVER RUNS.
 *
 * Fixture-level proof of scripts/prune-bundle.cjs. The whole-bundle proof is
 * prepare-server.mjs booting the pruned analyzer from outside the repository,
 * and desktop-smoke --packaged against the built app.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pruneAnalyzerBundle } = require(path.resolve(__dirname, '..', '..', 'scripts', 'prune-bundle.cjs')) as {
  pruneAnalyzerBundle: (dir: string, platform?: string) => { removed: string[]; bytes: number };
};

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-prune-'));
  const files: Record<string, string> = {
    'dist/cli.js': 'runtime',
    'dist/cli.js.map': 'map',
    'dist/cli.d.ts': 'types',
    'dist/test/ask-honesty-corpus.js': 'a helper runtime code imports',
    'dist/test/server.test.js': 'a test',
    'node_modules/node-pty/lib/index.js': 'runtime',
    'node_modules/node-pty/prebuilds/win32-x64/pty.node': 'native',
    'node_modules/node-pty/prebuilds/win32-x64/pty.pdb': 'symbols',
    'node_modules/node-pty/prebuilds/win32-arm64/pty.node': 'native',
    'node_modules/node-pty/prebuilds/darwin-arm64/pty.node': 'native',
    'node_modules/zod/index.js': 'runtime',
    'node_modules/zod/index.d.ts': 'types',
    'node_modules/somepkg/thing.test.js': 'a dependency file that happens to be named .test.js',
  };
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

const exists = (root: string, rel: string) => fs.existsSync(path.join(root, rel));

test('removes symbols, maps, declarations, compiled tests and other platforms', () => {
  const root = fixture();
  try {
    const out = pruneAnalyzerBundle(root, 'win32');
    for (const gone of [
      'dist/cli.js.map',
      'dist/cli.d.ts',
      'dist/test/server.test.js',
      'node_modules/node-pty/prebuilds/win32-x64/pty.pdb',
      'node_modules/node-pty/prebuilds/darwin-arm64',
      'node_modules/zod/index.d.ts',
    ]) {
      assert.ok(!exists(root, gone), `${gone} should have been pruned`);
      assert.ok(out.removed.includes(gone), `${gone} is not reported as removed`);
    }
    assert.ok(out.bytes > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('keeps everything that loads at runtime', () => {
  const root = fixture();
  try {
    pruneAnalyzerBundle(root, 'win32');
    for (const kept of [
      'dist/cli.js',
      /* imported by harness/m3m4Reporter.js — a helper, not a test */
      'dist/test/ask-honesty-corpus.js',
      'node_modules/node-pty/lib/index.js',
      'node_modules/node-pty/prebuilds/win32-x64/pty.node',
      /* every arch of this platform: the mac build packs two from one bundle */
      'node_modules/node-pty/prebuilds/win32-arm64/pty.node',
      'node_modules/zod/index.js',
      /* .test.js is only pruned from the analyzer's own dist */
      'node_modules/somepkg/thing.test.js',
    ]) {
      assert.ok(exists(root, kept), `${kept} was pruned but is runtime`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* ── 0.1.8.1 D2: what the installed server never loads ───────────────────── */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pruneShippedServer } = require(path.resolve(__dirname, '..', '..', 'scripts', 'prune-bundle.cjs')) as {
  pruneShippedServer: (dir: string, opts: { keepGrammars: string[] }) => { removed: string[]; bytes: number };
};

function shippedFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-prune-d2-'));
  const pkg = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps });
  const files: Record<string, string> = {
    'package.json': pkg({ ws: '1', pg: '8', 'node-pty': '1', zod: '3' }),
    'src/scan.ts': 'source',
    'test/fixtures/x.ts': 'test',
    'tsconfig.json': '{}',
    'components/groups.json': '{}',
    'dist/cli.js': 'unbundled',
    'dist/server/repoServer.js': 'unbundled',
    'dist/sequence-server.cjs': 'bundle',
    'dist/sequence-server-entry.cjs': 'entry',
    'dist/sequence-mcp.cjs': 'mcp',
    'dist/sequence-html-worker.cjs': 'html worker',
    'dist/claude-agent-acp-launch.mjs': 'launcher',
    'node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter.js': 'runtime',
    'node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm': 'runtime',
    'node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter-typescript.wasm': 'grammar',
    'node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter-rust.wasm': 'grammar',
    'node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter-php.wasm': 'grammar',
    'node_modules/zod/index.js': 'runtime',
    'node_modules/zod/src/index.ts': 'source',
    'node_modules/node-pty/lib/index.js': 'runtime',
    'node_modules/node-pty/deps/winpty/x.cc': 'source',
    'node_modules/node-pty/third_party/conpty/x.dll': 'source',
    'node_modules/node-pty/src/unix/pty.cc': 'source',
    'node_modules/pg/package.json': pkg({ 'pg-protocol': '1', shared: '1' }),
    'node_modules/pg-protocol/package.json': pkg({}),
    'node_modules/shared/package.json': pkg({}),
    'node_modules/ws/package.json': pkg({ shared: '1' }),
  };
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

test('D2: drops sources, the unbundled dist, unused grammars, dependency sources and pg', () => {
  const root = shippedFixture();
  try {
    const out = pruneShippedServer(root, { keepGrammars: ['tree-sitter-typescript.wasm'] });
    for (const gone of [
      'src',
      'test',
      'tsconfig.json',
      'dist/cli.js',
      'dist/server',
      'node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter-rust.wasm',
      'node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter-php.wasm',
      'node_modules/zod/src',
      'node_modules/node-pty/deps',
      'node_modules/node-pty/third_party',
      'node_modules/node-pty/src',
      'node_modules/pg',
      'node_modules/pg-protocol',
    ]) {
      assert.ok(!exists(root, gone), `${gone} should have been pruned`);
      assert.ok(out.removed.includes(gone), `${gone} is not reported as removed`);
    }
    for (const kept of [
      'components/groups.json',
      'dist/sequence-server.cjs',
      'dist/sequence-server-entry.cjs',
      'dist/sequence-mcp.cjs',
      /* review B: the bundle runs the HTML converter in a worker beside itself */
      'dist/sequence-html-worker.cjs',
      'dist/claude-agent-acp-launch.mjs',
      'node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter.js',
      'node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm',
      'node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter-typescript.wasm',
      'node_modules/zod/index.js',
      'node_modules/node-pty/lib/index.js',
      /* pg needs it, and so does ws: it stays */
      'node_modules/shared/package.json',
    ]) {
      assert.ok(exists(root, kept), `${kept} was pruned but the installed server needs it`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('D2: refuses to prune when the bundle is missing or a loaded grammar is absent', () => {
  const root = shippedFixture();
  try {
    assert.throws(() => pruneShippedServer(root, { keepGrammars: [] }), /keepGrammars is empty/);
    assert.throws(() => pruneShippedServer(root, { keepGrammars: ['tree-sitter-cobol.wasm'] }), /does not have/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  const bare = shippedFixture();
  try {
    fs.rmSync(path.join(bare, 'dist', 'sequence-server.cjs'));
    assert.throws(() => pruneShippedServer(bare, { keepGrammars: ['tree-sitter-typescript.wasm'] }), /no server bundle/);
    assert.ok(exists(bare, 'dist/cli.js'), 'the unbundled dist is kept when it is the only server');
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('D2: prepare-server keeps exactly the grammars the scanner loads (its own table), and boots the entry it ships', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'scripts', 'prepare-server.mjs'), 'utf8');
  assert.match(src, /pruneShippedServer\(ANALYZER_OUT, \{ keepGrammars: \[\.\.\.LOADED_GRAMMARS\] \}\)/);
  assert.match(src, /'parse', 'treesitter\.js'/);
  assert.match(src, /'dist', 'sequence-server-entry\.cjs'\), '--help'\]/);
});
