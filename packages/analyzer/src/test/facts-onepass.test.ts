/**
 * 2C LOCK — the one-pass cursor walk visits exactly the nodes the recursive
 * `walk` did, in the same (pre-order, named-only) order, and the folded env pass
 * still finds every read.
 *
 * Specimens are small on purpose; the real-corpus equality (3,188 files of this
 * repo, old extractor vs new, deepStrictEqual) is recorded in the commit message
 * and re-checked by scan-oracle.test.ts on every fixture.
 */
import assert from 'node:assert';
import { test, before } from 'node:test';
import { initParser, parseSource, walk, walkSelected } from '../parse/treesitter.js';
import { extractFacts } from '../parse/facts.js';
import type { Lang } from '../types.js';

before(async () => {
  await initParser();
});

const SPECIMENS: Array<[Lang, boolean, string]> = [
  ['ts', false, "import a from 'x';\nexport * from './y';\nconst { P = 1, Q: z } = process.env;\nfunction f(a: number) { return a + g(1); }\nclass C { m() { return new D(process.env['K']); } }\nconst h = () => os;\n"],
  ['ts', true, 'const el = <div a="1">{process.env.T}</div>;\n'],
  ['js', false, "const x = require('y'); exports.z = function () {};\nconst bad = ( ;\nfunction q( {\n"],
  ['py', false, "import os\nfrom a import b as c\nX = os.environ['A']\ndef f(:\n  y = os.getenv('B')\nclass K(B):\n  pass\n"],
  ['go', false, 'package p\nimport (\n "os"\n)\nfunc F() { v := os.Getenv("G"); _ = v }\nfunc (r *R) M( {\n'],
  ['java', false, 'package p;\nimport java.util.List;\nclass A extends B { String s = System.getenv("J"); void m(int x) { foo.bar(x); } }\nclass Broken { void m( { }\n'],
];

test('walkSelected selecting every type visits the same nodes in the same order as walk', () => {
  for (const [lang, tsx, src] of SPECIMENS) {
    const tree = parseSource(src, lang, tsx);
    try {
      const expected: string[] = [];
      walk(tree.rootNode, (n) => {
        expected.push(`${n.type}@${n.startIndex}`);
      });
      const types = new Set(expected.map((e) => e.split('@')[0]));
      const got: string[] = [];
      walkSelected(tree, src, types, new Map(), (n) => {
        got.push(`${n.type}@${n.startIndex}`);
      });
      assert.ok(expected.length > 5);
      assert.deepStrictEqual(got, expected, `${lang}${tsx ? '/tsx' : ''}`);
    } finally {
      tree.delete();
    }
  }
});

test('walkSelected hands over only the selected types, still in pre-order', () => {
  const src = "function a() { function b() {} }\nconst c = () => 1;\n";
  const tree = parseSource(src, 'ts');
  try {
    const got: string[] = [];
    walkSelected(tree, src, new Set(['function_declaration', 'arrow_function']), new Map(), (n) =>
      got.push(`${n.type}@${n.startIndex}`),
    );
    assert.deepStrictEqual(got, ['function_declaration@0', 'function_declaration@15', 'arrow_function@' + src.indexOf('() =>')]);
  } finally {
    tree.delete();
  }
});

test('env reads survive non-ASCII text and CRLF before them (index units match the source)', () => {
  const ts = extractFacts("const s = '😀😀 日本語';\r\nconst a = process.env.AAA;\r\nconst b = process.env['BBB'];\r\n", 'a.ts', 'ts');
  assert.deepStrictEqual(ts.envReads.map((e) => [e.name, e.line]), [['AAA', 2], ['BBB', 3]]);
  const py = extractFacts("x = '😀日本'\nimport os\ny = os.environ['PYE']\nz = os.getenv('GG')\n", 'a.py', 'py');
  assert.deepStrictEqual(py.envReads.map((e) => [e.name, e.line]), [['PYE', 3], ['GG', 4]]);
});

test('an env read in every language is found by the folded pass, once per name per line', () => {
  const found = (lang: Lang, src: string): string[] => extractFacts(src, `a.${lang}`, lang).envReads.map((e) => e.name);
  assert.deepStrictEqual(found('js', 'const a = process.env.ONE, b = process.env.ONE;\n'), ['ONE']);
  assert.deepStrictEqual(found('go', 'package p\nfunc F() { _ = os.Getenv("GO_V") }\n'), ['GO_V']);
  assert.deepStrictEqual(found('java', 'class A { String s = System.getenv("JAVA_V"); }\n'), ['JAVA_V']);
});

test('ERROR nodes are still tallied by the cursor pass', () => {
  assert.ok(extractFacts('const a = ( ;\nfunction f( {\n', 'a.ts', 'ts').parseErrors > 0);
  assert.strictEqual(extractFacts('const a = 1;\n', 'a.ts', 'ts').parseErrors, 0);
});
