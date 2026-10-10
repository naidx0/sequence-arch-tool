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
