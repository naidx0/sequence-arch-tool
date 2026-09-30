import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { type ArchGraph } from '@sequence/schema';
import { startMockProvider } from './mock-provider.js';

/**
 * r179 — NO SILENT DATA LOSS on the AI write endpoints (vision.md §5).
 *
 * `/api/generate` and `/api/prompt-file` used to `fs.writeFileSync` every path the
 * model returned after only jail / reserved-dir / size vetting. A model that
 * decided to "rewrite" a file you had spent a week on replaced it, silently, with
 * no dry-run, no Accept, and no mention in the response — while the board's own
 * multi-file apply (packages/web/src/panels/multiFileApply.ts) had refused exactly
 * that since r122 (dry-run → wouldOverwrite → explicit Accept).
 *
 * The server now speaks the same rule:
 *   - a destination that already holds content is REFUSED (409) unless the request
 *     confirmed it — `overwrite: true`, or `overwrite: ["a.ts", "b.ts"]`;
 *   - the refusal is all-or-nothing and NAMES every file it protected;
 *   - a create, an empty destination, and a byte-identical rewrite carry no
 *     friction (there is nothing to lose in any of them);
 *   - /api/prompt-file's own target is confirmed BY the request (the human pointed
 *     at that file and asked for it to change) — but only that one file.
 *
 * Every test here asserts the protected bytes are still on disk afterwards: a
 * status code alone would not prove the file survived.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> dist -> analyzer -> packages -> <repo root>
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const TICKETING = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');
const TICKETING_SPEC = path.join(REPO_ROOT, 'examples', 'ticketing.spec.json');

const TEST_KEY = 'sk-ant-test-SUPERSECRET-9f3a2b';

/** The hand-written work a careless generate would destroy. */
const PRECIOUS = [
  '// hand-written by the user over a week.',
  'export function doNotLoseMe(): string {',
  "  return 'a week of work';",
  '}',
  '',
].join('\n');

const OTHER_PRECIOUS = '// also hand-written; also not the model\'s to replace.\nexport const keep = true;\n';

function spec(): ArchGraph {
  return JSON.parse(fs.readFileSync(TICKETING_SPEC, 'utf8')) as ArchGraph;
}

/**
 * A repo the scanner can read (it needs the compose manifest) plus whatever files
 * the test wants pre-existing on disk.
 */
function repoWith(files: { path: string; content: string }[] = [], dirs: string[] = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-overwrite-'));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  fs.copyFileSync(path.join(TICKETING, 'docker-compose.yml'), path.join(repo, 'docker-compose.yml'));
  for (const d of dirs) fs.mkdirSync(path.join(repo, d), { recursive: true });
  for (const f of files) {
    const abs = path.join(repo, f.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content);
  }
  return repo;
}

