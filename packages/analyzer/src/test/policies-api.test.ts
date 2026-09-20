import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { readPolicies } from '../server/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-policies-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

function writePolicy(repo: string, name: string, body: string): void {
  const dir = path.join(repo, '.sequence', 'policies');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), body, 'utf8');
}

async function startServer(repoRoot: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repoRoot, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/* --------------------------------- the reader -------------------------------- */

test('readPolicies: no policies dir is an honest no-op, not an error', () => {
  const repo = plainappRepo();
  assert.deepEqual(readPolicies(repo), { policies: [], warnings: [] });
});

test('readPolicies: loads valid files in filename order', () => {
  const repo = plainappRepo();
  writePolicy(repo, 'b-hops.json', JSON.stringify({ version: 1, name: 'B', rules: [{ kind: 'flag-network-hop' }] }));
  writePolicy(
    repo,
    'a-latency.json',
    JSON.stringify({ version: 1, name: 'A', rules: [{ kind: 'no-sync-into', target: 'svc:pricing' }] }),
  );
  const loaded = readPolicies(repo);
  assert.deepEqual(loaded.warnings, []);
  assert.deepEqual(loaded.policies.map((p) => p.name), ['A', 'B']);
});

test('readPolicies: infers scope from a filename when the JSON omits scope', () => {
  /*
   * POSIX ONLY, AND THE REASON IS WHY THE PORTABLE SPELLING EXISTS.
   *
   * A colon cannot appear in a Windows filename: it opens an NTFS alternate
   * data stream. `fs.writeFileSync('svc:orders.json')` therefore SUCCEEDS,
   * writes into a stream hanging off a file called `svc`, and `readdirSync`
   * lists `svc` — no `.json`, so the policy is filtered out and never loads.
   * The rule silently does not exist, with no error at any layer. Measured, not
   * assumed. The `svc__orders.json` test below is the spelling that works
   * everywhere, and it is the one that carries this feature on Windows.
   */
  if (process.platform === 'win32') return;
  const repo = plainappRepo();
  writePolicy(
    repo,
    'svc:orders.json',
    JSON.stringify({ version: 1, name: 'Orders', rules: [{ kind: 'flag-network-hop' }] }),
  );
  const loaded = readPolicies(repo);
  assert.equal(loaded.warnings.length, 0);
  assert.equal(loaded.policies[0]!.scope, 'svc:orders');
});

test('readPolicies: the portable `__` filename spelling carries scope on every platform', () => {
  // `svc__orders.json` means `svc:orders`. Same feature, legal filename.
  const repo = plainappRepo();
  writePolicy(
    repo,
    'svc__orders.json',
    JSON.stringify({ version: 1, name: 'Orders', rules: [{ kind: 'flag-network-hop' }] }),
  );
  const loaded = readPolicies(repo);
  assert.equal(loaded.warnings.length, 0);
  assert.equal(loaded.policies[0]!.scope, 'svc:orders');
});

test('readPolicies: an invalid file is REPORTED BY NAME, never silently dropped', () => {
  const repo = plainappRepo();
  writePolicy(repo, 'good.json', JSON.stringify({ version: 1, name: 'Good', rules: [{ kind: 'flag-network-hop' }] }));
  writePolicy(repo, 'broken.json', '{ not json');
  writePolicy(repo, 'wrong.json', JSON.stringify({ version: 1, rules: [{ kind: 'no-sync-into' }] }));

  const loaded = readPolicies(repo);
  // The good one still loads — one bad file does not disarm the rest.
  assert.deepEqual(loaded.policies.map((p) => p.name), ['Good']);
  assert.equal(loaded.warnings.length, 2);
  assert.ok(loaded.warnings.some((w) => w.startsWith('.sequence/policies/broken.json:') && /JSON/.test(w)));
  assert.ok(
    loaded.warnings.some(
      (w) => w.startsWith('.sequence/policies/wrong.json:') && w.includes('non-empty target'),
    ),
  );
});

test('readPolicies: ignores non-.json files and sub-directories', () => {
  const repo = plainappRepo();
  writePolicy(repo, 'ok.json', JSON.stringify({ version: 1, rules: [{ kind: 'flag-network-hop' }] }));
  writePolicy(repo, 'notes.md', '# not a policy');
  fs.mkdirSync(path.join(repo, '.sequence', 'policies', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.sequence', 'policies', 'nested', 'x.json'), '{ not json', 'utf8');
  const loaded = readPolicies(repo);
  assert.equal(loaded.policies.length, 1);
  assert.deepEqual(loaded.warnings, []);
});

/* --------------------------------- the route --------------------------------- */

test('/api/policies: 200 with an empty set when the repo has none', async () => {
  const repo = plainappRepo();
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/policies`);
    assert.strictEqual(res.status, 200);
    assert.deepEqual(await res.json(), { policies: [], warnings: [] });
  } finally {
    await close();
  }
});

test('/api/policies: serves loaded rules and validation warnings together', async () => {
  const repo = plainappRepo();
  writePolicy(
    repo,
    'latency.json',
    JSON.stringify({
      version: 1,
      name: 'Latency first',
      rules: [{ kind: 'no-sync-into', target: 'svc:pricing', reason: 'pricing must stay non-blocking' }],
    }),
  );
  writePolicy(repo, 'oops.json', JSON.stringify({ version: 3, rules: [] }));
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/policies`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { policies: { name?: string }[]; warnings: string[] };
    assert.deepEqual(body.policies.map((p) => p.name), ['Latency first']);
    assert.equal(body.warnings.length, 1);
    assert.match(body.warnings[0]!, /oops\.json/);
  } finally {
    await close();
  }
});

/* ------------------------- the ADR-009 jail discipline ----------------------- */

test('/api/file: a policy file is readable, but the reserved dir around it is not', async () => {
  const repo = plainappRepo();
  writePolicy(repo, 'latency.json', JSON.stringify({ version: 1, rules: [{ kind: 'flag-network-hop' }] }));
  fs.writeFileSync(path.join(repo, '.sequence', 'ai.json'), JSON.stringify({ apiKey: 'sk-secret' }), 'utf8');
  const { base, close } = await startServer(repo);
  try {
    const ok = await fetch(`${base}/api/file?path=${encodeURIComponent('.sequence/policies/latency.json')}`);
    assert.strictEqual(ok.status, 200);
    const key = await fetch(`${base}/api/file?path=${encodeURIComponent('.sequence/ai.json')}`);
    assert.strictEqual(key.status, 403);
  } finally {
    await close();
  }
});

test('/api/file: a policy path that is a HARD LINK to the key file is refused', async (t) => {
  const repo = plainappRepo();
  fs.mkdirSync(path.join(repo, '.sequence', 'policies'), { recursive: true });
  const secret = path.join(repo, '.sequence', 'ai.json');
  fs.writeFileSync(secret, JSON.stringify({ apiKey: 'sk-secret' }), 'utf8');
  try {
    fs.linkSync(secret, path.join(repo, '.sequence', 'policies', 'leak.json'));
  } catch {
    t.skip('filesystem does not support hard links');
    return;
  }
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/file?path=${encodeURIComponent('.sequence/policies/leak.json')}`);
    assert.strictEqual(res.status, 403, 'a hard link into .sequence must never serve the key');
  } finally {
    await close();
  }
});

test('/api/file: a policies dir that is a SYMLINK out of the allowed subtree is refused', async (t) => {
  const repo = plainappRepo();
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'elsewhere'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'elsewhere', 'x.json'), '{"version":1,"rules":[]}', 'utf8');
  try {
    fs.symlinkSync(path.join(repo, 'elsewhere'), path.join(repo, '.sequence', 'policies'), 'dir');
  } catch {
    t.skip('filesystem does not support symlinks');
    return;
  }
  // The symlinked path canonicalises OUT of `.sequence/policies/`, so the policy
  // allowance does not apply to it. It is not reserved either (it is a normal repo
  // dir), so the honest answer is that it reads as the ordinary file it really is —
  // what must never happen is the allowance following the link back INTO .sequence.
  fs.writeFileSync(path.join(repo, '.sequence', 'ai.json'), JSON.stringify({ apiKey: 'sk-secret' }), 'utf8');
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/file?path=${encodeURIComponent('.sequence/policies/../ai.json')}`);
    assert.strictEqual(res.status, 403);
  } finally {
    await close();
  }
});
