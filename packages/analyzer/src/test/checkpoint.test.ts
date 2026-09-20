import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { scanRepo } from '../scan.js';
import {
  CHECKPOINT_VERSION,
  forkCheckpoint,
  migrateCheckpoint,
  readCheckpoint,
  writeCheckpoint,
} from '../server/checkpoint.js';
import type { LessonShape } from '../server/lessonState.js';

/**
 * THE LESSON CHECKPOINT — the planted cases, from the design page's §4.
 *
 * Numbered as the page numbers them, so a reader can hold the two side by side.
 * Card-free: every derivation here is a pure function of a scanned graph.
 */
function repo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-checkpoint-'));
  fs.mkdirSync(path.join(root, '.sequence', 'sessions', 's1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'r', version: '1.0.0' }));
  return root;
}

const lessonOf = (id: string, taught: string[], queue: string[]): LessonShape => ({
  version: 1,
  sessionId: id,
  subject: { ask: 'teach me', nodeIds: [] },
  queue: queue.map((t) => ({ title: t })),
  taught: taught.map((t, i) => ({ title: t, turn: i })),
});

const graphOnce = (async () => scanRepo(process.cwd(), { cluster: true }))();

/* ── case 3: a checkpoint with no version field ──────────────────────────── */

test('case 3: no build stamp is read as version 0 and migrated, never guessed current', async () => {
  /*
   * The unreadable-lock law, one layer down: a checkpoint that does not say
   * which build wrote it CANNOT be assumed current, and assuming it is current
   * is precisely the guess this file exists to stop.
   */
  const root = repo();
  try {
    fs.writeFileSync(
      path.join(root, '.sequence', 'sessions', 's1', 'lesson.json'),
      JSON.stringify(lessonOf('s1', ['a'], ['b'])),
    );
    const read = readCheckpoint(root, 's1');
    assert.strictEqual(read.refused, undefined);
    assert.strictEqual(read.checkpoint!.schemaVersion, 0, 'no stamp means version 0');
    assert.strictEqual(read.checkpoint!.writtenBy, null);

    const m = migrateCheckpoint({
      checkpoint: read.checkpoint!,
      graph: await graphOnce,
      builtAt: '2026-09-06T00:00:00.000Z',
    });
    assert.strictEqual(m.migrated, true, 'an unstamped checkpoint is always migrated');
    assert.match(m.reason, /names no build/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* ── case 2: same build in, same charts out ──────────────────────────────── */

test('case 2: a same-build open re-derives nothing and says so', async () => {
  /*
   * `migrated 0 of 1` is not a null result — it is the statement that nothing
   * needed changing, and it is only worth anything because the same code would
   * have changed it if it had. Case 1 is the half that proves that.
   */
  const root = repo();
  try {
    const BUILT = '2026-09-06T01:00:00.000Z';
    writeCheckpoint(root, 's1', lessonOf('s1', ['a'], ['b']), { writtenBy: BUILT, turn: 1 });
    const read = readCheckpoint(root, 's1');
    assert.strictEqual(read.checkpoint!.schemaVersion, CHECKPOINT_VERSION);
    assert.strictEqual(read.checkpoint!.writtenBy, BUILT);
    assert.strictEqual(read.checkpoint!.turn, 1);

    const m = migrateCheckpoint({ checkpoint: read.checkpoint!, graph: await graphOnce, builtAt: BUILT });
    assert.strictEqual(m.migrated, false);
    assert.deepStrictEqual(m.charts, read.checkpoint!.charts, 'the stored charts are served unchanged');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* ── case 1: an older build's lesson is re-derived on open ───────────────── */

test('case 1: a lesson written by another build has its chart re-derived from the graph', async () => {
  const root = repo();
  try {
    const g = await graphOnce;
    const brief = g.nodes.find((n) => String(n.path ?? '').replace(/\\/g, '/').endsWith('src/brief.ts'));
    assert.ok(brief, 'fixture assumption: brief.ts is in the graph');
    const lesson: LessonShape = {
      ...lessonOf('s1', [], []),
      queue: [{ title: 'brief.ts', nodeId: brief.id }],
    };
    writeCheckpoint(root, 's1', lesson, { writtenBy: '2026-09-01T00:00:00.000Z', turn: 0 });

    const read = readCheckpoint(root, 's1');
    const m = migrateCheckpoint({
      checkpoint: read.checkpoint!,
      graph: g,
      builtAt: '2026-09-06T01:00:00.000Z',
    });
    assert.strictEqual(m.migrated, true);
    assert.match(m.reason, /written by 2026-09-01/);
    assert.strictEqual(m.charts.length, 1, 'a chart is re-derived, not restored');
    assert.ok((m.charts[0]!.items?.length ?? 0) > 1, 'and it has the graph’s neighbours in it');
    assert.ok(m.checkIn !== undefined, 'the check-in is re-derived with it');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a stale derivation is never served, even when there is no graph to replace it', async () => {
  /*
   * THE RULE THAT MATTERS MOST. With no graph the tempting behaviour is to fall
   * back to the stored chart — and that is exactly the stale derivation the
   * migration exists to refuse. An empty canvas is honest; a stale one is a
   * false claim about the repository.
   */
  const root = repo();
  try {
    writeCheckpoint(root, 's1', lessonOf('s1', ['a'], ['b']), {
      writtenBy: '2026-09-01T00:00:00.000Z',
      turn: 1,
    });
    const read = readCheckpoint(root, 's1');
    const m = migrateCheckpoint({ checkpoint: read.checkpoint!, graph: undefined, builtAt: 'now' });
    assert.strictEqual(m.migrated, true);
    assert.deepStrictEqual(m.charts, [], 'nothing is served rather than something stale');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* ── case 4: a corrupt checkpoint ────────────────────────────────────────── */

test('case 4: a corrupt checkpoint is refused with the field named, session untouched', () => {
  const root = repo();
  try {
    const f = path.join(root, '.sequence', 'sessions', 's1', 'lesson.json');
    fs.writeFileSync(f, '{ "version": 1, "queue": [ this is not json');
    const read = readCheckpoint(root, 's1');
    assert.ok(read.refused !== undefined, 'a corrupt lesson is refused, not read as empty');
    assert.match(read.refused, /lesson\.json/);
    /* And the file is still there, byte for byte: a refusal must not repair. */
    assert.ok(fs.readFileSync(f, 'utf8').includes('this is not json'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* ── case 5: the fork ────────────────────────────────────────────────────── */

test('case 5: a fork at turn 1 gives two branches with the same first turn', () => {
  const root = repo();
  try {
    fs.mkdirSync(path.join(root, '.sequence', 'sessions', 'branch-a'), { recursive: true });
    fs.mkdirSync(path.join(root, '.sequence', 'sessions', 'branch-b'), { recursive: true });
    const source = lessonOf('s1', ['one', 'two'], ['three']);
    writeCheckpoint(root, 's1', source, { writtenBy: 'B1', turn: 2 });

    const a = forkCheckpoint({ repoRoot: root, from: 's1', to: 'branch-a', atTurn: 1, writtenBy: 'B1' });
    const b = forkCheckpoint({ repoRoot: root, from: 's1', to: 'branch-b', atTurn: 1, writtenBy: 'B1' });
    assert.ok(a.forked && b.forked);

    for (const br of [a, b]) {
      assert.strictEqual(br.lesson.taught.length, 1, 'one taught turn, the shared first');
      assert.strictEqual(br.lesson.taught[0]!.title, 'one');
      /* REWOUND, not truncated: what came after the fork point is ahead again. */
      assert.deepStrictEqual(br.lesson.queue.map((c) => c.title), ['two', 'three']);
    }
    /* Neither overwrites the other, and the source is untouched. */
    assert.notStrictEqual(a.lesson.sessionId, b.lesson.sessionId);
    const after = readCheckpoint(root, 's1').checkpoint!;
    assert.strictEqual(after.lesson!.taught.length, 2, 'the source lesson is unchanged');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a fork past the end is refused rather than clamped', () => {
  const root = repo();
  try {
    writeCheckpoint(root, 's1', lessonOf('s1', ['one'], []), { writtenBy: 'B1', turn: 1 });
    const r = forkCheckpoint({ repoRoot: root, from: 's1', to: 'x', atTurn: 9, writtenBy: 'B1' });
    assert.strictEqual(r.forked, false);
    assert.match((r as { refused: string }).refused, /outside this lesson's 1 taught turns/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