function filesReply(files: { path: string; content: string }[], notes?: string): string {
  return JSON.stringify({ files, notes });
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

async function putAiConfig(base: string, baseUrl: string): Promise<Response> {
  return fetch(`${base}/api/ai-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'anthropic', baseUrl, model: 'claude-test', apiKey: TEST_KEY }),
  });
}

function postGenerate(base: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ specOverride: spec(), ...body }),
  });
}

function postPromptFile(base: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${base}/api/prompt-file`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/* ================================================================= generate === */

test('generate REFUSES to replace a file that already has content; the bytes are identical after', async () => {
  const repo = repoWith([{ path: 'gateway/index.ts', content: PRECIOUS }]);
  const mock = await startMockProvider(() =>
    filesReplyResponse([
      { path: 'gateway/index.ts', content: '// the model decided to rewrite your week\n' },
      { path: 'gateway/brand-new.ts', content: 'export const fresh = 1;\n' },
    ])
  );
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await postGenerate(base, {});
    assert.strictEqual(res.status, 409, 'an unconfirmed replacement is refused, not performed');
    const body = (await res.json()) as { error: string; wouldOverwrite: string[] };

    // It NAMES what it protected — the user can act on this without guessing.
    assert.deepStrictEqual(body.wouldOverwrite, ['gateway/index.ts']);
    assert.ok(body.error.includes('gateway/index.ts'), `the message names the file: ${body.error}`);
    assert.match(body.error, /^nothing was written/, 'it says what did NOT happen, first');

    // The bytes survived, and the all-or-nothing rule held: the safe sibling was
    // not written either, so the repo is exactly as it was.
    assert.strictEqual(fs.readFileSync(path.join(repo, 'gateway', 'index.ts'), 'utf8'), PRECIOUS);
    assert.ok(!fs.existsSync(path.join(repo, 'gateway', 'brand-new.ts')), 'nothing written on refusal');
    assert.ok(!fs.existsSync(path.join(repo, 'db', 'schema.sql')), 'no server-authored write either');
    assert.ok(!fs.existsSync(path.join(repo, '.sequence', 'spec.json')), 'a refused generate stores no spec');
  } finally {
    await close();
    await mock.close();
  }
});

test('generate WITH explicit confirmation (overwrite:true) replaces the file and reports it written', async () => {
  const repo = repoWith([{ path: 'gateway/index.ts', content: PRECIOUS }]);
  const REPLACEMENT = '// the model decided to rewrite your week\n';
  const mock = await startMockProvider(() =>
    filesReplyResponse([
      { path: 'gateway/index.ts', content: REPLACEMENT },
      { path: 'gateway/brand-new.ts', content: 'export const fresh = 1;\n' },
    ])
  );
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await postGenerate(base, { overwrite: true });
    assert.strictEqual(res.status, 200, 'confirmed ⇒ the write happens exactly as before');
    const body = (await res.json()) as { written: string[] };
    assert.ok(body.written.includes(path.join('gateway', 'index.ts')));
    assert.ok(body.written.includes(path.join('gateway', 'brand-new.ts')));
    assert.strictEqual(fs.readFileSync(path.join(repo, 'gateway', 'index.ts'), 'utf8'), REPLACEMENT);
  } finally {
    await close();
    await mock.close();
  }
});

test('generate with a per-file confirmation list: an unnamed file still protects the whole request', async () => {
  const repo = repoWith([
    { path: 'gateway/index.ts', content: PRECIOUS },
    { path: 'api/app/main.py', content: OTHER_PRECIOUS },
  ]);
  const mock = await startMockProvider(() =>
    filesReplyResponse([
      { path: 'gateway/index.ts', content: '// rewritten\n' },
      { path: 'api/app/main.py', content: '# rewritten\n' },
    ])
  );
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);

    // Confirming ONE of the two is not consent for the other.
    const partial = await postGenerate(base, { overwrite: ['gateway/index.ts'] });
    assert.strictEqual(partial.status, 409);
    const partialBody = (await partial.json()) as { error: string; wouldOverwrite: string[] };
    assert.deepStrictEqual(partialBody.wouldOverwrite, ['api/app/main.py'], 'only the UNconfirmed file is named');
    assert.ok(!partialBody.error.includes('gateway/index.ts'), 'a confirmed file is not reported as protected');
    assert.strictEqual(fs.readFileSync(path.join(repo, 'gateway', 'index.ts'), 'utf8'), PRECIOUS, 'still untouched');
    assert.strictEqual(fs.readFileSync(path.join(repo, 'api', 'app', 'main.py'), 'utf8'), OTHER_PRECIOUS);

    // Naming BOTH writes both.
    const full = await postGenerate(base, { overwrite: ['gateway/index.ts', 'api/app/main.py'] });
    assert.strictEqual(full.status, 200);
    assert.strictEqual(fs.readFileSync(path.join(repo, 'gateway', 'index.ts'), 'utf8'), '// rewritten\n');
    assert.strictEqual(fs.readFileSync(path.join(repo, 'api', 'app', 'main.py'), 'utf8'), '# rewritten\n');
  } finally {
    await close();
    await mock.close();
  }
});

test('generate writes NEW and EMPTY destinations with no friction (nothing to lose ⇒ nothing to confirm)', async () => {
  const repo = repoWith([{ path: 'gateway/placeholder.ts', content: '' }]);
  const mock = await startMockProvider(() =>
    filesReplyResponse([
      { path: 'gateway/placeholder.ts', content: 'export const filled = true;\n' },
      { path: 'gateway/index.ts', content: 'export const created = true;\n' },
    ])
  );
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await postGenerate(base, {}); // NO overwrite flag at all
    assert.strictEqual(res.status, 200, 'a zero-byte file and a new path need no confirmation');
    assert.strictEqual(fs.readFileSync(path.join(repo, 'gateway', 'placeholder.ts'), 'utf8'), 'export const filled = true;\n');
    assert.strictEqual(fs.readFileSync(path.join(repo, 'gateway', 'index.ts'), 'utf8'), 'export const created = true;\n');
  } finally {
    await close();
    await mock.close();
  }
});

