/**
 * THE ERROR TALLY MUST STAY THE NUMBER THE DEDICATED WALK PRODUCED.
 *
 * H12 profiling (see `parse/profile.ts`) showed the scanner walking every
 * syntax tree TWICE: once to extract facts, and once more in `countErrors` to
 * tally ERROR nodes. On the real corpus that second traversal was ~15% of the
 * entire scan — 2.47s of django's 16.2s, 10.75s of n8n's 71.5s — for a number
 * the first walk was already positioned to count.
 *
 * `factsFromTree` now tallies ERROR nodes inline. That is only safe because
 * every fact walk visits the same nodes in the same order and none of them
 * prunes. This test is what makes that claim checkable rather than asserted:
 * it re-parses the same source, runs the ORIGINAL `countErrors` walk over it,
 * and requires the two numbers to be equal — for every language, for clean
 * sources and for deliberately broken ones.
 *
 * If someone later adds a `return false` to a fact walk (a legitimate-looking
 * pruning optimisation), the inline tally silently starts under-counting and
 * `graph.warnings` quietly loses its "N parse error region(s)" lines. This
 * test fails first.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import { extractFacts } from '../parse/facts.js';
import { countErrors, initParser, parseSource } from '../parse/treesitter.js';
import type { Lang } from '../types.js';

/** [label, source, file, lang] — clean and broken, all five languages. */
const CASES: [string, string, string, Lang][] = [
  ['py clean', 'import os\n\n\ndef handler(event):\n    return os.environ.get("K", event)\n', 'a.py', 'py'],
  ['py broken', 'def broken(:\n    x = )\nclass ??:\n', 'b.py', 'py'],
  // A file that is mostly fine with ONE bad region — the shape a real repo
  // produces, and the one where an early-pruning walk would diverge first.
  ['py half-broken', 'import sys\n\ndef ok():\n    return 1\n\n)))\n', 'c.py', 'py'],
  // …and one the parser recovers from with MISSING rather than ERROR nodes,
  // so the equality assertion is exercised at zero too.
  ['py recovered', 'import sys\n\ndef ok():\n    return 1\n\ndef bad(:\n', 'd.py', 'py'],
  ['ts clean', 'import { join } from "node:path";\nexport const p = (a: string) => join(a, "b");\n', 'a.ts', 'ts'],
  ['ts broken', 'const x = {{{;\nfunction ((\n', 'b.ts', 'ts'],
  ['tsx broken', 'const A = () => <div><span></div>;\nconst ) = 1;\n', 'c.tsx', 'ts'],
  ['js clean', 'const path = require("path");\nfunction go() { return path.join("a"); }\n', 'a.js', 'js'],
  ['js broken', 'function ) { const = ; }\n', 'b.js', 'js'],
  ['jsx broken', 'const A = () => <div>;\nlet ] = 2;\n', 'c.jsx', 'js'],
  ['go clean', 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("hi") }\n', 'a.go', 'go'],
  ['go broken', 'package main\n\nfunc ( { }\nvar = =\n', 'b.go', 'go'],
  ['java clean', 'package a;\n\npublic class A {\n  public String go() { return System.getenv("X"); }\n}\n', 'A.java', 'java'],
  ['java broken', 'public class {\n  void ((( }\n', 'B.java', 'java'],

  // NESTED error regions — an ERROR buried inside a function body / class body,
  // not at the top of the file. These are the cases a pruning fact walk would
  // silently stop counting while the top-level ones still matched.
  ['py nested broken', 'def outer():\n    def inner():\n        )))\n        return 1\n    return inner\n', 'n.py', 'py'],
  ['ts nested broken', 'function outer() {\n  const go = () => {\n    let ) = 1;\n    return 2;\n  };\n  return go;\n}\n', 'n.ts', 'ts'],
  ['go nested broken', 'package main\n\nfunc outer() int {\n\tif true {\n\t\tvar = =\n\t}\n\treturn 1\n}\n', 'n.go', 'go'],
  ['java nested broken', 'public class N {\n  void go() {\n    int x = ;\n    ((( ;\n  }\n}\n', 'N.java', 'java'],
];

test('the inline ERROR tally equals the dedicated countErrors walk, every language', async () => {
  await initParser();
  for (const [label, src, file, lang] of CASES) {
    const facts = extractFacts(src, file, lang);

    // The original second traversal, run here on an independently parsed tree.
    const isTsx = file.endsWith('.tsx') || file.endsWith('.jsx');
    const tree = parseSource(src, lang === 'js' && isTsx ? 'ts' : lang, isTsx);
    let expected: number;
    try {
      expected = countErrors(tree.rootNode);
    } finally {
      tree.delete();
    }

    assert.equal(
      facts.parseErrors,
      expected,
      `${label}: inline tally ${facts.parseErrors} != countErrors ${expected} — ` +
        'the fact walk no longer visits every node the error walk did',
    );
  }
});

test('the broken cases actually produce errors — otherwise the test above proves nothing', async () => {
  await initParser();
  const broken = CASES.filter(([label]) => label.includes('broken'));
  assert.ok(broken.length >= 6, 'the corpus must carry broken sources for every language');
  assert.ok(
    CASES.some(([label]) => label.includes('nested')),
    'and at least one error region nested inside a function/class body, ' +
      'so a pruning walk is caught rather than matching on top-level nodes alone',
  );
  for (const [label, src, file, lang] of broken) {
    const facts = extractFacts(src, file, lang);
    assert.ok(
      facts.parseErrors > 0,
      `${label}: expected ERROR regions in deliberately broken source, got ${facts.parseErrors} — ` +
        'a corpus of only-clean sources would make the equality assertion vacuous',
    );
  }
});
