/**
 * 019-P2C: a rescan reuses what did not change and nothing else.
 *
 * The scan index (parse/scanIndex.ts) answers "unchanged" from a stat, the detectors' answers
 * are memoised per file (detectors/perFile.ts), and the node build reads memoised import
 * snippets, rationale and scheduler flags (parse/lazyFacts.ts). The one property that makes all of
 * that safe is: the graph a warm rescan emits is the graph a from-scratch scan of the same tree
 * emits. This runs every fixture (the list is derived) through edit / delete / add and compares.
 *
 *   - an EDITED file's change appears in the rescanned graph (its node's `loc` moves)
 *   - a DELETED file disappears, an ADDED file appears
 *   - an unchanged tree parses nothing, reads no source file, and loads no file's heavy facts
 *   - a stat that matches is trusted only outside the racy window (git's rule); inside it, or on
 *     any size change, the bytes are read and hashed
 *   - the compose file changing re-runs the detectors that depend on it (the memo key covers it)
 */
import assert from 'node:assert';
import { test, before } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { initParser, parsedFileCount } from '../parse/treesitter.js';
import { heavyLoadCount } from '../parse/lazyFacts.js';
import { RACY_MS } from '../parse/scanIndex.js';
import type { FileFacts } from '../types.js';

type ArchGraph = Awaited<ReturnType<typeof scanRepo>>;

before(async () => {
  await initParser();
});

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, '..', '..', 'test', 'fixtures');

const SOURCE = /\.(ts|tsx|js|jsx|mjs|py|go|java)$/;

const strip = (g: ArchGraph): string => {
  const { scannedAt: _s, ...rest } = g as unknown as Record<string, unknown>;
  void _s;
  return JSON.stringify(rest);
};

function copyFixture(name: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-incr-'));
  const dir = path.join(tmp, name);
  fs.cpSync(path.join(FIXTURES, name), dir, { recursive: true });
  return dir;
}
const cleanup = (dir: string): void => fs.rmSync(path.dirname(dir), { recursive: true, force: true });

/** Every source file in walk order (the scan's own order is irrelevant here), skipping dot and vendored dirs. */
function sources(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (SOURCE.test(e.name)) out.push(f);
    }
  };
  walk(dir);
  return out.sort();
}

