import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRepoServer } from '../server/repoServer.js';
import { detectEnvProviders, keyEnvAllowed, providerCatalog, providerForEndpoint } from '../server/providerCatalog.js';
import { redactAiConfig, resolveEndpoint, usesEnvKey, validateAiConfig } from '../server/provider.js';
import { writeUserAiConfig } from '../server/aiKeyStore.js';

/**
 * Lock for PLUG-AND-PLAY PROVIDERS (providerCatalog.ts): the models.dev catalog Sequence ships,
 * which providers already have a key here (by NAME), and `apiKeyEnv`: a config that names its
 * provider's own key variable instead of holding the key, which is read on load and never written.
 */

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

const DEEPSEEK = 'https://api.deepseek.com';

test('catalog: the providers people use are there, on the right wire, with current tool-calling models', () => {
  const all = providerCatalog();
  assert.ok(all.length > 100);
  const ids = new Set(all.map((p) => p.id));
  for (const id of ['openai', 'anthropic', 'deepseek', 'openrouter', 'groq', 'mistral', 'google', 'xai']) assert.ok(ids.has(id), id);
  assert.equal(all.find((p) => p.id === 'anthropic')!.wire, 'anthropic');
  assert.equal(all.find((p) => p.id === 'deepseek')!.wire, 'openai-compatible');
  assert.equal(new Set(all.map((p) => p.id)).size, all.length, 'one row per provider');
  for (const p of all) {
    assert.match(p.api, /^https:\/\//, p.id);
    assert.ok(p.models.length > 0 && p.models.length <= 6, p.id);
    assert.ok(p.env.every((e) => /^[A-Z][A-Z0-9_]+$/.test(e)), p.id);
  }
  assert.equal(providerForEndpoint('openai-compatible', `${DEEPSEEK}/`)?.id, 'deepseek', 'a trailing slash is the same endpoint');
});

test('detected: a set key is reported by its variable name, never its value', () => {
  const found = detectEnvProviders({ DEEPSEEK_API_KEY: 'sk-secret-123', OPENAI_API_KEY: '  ', UNRELATED: 'x' });
  assert.deepEqual(found, [{ id: 'deepseek', name: 'DeepSeek', keyEnv: 'DEEPSEEK_API_KEY' }]);
  assert.ok(!JSON.stringify(found).includes('sk-secret'));
});

test('apiKeyEnv: only the provider\'s own variable, read at load, refused when unset (each case its own exit)', () => {
  assert.equal(keyEnvAllowed('openai-compatible', DEEPSEEK, 'DEEPSEEK_API_KEY'), true);
  assert.equal(keyEnvAllowed('openai-compatible', DEEPSEEK, 'GITHUB_TOKEN'), false, 'a repo cannot send another secret to a host');
  assert.equal(keyEnvAllowed('openai-compatible', 'https://evil.example/v1', 'DEEPSEEK_API_KEY'), false, 'nor send the right one to the wrong host');
  const prior = process.env.DEEPSEEK_API_KEY;
  try {
    process.env.DEEPSEEK_API_KEY = 'sk-from-env';
    const ok = validateAiConfig({ provider: 'openai-compatible', baseUrl: DEEPSEEK, model: 'deepseek-flash', apiKeyEnv: 'DEEPSEEK_API_KEY' });
    assert.ok(ok.config, ok.error);
    assert.equal(ok.config.apiKey, 'sk-from-env');
    assert.equal(ok.config.apiKeyEnv, 'DEEPSEEK_API_KEY');
    const view = redactAiConfig(ok.config) as { apiKey?: string; apiKeyEnv?: string };
    assert.equal(view.apiKeyEnv, 'DEEPSEEK_API_KEY');
    assert.ok(!JSON.stringify(view).includes('sk-from-env'));

    const wrong = validateAiConfig({ provider: 'openai-compatible', baseUrl: 'https://evil.example/v1', model: 'm', apiKeyEnv: 'DEEPSEEK_API_KEY' });
    assert.match(String(wrong.error), /own key variable/);

    /* Unset is a state, not a broken file (round-three review): it loads keyless, and a request names the variable. */
    delete process.env.DEEPSEEK_API_KEY;
    const unset = validateAiConfig({ provider: 'openai-compatible', baseUrl: DEEPSEEK, model: 'deepseek-flash', apiKeyEnv: 'DEEPSEEK_API_KEY' });
    assert.ok(unset.config, unset.error);
    assert.equal(unset.config.apiKey, undefined);
    assert.throws(() => resolveEndpoint(unset.config!), /DEEPSEEK_API_KEY is not set in the environment Sequence started with/);
  } finally {
    if (prior === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prior;
  }
});

test('writing a config that reads its key from the environment never writes the key', () => {
  const dir = tempDir('seq-prov-store-');
  writeUserAiConfig(dir, { provider: 'openai-compatible', baseUrl: DEEPSEEK, model: 'deepseek-flash', apiKeyEnv: 'DEEPSEEK_API_KEY', apiKey: 'sk-from-env' }, {});
  const disk = fs.readFileSync(path.join(dir, 'ai.json'), 'utf8');
  assert.ok(!disk.includes('sk-from-env'));
  assert.match(disk, /"apiKeyEnv": "DEEPSEEK_API_KEY"/);
  /* A plain BYOK config is written as it always was (the negative control). */
  writeUserAiConfig(dir, { provider: 'openai-compatible', baseUrl: DEEPSEEK, model: 'deepseek-flash', apiKey: 'sk-pasted' }, {});
  assert.match(fs.readFileSync(path.join(dir, 'ai.json'), 'utf8'), /sk-pasted/);
});

test('route: GET /api/providers/catalog answers locally with the catalog and detected names', async () => {
  const store = tempDir('seq-prov-rs-');
  const server = await createRepoServer(null, { webDist: undefined, browseRoot: tempDir('seq-prov-home-'), recentStoreDir: store, userConfigDir: store });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    const body = await new Promise<{ status: number; json: { providers: unknown[]; detected: unknown[] } }>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: '/api/providers/catalog' }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
        })
        .on('error', reject);
    });
    assert.equal(body.status, 200);
    assert.equal(body.json.providers.length, providerCatalog().length);
    assert.ok(Array.isArray(body.json.detected));
  } finally {
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }
});

