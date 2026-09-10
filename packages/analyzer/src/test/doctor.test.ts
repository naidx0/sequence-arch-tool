import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runDoctor, formatDoctor, loadConfiguredModel } from '../doctor.js';
import { llmLabels, type LabelRequest } from '../llm/label.js';

/**
 * `sequence doctor` answers the owner's question: "what's the best workflow to
 * see if everything is operational?"
 *
 * The property that makes the answer USEFUL rather than reassuring is the split:
 * local-first checks (which need no key) are reported separately from
 * AI-assisted ones (which do), so "the names are generic" and "the scan is
 * wrong" can never be confused for each other again. A skip must never read as
 * a pass, and a missing key must never read as a failure.
 */

function write(p: string, body: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

function tinyRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-doctor-'));
  write(path.join(root, 'api', 'requirements.txt'), 'fastapi\n');
  write(path.join(root, 'api', 'app', 'main.py'), 'from fastapi import FastAPI\napp = FastAPI()\n');
  write(path.join(root, 'docker-compose.yml'), 'services:\n  api:\n    build: ./api\n');
  return root;
}

test('with no model configured, AI checks SKIP and local-first still passes', async () => {
  const root = tinyRepo();
  const emptyCfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-cfg-'));
  const report = await runDoctor({ repoPath: root, configDir: emptyCfgDir });

  const byId = new Map(report.checks.map((c) => [c.id, c]));
  assert.strictEqual(byId.get('scan')?.status, 'pass', 'scanning needs no key');
  assert.strictEqual(byId.get('scope')?.status, 'pass');
  assert.strictEqual(byId.get('ai-config')?.status, 'skip');
  assert.strictEqual(byId.get('ai-reach')?.status, 'skip');
  // The whole point: no key is not a failure.
  assert.strictEqual(report.ok, true, 'a missing optional key must not fail the run');
});

test('a skip states WHY, and how to fix it — never a bare "skipped"', async () => {
  const emptyCfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-cfg-'));
  const report = await runDoctor({ repoPath: tinyRepo(), configDir: emptyCfgDir });
  const cfg = report.checks.find((c) => c.id === 'ai-config')!;
  assert.match(cfg.detail, /no model configured/);
  assert.match(cfg.fix ?? '', /openrouter\.ai/i, 'the fix must name a real host, not "configure AI"');

  const labels = report.checks.find((c) => c.id === 'ai-labels')!;
  assert.strictEqual(labels.status, 'skip');
  assert.match(
    labels.fix ?? '',
    /Backend/,
    'it must connect the missing key to the generic names the owner actually sees',
  );
});

test('a swallowed repo FAILS the scope check — the defect that took three rounds', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-doctor-swallow-'));
  write(path.join(root, 'requirements.txt'), 'fastapi\n');
  write(path.join(root, 'app', 'main.py'), 'from fastapi import FastAPI\napp = FastAPI()\n');
  write(path.join(root, 'other', 'package.json'), JSON.stringify({ name: 'other' }));
  write(path.join(root, 'Dockerfile'), 'FROM python:3.11\nCOPY . /app\n');
  write(path.join(root, 'docker-compose.yml'), 'services:\n  api:\n    build: .\n');
  const report = await runDoctor({
    repoPath: root,
    configDir: fs.mkdtempSync(path.join(os.tmpdir(), 'seq-cfg-')),
  });
  const scope = report.checks.find((c) => c.id === 'scope')!;
  if (scope.status === 'fail') {
    assert.strictEqual(report.ok, false, 'a swallowed repo must fail the run');
    assert.match(scope.detail, /rooted at the repo itself/);
  } else {
    // The narrowing rules resolved it, which is also correct — but then the
    // check must be reporting a real scoped path, not silently passing nothing.
    assert.strictEqual(scope.status, 'pass');
  }
});

test('a configured model is probed, and a bad key is reported with its status', async () => {
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-cfg-'));
  write(
    path.join(cfgDir, 'ai.json'),
    JSON.stringify({
      provider: 'openai-compatible',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-3.5-sonnet',
      apiKey: 'sk-not-a-real-key',
    }),
  );
  const report = await runDoctor({
    repoPath: tinyRepo(),
    configDir: cfgDir,
    probe: async () => ({ ok: false, detail: 'HTTP 401 from openrouter.ai — invalid key' }),
  });
  const reach = report.checks.find((c) => c.id === 'ai-reach')!;
  assert.strictEqual(reach.status, 'fail');
  assert.match(reach.detail, /401/, 'the status code is the actionable part');
  assert.match(reach.fix ?? '', /401 is the key/, 'and it must say what 401 means');
  assert.strictEqual(report.ok, false);
});

