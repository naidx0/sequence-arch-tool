import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import type { ArchGraph } from '@sequence/schema';

/**
 * v7 Phase B — the app-shell surface: no-repo state, GET /api/browse (folder
 * picker, jailed to the browse root), POST /api/attach (runtime jail re-point),
 * GET /api/recent (user-level store). Security is the primary review target, so
 * traversal / absolute / encoded / symlink-escape are all locked here, plus the
 * switch-repo jail-repoint (attach A → B → an A-only file is no longer served).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> dist -> analyzer -> packages -> <repo root>
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const TICKETING = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');

interface Tree {
  browseRoot: string;
  projectA: string;
  projectB: string;
  outside: string;
  recentStoreDir: string;
  cleanup: () => void;
}

/** A temp browse tree: two attachable repos, a plain nested folder, a file, and
 *  a sibling "outside" dir that must never be reachable through the browse root. */
function makeTree(): Tree {
  const browseRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-browse-')));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-outside-')));
  const recentStoreDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-recent-')));
  const projectA = path.join(browseRoot, 'projectA');
  const projectB = path.join(browseRoot, 'projectB');
  fs.cpSync(TICKETING, projectA, { recursive: true });
  fs.cpSync(TICKETING, projectB, { recursive: true });
  /*
   * THE COPIED `.sequence/` MUST GO, OR THIS TESTS THE CACHE INSTEAD OF THE ATTACH.
   *
   * `examples/ticketing-scaffold/.sequence/` is GITIGNORED — it is whatever the
   * last person to scan that example left behind, so it exists on a developer
   * machine and not in CI. Copying it hands each project a `graph.json` the
   * server will serve on attach, complete with the ORIGINAL repoName
   * (`ticketing-scaffold`), so `status.repoName` came back as the example's name
   * rather than `projectB` and the assertion below failed on exactly the
   * machines where the suite had been run before. Deleting it makes the tree
   * depend on nothing but this function.
   */
  for (const proj of [projectA, projectB]) {
    fs.rmSync(path.join(proj, '.sequence'), { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(projectA, 'ONLY-IN-A.txt'), 'secret-a-marker\n');
  fs.mkdirSync(path.join(browseRoot, 'plain', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(browseRoot, 'notes.txt'), 'a file, not a dir');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside-only');
  return {
    browseRoot,
    projectA,
    projectB,
    outside,
    recentStoreDir,
    cleanup: () => {
      for (const d of [browseRoot, outside, recentStoreDir]) fs.rmSync(d, { recursive: true, force: true });
    },
  };
}

async function startServer(opts: {
  repoRoot?: string | null;
  browseRoot?: string;
  recentStoreDir?: string;
}): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(opts.repoRoot ?? null, {
    webDist: undefined,
    browseRoot: opts.browseRoot,
    recentStoreDir: opts.recentStoreDir,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/* ----------------------------------------------------------- no-repo state -- */

test('no-repo: /api/status is {attached:false}; graph endpoints 409, not a crash', async () => {
  const t = makeTree();
  const { base, close } = await startServer({ browseRoot: t.browseRoot, recentStoreDir: t.recentStoreDir });
  try {
    const status = await fetch(`${base}/api/status`);
    assert.strictEqual(status.status, 200);
    assert.deepStrictEqual(await status.json(), { attached: false });

    // Repo-scoped endpoints must refuse cleanly (409), never throw a socket.
    for (const p of ['/api/tree', '/archgraph.json']) {
      const r = await fetch(`${base}${p}`);
      assert.strictEqual(r.status, 409, `${p} should be 409 with no repo`);
      assert.match(((await r.json()) as { error: string }).error, /no repo attached/);
    }
    const scan = await fetch(`${base}/api/scan`, { method: 'POST' });
    assert.strictEqual(scan.status, 409);

    // …but browse works without a repo.
    const browse = await fetch(`${base}/api/browse`);
    assert.strictEqual(browse.status, 200);
  } finally {
    await close();
    t.cleanup();
  }
});

test('no-repo → attach → repo endpoints work and /api/status flips', async () => {
  const t = makeTree();
  const { base, close } = await startServer({ browseRoot: t.browseRoot, recentStoreDir: t.recentStoreDir });
  try {
    const before = await fetch(`${base}/api/tree`);
    assert.strictEqual(before.status, 409);

    const attach = await fetch(`${base}/api/attach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: t.projectA }),
    });
    assert.strictEqual(attach.status, 200);
    const body = (await attach.json()) as { attached: boolean; repoName: string; graphSummary: Record<string, number> };
    assert.strictEqual(body.attached, true);
    assert.strictEqual(body.repoName, 'projectA');
    assert.ok(body.graphSummary.nodes > 0, 'graphSummary reports scanned nodes');

    const status = await fetch(`${base}/api/status`);
    assert.deepStrictEqual((await status.json()) as { attached: boolean; repoName: string }, {
      attached: true,
      repoName: 'projectA',
      root: t.projectA,
    });

    const tree = await fetch(`${base}/api/tree`);
    assert.strictEqual(tree.status, 200);
    const graph = (await (await fetch(`${base}/archgraph.json`)).json()) as ArchGraph;
    assert.strictEqual(graph.repoName, 'projectA');

    const detach = await fetch(`${base}/api/detach`, { method: 'POST' });
    assert.strictEqual(detach.status, 200);
    assert.deepStrictEqual(await detach.json(), { attached: false });
    const after = await fetch(`${base}/api/status`);
    assert.deepStrictEqual(await after.json(), { attached: false });
    const treeAfter = await fetch(`${base}/api/tree`);
    assert.strictEqual(treeAfter.status, 409);
  } finally {
    await close();
    t.cleanup();
  }
});

test('attach a manifest-less repo → calm 422 with code "no-manifests", not a 500', async () => {
  const t = makeTree();
  // A pure frontend/mobile shape: app/ components/ hooks/ lib/ types/ and no
  // docker-compose / Kubernetes / Helm manifests anywhere.
  const frontend = path.join(t.browseRoot, 'frontend');
  for (const d of ['app', 'components', 'hooks', 'lib', 'types']) {
    fs.mkdirSync(path.join(frontend, d), { recursive: true });
    fs.writeFileSync(path.join(frontend, d, 'index.tsx'), 'export default function X() { return null; }\n');
  }
  const { base, close } = await startServer({ browseRoot: t.browseRoot, recentStoreDir: t.recentStoreDir });
  try {
    const res = await fetch(`${base}/api/attach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: frontend }),
    });
    // A distinct, calm 4xx — NOT the internal-error 500 / validation-dump path.
    assert.strictEqual(res.status, 422, 'no-manifest attach must be a clean 4xx, not a 500');
    const body = (await res.json()) as { error: string; code?: string; repoName?: string };
    assert.strictEqual(body.code, 'no-manifests', 'carries the stable discriminator the home screen keys on');
    assert.strictEqual(body.repoName, 'frontend');
    // Friendly, informational message — never a "internal error"/"failed validation" dump.
    assert.match(body.error, /docker-compose, Kubernetes, or Helm/);
    assert.match(body.error, /nothing to scan yet/);
    assert.doesNotMatch(body.error, /internal error|failed validation|scan failed/i);

    // The server stays in the clean no-repo state (attach did not half-apply).
    const status = await fetch(`${base}/api/status`);
    assert.deepStrictEqual(await status.json(), { attached: false });
  } finally {
    await close();
    t.cleanup();
  }
});

/* -------------------------------------------------------------- browse jail -- */

test('GET /api/browse lists sub-directories only (no files, no contents) and flags repos', async () => {
  const t = makeTree();
  const { base, close } = await startServer({ browseRoot: t.browseRoot, recentStoreDir: t.recentStoreDir });
  try {
    const res = await fetch(`${base}/api/browse`);
    assert.strictEqual(res.status, 200);
    const raw = await res.text();
    // Never leaks file contents on the browse surface.
    assert.ok(!raw.includes('a file, not a dir'), 'browse must not expose file contents');
    const body = JSON.parse(raw) as {
      root: string;
      path: string;
      parent: string | null;
      entries: { name: string; path: string; isRepo: boolean; hasChildren: boolean }[];
    };
    assert.strictEqual(body.root, t.browseRoot);
    assert.strictEqual(body.path, t.browseRoot);
    assert.strictEqual(body.parent, null, 'cannot ascend above the browse root');

    const names = body.entries.map((e) => e.name);
    assert.ok(names.includes('projectA') && names.includes('projectB') && names.includes('plain'));
    assert.ok(!names.includes('notes.txt'), 'files must not be listed');

    const a = body.entries.find((e) => e.name === 'projectA')!;
    assert.strictEqual(a.isRepo, true, 'projectA has docker-compose/package.json ⇒ isRepo');
    const plain = body.entries.find((e) => e.name === 'plain')!;
    assert.strictEqual(plain.isRepo, false);
    assert.strictEqual(plain.hasChildren, true, 'plain/nested ⇒ hasChildren');

    // Browsing INTO projectA lists its dirs but never the file (or its contents).
    const inA = (await (
      await fetch(`${base}/api/browse?path=${encodeURIComponent(t.projectA)}`)
    ).json()) as { entries: { name: string }[] };
    const aNames = inA.entries.map((e) => e.name);
    assert.ok(!aNames.includes('ONLY-IN-A.txt'), 'a file inside a browsed dir is not listed');
  } finally {
    await close();
    t.cleanup();
  }
});

test('GET /api/browse rejects traversal, absolute, encoded, and root-relative escapes', async () => {
  const t = makeTree();
  const { base, close } = await startServer({ browseRoot: t.browseRoot, recentStoreDir: t.recentStoreDir });
  try {
    const cases = [
      encodeURIComponent('../../etc'),
      encodeURIComponent('/etc'),
      '..%2F..%2Fetc%2Fpasswd',
      encodeURIComponent(path.join(t.browseRoot, '..')), // root-relative escape
      encodeURIComponent(t.outside), // an absolute sibling outside the root
    ];
    for (const c of cases) {
      const r = await fetch(`${base}/api/browse?path=${c}`);
      assert.strictEqual(r.status, 403, `path=${c} must be 403`);
    }
  } finally {
    await close();
    t.cleanup();
  }
});

test('GET /api/browse: a symlink escaping the browse root is rejected (realpath) and never listed', async () => {
  const t = makeTree();
  const link = path.join(t.browseRoot, 'escape');
  try {
    fs.symlinkSync(t.outside, link); // browseRoot/escape -> /outside
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM') {
      t.cleanup();
      return; // symlinks not permitted here
    }
    throw e;
  }
  const { base, close } = await startServer({ browseRoot: t.browseRoot, recentStoreDir: t.recentStoreDir });
  try {
    // Browsing THROUGH the escaping symlink is refused by the realpath layer.
    const via = await fetch(`${base}/api/browse?path=${encodeURIComponent(link)}`);
    assert.strictEqual(via.status, 403, 'symlink whose realpath escapes must be 403');

    // …and it is not even offered as a navigable entry in the listing.
    const listing = (await (await fetch(`${base}/api/browse`)).json()) as { entries: { name: string }[] };
    assert.ok(!listing.entries.some((e) => e.name === 'escape'), 'escaping symlink must not be listed');
  } finally {
    await close();
    t.cleanup();
  }
});