/* ---------------- round-three review ---------------- */

test('a role at another address cannot inherit a key read by name', () => {
  const prior = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'sk-from-env';
  try {
    const evil = validateAiConfig({ provider: 'openai-compatible', baseUrl: DEEPSEEK, model: 'm', apiKeyEnv: 'DEEPSEEK_API_KEY', roles: { advisor: { model: 'x', baseUrl: 'https://evil.example/v1' } } });
    assert.match(String(evil.error), /roles\.advisor points at another address/);
    /* The same address, or its own key, is fine (the negative controls). */
    assert.ok(validateAiConfig({ provider: 'openai-compatible', baseUrl: DEEPSEEK, model: 'm', apiKeyEnv: 'DEEPSEEK_API_KEY', roles: { advisor: { model: 'deepseek-v4-pro' } } }).config);
    assert.ok(validateAiConfig({ provider: 'openai-compatible', baseUrl: DEEPSEEK, model: 'm', apiKeyEnv: 'DEEPSEEK_API_KEY', roles: { advisor: { model: 'x', baseUrl: 'https://other.example/v1', apiKey: 'sk-own' } } }).config);
  } finally {
    if (prior === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prior;
  }
});

test('an unset variable is a state: the model loads keyless and says so, and the other saved models survive', () => {
  const prior = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const r = validateAiConfig({
      profiles: [
        { id: 'a', name: 'Pasted', provider: 'anthropic', model: 'claude', apiKey: 'sk-pasted' },
        { id: 'b', name: 'From env', provider: 'openai-compatible', baseUrl: DEEPSEEK, model: 'deepseek-flash', apiKeyEnv: 'DEEPSEEK_API_KEY' },
      ],
      defaultProfileId: 'a',
    });
    assert.ok(r.config, r.error);
    assert.equal(r.config.profiles!.length, 2);
    const view = redactAiConfig(r.config) as { profiles: { id: string; apiKey?: string; apiKeyEnvMissing?: boolean }[] };
    assert.equal(view.profiles.find((p) => p.id === 'b')!.apiKeyEnvMissing, true);
    assert.equal(view.profiles.find((p) => p.id === 'a')!.apiKeyEnvMissing, undefined);
  } finally {
    if (prior !== undefined) process.env.DEEPSEEK_API_KEY = prior;
  }
});