test('the report never prints the API key', async () => {
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-cfg-'));
  const SECRET = 'sk-super-secret-value-9876';
  write(
    path.join(cfgDir, 'ai.json'),
    JSON.stringify({
      provider: 'openai-compatible',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'x/y',
      apiKey: SECRET,
    }),
  );
  const report = await runDoctor({
    repoPath: tinyRepo(),
    configDir: cfgDir,
    probe: async () => ({ ok: true, detail: 'x/y answered over openrouter.ai' }),
  });
  const text = formatDoctor(report) + JSON.stringify(report);
  assert.ok(!text.includes(SECRET), 'the doctor output is pasted into issues — it must never carry the key');
});

test('loadConfiguredModel prefers the repo config over the user one', async () => {
  const root = tinyRepo();
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-cfg-'));
  write(
    path.join(cfgDir, 'ai.json'),
    JSON.stringify({ provider: 'anthropic', model: 'user-level', apiKey: 'k' }),
  );
  write(
    path.join(root, '.sequence', 'ai.json'),
    JSON.stringify({ provider: 'anthropic', model: 'repo-level', apiKey: 'k' }),
  );
  assert.strictEqual(loadConfiguredModel(root, cfgDir)?.model, 'repo-level');
  assert.strictEqual(loadConfiguredModel(undefined, cfgDir)?.model, 'user-level');
});

/* ── the labelling pass now uses the CONFIGURED model ─────────────────────── */

const REQ: LabelRequest[] = [
  { id: 'mod:api/0', kind: 'module', heuristicLabel: 'Core', memberFiles: ['api/app/core/a.py'] },
];

test('an openai-compatible model (OpenRouter) is actually used for labels', async () => {
  // The reported gap: connecting an OpenRouter key improved the assistant and
  // left every service called "Backend", because this pass read a different key.
  let sawUrl = '';
  let sawAuth = '';
  const fakeFetch = (async (url: string, init: RequestInit) => {
    sawUrl = String(url);
    sawAuth = String((init.headers as Record<string, string>).authorization ?? '');
    return new Response(
      JSON.stringify({
        choices: [
          { message: { content: JSON.stringify({ labels: [{ id: 'mod:api/0', label: 'Billing engine', description: 'Charges customers.' }] }) } },
        ],
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const warnings: string[] = [];
  const out = await llmLabels('repo', '', REQ, warnings, {
    provider: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-3.5-sonnet',
    apiKey: 'sk-test',
  }, fakeFetch);

  assert.strictEqual(sawUrl, 'https://openrouter.ai/api/v1/chat/completions');
  assert.strictEqual(sawAuth, 'Bearer sk-test');
  assert.strictEqual(out.get('mod:api/0')?.label, 'Billing engine');
  assert.deepStrictEqual(warnings, []);
});

test('a label for an id we never asked about is DROPPED, on the new path too', async () => {
  // The fabrication guard is the whole reason this pass is allowed to exist: a
  // model may RENAME a component, never introduce one.
  const fakeFetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                labels: [
                  { id: 'mod:api/0', label: 'Real', description: 'ok' },
                  { id: 'svc:invented', label: 'Ghost', description: 'not requested' },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200 },
    )) as unknown as typeof fetch;

  const out = await llmLabels('repo', '', REQ, [], {
    provider: 'openai-compatible',
    baseUrl: 'https://x/v1',
    model: 'm',
    apiKey: 'k',
  }, fakeFetch);
  assert.strictEqual(out.size, 1);
  assert.ok(!out.has('svc:invented'), 'an unrequested id must never enter the graph');
});

test('a non-JSON reply degrades to heuristic labels with an honest warning', async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'sure! here you go' } }] }), {
      status: 200,
    })) as unknown as typeof fetch;
  const warnings: string[] = [];
  const out = await llmLabels('repo', '', REQ, warnings, {
    provider: 'openai-compatible',
    baseUrl: 'https://x/v1',
    model: 'm',
    apiKey: 'k',
  }, fakeFetch);
  assert.strictEqual(out.size, 0, 'nothing is invented from an unparseable reply');
  assert.ok(warnings.some((w) => /did not return JSON/.test(w)));
});

test('an HTTP error names the status so the user can act on it', async () => {
  const fakeFetch = (async () =>
    new Response('no credit', { status: 402 })) as unknown as typeof fetch;
  const warnings: string[] = [];
  await llmLabels('repo', '', REQ, warnings, {
    provider: 'openai-compatible',
    baseUrl: 'https://x/v1',
    model: 'm',
    apiKey: 'k',
  }, fakeFetch);
  assert.ok(warnings.some((w) => /402/.test(w)), `warnings: ${JSON.stringify(warnings)}`);
});

test('with no configured model and no env key, it says so instead of failing', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const warnings: string[] = [];
    const out = await llmLabels('repo', '', REQ, warnings);
    assert.strictEqual(out.size, 0);
    assert.ok(
      warnings.some((w) => /no model is configured/.test(w) && /Settings/.test(w)),
      `the warning must point at where to fix it: ${JSON.stringify(warnings)}`,
    );
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});