test('GET /api/browse of a FILE path (not a dir) is 400', async () => {
  const t = makeTree();
  const { base, close } = await startServer({ browseRoot: t.browseRoot, recentStoreDir: t.recentStoreDir });
  try {
    const r = await fetch(`${base}/api/browse?path=${encodeURIComponent(path.join(t.browseRoot, 'notes.txt'))}`);
    assert.strictEqual(r.status, 400);
    assert.match(((await r.json()) as { error: string }).error, /not a directory/);
  } finally {
    await close();
    t.cleanup();
  }
});

/* -------------------------------------------------------------- attach jail -- */

test('POST /api/attach rejects a path outside the browse root (403)', async () => {
  const t = makeTree();
  const { base, close } = await startServer({ browseRoot: t.browseRoot, recentStoreDir: t.recentStoreDir });
  try {
    for (const bad of [t.outside, '/etc', '../../etc']) {
      const r = await fetch(`${base}/api/attach`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: bad }),
      });
      assert.strictEqual(r.status, 403, `attach ${bad} must be 403`);
    }
    // Still no repo attached after all the rejected attempts.
    assert.deepStrictEqual(await (await fetch(`${base}/api/status`)).json(), { attached: false });
  } finally {
    await close();
    t.cleanup();
  }
});

test('switch-repo: attach A → B fully re-points the jail (an A-only file is no longer served)', async () => {
  const t = makeTree();
  const { base, close } = await startServer({ browseRoot: t.browseRoot, recentStoreDir: t.recentStoreDir });
  const attach = (p: string) =>
    fetch(`${base}/api/attach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: p }),
    });
  try {
    await attach(t.projectA);
    // While A is attached, its unique file is served.
    const inA = await fetch(`${base}/api/file?path=${encodeURIComponent('ONLY-IN-A.txt')}`);
    assert.strictEqual(inA.status, 200);
    assert.strictEqual((await inA.text()).trim(), 'secret-a-marker');

    // Switch to B: the jail root re-points, so A's file is unreachable now.
    await attach(t.projectB);
    const afterSwitch = await fetch(`${base}/api/file?path=${encodeURIComponent('ONLY-IN-A.txt')}`);
    assert.strictEqual(afterSwitch.status, 404, 'A-only file must NOT be served after switching to B');

    const status = (await (await fetch(`${base}/api/status`)).json()) as { repoName: string; root: string };
    assert.strictEqual(status.repoName, 'projectB');
    assert.strictEqual(status.root, t.projectB);
    const graph = (await (await fetch(`${base}/archgraph.json`)).json()) as ArchGraph;
    assert.strictEqual(graph.repoName, 'projectB');
  } finally {
    await close();
    t.cleanup();
  }
});

/* --------------------------------------------------------------- recent list -- */

test('GET /api/recent: most-recent-first, de-duped, stored under the user dir (not the repo)', async () => {
  const t = makeTree();
  const { base, close } = await startServer({ browseRoot: t.browseRoot, recentStoreDir: t.recentStoreDir });
  const attach = (p: string) =>
    fetch(`${base}/api/attach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: p }),
    });
  try {
    await attach(t.projectA);
    await attach(t.projectB);
    let recent = ((await (await fetch(`${base}/api/recent`)).json()) as { recent: { path: string; name: string }[] })
      .recent;
    assert.deepStrictEqual(
      recent.map((r) => r.path),
      [t.projectB, t.projectA],
      'most-recent first'
    );
    assert.deepStrictEqual(recent.map((r) => r.name), ['projectB', 'projectA']);

    // Re-attaching A moves it to the front without duplicating it.
    await attach(t.projectA);
    recent = ((await (await fetch(`${base}/api/recent`)).json()) as { recent: { path: string; name: string }[] })
      .recent;
    assert.deepStrictEqual(recent.map((r) => r.path), [t.projectA, t.projectB], 'A de-duped to the front');

    // Persisted to the USER store, never inside a scanned repo.
    assert.ok(fs.existsSync(path.join(t.recentStoreDir, 'recent.json')), 'recent.json under the user store dir');
    assert.ok(!fs.existsSync(path.join(t.projectA, 'recent.json')), 'never written into the repo root');
    assert.ok(
      !fs.existsSync(path.join(t.projectA, '.sequence', 'recent.json')),
      'never written into the repo .sequence dir'
    );
  } finally {
    await close();
    t.cleanup();
  }
});

