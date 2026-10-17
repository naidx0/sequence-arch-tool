/**
 * 2C LOCK - the per-file facts cache.
 *
 * The invariants, each with the case that would break it:
 *   - a rescan of an unchanged repo parses NOTHING and emits the same graph
 *   - after editing exactly one file, the rescan parses EXACTLY one file
 *   - cached facts are deepStrictEqual to a fresh parse (Maps, undefined members)
 *   - a different extractor version / size cap / language / content never hits
 *   - a torn or foreign cache file is ignored, not an error
 */
import assert from 'node:assert';
import { test, before } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { initParser, parsedFileCount } from '../parse/treesitter.js';
import { FactsCache, EXTRACTOR_VERSION } from '../parse/factsCache.js';
import { extractFacts } from '../parse/facts.js';
import type { FileFacts } from '../types.js';

type ArchGraph = Awaited<ReturnType<typeof scanRepo>>;

before(async () => {
  await initParser();
});

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, '..', '..', 'test', 'fixtures');

function copyFixture(name: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-fcache-'));
  const dir = path.join(tmp, name);
  fs.cpSync(path.join(FIXTURES, name), dir, { recursive: true });
  return dir;
}

const strip = (g: ArchGraph): string => {
  const { scannedAt: _s, ...rest } = g as unknown as Record<string, unknown>;
  void _s;
  return JSON.stringify(rest);
};

async function scan(
  dir: string,
  factsCache: boolean,
): Promise<{ graph: string; parsed: number; facts: FileFacts[] }> {
  const before = parsedFileCount();
  const facts: FileFacts[] = [];
  const g = await scanRepo(dir, {
    factsCache,
    onServiceFacts: (per) => per.forEach((p) => facts.push(...p.facts)),
  });
  return { graph: strip(g), parsed: parsedFileCount() - before, facts };
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(ts|tsx|js|jsx|mjs|py|go|java)$/.test(e.name)) out.push(f);
    }
  };
  walk(dir);
  return out.sort();
}