const fixtureNames = (): string[] =>
  fs
    .readdirSync(FIXTURES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

/** A scan, or the reason it refused (a fixture with nothing to scan is fingerprinted by its error). */
async function scan(dir: string, cached: boolean): Promise<string> {
  try {
    return strip(await scanRepo(dir, { factsCache: cached }));
  } catch (e) {
    return `error:${(e as Error).name}`;
  }
}

/** The graph's file-node ids and locs, for asserting that a change is IN the graph and not merely equal to a fresh scan. */
function fileNodes(g: string): Map<string, number | undefined> {
  const graph = JSON.parse(g) as { nodes?: Array<{ id: string; kind: string; meta?: { loc?: number } }> };
  return new Map((graph.nodes ?? []).filter((n) => n.kind === 'file').map((n) => [n.id, n.meta?.loc]));
}

test('every fixture: a warm rescan after an edit, a deletion and an addition equals a from-scratch scan', async () => {
  let exercised = 0;
  for (const name of fixtureNames()) {
    const dir = copyFixture(name);
    try {
      const files = sources(dir);
      const base = await scan(dir, false);
      if (base.startsWith('error:') || files.length < 2) continue;
      exercised += 1;

      // cold (writes the index and the facts store), then warm: the same bytes
      assert.strictEqual(await scan(dir, true), base, `${name}: cold cached scan == uncached`);
      assert.strictEqual(await scan(dir, true), base, `${name}: warm rescan of an unchanged tree == uncached`);

      // EDIT: one file gains two lines; its node must say so, and the whole graph must equal a fresh scan
      const edited = files[0];
      const rel = path.relative(dir, edited).split(path.sep).join('/');
      fs.appendFileSync(edited, '\n// edited by scan-incremental\n// and again\n');
      const afterEdit = await scan(dir, true);
      assert.strictEqual(afterEdit, await scan(dir, false), `${name}: rescan after an edit == fresh scan`);
      const before = fileNodes(base).get(`file:${rel}`);
      const after = fileNodes(afterEdit).get(`file:${rel}`);
      assert.ok(before !== undefined && after !== undefined && after > before, `${name}: the edit shows in ${rel}'s loc (${before} -> ${after})`);

      // DELETE: another file goes; its node must go
      const gone = files[files.length - 1];
      const goneRel = path.relative(dir, gone).split(path.sep).join('/');
      if (fileNodes(afterEdit).has(`file:${goneRel}`)) {
        fs.rmSync(gone);
        const afterDelete = await scan(dir, true);
        assert.strictEqual(afterDelete, await scan(dir, false), `${name}: rescan after a deletion == fresh scan`);
        assert.ok(!fileNodes(afterDelete).has(`file:${goneRel}`), `${name}: ${goneRel} is gone from the graph`);
      }

      // ADD: a new file beside the first one
      const added = path.join(path.dirname(edited), `zz_added_by_test${path.extname(edited)}`);
      fs.copyFileSync(edited, added);
      const addedRel = path.relative(dir, added).split(path.sep).join('/');
      const fresh = await scan(dir, false);
      const afterAdd = await scan(dir, true);
      assert.strictEqual(afterAdd, fresh, `${name}: rescan after an addition == fresh scan`);
      if (fileNodes(fresh).has(`file:${addedRel}`)) {
        assert.ok(fileNodes(afterAdd).has(`file:${addedRel}`), `${name}: ${addedRel} appears in the graph`);
      }
    } finally {
      cleanup(dir);
    }
  }
  assert.ok(exercised >= 10, `only ${exercised} fixtures exercised: the fixture list is not being derived`);
});

test('an import follows its target appearing and disappearing, though the importing file never changed', async () => {
  let exercised = 0;
  for (const name of fixtureNames()) {
    const dir = copyFixture(name);
    try {
      const base = await scan(dir, false);
      if (base.startsWith('error:')) continue;
      const edges = (JSON.parse(base) as { edges: Array<{ kind: string; srcId: string; dstId: string }> }).edges.filter(
        (e) => e.kind === 'import' && e.srcId.startsWith('file:') && e.dstId.startsWith('file:'),
      );
      if (edges.length === 0) continue;
      exercised += 1;
      const target = edges[0].dstId.slice('file:'.length);
      const targetAbs = path.join(dir, ...target.split('/'));
      const kept = fs.readFileSync(targetAbs);
      assert.strictEqual(await scan(dir, true), base, `${name}: cold cached scan == uncached`);
      assert.strictEqual(await scan(dir, true), base, `${name}: warm`);

      fs.rmSync(targetAbs);
      const without = await scan(dir, true);
      assert.strictEqual(without, await scan(dir, false), `${name}: rescan with ${target} gone == fresh`);
      assert.ok(!JSON.parse(without).edges.some((e: { kind: string; dstId: string }) => e.kind === 'import' && e.dstId === `file:${target}`), `${name}: no import edge into the deleted ${target}`);

      fs.writeFileSync(targetAbs, kept);
      const restored = await scan(dir, true);
      assert.strictEqual(restored, await scan(dir, false), `${name}: rescan with ${target} back == fresh`);
      assert.ok(
        JSON.parse(restored).edges.some((e: { kind: string; dstId: string }) => e.kind === 'import' && e.dstId === `file:${target}`),
        `${name}: the import edge into ${target} is back`,
      );
    } finally {
      cleanup(dir);
    }
  }
  assert.ok(exercised >= 3, `only ${exercised} fixtures have an import edge to follow`);
});

test('an unchanged tree: nothing parsed, no source read, no heavy facts loaded; one edit: one parse, one read', async () => {
  const dir = copyFixture('shopfront');
  try {
    const files = sources(dir);
    // Age every file past the racy window so a stat match may stand in for a read.
    const old = new Date(Date.now() - 10 * RACY_MS);
    for (const f of files) fs.utimesSync(f, old, old);

    await scanRepo(dir, { factsCache: true });
    const seen: string[] = [];
    const realRead = fs.readFileSync;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fs as any).readFileSync = function (p: unknown, ...rest: unknown[]) {
      if (typeof p === 'string' && SOURCE.test(p)) seen.push(p);
      return (realRead as (...a: unknown[]) => unknown).call(fs, p, ...rest);
    };
    try {
      const parsed0 = parsedFileCount();
      const loads0 = heavyLoadCount();
      await scanRepo(dir, { factsCache: true });
      assert.strictEqual(parsedFileCount() - parsed0, 0, 'no file parsed');
      assert.deepStrictEqual(seen, [], 'no source file read');
      assert.strictEqual(heavyLoadCount() - loads0, 0, "no file's heavy facts loaded");

      fs.appendFileSync(files[1], '\n// one edit\n');
      seen.length = 0;
      const parsed1 = parsedFileCount();
      const loads1 = heavyLoadCount();
      await scanRepo(dir, { factsCache: true });
      assert.strictEqual(parsedFileCount() - parsed1, 1, 'exactly the edited file parsed');
      assert.deepStrictEqual(seen, [files[1]], 'exactly the edited file read');
      assert.strictEqual(heavyLoadCount() - loads1, 0, "still no unchanged file's heavy facts loaded");
    } finally {
      (fs as unknown as { readFileSync: unknown }).readFileSync = realRead;
    }
  } finally {
    cleanup(dir);
  }
});

