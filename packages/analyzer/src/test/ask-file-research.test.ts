import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { createRepoServer } from '../server/repoServer.js';
import { startMockProvider } from './mock-provider.js';
import { buildAskPrompt, buildDigest } from '../explain/explain.js';
import { resolveInRepo } from '../server/jail.js';
import {
  DEFAULT_ASK_FILE_RESEARCH_BUDGET,
  digestFilePaths,
  gatherAskFileResearch,
  readAskResearchFiles,
  renderAskFileResearchSection,
  selectAskResearchPaths,
  wantsAskFileResearch,
} from '../explain/askFileResearch.js';

/**
 * Wave D — ask research reads capped real file bodies into the prompt.
 * Shopfront fixture preferred; jail and budget locks included.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');
const TEST_KEY = 'sk-ant-test-FILE-RESEARCH-42';

function shopfrontRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-ask-file-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(SHOPFRONT, repo, { recursive: true });
  return repo;
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

/* ============================================================ unit locks ===== */

test('wantsAskFileResearch: code questions yes, pure topology no', () => {
  assert.ok(wantsAskFileResearch('How does the gateway route orders in code?'));
  assert.ok(!wantsAskFileResearch('What services are fragile?'));
});

test('wantsAskFileResearch: shopfront explain-how-reaches is research-worthy', () => {
  assert.ok(wantsAskFileResearch('Explain how orders reaches payments and postgres.'));
  assert.ok(wantsAskFileResearch('how orders reaches payments'));
  assert.ok(wantsAskFileResearch('how gateway talks to orders'));
  assert.ok(!wantsAskFileResearch('What services are fragile?'));
});

test('selectAskResearchPaths: shopfront question picks orders route file', async () => {
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  const digest = buildDigest(graph);
  const paths = selectAskResearchPaths(graph, digest, 'How does the gateway route orders?');
  assert.ok(paths.some((p) => p.includes('orders') && p.includes('gateway')), paths.join(', '));
});

test('selectAskResearchPaths: shopfront reaches-ask picks orders payments and db files', async () => {
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  const digest = buildDigest(graph);
  const question = 'Explain how orders reaches payments and postgres.';
  assert.ok(wantsAskFileResearch(question));
  const paths = selectAskResearchPaths(graph, digest, question);
  const all = digestFilePaths(digest);
  assert.ok(
    paths.some((p) => p.includes('orders') && p.includes('payments_client')),
    paths.join(', '),
  );
  assert.ok(
    paths.some((p) => p.includes('orders') && /(?:^|\/)db\.(py|js|ts)$/.test(p)),
    paths.join(', '),
  );
  assert.ok(paths.length <= DEFAULT_ASK_FILE_RESEARCH_BUDGET.maxFiles);
  assert.ok(paths.length < all.length, 'must not dump the whole fixture');
});

test('readAskResearchFiles: includes real file body content, not path-only', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const rel = 'gateway/src/routes/orders.ts';
  const resolveReadable = (p: string) => resolveInRepo(root, p);
  const result = readAskResearchFiles(resolveReadable, [rel]);
  assert.strictEqual(result.files.length, 1);
  assert.match(result.files[0].content, /ordersRouter/);
  assert.match(result.files[0].content, /ORDERS_URL/);
  assert.ok(!result.files[0].content.includes('orders.ts')); // path is metadata, body is code
});

test('readAskResearchFiles: enforces max files + per-file + total byte caps', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const resolveReadable = (p: string) => resolveInRepo(root, p);
  const graph = await scanRepo(repo, { cluster: true });
  const digest = buildDigest(graph);
  const all = digestFilePaths(digest);
  assert.ok(all.length > 3, 'fixture has enough files to test caps');

  const budget = { maxFiles: 2, maxBytesPerFile: 80, maxTotalBytes: 120 };
  const result = readAskResearchFiles(resolveReadable, all, budget);
  assert.strictEqual(result.files.length, 2);
  assert.ok(result.omittedFiles >= 1);
  for (const f of result.files) {
    assert.ok(f.content.length <= budget.maxBytesPerFile);
  }
  const total = result.files.reduce((n, f) => n + f.content.length, 0);
  assert.ok(total <= budget.maxTotalBytes);
});

test('readAskResearchFiles: jail escape and reserved paths refused', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.sequence', 'ai.json'), '{"apiKey":"secret"}');
  const resolveReadable = (p: string) => {
    const abs = resolveInRepo(root, p);
    if (!abs) return null;
    if (p.startsWith('.sequence/') && !p.startsWith('.sequence/decisions/')) return null;
    return abs;
  };
  const result = readAskResearchFiles(resolveReadable, [
    '../../../etc/passwd',
    '.sequence/ai.json',
    'gateway/src/routes/orders.ts',
  ]);
  assert.strictEqual(result.refusedPaths.length, 2);
  assert.strictEqual(result.files.length, 1);
});