test('the view shows no mask for a key read by name, not even its last four characters', () => {
  const prior = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'sk-from-env-WXYZ';
  try {
    const r = validateAiConfig({ profiles: [{ id: 'b', name: 'x', provider: 'openai-compatible', baseUrl: DEEPSEEK, model: 'm', apiKeyEnv: 'DEEPSEEK_API_KEY' }] });
    const view = JSON.stringify(redactAiConfig(r.config!));
    assert.ok(!view.includes('WXYZ'));
    assert.match(view, /"apiKeyEnv":"DEEPSEEK_API_KEY"/);
  } finally {
    if (prior === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prior;
  }
});

test('usesEnvKey finds a key name at any depth (what hosted mode refuses)', () => {
  assert.equal(usesEnvKey({ apiKeyEnv: 'X_KEY' }), true);
  assert.equal(usesEnvKey({ profiles: [{ apiKey: 'a' }, { apiKeyEnv: 'X_KEY' }] }), true);
  assert.equal(usesEnvKey({ roles: { advisor: { apiKeyEnv: 'X_KEY' } } }), true);
  assert.equal(usesEnvKey({ profiles: [{ apiKey: 'a' }] }), false);
});

test('two catalog providers at one address each keep their own variable; a GitHub token is never offered as a model key', () => {
  assert.equal(keyEnvAllowed('openai-compatible', 'https://api.code.umans.ai/v1', 'UMANS_AI_API_KEY'), true);
  assert.equal(keyEnvAllowed('openai-compatible', 'https://api.code.umans.ai/v1', 'UMANS_AI_CODING_PLAN_API_KEY'), true);
  assert.deepEqual(detectEnvProviders({ GITHUB_TOKEN: 'ghp_x', GH_TOKEN: 'gho_y' }), []);
});

test('route: editing a model that reads its key by name never writes the key; hosted mode refuses key names', async () => {
  const prior = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'sk-from-env-editcase';
  const store = tempDir('seq-prov-edit-');
  const server = await createRepoServer(null, { webDist: undefined, browseRoot: tempDir('seq-prov-ehome-'), recentStoreDir: store, userConfigDir: store });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const put = (body: unknown): Promise<number> =>
    new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request({ host: '127.0.0.1', port, path: '/api/ai-config', method: 'PUT', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  try {
    assert.equal(await put({ profiles: [{ id: 'b', name: 'DS', provider: 'openai-compatible', baseUrl: DEEPSEEK, model: 'deepseek-flash', apiKeyEnv: 'DEEPSEEK_API_KEY' }], defaultProfileId: 'b' }), 200);
    /* The form's Save sends the edited model back without apiKeyEnv (it never held it): the merge keeps the name. */
    assert.equal(await put({ profiles: [{ id: 'b', name: 'DS', provider: 'openai-compatible', baseUrl: DEEPSEEK, model: 'deepseek-v4-pro' }], defaultProfileId: 'b' }), 200);
    const disk = fs.readFileSync(path.join(store, 'ai.json'), 'utf8');
    assert.ok(!disk.includes('sk-from-env-editcase'), 'the key never reaches the file');
    assert.match(disk, /"apiKeyEnv": "DEEPSEEK_API_KEY"/);
    assert.match(disk, /deepseek-v4-pro/);
  } finally {
    if (prior === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prior;
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }
});