test('rescan: unchanged repo parses nothing; one edited file parses exactly one', async () => {
  const dir = copyFixture('shopfront');
  try {
    const files = sourceFiles(dir);
    assert.ok(files.length >= 3, 'specimen too small to mean anything');
    const nocache = await scan(dir, false);
    const cold = await scan(dir, true);
    assert.strictEqual(cold.parsed, files.length, 'cold scan parses every file');
    assert.strictEqual(cold.graph, nocache.graph, 'a cache-writing scan emits the uncached graph');
    assert.ok(fs.existsSync(path.join(dir, '.sequence', 'cache', 'facts.v8')));

    const warm = await scan(dir, true);
    assert.strictEqual(warm.parsed, 0, 'unchanged rescan parses nothing');
    assert.strictEqual(warm.graph, nocache.graph, 'cached facts yield the byte-identical graph');
    assert.deepStrictEqual(warm.facts, nocache.facts, 'cached FileFacts equal fresh FileFacts');
    warm.facts.forEach((f, i) =>
      assert.deepStrictEqual(Object.keys(f), Object.keys(nocache.facts[i]), 'and list their keys in the same order'),
    );

    fs.appendFileSync(files[1], '\n// edited\n');
    const edited = await scan(dir, true);
    assert.strictEqual(edited.parsed, 1, 'editing one file re-parses exactly one file');
    const fresh = await scan(dir, false);
    assert.strictEqual(edited.graph, fresh.graph, 'and the result equals a from-scratch scan');

    const again = await scan(dir, true);
    assert.strictEqual(again.parsed, 0, 'the edit was cached too');
  } finally {
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
});

test('without the option a scan neither reads nor writes the cache', async () => {
  const dir = copyFixture('shopfront');
  try {
    await scan(dir, false);
    assert.ok(!fs.existsSync(path.join(dir, '.sequence', 'cache', 'facts.v8')));
  } finally {
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
});

test('a torn or foreign cache file is ignored, not fatal', async () => {
  const dir = copyFixture('shopfront');
  try {
    fs.mkdirSync(path.join(dir, '.sequence', 'cache'), { recursive: true });
    const f = path.join(dir, '.sequence', 'cache', 'facts.v8');
    const junks = [
      Buffer.from('{"format":1,"entries":'),
      v8.serialize([]),
      v8.serialize({ format: 99, v8: process.versions.v8, entries: {} }),
      v8.serialize({ format: 1, v8: 'other', entries: {} }),
      v8.serialize({ format: 1, v8: process.versions.v8, entries: { x: 1 } }).subarray(0, 20),
      Buffer.alloc(0),
    ];
    for (const junk of junks) {
      fs.writeFileSync(f, junk);
      const r = await scan(dir, true);
      assert.ok(r.parsed > 0, `junk of ${junk.length} bytes must not be served`);
    }
  } finally {
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
});

test('the key covers content, rel, language, tsx, size cap and extractor version', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-fcache-key-'));
  try {
    const src = "const a = process.env.X; const m = new Map(); function f() { return g(a, 'lit'); }\n";
    const facts = extractFacts(src, 'a.ts', 'ts');
    const c = new FactsCache(dir, 1000);
    const sha = FactsCache.hash(src);
    c.put('a.ts', sha, 'ts', false, facts);
    c.save();
    const lines = (): string[] => src.split('\n');
    const reload = (max: number): FactsCache => new FactsCache(dir, max);
    assert.deepStrictEqual(reload(1000).get('a.ts', sha, 'ts', false, lines), facts, 'round trip is exact');
    assert.strictEqual(reload(1000).get('a.ts', FactsCache.hash(src + ' '), 'ts', false, lines), undefined, 'content');
    assert.strictEqual(reload(1000).get('b.ts', sha, 'ts', false, lines), undefined, 'rel');
    assert.strictEqual(reload(1000).get('a.ts', sha, 'js', false, lines), undefined, 'language');
    assert.strictEqual(reload(1000).get('a.ts', sha, 'ts', true, lines), undefined, 'tsx flag');
    assert.strictEqual(reload(2000).get('a.ts', sha, 'ts', false, lines), undefined, 'MAX_FILE_BYTES');
    // extractor version: tamper with the stored entry, as an older build would have written it
    const file = path.join(dir, '.sequence', 'cache', 'facts.v8');
    const disk = v8.deserialize(fs.readFileSync(file));
    disk.entries['a.ts'].extractor = `${EXTRACTOR_VERSION}-old`;
    fs.writeFileSync(file, v8.serialize(disk));
    assert.strictEqual(reload(1000).get('a.ts', sha, 'ts', false, lines), undefined, 'extractor version');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cached facts equal fresh facts for every language specimen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-fcache-codec-'));
  try {
    const specimens: Array<[string, 'ts' | 'js' | 'py' | 'go' | 'java', string]> = [
      ['a.ts', 'ts', "import a, { b } from 'x';\nconst { P = 1, Q: z } = process.env;\nconst u = new URL(process.env.U ?? 'http://h');\nexport * from './y';\n"],
      ['a.py', 'py', "import os\nX = os.environ['A']\nclass K(B):\n  def f(self): return requests.get(X + '/p')\n"],
      ['a.go', 'go', 'package p\nimport "net/http"\nvar U = "http://h"\nfunc F() { http.Get(U) }\n'],
      ['A.java', 'java', 'import a.B;\nclass A extends C { @Value("${x}") String s; void m(B b) { b.go(s); } }\n'],
    ];
    for (const [rel, lang, src] of specimens) {
      const facts = extractFacts(src, rel, lang);
      const c = new FactsCache(dir, 1);
      const sha = FactsCache.hash(src);
      c.put(rel, sha, lang, false, facts);
      c.save();
      const back = new FactsCache(dir, 1).get(rel, sha, lang, false, () => src.split('\n'));
      assert.deepStrictEqual(back, facts, rel);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
