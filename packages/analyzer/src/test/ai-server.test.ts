import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { setRepoTrust } from '../server/repoTrust.js';
import { userStoreDir } from '../server/store.js';
import { type ArchGraph } from '@sequence/schema';
import { startMockProvider } from './mock-provider.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> dist -> analyzer -> packages -> <repo root>
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const TICKETING = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');
const TICKETING_SPEC = path.join(REPO_ROOT, 'examples', 'ticketing.spec.json');

const TEST_KEY = 'sk-ant-test-SUPERSECRET-9f3a2b';

/** A throwaway copy of the ticketing scaffold — writes never touch examples/. */
function ticketingRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-ai-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(TICKETING, repo, { recursive: true });
  return repo;
}

/**
 * A near-empty "generate target": only docker-compose.yml (the scanner requires
 * a compose/k8s manifest to start). Generate then writes every service's source
 * from scratch — the "draw spec → files appear" one-motion case, minus the one
 * manifest the platform needs to boot a scan.
 */
function seedRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-ai-seed-'));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  fs.copyFileSync(path.join(TICKETING, 'docker-compose.yml'), path.join(repo, 'docker-compose.yml'));
  return repo;
}

/** Reserved top-level dir names — never part of a scaffold payload. */
const RESERVED_WALK_DIRS = new Set(['.sequence', '.git', '.ssh', '.aws', '.gnupg', 'node_modules']);

/** Recursively collect every file under `root` as a {path, content} payload entry. */
function collectScaffoldFiles(root: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      if (dir === root && RESERVED_WALK_DIRS.has(name)) continue;
      const abs = path.join(dir, name);
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) walk(abs);
      else out.push({ path: path.relative(root, abs), content: fs.readFileSync(abs, 'utf8') });
    }
  };
  walk(root);
  return out;
}

const SCAFFOLD_FILES = collectScaffoldFiles(TICKETING);

/** A payload that omits the worker's subscribe wiring → the queue_consume edge goes missing. */
const BROKEN_FILES = SCAFFOLD_FILES.map((f) =>
  f.path === path.join('worker', 'index.ts')
    ? {
        path: f.path,
        // Same service, but no subscribe() call — the queue_consume edge vanishes.
        content: [
          "import { createClient } from 'redis';",
          '// worker connects but (deliberately) never subscribes',
          'const client = createClient({ url: process.env.REDIS_URL });',
          'async function main() { await client.connect(); }',
          'main().catch((err) => { console.error(err); process.exit(1); });',
          '',
        ].join('\n'),
      }
    : f
);

function filesReply(files: { path: string; content: string }[], notes?: string): string {
  return JSON.stringify({ files, notes });
}

/** An isolated user-config dir, so a test never reads or writes the real HOME. */
function tempUserDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-ai-user-')));
}

