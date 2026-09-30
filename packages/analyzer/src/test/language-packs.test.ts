/**
 * Language packs (final-vision gap plan G-B, slice 1).
 *
 * The owner's ask: the system should know HOW to read each language into native
 * English, composed by the repo's real mix — "60% Python / 30% React" is two
 * sets of reading instructions, not one winner. These tests lock the whole
 * chain: the counting, the per-service selection, the seams that consume it, and
 * the honesty rules that stop it from claiming more than the parse saw.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArchGraph } from '@sequence/schema';
import { formatLanguageMix, graphLanguageMix, languageMix } from '../lang/mix.js';
import {
  allowlistsFor,
  composeLabelHints,
  composePromptGuidance,
  packFor,
  selectPacks,
} from '../lang/packs.js';
import { buildAnnotatePrompt, buildDigest, buildExplainPrompt } from '../explain/explain.js';
import { scanRepo } from '../scan.js';
import { projectToServiceLevel } from '../score.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, '..', '..', 'test', 'fixtures');
const MIXED = path.join(FIXTURES, 'mixed-lang');
const SHOPFRONT = path.join(FIXTURES, 'shopfront');

/* ───────────────────────────────────────────────────────── mix arithmetic ── */

test('languageMix: weights by loc when the samples carry it, and says so', () => {
  const mix = languageMix([
    { language: 'py', path: 'a/views.py', loc: 600 },
    { language: 'py', path: 'a/models.py', loc: 20 },
    { language: 'ts', path: 'b/App.tsx', loc: 380 },
  ]);
  assert.strictEqual(mix.weightedBy, 'loc');
  assert.deepStrictEqual(
    mix.shares.map((s) => [s.language, s.share]),
    [
      ['py', 0.62],
      ['ts', 0.38],
    ]
  );
  assert.strictEqual(mix.files, 3);
  assert.strictEqual(mix.loc, 1000);
  assert.strictEqual(formatLanguageMix(mix), '62% py · 38% ts');
});

test('languageMix: falls back to file count when nothing carries loc, and says THAT', () => {
  const mix = languageMix([
    { language: 'go', path: 'a/main.go' },
    { language: 'go', path: 'a/handler.go' },
    { language: 'java', path: 'b/App.java' },
  ]);
  assert.strictEqual(mix.weightedBy, 'files');
  assert.deepStrictEqual(
    mix.shares.map((s) => [s.language, s.share]),
    [
      ['go', 0.6667],
      ['java', 0.3333],
    ]
  );
});

test('languageMix: a language we cannot parse is reported, never dressed up as parsed', () => {
  const mix = languageMix([
    { language: undefined, path: 'src/engine.rs', loc: 700 },
    { language: 'py', path: 'tools/build.py', loc: 300 },
  ]);
  const rust = mix.shares.find((s) => s.language === 'rs')!;
  assert.strictEqual(rust.parsed, false, 'rs has no grammar — it must not claim to be parsed');
  assert.strictEqual(rust.share, 0.7);
  assert.strictEqual(formatLanguageMix(mix), '70% rs (not parsed) · 30% py');
  // …and nothing pretends to understand it.
  assert.deepStrictEqual(
    selectPacks(mix.shares).map((p) => p.id),
    ['py'],
    'no Rust pack exists, so a Rust-dominated repo composes only what we can read'
  );
});

test('languageMix: an unparsed file never merges into a parsed bucket of the same name', () => {
  // A `.ts` file the parser did not read is a different fact from one it did,
  // and folding them together would let an unread file inherit "we read this".
  const mix = languageMix([
    { language: 'ts', path: 'src/a.ts', loc: 100 },
    { language: undefined, path: 'vendor/b.ts', loc: 100 },
  ]);
  assert.deepStrictEqual(
    mix.shares.map((s) => [s.language, s.parsed, s.files]),
    [
      ['ts', true, 1],
      ['ts', false, 1],
    ]
  );
});

test('languageMix: a file with neither language nor extension is counted apart, not bucketed', () => {
  const mix = languageMix([{ path: 'Dockerfile' }, { language: 'go', path: 'main.go' }]);
  assert.strictEqual(mix.unclassifiedFiles, 1);
  assert.deepStrictEqual(mix.shares.map((s) => s.language), ['go']);
});

/* ───────────────────────────────────────────────────────── pack selection ── */

test('selectPacks: the owner mixed-repo case yields TWO packs, strongest first', () => {
  const mix = languageMix([
    { language: 'py', path: 'api/views.py', loc: 600 },
    { language: 'ts', path: 'ui/App.tsx', loc: 300 },
    { language: 'go', path: 'tools/gen.go', loc: 100 },
  ]);
  assert.deepStrictEqual(
    selectPacks(mix.shares).map((p) => p.id),
    ['py', 'ts'],
    'go is 10% — under the bar, so it does not add a third voice to every prompt'
  );
});

