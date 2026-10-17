import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { referencedDrawingIds, sequenceMcpEntry, sequenceMcpServer } from '../server/sequenceMcp.js';

/*
 * S2a: THE INSTALLED APP CARRIES THE BOARD SERVER. desktop prepare-server
 * writes packages/mcp as one bundle beside the analyzer's
 * (<resources>/server/packages/analyzer/dist/sequence-mcp.cjs); the resolver
 * finds it from where the server runs (dist/ for the server bundle,
 * dist/server/ for cli.js), and the bundle starts and answers.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER = path.resolve(HERE, '..', '..');
const SHOPFRONT = path.join(ANALYZER, 'test', 'fixtures', 'shopfront');
/* The bundled server starts its repo's shared find_files host; let it leave soon after this test's session does. */
process.env.SEQUENCE_FIND_FILES_HOST_IDLE_MS = '2000';

test('the resolver finds the bundle in the packaged layout, from dist/ and from dist/server/', () => {
  const resources = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-packaged-')));
  try {
    const dist = path.join(resources, 'server', 'packages', 'analyzer', 'dist');
    fs.mkdirSync(path.join(dist, 'server'), { recursive: true });
    /* Before prepare-server writes it: nothing (the session runs without the board server). */
    assert.equal(sequenceMcpEntry({}, dist), null);
    fs.writeFileSync(path.join(dist, 'sequence-mcp.cjs'), '// bundle\n');
    assert.equal(sequenceMcpEntry({}, dist), path.join(dist, 'sequence-mcp.cjs'));
    assert.equal(sequenceMcpEntry({}, path.join(dist, 'server')), path.join(dist, 'sequence-mcp.cjs'));
    const entry = sequenceMcpServer('/repo', { entry: sequenceMcpEntry({}, dist) })!;
    assert.deepEqual(entry.args, [path.join(dist, 'sequence-mcp.cjs')]);
    /* Lane components: the visual tool saves drawings in the project the app serves, under the chat; absent without the option. */
    assert.equal(entry.env!.SEQUENCE_DRAWINGS_ROOT, undefined);
    const withDrawings = sequenceMcpServer('/wt/chat', { entry: sequenceMcpEntry({}, dist), drawings: { root: '/proj', chat: 'c-9' } })!;
    assert.equal(withDrawings.env!.SEQUENCE_REPO, path.resolve('/wt/chat'));
    assert.equal(withDrawings.env!.SEQUENCE_DRAWINGS_ROOT, path.resolve('/proj'));
    assert.equal(withDrawings.env!.SEQUENCE_CHAT, 'c-9');
    /* Only the drawings the message referenced may be versioned from another chat. */
    assert.equal(withDrawings.env!.SEQUENCE_REFERENCED, undefined);
    assert.deepEqual(referencedDrawingIds('redo @drawing:d3 like @drawing:d12, not @drawing:d3 or @drawing:dx'), ['d3', 'd12']);
    const withRefs = sequenceMcpServer('/wt/chat', { entry: sequenceMcpEntry({}, dist), drawings: { root: '/proj', chat: 'c-9', referenced: ['d3', 'd12'] } })!;
    assert.equal(withRefs.env!.SEQUENCE_REFERENCED, 'd3,d12');
    /* SEQUENCE_MCP_ENTRY names it outright; a named file that is not there is no server, not a guess. */
    assert.equal(sequenceMcpEntry({ SEQUENCE_MCP_ENTRY: path.join(dist, 'nope.cjs') }, dist), null);
  } finally {
    fs.rmSync(resources, { recursive: true, force: true });
  }
});

test('the one-file bundle starts beside the analyzer\'s node_modules, lists the core tools and answers map', async () => {
  const { bundleMcp } = (await import(pathToFileURL(path.join(ANALYZER, 'scripts', 'bundle-mcp.mjs')).href)) as { bundleMcp: (out: string) => Promise<number> };
  const { checkMcpBundle } = (await import(pathToFileURL(path.join(ANALYZER, 'scripts', 'check-mcp-bundle.mjs')).href)) as {
    checkMcpBundle: (o: { entry: string; repo: string }) => Promise<{ ok: boolean; tools: string[]; problems: string[]; stderr: string }>;
  };
  /* Inside the analyzer package, as in the installed shape: its externals resolve from the analyzer's node_modules. */
  const dir = fs.mkdtempSync(path.join(ANALYZER, '.tmp-mcp-bundle-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-mcp-bundle-repo-'));
  try {
    fs.cpSync(SHOPFRONT, repo, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git|\.sequence)([\\/]|$)/.test(p.slice(SHOPFRONT.length)) });
    const entry = path.join(dir, 'sequence-mcp.cjs');
    await bundleMcp(entry);
    const r = await checkMcpBundle({ entry, repo });
    assert.equal(r.ok, true, `${r.problems.join('; ')}\n${r.stderr.slice(-1500)}`);
    assert.deepEqual(r.tools, ['architecture_changed', 'components', 'create_board', 'draw', 'drawings', 'edit_workflow', 'find_files', 'impact', 'list_boards', 'map', 'visual', 'web_fetch', 'web_search', 'who_calls']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a board server that dies before answering is reported, and the caller does not quit silently', async () => {
  /* The 0.1.4 macOS release build: the server died, the timeout timer was unreferenced, nothing held the
     event loop, and prepare-server's top-level await ended the process with code 13 and no message. */
  const { spawnSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-mcp-dies-'));
  try {
    fs.writeFileSync(path.join(dir, 'dies.cjs'), "process.stderr.write('dying on purpose\n'); process.exit(3);\n");
    const check = pathToFileURL(path.join(ANALYZER, 'scripts', 'check-mcp-bundle.mjs')).href;
    fs.writeFileSync(
      path.join(dir, 'caller.mjs'),
      `const { checkMcpBundle } = await import(${JSON.stringify(check)});\n` +
        `const r = await checkMcpBundle({ entry: ${JSON.stringify(path.join(dir, 'dies.cjs'))}, repo: ${JSON.stringify(dir)} });\n` +
        `console.log(JSON.stringify(r));\n`,
    );
    const p = spawnSync(process.execPath, [path.join(dir, 'caller.mjs')], { encoding: 'utf8', timeout: 30000 });
    assert.equal(p.status, 0, `the caller ended with ${p.status}: ${p.stderr}`);
    const r = JSON.parse(p.stdout.trim().split('\n').pop()!);
    assert.equal(r.ok, false);
    assert.match(r.problems.join('; '), /exited \(code \d+\) before answering/);
    assert.match(r.stderr, /dying on purpose/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