async function startServer(
  repoRoot: string,
  userConfigDir: string = tempUserDir(),
): Promise<{ base: string; close: () => Promise<void> }> {
  /*
   * THE USER DIR IS ISOLATED BY DEFAULT HERE, NOT OPT-IN.
   *
   * The AI config falls back to the user-level `~/.sequence/ai.json`, so on any
   * machine where a human has connected a key — every developer machine — this
   * file's very first assertion ("not configured yet") saw `configured: true`
   * and failed. A test about whether the SERVER is configured cannot be allowed
   * to depend on whoever is running it; defaulting the isolation means the next
   * test added to this file cannot forget it.
   */
  /* PER-REPO AI CONFIG IS A TRUSTED-REPO FEATURE, so this fixture consents.
     A repo's own `.sequence/ai.json` is ignored while untrusted — it can point
     `baseUrl` at an attacker's host and take every question and file excerpt
     with it — and the user's settings go to the user store instead. The
     assertions below are about key masking, redaction and per-repo precedence,
     not about trust, so the fixture says yes the way a reader would.
     `isRepoTrusted`'s OWN default store, never `userConfigDir`: the boundary has
     one store and `isolate-user-store.js` has already isolated it. */
  setRepoTrust(userStoreDir(), repoRoot, true);
  const server = await createRepoServer(repoRoot, { webDist: undefined, userConfigDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function putAiConfig(base: string, baseUrl: string): Promise<Response> {
  return fetch(`${base}/api/ai-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'anthropic', baseUrl, model: 'claude-test', apiKey: TEST_KEY }),
  });
}

/* ============================================================ ai-config ===== */

test('ai-config PUT/GET round-trips with the key redacted; 415/400 on garbage', async () => {
  const repo = ticketingRepo();
  const { base, close } = await startServer(repo);
  try {
    // not configured yet
    const before = (await (await fetch(`${base}/api/ai-config`)).json()) as { configured: boolean };
    assert.strictEqual(before.configured, false);

    const put = await putAiConfig(base, 'http://127.0.0.1:9');
    assert.strictEqual(put.status, 200);
    const putBody = (await put.json()) as { apiKey: string };
    // PUT response is already redacted.
    assert.ok(!putBody.apiKey.includes(TEST_KEY), 'PUT response must not contain the raw key');
    assert.ok(putBody.apiKey.endsWith(TEST_KEY.slice(-4)), 'redacted key shows last4');

    // GET redacts; on-disk ai.json holds the FULL key.
    const get = await fetch(`${base}/api/ai-config`);
    const getBody = (await get.json()) as { configured: boolean; apiKey: string; provider: string };
    assert.strictEqual(getBody.configured, true);
    assert.strictEqual(getBody.provider, 'anthropic');
    assert.ok(!getBody.apiKey.includes(TEST_KEY), 'GET must never return the raw key');
    assert.match(getBody.apiKey, /^••••/);

    const onDisk = fs.readFileSync(path.join(repo, '.sequence', 'ai.json'), 'utf8');
    assert.ok(onDisk.includes(TEST_KEY), 'the on-disk ai.json must hold the full key');

    // wrong content-type
    const badCt = await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    assert.strictEqual(badCt.status, 415);

    // malformed shape
    const badShape = await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'nope', model: '', apiKey: '' }),
    });
    assert.strictEqual(badShape.status, 400);
    const badBody = (await badShape.json()) as { error: string };
    assert.ok(!badBody.error.includes(TEST_KEY));
  } finally {
    await close();
  }
});

test('ai-config saves a keyless loopback model and returns no invented key mask', async () => {
  const repo = ticketingRepo();
  const { base, close } = await startServer(repo);
  try {
    const put = await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'api-key',
        provider: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: 'granite4-hermes:latest',
      }),
    });
    assert.strictEqual(put.status, 200);
    const putBody = (await put.json()) as Record<string, unknown>;
    assert.strictEqual(putBody.configured, true);
    assert.ok(!('apiKey' in putBody));

    const getBody = (await (await fetch(`${base}/api/ai-config`)).json()) as Record<string, unknown>;
    assert.strictEqual(getBody.configured, true);
    assert.ok(!('apiKey' in getBody));

    const onDisk = JSON.parse(fs.readFileSync(path.join(repo, '.sequence', 'ai.json'), 'utf8')) as Record<string, unknown>;
    assert.ok(!('apiKey' in onDisk), 'keyless is represented by absence, never a placeholder credential');
  } finally {
    await close();
  }
});

/* ============================================================ generate ====== */

test('generate against the mock writes the scaffold and diff reports zero drift', async () => {
  const spec = JSON.parse(fs.readFileSync(TICKETING_SPEC, 'utf8')) as ArchGraph;
  const mock = await startMockProvider(() => ({ text: filesReply(SCAFFOLD_FILES, 'scaffolded') }));
  const repo = seedRepo(); // generate from nothing — the one-motion proof
  const { base, close } = await startServer(repo);
  try {
    assert.strictEqual((await putAiConfig(base, mock.baseUrl)).status, 200);

    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ specOverride: spec }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as {
      written: string[];
      scan: Record<string, number>;
      diff: { added: string[]; removed: string[]; mismatched: string[]; markdown: string };
      notes?: string;
    };

    // files landed where the model claimed
    assert.ok(body.written.includes(path.join('gateway', 'index.ts')));
    assert.ok(body.written.includes(path.join('api', 'app', 'main.py')));
    assert.ok(body.written.includes(path.join('worker', 'index.ts')));
    for (const w of body.written) assert.ok(fs.existsSync(path.join(repo, w)), `${w} written to disk`);

    // rescan is a valid graph with all three services
    assert.strictEqual(body.scan.services, 3);
    assert.strictEqual(body.notes, 'scaffolded');

    // zero drift against the spec
    assert.deepStrictEqual(body.diff.added, []);
    assert.deepStrictEqual(body.diff.removed, []);
    assert.deepStrictEqual(body.diff.mismatched, []);
    assert.match(body.diff.markdown, /conforms to spec/);

    assert.strictEqual(mock.requests.length, 1);
  } finally {
    await close();
    await mock.close();
  }
});

test('r179: a successful generate SAVES the design it generated from, and a later generate runs on it', async () => {
  // The read side of `.sequence/spec.json` existed since v6 (generate, the DDL
  // preview and prompt-file's conformance diff all read it) but the only writer
  // was a PUT no surface ever called — so in the shipped app the stored spec was
  // always absent and that whole seam was dead. Generate is now the writer: the
  // design that really produced code is the project's spec.
  const spec = JSON.parse(fs.readFileSync(TICKETING_SPEC, 'utf8')) as ArchGraph;
  const mock = await startMockProvider(() => ({ text: filesReply(SCAFFOLD_FILES, 'scaffolded') }));
  const repo = seedRepo();
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const onDisk = path.join(repo, '.sequence', 'spec.json');
    assert.ok(!fs.existsSync(onDisk), 'no spec before the first generate');

    const first = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ specOverride: spec }),
    });
    assert.strictEqual(first.status, 200);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(onDisk, 'utf8')), spec, 'the generated-from design is stored');

    // Now the fallback is real: a generate with NO spec in the request scaffolds
    // from the stored one instead of failing with "no design spec found".
    const second = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'same design, run it again' }),
    });
    assert.strictEqual(second.status, 200, 'the stored spec is enough to generate again');
    const body = (await second.json()) as { written: string[]; diff: { markdown: string } };
    assert.ok(body.written.includes(path.join('worker', 'index.ts')));
    assert.match(body.diff.markdown, /conforms to spec/, 'the diff measured the stored design');

    // And the DDL preview reads the same stored spec (no spec in the request).
    const ddl = await fetch(`${base}/api/ddl`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(ddl.status, 200);
    assert.match(((await ddl.json()) as { sql: string }).sql, /CREATE TABLE IF NOT EXISTS tickets/);
  } finally {
    await close();
    await mock.close();
  }
});

test('generate with a broken payload reports the missing queue_consume edge in the diff', async () => {
  const spec = JSON.parse(fs.readFileSync(TICKETING_SPEC, 'utf8')) as ArchGraph;
  const mock = await startMockProvider(() => ({ text: filesReply(BROKEN_FILES) }));
  const repo = seedRepo();
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ specOverride: spec }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as {
      diff: { removed: string[]; markdown: string };
    };
    // The worker→ticket.created queue_consume edge is in the spec but not the impl.
    assert.ok(
      body.diff.removed.some((e) => e.includes('worker') && e.includes('queue_consume')),
      `expected a missing queue_consume edge in ${JSON.stringify(body.diff.removed)}`
    );
    assert.match(body.diff.markdown, /Missing from implementation/);
  } finally {
    await close();
    await mock.close();
  }
});

test('generate refuses an unscaffoldable spec with 422 BEFORE any provider call', async () => {
  // A structurally-valid but unscaffoldable design spec: a service with no language.
  const spec: ArchGraph = {
    version: 1,
    mode: 'design',
    scannedAt: '',
    repoRoot: '',
    repoName: 'x',
    nodes: [
      { id: 'repo', kind: 'repo', label: 'x' },
      { id: 'svc:a', kind: 'service', label: 'a', parentId: 'repo', meta: {} },
    ],
    edges: [],
    warnings: [],
  };
  let called = 0;
  const mock = await startMockProvider(() => {
    called++;
    return { text: filesReply([]) };
  });
  const repo = ticketingRepo();
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ specOverride: spec }),
    });
    assert.strictEqual(res.status, 422);
    const body = (await res.json()) as { error: string; problems: string[] };
    assert.ok(Array.isArray(body.problems) && body.problems.length > 0);
    assert.strictEqual(called, 0, 'the provider must not be called for an unscaffoldable spec');
    assert.strictEqual(mock.requests.length, 0);
  } finally {
    await close();
    await mock.close();
  }
});

test('a malicious model response (traversal / absolute / .sequence targets) writes nothing', async () => {
  const spec = JSON.parse(fs.readFileSync(TICKETING_SPEC, 'utf8')) as ArchGraph;
  const evil = [
    { path: '../escape.txt', content: 'pwned' },
    { path: '/tmp/sequence-abs-escape.txt', content: 'pwned' },
    { path: '.sequence/ai.json', content: '{"apiKey":"stolen"}' },
    { path: '.git/hooks/pre-commit', content: '#!/bin/sh\necho pwned' },
  ];
  const mock = await startMockProvider(() => ({ text: filesReply(evil) }));
  const repo = ticketingRepo();
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const treeBefore = await (await fetch(`${base}/api/tree`)).text();

    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ specOverride: spec }),
    });
    assert.strictEqual(res.status, 422);
    const body = (await res.json()) as { error: string; rejected: { path: string; reason: string }[] };
    assert.strictEqual(body.rejected.length, 4, 'all four unsafe paths rejected');

    // nothing escaped, nothing clobbered
    assert.ok(!fs.existsSync(path.join(repo, '..', 'escape.txt')), 'no parent-dir escape');
    assert.ok(!fs.existsSync('/tmp/sequence-abs-escape.txt'), 'no absolute-path write');
    // ai.json still holds our real key, not the injected one
    const aiOnDisk = fs.readFileSync(path.join(repo, '.sequence', 'ai.json'), 'utf8');
    assert.ok(aiOnDisk.includes(TEST_KEY) && !aiOnDisk.includes('stolen'), '.sequence/ai.json untouched');
    assert.ok(!fs.existsSync(path.join(repo, '.git', 'hooks', 'pre-commit')), 'no .git write');

    // repo tree unchanged
    const treeAfter = await (await fetch(`${base}/api/tree`)).text();
    assert.strictEqual(treeAfter, treeBefore, 'the repo tree must be unchanged');
  } finally {
    await close();
    await mock.close();
  }
});

test('a model write through an in-repo symlink into .sequence is rejected; ai.json untouched', async () => {
  // Round-2 write-side of the lexical-reserved-guard bug: the model returns a
  // file at `docs/ai.json` where `docs` → `.sequence` (an in-repo symlink, so the
  // jail's containment passes). The old lexical guard saw top segment `docs` and
  // let the write through, clobbering the real key with the attacker's. The
  // realpath-based guard now rejects the whole request; the key stays put.
  const spec = JSON.parse(fs.readFileSync(TICKETING_SPEC, 'utf8')) as ArchGraph;
  const ATTACKER_KEY = 'sk-ant-ATTACKER-substituted-key';
  const evil = [{ path: path.join('docs', 'ai.json'), content: JSON.stringify({ provider: 'anthropic', model: 'x', apiKey: ATTACKER_KEY }) }];
  const mock = await startMockProvider(() => ({ text: filesReply(evil) }));
  const repo = seedRepo();
  try {
    /*
     * The type argument is required on Windows and ignored on POSIX. The target
     * does not exist yet — .sequence is created lazily by putAiConfig below — and
     * Windows bakes the link TYPE at creation time, so a dangling target without
     * this becomes a FILE symlink. The scan then cannot walk it, the repo fails to
     * attach, and /api/generate answers the no-repo 409 instead of exercising the
     * reserved-dir guard this test exists for.
     */
    fs.symlinkSync('.sequence', path.join(repo, 'docs'), 'dir');
  } catch {
    await mock.close();
    return; // symlinks not permitted here; skip
  }
  const { base, close } = await startServer(repo);
  try {
    // putAiConfig writes the REAL key to .sequence/ai.json (creating .sequence/).
    assert.strictEqual((await putAiConfig(base, mock.baseUrl)).status, 200);
    const before = fs.readFileSync(path.join(repo, '.sequence', 'ai.json'), 'utf8');
    assert.ok(before.includes(TEST_KEY));

    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ specOverride: spec }),
    });
    assert.strictEqual(res.status, 422, 'symlinked reserved write must be rejected whole-request');
    const body = (await res.json()) as { rejected: { path: string; reason: string }[] };
    assert.ok(
      body.rejected.some((r) => /\.sequence\/ or \.git\//.test(r.reason)),
      `expected a reserved-dir rejection, got ${JSON.stringify(body.rejected)}`
    );

    // The on-disk key is UNCHANGED: still the real key, never the attacker's.
    const after = fs.readFileSync(path.join(repo, '.sequence', 'ai.json'), 'utf8');
    assert.strictEqual(after, before, '.sequence/ai.json must be byte-for-byte unchanged');
    assert.ok(after.includes(TEST_KEY) && !after.includes(ATTACKER_KEY), 'real key preserved, attacker key not written');
  } finally {
    await close();
    await mock.close();
  }
});

test('F1: a model write targeting .ssh/authorized_keys is rejected whole-request; nothing written', async () => {
  // F1 write-side (layer 2): a hostile provider response tries to plant an SSH
  // authorized_keys. The reserved-dir set now covers .ssh/.aws/.gnupg, so the
  // whole request is refused (all-or-nothing) and even the safe sibling file is
  // not written.
  const spec = JSON.parse(fs.readFileSync(TICKETING_SPEC, 'utf8')) as ArchGraph;
  const evil = [
    { path: path.join('gateway', 'should-not-appear.ts'), content: 'export const ok = 1;\n' },
    { path: path.join('.ssh', 'authorized_keys'), content: 'ssh-rsa ATTACKER-KEY attacker@evil\n' },
  ];
  const mock = await startMockProvider(() => ({ text: filesReply(evil) }));
  const repo = ticketingRepo();
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const treeBefore = await (await fetch(`${base}/api/tree`)).text();

    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ specOverride: spec }),
    });
    assert.strictEqual(res.status, 422, 'a reserved .ssh write rejects the whole request');
    const body = (await res.json()) as { rejected: { path: string; reason: string }[] };
    assert.ok(
      body.rejected.some((r) => r.path.includes('authorized_keys') && /reserved/.test(r.reason)),
      `expected the .ssh write rejected as reserved, got ${JSON.stringify(body.rejected)}`
    );

    // Nothing written — neither the malicious file nor the safe sibling (all-or-nothing).
    assert.ok(!fs.existsSync(path.join(repo, '.ssh', 'authorized_keys')), 'authorized_keys must not be written');
    assert.ok(
      !fs.existsSync(path.join(repo, 'gateway', 'should-not-appear.ts')),
      'the safe sibling must not be written on whole-request rejection'
    );
    const treeAfter = await (await fetch(`${base}/api/tree`)).text();
    assert.strictEqual(treeAfter, treeBefore, 'the repo tree must be unchanged');
  } finally {
    await close();
    await mock.close();
  }
});

/* ============================================================ size caps ===== */

test('an over-cap provider response body is refused cleanly (502); the server stays alive', async () => {
  const spec = JSON.parse(fs.readFileSync(TICKETING_SPEC, 'utf8')) as ArchGraph;
  let calls = 0;
  const huge = 'x'.repeat(21 * 1024 * 1024); // > the 20 MB provider-response cap
  const mock = await startMockProvider(() => {
    calls++;
    // First call floods an over-cap body; later calls behave normally, so we can
    // prove the server survived the abort and still serves requests.
    return calls === 1 ? { text: huge } : { text: filesReply(SCAFFOLD_FILES, 'ok') };
  });
  const repo = seedRepo();
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const treeBefore = await (await fetch(`${base}/api/tree`)).text();

    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ specOverride: spec }),
    });
    assert.strictEqual(res.status, 502, 'over-cap provider body → clean 502');
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /cap|exceeded/i);
    assert.ok(!JSON.stringify(body).includes(TEST_KEY), 'error body must not contain the key');

    // Nothing was written by the failed generate.
    const treeAfter = await (await fetch(`${base}/api/tree`)).text();
    assert.strictEqual(treeAfter, treeBefore, 'nothing written on the over-cap failure');

    // The server survived the aborted stream: a subsequent generate succeeds.
    const ok = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ specOverride: spec }),
    });
    assert.strictEqual(ok.status, 200, 'the server stayed alive and served the next request');
  } finally {
    await close();
    await mock.close();
  }
});

test('an over-cap single file inside an under-cap response is rejected; nothing written', async () => {
  const spec = JSON.parse(fs.readFileSync(TICKETING_SPEC, 'utf8')) as ArchGraph;
  const bigContent = 'x'.repeat(3_000_000); // > 2 MB per-file cap, < 20 MB response cap
  const payload = [
    { path: 'gateway/index.ts', content: 'export const ok = 1;\n' }, // safe, but must NOT be written
    { path: 'huge.txt', content: bigContent },
  ];
  const mock = await startMockProvider(() => ({ text: filesReply(payload) }));
  const repo = seedRepo();
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const treeBefore = await (await fetch(`${base}/api/tree`)).text();
    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ specOverride: spec }),
    });
    assert.strictEqual(res.status, 422, 'whole-request rejection on an over-cap file');
    const body = (await res.json()) as { rejected: { path: string; reason: string }[] };
    assert.ok(
      body.rejected.some((r) => r.path === 'huge.txt' && /per-file cap/.test(r.reason)),
      `expected the over-cap file rejected, got ${JSON.stringify(body.rejected)}`
    );
    // Whole-request semantics: the OTHER (safe) file is not written either.
    assert.ok(!fs.existsSync(path.join(repo, 'gateway', 'index.ts')), 'nothing written on rejection');
    assert.ok(!fs.existsSync(path.join(repo, 'huge.txt')), 'the over-cap file is not written');
    const treeAfter = await (await fetch(`${base}/api/tree`)).text();
    assert.strictEqual(treeAfter, treeBefore, 'repo tree unchanged');
  } finally {
    await close();
    await mock.close();
  }
});

/* ============================================================ prompt-file === */

test('prompt-file reads a jailed file, applies the mock rewrite, and rescans+diffs', async () => {
  const spec = JSON.parse(fs.readFileSync(TICKETING_SPEC, 'utf8')) as ArchGraph;
  let sawFileContent = false;
  const mock = await startMockProvider((reqBody) => {
    const text = JSON.stringify(reqBody);
    const worker = SCAFFOLD_FILES.find((f) => f.path === path.join('worker', 'index.ts'))!;
    // The seeding generate is answered with the scaffold exactly as it is on disk.
    if (!text.includes('--- FILE:')) return { text: filesReply(SCAFFOLD_FILES, 'seed') };
    // The prompt-file call: the provider receives the current file content in the
    // prompt, and returns the same file lightly edited (keeps the scaffold conforming).
    if (text.includes('subscribe') && text.includes('ticket.created')) sawFileContent = true;
    return { text: filesReply([{ path: worker.path, content: worker.content + '\n// touched by prompt-file\n' }]) };
  });
  const repo = ticketingRepo();
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    // r179: the project's spec is saved by a successful GENERATE (the design the
    // code came from) — the PUT /api/spec endpoint that used to seed it here was
    // removed because nothing in the product ever called it. The scaffold on disk
    // already matches this spec, so the model returns it byte-for-byte: an
    // identical rewrite needs no overwrite confirmation, and the generate leaves
    // `.sequence/spec.json` behind for prompt-file to diff against.
    const seed = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ specOverride: spec }),
    });
    assert.strictEqual(seed.status, 200, 'the seeding generate must succeed');
    assert.ok(
      fs.existsSync(path.join(repo, '.sequence', 'spec.json')),
      'a successful generate persists the spec it generated from'
    );

    const res = await fetch(`${base}/api/prompt-file`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'worker/index.ts', prompt: 'add a comment' }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as {
      written: string[];
      diff: { added: string[]; removed: string[]; mismatched: string[] } | null;
    };
    assert.ok(sawFileContent, 'the provider prompt included the jailed file content');
    assert.ok(body.written.includes(path.join('worker', 'index.ts')));
    assert.ok(fs.readFileSync(path.join(repo, 'worker', 'index.ts'), 'utf8').includes('touched by prompt-file'));
    // still conforms
    assert.ok(body.diff && body.diff.removed.length === 0 && body.diff.added.length === 0);

    // a reserved / traversal path is refused before any provider hop
    const reserved = await fetch(`${base}/api/prompt-file`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '.sequence/ai.json', prompt: 'leak the key' }),
    });
    assert.strictEqual(reserved.status, 403);
  } finally {
    await close();
    await mock.close();
  }
});

/* ============================================================ key hygiene === */

test('the api key never appears in server stdout/stderr, nor in a provider-error body', async () => {
  const spec = JSON.parse(fs.readFileSync(TICKETING_SPEC, 'utf8')) as ArchGraph;

  // Capture everything the process writes while a generate runs.
  const captured: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  const origLog = console.log;
  const origErrorLog = console.error;
  const grab = (chunk: unknown): boolean => {
    captured.push(String(chunk));
    return true;
  };

  // First: a provider that 500s with a body — assert the error surfaced to the
  // client carries the provider body but never our key.
  const failMock = await startMockProvider(() => ({
    status: 500,
    rawBody: JSON.stringify({ error: { message: 'upstream boom', type: 'overloaded' } }),
  }));
  const repo = ticketingRepo();
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, failMock.baseUrl);

    (process.stdout.write as unknown) = grab;
    (process.stderr.write as unknown) = grab;
    console.log = (...a: unknown[]) => grab(a.join(' '));
    console.error = (...a: unknown[]) => grab(a.join(' '));

    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ specOverride: spec }),
    });

    (process.stdout.write as unknown) = origOut;
    (process.stderr.write as unknown) = origErr;
    console.log = origLog;
    console.error = origErrorLog;

    assert.strictEqual(res.status, 502);
    const body = (await res.json()) as { error: string; providerResponse?: string };
    assert.ok(body.providerResponse && body.providerResponse.includes('upstream boom'), 'provider body surfaced');
    assert.ok(!JSON.stringify(body).includes(TEST_KEY), 'error body must not contain the key');
    assert.ok(!captured.join('').includes(TEST_KEY), 'server logs must not contain the key');
  } finally {
    // restore no matter what
    (process.stdout.write as unknown) = origOut;
    (process.stderr.write as unknown) = origErr;
    console.log = origLog;
    console.error = origErrorLog;
    await close();
    await failMock.close();
  }
});

/* ============================================================ gitignore ===== */

test('.gitignore covers .sequence/ so the key is never committed', async () => {
  const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
  // The key lives at .sequence/ai.json and must be ignored. Accept EITHER a blanket
  // `.sequence/` rule OR the more precise `.sequence/*` form (v16 ships program
  // TEMPLATES under .sequence/programs via `.sequence/*` + a `!.sequence/programs/…`
  // negation — ai.json still matches `.sequence/*` and stays ignored).
  assert.ok(
    /^\.sequence\/?$/m.test(gitignore) || /^\.sequence\/\*$/m.test(gitignore),
    `.gitignore must ignore .sequence/ (or .sequence/*) so the key is never committed; got:\n${gitignore}`
  );
});