test('selectPacks: ts and js share one pack, so their shares add up before the threshold', () => {
  const mix = languageMix([
    { language: 'py', path: 'api/views.py', loc: 800 },
    { language: 'ts', path: 'ui/a.ts', loc: 100 },
    { language: 'js', path: 'ui/b.js', loc: 100 },
  ]);
  assert.deepStrictEqual(selectPacks(mix.shares).map((p) => p.id), ['py', 'ts']);
});

test('selectPacks: the single dominant language is always packed, however small the mix', () => {
  const mix = languageMix([{ language: 'java', path: 'A.java', loc: 5 }]);
  assert.deepStrictEqual(selectPacks(mix.shares).map((p) => p.id), ['java']);
});

test('packFor: exactly the five parsed languages have a pack', () => {
  for (const lang of ['ts', 'js', 'py', 'go', 'java']) {
    assert.ok(packFor(lang), `${lang} parses, so it must have a pack`);
  }
  for (const lang of ['rs', 'rb', 'php', 'kt', 'swift', 'dart', undefined]) {
    assert.strictEqual(packFor(lang), undefined, `${lang} has no grammar — a pack would be cosmetic`);
  }
});

/* ─────────────────────────────────────────────────── composed instructions ── */

test('composeLabelHints: names the mix and the conventions to translate', () => {
  const mix = languageMix([
    { language: 'py', path: 'api/views.py', loc: 600 },
    { language: 'ts', path: 'ui/App.tsx', loc: 400 },
  ]);
  const hints = composeLabelHints(mix.shares);
  assert.match(hints, /60% Python/);
  assert.match(hints, /40% TypeScript\/JavaScript/);
  assert.match(hints, /views\.py/, 'Python naming conventions must reach the labeller');
  assert.match(hints, /React component group/, 'React conventions must reach it too');
  assert.strictEqual(composeLabelHints([]), '', 'no mix, no padding');
});

test('composePromptGuidance: one voice per pack, entrypoints stated as convention only', () => {
  const py = languageMix([{ language: 'py', path: 'a/main.py', loc: 10 }]).shares;
  const java = languageMix([{ language: 'java', path: 'b/App.java', loc: 10 }]).shares;
  const lines = composePromptGuidance([py, java]);
  assert.ok(lines.some((l) => l.startsWith('Python:')));
  assert.ok(lines.some((l) => l.startsWith('Java:')));
  assert.ok(
    lines.some((l) => /Only treat a file as an entry point if it appears in the digest/.test(l)),
    'entrypoint hints must never license inventing a file'
  );
  assert.deepStrictEqual(composePromptGuidance([]), []);
});

/* ─────────────────────────────────────────────── the mix on a real scan ──── */

test('scan stamps the counted language mix on each service and on the repo', async () => {
  const graph = await scanRepo(MIXED);
  const portal = graph.nodes.find((n) => n.id === 'svc:portal')!;
  const shares = portal.meta?.languages as { language: string; share: number }[];
  assert.ok(shares, 'a scanned service must carry its own breakdown');
  assert.deepStrictEqual(shares.map((s) => s.language).sort(), ['py', 'ts']);
  assert.ok(shares.every((s) => s.share > 0 && s.share < 1), 'a two-language service is neither 0% nor 100%');
  assert.ok(
    Math.abs(shares.reduce((a, s) => a + s.share, 0) - 1) < 0.01,
    'shares are a breakdown of the whole, so they sum to 1'
  );

  const repo = graph.nodes.find((n) => n.id === 'repo')!;
  assert.ok((repo.meta?.languages as unknown[])?.length >= 2, 'the repo node carries the repo-wide mix');

  // HONESTY: the mix is a new fact ABOUT the files, never a rewrite OF them.
  assert.strictEqual(portal.meta?.language, undefined, 'meta.language is a design-mode hint — untouched');
  const views = graph.nodes.find((n) => n.path === 'portal/api/views.py')!;
  assert.strictEqual(views.meta?.language, 'py', 'file languages are exactly what the parse said');
});

test('per-SERVICE selection: shopfront gives each service its own pack, not a repo winner', async () => {
  const graph = await scanRepo(SHOPFRONT);
  const mixes = graphLanguageMix(graph);
  const packOf = (svc: string): string[] =>
    selectPacks(mixes.byService.get(`svc:${svc}`)?.shares ?? []).map((p) => p.id);
  assert.deepStrictEqual(packOf('orders'), ['py'], 'the Python service reads as Python');
  assert.deepStrictEqual(packOf('gateway'), ['ts'], 'the TypeScript gateway reads as TypeScript');
  assert.deepStrictEqual(packOf('shipping'), ['go']);
  assert.deepStrictEqual(packOf('invoices'), ['java']);
  // …while the repo as a whole is honestly several languages at once.
  assert.ok(mixes.repo.shares.length >= 4, `repo mix: ${formatLanguageMix(mixes.repo, 5)}`);
});