test('generate re-writing BYTE-IDENTICAL content is a no-op, not a loss — no confirmation needed', async () => {
  const repo = repoWith([{ path: 'gateway/index.ts', content: PRECIOUS }]);
  const mock = await startMockProvider(() =>
    filesReplyResponse([{ path: 'gateway/index.ts', content: PRECIOUS }])
  );
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await postGenerate(base, {});
    assert.strictEqual(res.status, 200, 'identical bytes lose nothing, so the gate must not nag');
    const body = (await res.json()) as { written: string[] };
    assert.ok(body.written.includes(path.join('gateway', 'index.ts')));
    assert.strictEqual(fs.readFileSync(path.join(repo, 'gateway', 'index.ts'), 'utf8'), PRECIOUS);
  } finally {
    await close();
    await mock.close();
  }
});

test('the deterministic db/schema.sql is protected too: a hand-edited schema is never silently replaced', async () => {
  const HAND_SQL = '-- hand-tuned by the DBA; indexes and all.\nCREATE TABLE tickets (id uuid primary key, urgency int);\n';
  const repo = repoWith([{ path: 'db/schema.sql', content: HAND_SQL }]);
  const mock = await startMockProvider(() =>
    filesReplyResponse([{ path: 'gateway/index.ts', content: 'export const ok = 1;\n' }])
  );
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    // The ticketing spec has db tables, so generate wants to emit db/schema.sql.
    // It is server-authored, but it is still someone's file.
    const res = await postGenerate(base, {});
    assert.strictEqual(res.status, 409, 'the server-authored write obeys the same rule');
    const body = (await res.json()) as { wouldOverwrite: string[] };
    assert.deepStrictEqual(body.wouldOverwrite, ['db/schema.sql']);
    assert.strictEqual(fs.readFileSync(path.join(repo, 'db', 'schema.sql'), 'utf8'), HAND_SQL, 'DDL untouched');
    assert.ok(!fs.existsSync(path.join(repo, 'gateway', 'index.ts')), 'all-or-nothing: no model file landed either');

    const confirmed = await postGenerate(base, { overwrite: true });
    assert.strictEqual(confirmed.status, 200);
    assert.match(fs.readFileSync(path.join(repo, 'db', 'schema.sql'), 'utf8'), /generated by sequence/);
  } finally {
    await close();
    await mock.close();
  }
});

test('a malformed overwrite flag is an honest 400 BEFORE any provider call (consent is never guessed)', async () => {
  const repo = repoWith([{ path: 'gateway/index.ts', content: PRECIOUS }]);
  let called = 0;
  const mock = await startMockProvider(() => {
    called++;
    return filesReplyResponse([{ path: 'gateway/index.ts', content: 'rewritten\n' }]);
  });
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    for (const bad of ['yes', 1, { all: true }, ['ok', 7]]) {
      const res = await postGenerate(base, { overwrite: bad });
      assert.strictEqual(res.status, 400, `overwrite:${JSON.stringify(bad)} must not be interpreted`);
      const body = (await res.json()) as { error: string };
      assert.match(body.error, /confirm the replacement/i);
      assert.ok(!/\b(GET|POST|PUT|DELETE|PATCH)\s+\/api/.test(body.error), 'human copy, not a route');
    }
    assert.strictEqual(called, 0, 'no tokens spent on a request we refuse to interpret');
    assert.strictEqual(fs.readFileSync(path.join(repo, 'gateway', 'index.ts'), 'utf8'), PRECIOUS);
  } finally {
    await close();
    await mock.close();
  }
});