/* --------------------------------------------- F1 layer 1: browse-root attach -- */

test('F1: POST /api/attach of the browse root ITSELF is refused (400); a subdir still attaches', async () => {
  const t = makeTree();
  const { base, close } = await startServer({ browseRoot: t.browseRoot, recentStoreDir: t.recentStoreDir });
  const attach = (p: string) =>
    fetch(`${base}/api/attach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: p }),
    });
  try {
    // The browse root is HOME in production; attaching it would re-root the file
    // jail over the whole home dir (~/.ssh, ~/.aws, …). Refused with a clear 400.
    const root = await attach(t.browseRoot);
    assert.strictEqual(root.status, 400, 'attaching the browse root itself must be 400');
    assert.match(((await root.json()) as { error: string }).error, /home directory itself/i);

    // A path that RESOLVES to the browse root (…/projectA/..) is caught by the same
    // guard — not the trivial string compare — so the escape can't be dressed up.
    const viaDotDot = await attach(path.join(t.projectA, '..'));
    assert.strictEqual(viaDotDot.status, 400, 'a path resolving to the browse root is refused');

    // Nothing attached by the refused calls.
    assert.deepStrictEqual(await (await fetch(`${base}/api/status`)).json(), { attached: false });

    // …but a real SUBDIR inside the browse root still attaches fine.
    const sub = await attach(t.projectA);
    assert.strictEqual(sub.status, 200, 'a project subdir still attaches');
    assert.strictEqual(((await sub.json()) as { repoName: string }).repoName, 'projectA');

    // Regression: the correct behavior STAYS correct — after attaching a SUBDIR,
    // that repo's own .sequence/ai.json (the plaintext key) is still 403.
    fs.mkdirSync(path.join(t.projectA, '.sequence'), { recursive: true });
    fs.writeFileSync(
      path.join(t.projectA, '.sequence', 'ai.json'),
      JSON.stringify({ provider: 'anthropic', model: 'x', apiKey: 'sk-ant-STILL-SECRET-0000' })
    );
    const key = await fetch(`${base}/api/file?path=${encodeURIComponent('.sequence/ai.json')}`);
    assert.strictEqual(key.status, 403, 'the API key is still reserved after a subdir attach');
    assert.ok(!(await key.text()).includes('sk-ant-STILL-SECRET-0000'), 'key never leaks');
  } finally {
    await close();
    t.cleanup();
  }
});

/* --------------------------------------------- F2: dot-dir browse targets ----- */

test('F2: GET /api/browse INTO a hidden (dot) dir is refused (403) and enumerates nothing', async () => {
  const t = makeTree();
  // Plant a hidden secret dir with a subdir a same-origin caller could otherwise
  // enumerate via ?path=<root>/.ssh even though the listing hides it.
  const ssh = path.join(t.browseRoot, '.ssh');
  fs.mkdirSync(path.join(ssh, 'privatekeys'), { recursive: true });
  fs.writeFileSync(path.join(ssh, 'id_rsa'), 'PRIVATE-KEY');
  const { base, close } = await startServer({ browseRoot: t.browseRoot, recentStoreDir: t.recentStoreDir });
  try {
    // Root listing still never offers the dot dir (unchanged).
    const listing = (await (await fetch(`${base}/api/browse`)).json()) as { entries: { name: string }[] };
    assert.ok(!listing.entries.some((e) => e.name === '.ssh'), '.ssh is not listed');

    // Explicitly navigating INTO it is now refused — its subdirs stay unenumerable.
    const into = await fetch(`${base}/api/browse?path=${encodeURIComponent(ssh)}`);
    assert.strictEqual(into.status, 403, 'browsing into .ssh must be 403');
    assert.ok(!(await into.text()).includes('privatekeys'), 'must not enumerate the hidden dir subdirs');

    // A nested path THROUGH the dot dir is refused too.
    const nested = await fetch(`${base}/api/browse?path=${encodeURIComponent(path.join(ssh, 'privatekeys'))}`);
    assert.strictEqual(nested.status, 403, 'browsing through .ssh/privatekeys must be 403');

    // No over-block: a normal (non-dot) dir still browses fine.
    const plain = await fetch(`${base}/api/browse?path=${encodeURIComponent(path.join(t.browseRoot, 'plain'))}`);
    assert.strictEqual(plain.status, 200, 'a normal dir still browses');
  } finally {
    await close();
    t.cleanup();
  }
});

/* --------------------------------------------- F3: recent outside browse root - */

test('F3: GET /api/recent drops entries outside the current browse root; in-root remain', async () => {
  const t = makeTree();
  // Hand-write recent.json: one entry OUTSIDE the browse root (a poisoned edit),
  // one legitimately inside it.
  fs.mkdirSync(t.recentStoreDir, { recursive: true });
  fs.writeFileSync(path.join(t.recentStoreDir, 'recent.json'), JSON.stringify([t.outside, t.projectA]));
  const { base, close } = await startServer({ browseRoot: t.browseRoot, recentStoreDir: t.recentStoreDir });
  try {
    const recent = ((await (await fetch(`${base}/api/recent`)).json()) as { recent: { path: string }[] }).recent;
    assert.ok(!recent.some((r) => r.path === t.outside), 'an out-of-root entry must not be listed');
    assert.ok(recent.some((r) => r.path === t.projectA), 'an in-root entry is still listed');
  } finally {
    await close();
    t.cleanup();
  }
});

test('GET /api/recent prunes a path that no longer exists', async () => {
  const t = makeTree();
  // A throwaway attachable repo we will delete after attaching.
  const projectC = path.join(t.browseRoot, 'projectC');
  fs.cpSync(TICKETING, projectC, { recursive: true });
  const { base, close } = await startServer({ browseRoot: t.browseRoot, recentStoreDir: t.recentStoreDir });
  const attach = (p: string) =>
    fetch(`${base}/api/attach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: p }),
    });
  try {
    await attach(projectC);
    await attach(t.projectA);
    // projectC recorded, then vanishes from disk.
    fs.rmSync(projectC, { recursive: true, force: true });
    const recent = ((await (await fetch(`${base}/api/recent`)).json()) as { recent: { path: string }[] }).recent;
    assert.ok(!recent.some((r) => r.path === projectC), 'a vanished path is pruned from /api/recent');
    assert.ok(recent.some((r) => r.path === t.projectA), 'still-existing paths remain');
  } finally {
    await close();
    t.cleanup();
  }
});