test('renderAskFileResearchSection: fenced bodies land in prompt section', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const graph = await scanRepo(repo, { cluster: true });
  const digest = buildDigest(graph);
  const research = gatherAskFileResearch({
    graph,
    digest,
    question: 'Show me the gateway orders route source code',
    resolveReadable: (p) => resolveInRepo(root, p),
  });
  const section = renderAskFileResearchSection(research);
  const prompt = buildAskPrompt(digest, 'Show me the gateway orders route source code', {
    fileResearchLines: section,
  });
  assert.ok(prompt.includes('FILE RESEARCH'));
  assert.ok(prompt.includes('ordersRouter'));
  assert.ok(prompt.includes('ORDERS_URL'));
  assert.ok(prompt.includes('STRUCTURE DIGEST'));
});

test('gatherAskFileResearch: generic topology question adds no file section', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const graph = await scanRepo(repo, { cluster: true });
  const digest = buildDigest(graph);
  const research = gatherAskFileResearch({
    graph,
    digest,
    question: 'Which service is the single point of failure?',
    resolveReadable: (p) => resolveInRepo(root, p),
  });
  assert.strictEqual(research.files.length, 0);
});

test('gatherAskFileResearch: shopfront reaches-ask reads orders payments/db bodies', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const graph = await scanRepo(repo, { cluster: true });
  const digest = buildDigest(graph);
  const research = gatherAskFileResearch({
    graph,
    digest,
    question: 'Explain how orders reaches payments and postgres.',
    resolveReadable: (p) => resolveInRepo(root, p),
  });
  assert.ok(research.files.length > 0, 'file research must run');
  assert.ok(
    research.files.some((f) => f.path.includes('orders') && f.path.includes('payments_client')),
    research.files.map((f) => f.path).join(', '),
  );
  assert.ok(
    research.files.some((f) => f.path.includes('orders') && /(?:^|\/)db\.(py|js|ts)$/.test(f.path)),
    research.files.map((f) => f.path).join(', '),
  );
  assert.ok(research.files.every((f) => f.content.length > 0));
  assert.ok(research.files.length <= DEFAULT_ASK_FILE_RESEARCH_BUDGET.maxFiles);
});

/* ============================================================ HTTP lock ===== */

test('/api/ask: shopfront code question sends real file bodies in provider prompt', async () => {
  const repo = shopfrontRepo();
  let promptText = '';
  const mock = await startMockProvider((reqBody) => {
    promptText = JSON.stringify(reqBody);
    return { text: 'The gateway proxies orders via ordersRouter.' };
  });
  const { base, close } = await startServer(repo);
  try {
    assert.strictEqual((await putAiConfig(base, mock.baseUrl)).status, 200);
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'How does the gateway route orders in the source code?',
      }),
    });
    assert.strictEqual(res.status, 200);
    assert.ok(promptText.includes('FILE RESEARCH'), 'file research section present');
    assert.ok(promptText.includes('ordersRouter'), 'real file body in prompt');
    assert.ok(promptText.includes('ORDERS_URL'), 'real file body in prompt');
    assert.ok(promptText.includes('STRUCTURE DIGEST'), 'digest still present alongside bodies');
    assert.strictEqual(mock.requests.length, 1);
  } finally {
    await close();
    await mock.close();
  }
});

test('/api/ask: GET /api/file jail still refuses escape after research wiring', async () => {
  const repo = shopfrontRepo();
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/file?path=${encodeURIComponent('../../../etc/passwd')}`);
    assert.strictEqual(res.status, 403);
    const seq = await fetch(`${base}/api/file?path=${encodeURIComponent('.sequence/ai.json')}`);
    assert.strictEqual(seq.status, 403);
  } finally {
    await close();
  }
});

test('DEFAULT_ASK_FILE_RESEARCH_BUDGET: sane production caps', () => {
  assert.ok(DEFAULT_ASK_FILE_RESEARCH_BUDGET.maxFiles >= 1);
  assert.ok(DEFAULT_ASK_FILE_RESEARCH_BUDGET.maxBytesPerFile > 0);
  assert.ok(DEFAULT_ASK_FILE_RESEARCH_BUDGET.maxTotalBytes >= DEFAULT_ASK_FILE_RESEARCH_BUDGET.maxBytesPerFile);
});