test('a DIRECTORY sitting at a model write path is refused whole-request (never a half-applied EISDIR)', async () => {
  const repo = repoWith([], ['gateway/index.ts']); // a directory where the model wants a file
  const mock = await startMockProvider(() =>
    filesReplyResponse([
      { path: 'gateway/safe.ts', content: 'export const ok = 1;\n' },
      { path: 'gateway/index.ts', content: 'export const clash = 1;\n' },
    ])
  );
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await postGenerate(base, { overwrite: true }); // even confirmed, a dir is not a file
    assert.strictEqual(res.status, 422);
    const body = (await res.json()) as { rejected: { path: string; reason: string }[] };
    assert.ok(
      body.rejected.some((r) => r.path === 'gateway/index.ts' && /directory already exists/.test(r.reason)),
      `expected a named directory rejection, got ${JSON.stringify(body.rejected)}`
    );
    assert.ok(fs.statSync(path.join(repo, 'gateway', 'index.ts')).isDirectory(), 'the directory is intact');
    assert.ok(!fs.existsSync(path.join(repo, 'gateway', 'safe.ts')), 'the safe sibling was not written');
  } finally {
    await close();
    await mock.close();
  }
});

/* ============================================================== prompt-file === */

test('prompt-file rewrites the file the human pointed at, but PROTECTS other existing files the model returns', async () => {
  const repo = repoWith([
    { path: 'worker/index.ts', content: PRECIOUS },
    { path: 'shared/util.ts', content: OTHER_PRECIOUS },
  ]);
  const EDITED = `${PRECIOUS}// edited on request\n`;
  const mock = await startMockProvider(() =>
    filesReplyResponse([
      { path: 'worker/index.ts', content: EDITED },
      { path: 'shared/util.ts', content: '// the model helpfully rewrote this too\n' },
    ])
  );
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await postPromptFile(base, { path: 'worker/index.ts', prompt: 'add a trailing comment' });
    assert.strictEqual(res.status, 409, 'the file the user did NOT name is protected');
    const body = (await res.json()) as { error: string; wouldOverwrite: string[] };
    assert.deepStrictEqual(body.wouldOverwrite, ['shared/util.ts'], 'the named target is not reported');
    // All-or-nothing: even the target the user consented to is left alone, so the
    // repo never lands in a half-applied state the user cannot reason about.
    assert.strictEqual(fs.readFileSync(path.join(repo, 'worker', 'index.ts'), 'utf8'), PRECIOUS);
    assert.strictEqual(fs.readFileSync(path.join(repo, 'shared', 'util.ts'), 'utf8'), OTHER_PRECIOUS);

    // Confirming the extra file lets the whole edit through — and the target the
    // human pointed at never needed confirming.
    const ok = await postPromptFile(base, {
      path: 'worker/index.ts',
      prompt: 'add a trailing comment',
      overwrite: ['shared/util.ts'],
    });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(fs.readFileSync(path.join(repo, 'worker', 'index.ts'), 'utf8'), EDITED);
    assert.strictEqual(fs.readFileSync(path.join(repo, 'shared', 'util.ts'), 'utf8'), '// the model helpfully rewrote this too\n');
  } finally {
    await close();
    await mock.close();
  }
});

test('prompt-file: pointing at a file IS the consent for it — a single-file edit needs no extra flag', async () => {
  const repo = repoWith([{ path: 'worker/index.ts', content: PRECIOUS }]);
  const EDITED = '// fully rewritten by request\nexport const rewritten = true;\n';
  const mock = await startMockProvider(() => filesReplyResponse([{ path: 'worker/index.ts', content: EDITED }]));
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    // Spelled with a ./ prefix: consent is matched on the RESOLVED path, not the
    // raw string, so the shipped flow cannot be broken by path spelling.
    const res = await postPromptFile(base, { path: './worker/index.ts', prompt: 'rewrite it' });
    assert.strictEqual(res.status, 200, 'the "point at a file and prompt" feature still works in one shot');
    assert.strictEqual(fs.readFileSync(path.join(repo, 'worker', 'index.ts'), 'utf8'), EDITED);
  } finally {
    await close();
    await mock.close();
  }
});

/* ------------------------------------------------------------------ helper --- */

/** The mock's success envelope for a `{files:[…]}` reply. */
function filesReplyResponse(files: { path: string; content: string }[]): { text: string } {
  return { text: filesReply(files) };
}