test('a two-language service selects BOTH packs off the real scan', async () => {
  const graph = await scanRepo(MIXED);
  const mixes = graphLanguageMix(graph);
  const packs = selectPacks(mixes.byService.get('svc:portal')?.shares ?? []).map((p) => p.id);
  assert.deepStrictEqual(packs.sort(), ['py', 'ts'], 'the owner\'s 60/30 case, end to end');
});

/* ───────────────────────────────────────────────────────── seams: prompts ── */

test('explain and annotate prompts carry the language instructions for what is really there', async () => {
  const graph = await scanRepo(MIXED);
  const digest = buildDigest(graph);
  const explain = buildExplainPrompt(digest);
  const annotate = buildAnnotatePrompt(digest);
  for (const [name, prompt] of [['explain', explain], ['annotate', annotate]] as const) {
    assert.match(prompt, /Python: FastAPI\/Flask decorators/, `${name} prompt must know how to read Python`);
    assert.match(prompt, /TypeScript\/JavaScript: Express/, `${name} prompt must know how to read TS`);
    assert.ok(!/Java: @RestController/.test(prompt), `${name} prompt must not teach a language this repo has none of`);
  }
});

/* ──────────────────────────────────────────────── seam: LabelRequest.extras ─ */

test('LabelRequest.extras finally carries the language hints into the labelling prompt', async () => {
  const seen: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? '{}') as { messages?: { content?: string }[] };
    seen.push(body.messages?.[0]?.content ?? '');
    return {
      ok: true,
      json: async () => ({ content: [{ type: 'tool_use', input: { labels: [] } }] }),
    };
  }) as unknown as typeof fetch;
  try {
    await scanRepo(MIXED, {
      llm: true,
      labelModel: { provider: 'anthropic', model: 'test-model', apiKey: 'k' },
    });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.strictEqual(seen.length, 1, 'the labelling pass ran once');
  const prompt = seen[0];
  assert.match(prompt, /hints: written in/, 'extras must reach the prompt — it was built and never filled');
  assert.match(prompt, /views\.py is the HTTP layer/, 'the Python module carries Python naming conventions');
  assert.match(prompt, /React component group/, 'the TypeScript module carries React conventions');
});

/* ────────────────────────────────────────── seam: detector allowlists ────── */

test('allowlistsFor: the packs hold exactly the idioms the detectors used to inline', () => {
  assert.deepStrictEqual([...allowlistsFor('py').queuePublishFirstArg], ['send', 'send_and_wait']);
  assert.deepStrictEqual([...allowlistsFor('java').queuePublishFirstArg], ['send']);
  assert.deepStrictEqual(
    [...allowlistsFor('ts').queuePublishFirstArg],
    [],
    'kafkajs passes { topic } — a first-arg rule here would double-fire'
  );
  assert.deepStrictEqual([...allowlistsFor('java').routeControllerAnnotations], ['RestController', 'Controller']);
  assert.deepStrictEqual([...allowlistsFor('py').routeControllerAnnotations], []);
  // A language with no pack gets empty lists, never a default that detects.
  assert.deepStrictEqual([...allowlistsFor('rs').queuePublishFirstArg], []);
  assert.deepStrictEqual([...allowlistsFor(undefined).routeControllerAnnotations], []);
});

test('detector equivalence: the refactor detects the same edges shopfront always had', async () => {
  const graph: ArchGraph = await scanRepo(SHOPFRONT);
  const predicted = projectToServiceLevel(graph);
  // Java @RestController routes — the branch that was `f.language !== 'java'`
  // inline in http.ts and is now the Java pack's routeControllerAnnotations.
  // gateway -> invoices only resolves if the Spring route was read.
  assert.ok(predicted.has('gateway -> invoices [http]'), `Spring routes still resolve: ${[...predicted].join(', ')}`);
  assert.ok(predicted.has('invoices -> payments [http]'), 'the Spring client call still resolves');
  // Python producer send() (queues.ts, was `f.language === 'py'`).
  assert.ok(predicted.has('orders -> topic:order.created [queue_publish]'), 'the Python publisher still publishes');
  // Consumers still consume — the annotation branch is now pack-gated too.
  assert.ok(predicted.has('notifications -> topic:order.created [queue_consume]'), 'the consumer still consumes');
});
