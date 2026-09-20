/**
 * WAVE B4 — THE AUTO SEED (docs/research/carrying-harness-plan.md).
 *
 * "Auto setup" in the plan's own words: the harness seeds, places and re-flows
 * the canvas WITHOUT the model inventing coordinates. This locks the seeding
 * half — the cards are the scan's own nodes, the geometry is the deterministic
 * lane layout, the ids are stable so a second turn cannot double-draw, and the
 * event reaches the client on the same channel the model's own marks use.
 *
 * Built on the shopfront fixture, whose scan is real: eight services with real
 * HTTP edges between them, so "the edges came from the scan" is a claim this
 * file can actually check rather than assert about a hand-written digest.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanRepo } from '../scan.js';
import { buildDigest, type Digest } from '../explain/explain.js';
import { resolveInRepo } from '../server/jail.js';
import { SEED_ID_PREFIX, SEED_MAX_SERVICES, seedBoardFromDigest } from '../server/boardSeed.js';
import { runAskPipeline, type AskPipelineInput, type AskStreamEvent } from '../server/askPipeline.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');

function shopfrontRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-canvas-seed-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(SHOPFRONT, repo, { recursive: true });
  return fs.realpathSync(repo);
}

let cached: { repo: string; digest: Digest } | null = null;
async function shopfrontDigest(): Promise<{ repo: string; digest: Digest }> {
  if (cached) return cached;
  const repo = shopfrontRepo();
  const graph = await scanRepo(repo, { cluster: true });
  cached = { repo, digest: buildDigest(graph) };
  return cached;
}

/* ───────────────────────────── the seed itself ───────────────────────────── */

test('the seed places one card per service in scope, and every card is a REAL node id', async () => {
  const { digest } = await shopfrontDigest();
  const seed = seedBoardFromDigest({
    digest,
    question: 'draw how the gateway talks to orders',
    known: [],
  })!;
  assert.ok(seed, 'a repository with services seeds something');
  const known = new Set(digest.services.map((s) => s.id));
  const cards = seed.items.filter((i) => i.kind === 'noderef');
  assert.ok(cards.length >= 2, `expected the named services and their neighbours: ${cards.length}`);
  for (const card of cards) {
    assert.ok(known.has(card.nodeId), `${card.nodeId} is not a scanned service`);
    assert.ok(card.id.startsWith(SEED_ID_PREFIX), card.id);
    assert.ok(Number.isFinite(card.at.x) && Number.isFinite(card.at.y));
  }
  /* The two the question named are in, and they are first. */
  assert.deepStrictEqual(seed.serviceIds.slice(0, 2).sort(), ['svc:gateway', 'svc:orders']);
  assert.ok(seed.serviceIds.length <= SEED_MAX_SERVICES);
});

test('the arrows are the scan\'s own edges, joining two seeded cards and nothing else', async () => {
  const { digest } = await shopfrontDigest();
  const seed = seedBoardFromDigest({ digest, question: 'sketch the shopfront services', known: [] })!;
  const cardIds = new Set(seed.items.filter((i) => i.kind === 'noderef').map((i) => i.id));
  const arrows = seed.items.filter((i) => i.kind === 'shape');
  assert.ok(arrows.length > 0, 'the fixture has real HTTP edges between services');
  for (const a of arrows) {
    assert.strictEqual(a.shape, 'arrow');
    const [from, to] = a.id.slice(SEED_ID_PREFIX.length).split('>>');
    assert.ok(cardIds.has(`${SEED_ID_PREFIX}${from}`), `${from} has no card`);
    assert.ok(cardIds.has(`${SEED_ID_PREFIX}${to}`), `${to} has no card`);
  }
  /* The note names every id, because patching by id is the whole point. */
  for (const id of cardIds) assert.ok(seed.note.includes(id), `${id} missing from the note`);
  assert.match(seed.note, /annotate or connect them BY ID rather than drawing them again/);
});

test('the same ask seeds the same geometry twice — nothing here is a guess', async () => {
  const { digest } = await shopfrontDigest();
  const once = seedBoardFromDigest({ digest, question: 'draw the gateway', known: [] })!;
  const twice = seedBoardFromDigest({ digest, question: 'draw the gateway', known: [] })!;
  assert.deepStrictEqual(once.items, twice.items);
  assert.deepStrictEqual(once.note, twice.note);
});

test('a board that already carries a seed is left alone — the reader\'s arrangement is theirs', async () => {
  const { digest } = await shopfrontDigest();
  const first = seedBoardFromDigest({ digest, question: 'draw the gateway', known: [] })!;
  const again = seedBoardFromDigest({
    digest,
    question: 'now draw payments too',
    known: first.items.map((i) => ({ id: i.id })),
  });
  assert.strictEqual(again, null);
});