test('stat trust: racy files are re-read, a size change is always seen, the residual is the same-size same-mtime edit', async () => {
  const dir = copyFixture('shopfront');
  try {
    const files = sources(dir);
    const target = files[0];
    const text = fs.readFileSync(target, 'utf8');
    const flip = (s: string): string => s.replace(/[a-z]/, (c) => (c === 'z' ? 'y' : String.fromCharCode(c.charCodeAt(0) + 1)));
    assert.strictEqual(flip(text).length, text.length);
    assert.notStrictEqual(flip(text), text);
    const rel = path.relative(dir, target).split(path.sep).join('/');

    // 1. RACY: the file is brand new (mtime inside the window of the scan that reads it). A same-size edit that
    //    puts the mtime back is exactly what a stat comparison would miss; the window forces a re-read.
    const recent = new Date(Math.floor(Date.now() / 1000) * 1000); // whole milliseconds: restoring it is exact
    fs.utimesSync(target, recent, recent);
    await scanRepo(dir, { factsCache: true });
    fs.writeFileSync(target, flip(text));
    fs.utimesSync(target, recent, recent);
    assert.strictEqual(fs.statSync(target).mtimeMs, recent.getTime(), 'the specimen put the mtime back exactly');
    const parsedA = parsedFileCount();
    await scanRepo(dir, { factsCache: true });
    assert.strictEqual(parsedFileCount() - parsedA, 1, 'racy: same size, same mtime, still re-read and re-parsed');

    // 2. SIZE: older than the window and verified, then edited with the mtime put back: the size gives it away.
    const old = new Date(Date.now() - 10 * RACY_MS);
    fs.writeFileSync(target, text);
    fs.utimesSync(target, old, old);
    await scanRepo(dir, { factsCache: true }); // re-reads (stat changed), records the old mtime as verified
    fs.writeFileSync(target, `${text}\n// longer\n`);
    fs.utimesSync(target, old, old);
    const parsedB = parsedFileCount();
    await scanRepo(dir, { factsCache: true });
    assert.strictEqual(parsedFileCount() - parsedB, 1, 'size change with the mtime restored is seen');

    // 3. RESIDUAL (documented in parse/scanIndex.ts, the same blind spot as git): verified long after its mtime,
    //    then rewritten with the same size, the same mtime and the same inode.
    fs.writeFileSync(target, text);
    fs.utimesSync(target, old, old);
    await scanRepo(dir, { factsCache: true });
    const parsedC = parsedFileCount();
    const fd = fs.openSync(target, 'r+');
    fs.writeSync(fd, flip(text), 0, 'utf8'); // in place: the inode survives
    fs.closeSync(fd);
    fs.utimesSync(target, old, old);
    await scanRepo(dir, { factsCache: true });
    assert.strictEqual(parsedFileCount() - parsedC, 0, `residual: an in-place same-size edit with its mtime restored is not seen (${rel})`);
  } finally {
    cleanup(dir);
  }
});

test('the compose file changing re-runs the detectors that depend on it', async () => {
  const dir = copyFixture('shopfront');
  try {
    await scanRepo(dir, { factsCache: true });
    const before = strip(await scanRepo(dir, { factsCache: true }));
    const compose = path.join(dir, 'docker-compose.yml');
    const yml = fs.readFileSync(compose, 'utf8');
    // notifications reaches its broker through REDIS_URL: point the wire at the database instead.
    const next = yml.replace(/(notifications:[\s\S]*?REDIS_URL: )redis:\/\/redis:6379/, '$1redis://postgres:6379');
    assert.notStrictEqual(next, yml, 'the specimen has the wire to move');
    fs.writeFileSync(compose, next);
    const incremental = strip(await scanRepo(dir, { factsCache: true }));
    assert.strictEqual(incremental, strip(await scanRepo(dir, { factsCache: false })), 'rescan == fresh scan after the compose change');
    assert.notStrictEqual(incremental, before, 'and the change is in the graph: the unchanged source files were detected again');
  } finally {
    cleanup(dir);
  }
});

test('deferred persistence: nothing is written until asked, then the next scan is warm', async () => {
  const dir = copyFixture('shopfront');
  try {
    let persist: { index: () => void; facts: () => void } | undefined;
    await scanRepo(dir, { factsCache: true, deferCachePersist: (p) => (persist = p) });
    const cache = path.join(dir, '.sequence', 'cache');
    assert.ok(!fs.existsSync(path.join(cache, 'scan-index.v8')) && !fs.existsSync(path.join(cache, 'facts.v8')), 'nothing written yet');
    persist!.index();
    persist!.facts();
    assert.ok(fs.existsSync(path.join(cache, 'scan-index.v8')) && fs.existsSync(path.join(cache, 'facts.v8')));
    const parsed0 = parsedFileCount();
    const facts: FileFacts[] = [];
    await scanRepo(dir, { factsCache: true, onServiceFacts: (per) => per.forEach((p) => facts.push(...p.facts)) });
    assert.strictEqual(parsedFileCount() - parsed0, 0, 'the persisted cache serves the next scan');
    assert.ok(facts.length > 0 && facts.every((f) => Array.isArray(f.lines) && Array.isArray(f.calls)), 'onServiceFacts gets plain, complete facts');
  } finally {
    cleanup(dir);
  }
});