test('the seed lands BELOW what is already drawn, never on top of the reader\'s marks', async () => {
  const { digest } = await shopfrontDigest();
  const seed = seedBoardFromDigest({
    digest,
    question: 'draw the gateway',
    known: [{ id: 'n1', at: { x: 10, y: 400 } }],
  })!;
  const cards = seed.items.filter((i) => i.kind === 'noderef');
  for (const c of cards) assert.ok(c.at.y > 400, `${c.id} at y=${c.at.y} overlaps the drawing`);
});

test('a digest with no services seeds NOTHING rather than an empty frame', () => {
  const empty = {
    repo: { id: 'r', name: 'r' },
    folders: [],
    services: [],
    datastores: [],
    topics: [],
    edges: [],
  } as unknown as Digest;
  assert.strictEqual(seedBoardFromDigest({ digest: empty, question: 'draw it', known: [] }), null);
});

/* ─────────────────────── the seed reaching a real turn ───────────────────── */

async function drawishInput(
  repo: string,
  question: string,
  surfaceId: 'task-board' | 'ai-canvas' | undefined,
): Promise<AskPipelineInput> {
  const graph = await scanRepo(repo, { cluster: true });
  const digest = buildDigest(graph);
  return {
    question,
    intents: [],
    scopeLines: [],
    ...(surfaceId === undefined ? { surface: undefined } : { surface: { id: surfaceId } }),
    deictic: false,
    design: undefined,
    designMode: false,
    askMode: 'implementation',
    graph,
    digest,
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: (rel: string) => resolveInRepo(repo, rel),
    repoRoot: repo,
    callProvider: async () => ({ text: 'Here is the shape of it.' }),
  } as AskPipelineInput;
}

test('a drawish ask on a scanned repo puts the frame on the board BEFORE the model speaks', async () => {
  const repo = shopfrontRepo();
  const prompts: string[] = [];
  const input = await drawishInput(repo, 'draw how the gateway routes orders', 'task-board');
  const withCapture: AskPipelineInput = {
    ...input,
    callProvider: async (_cfg, prompt) => {
      prompts.push(prompt);
      return { text: 'Here is the shape of it.' };
    },
  };
  const events: AskStreamEvent[] = [];
  await runAskPipeline(withCapture, (e) => events.push(e));

  const boardEvents = events.filter((e) => e.type === 'board:item') as {
    items: { id: string; kind: string; nodeId?: string }[];
  }[];
  assert.strictEqual(boardEvents.length, 1, 'one seed, not one per round');
  const items = boardEvents[0]!.items;
  assert.ok(items.length >= 2, `seeded ${items.length} items`);
  assert.ok(items.every((i) => i.id.startsWith(SEED_ID_PREFIX)));
  const seededNodeIds = items.filter((i) => i.kind === 'noderef').map((i) => i.nodeId!);
  assert.ok(seededNodeIds.includes('svc:gateway'));
  assert.ok(seededNodeIds.includes('svc:orders'));

  /* And the model was TOLD, in the very first prompt, which ids are already there. */
  assert.ok(prompts.length > 0);
  assert.match(prompts[0]!, /### harness seed \(board\)/);
  assert.match(prompts[0]!, /seed:svc:gateway/);
});

test('a plot ask and an ordinary question seed nothing — the frame is for board turns', async () => {
  const repo = shopfrontRepo();
  for (const [question, surface] of [
    ['draw a parabola for y = x squared', 'task-board'],
    ['what does the gateway do?', undefined],
  ] as const) {
    const input = await drawishInput(repo, question, surface);
    const events: AskStreamEvent[] = [];
    await runAskPipeline(input, (e) => events.push(e));
    assert.strictEqual(
      events.filter((e) => e.type === 'board:item').length,
      0,
      `"${question}" should seed nothing`,
    );
  }
});

test('an unattached turn seeds nothing — there is no scan to be grounded in', async () => {
  const repo = shopfrontRepo();
  const attached = await drawishInput(repo, 'draw the services', 'ai-canvas');
  const unattached: AskPipelineInput = {
    ...attached,
    graph: null,
    digest: undefined,
    repoRoot: null,
    designMode: true,
    design: { title: 'Home workspace', outline: 'draw the services' },
  };
  const events: AskStreamEvent[] = [];
  await runAskPipeline(unattached, (e) => events.push(e));
  assert.strictEqual(events.filter((e) => e.type === 'board:item').length, 0);
});
