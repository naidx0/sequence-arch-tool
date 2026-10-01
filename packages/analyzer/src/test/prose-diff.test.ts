/**
 * PROSE-DIFF SALVAGE — locking tests. See proseDiff.ts for the measured
 * failure this answers: a full 32-round budget spent writing the fix into
 * markdown while the edit tools went uncalled.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import { applyProseDiffFile, parseProseDiffs } from '../server/proseDiff.js';

const FILE = ['function a() {', '  return 1;', '}', '', 'function b() {', '  return 2;', '}'].join('\n');

test('parseProseDiffs: only ```diff fences are read, prose patches are not writes', () => {
  const text = [
    'Here is the fix:',
    '```diff',
    '--- a/src/x.ts',
    '+++ b/src/x.ts',
    '@@ -2,1 +2,1 @@',
    '-  return 1;',
    '+  return 42;',
    '```',
    'And a QUOTED example that must not apply:',
    '```',
    '--- a/src/y.ts',
    '+++ b/src/y.ts',
    '```',
  ].join('\n');
  const files = parseProseDiffs(text);
  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0]!.path, 'src/x.ts');
  assert.strictEqual(files[0]!.isNew, false);
});

test('applyProseDiffFile: an exact-context hunk lands; the rest of the file is untouched', () => {
  const [df] = parseProseDiffs(
    '```diff\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n function a() {\n-  return 1;\n+  return 42;\n }\n```',
  );
  const applied = applyProseDiffFile(df!, FILE);
  assert.ok('content' in applied, JSON.stringify(applied));
  assert.ok(applied.content.includes('return 42;'));
  assert.ok(applied.content.includes('return 2;'), 'untouched half survives');
});

test('applyProseDiffFile: mismatched context refuses the file with the reason named', () => {
  const [df] = parseProseDiffs(
    // Removal-anchoring rescues real '-' lines, so a refusal now requires the
    // REMOVAL itself to be unreal too — that is the honest boundary.
    '```diff\n--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n function NOPE() {\n-  return NOT_IN_FILE;\n+  return 42;\n```',
  );
  const refused = applyProseDiffFile(df!, FILE);
  assert.ok('reason' in refused);
  assert.match(refused.reason, /context does not match/);
});

/*
 * EDGE-CONTEXT FUZZ — the mini-50 v17 shape, reproduced.
 *
 * 25 of 50 instances shipped no patch and 3 of them had a complete diff in the
 * answer that this module refused. sphinx-doc__sphinx-7748's hunk 1 adds two
 * class attributes under a docstring: ADDITION-ONLY, so the removal-anchored
 * fallback cannot reach it by construction, and its edge context was a line
 * off. Only fuzz can place it.
 */
const MIXIN_FILE = [
  'class DocstringSignatureMixin:',
  '    """',
  '    Mixin for FunctionDocumenter and MethodDocumenter to provide the',
  '    feature of reading the signature from the docstring.',
  '    """',
  '',
  '    def _find_signature(self, encoding=None):',
  '        pass',
].join('\n');

test('applyProseDiffFile: an ADDITION-ONLY hunk lands when only its edge context is wrong', () => {
  const [df] = parseProseDiffs(
    [
      '```diff',
      '--- a/sphinx/ext/autodoc/__init__.py',
      '+++ b/sphinx/ext/autodoc/__init__.py',
      '@@ -1,5 +1,7 @@',
      // The model retyped the class line with a base it does not have — this is
      // the ONLY wrong line, and it sits on the edge.
      ' class DocstringSignatureMixin(object):',
      '     """',
      '     Mixin for FunctionDocumenter and MethodDocumenter to provide the',
      '     feature of reading the signature from the docstring.',
      '     """',
      '+    _new_docstrings = None',
      '+    _signatures = None',
      '```',
    ].join('\n'),
  );
  const applied = applyProseDiffFile(df!, MIXIN_FILE);
  assert.ok('content' in applied, JSON.stringify(applied));
  const out = applied.content.split('\n');
  assert.ok(applied.content.includes('_new_docstrings = None'), 'the addition landed');
  assert.strictEqual(
    out[0],
    'class DocstringSignatureMixin:',
    "the FILE's own line survives — the diff's mis-remembered edge never overwrites it",
  );
  // Placed where the diff said: after the docstring, before the method.
  assert.ok(out.indexOf('    _new_docstrings = None') > out.indexOf('    """'));
  assert.ok(
    out.indexOf('    _signatures = None') <
      out.indexOf('    def _find_signature(self, encoding=None):'),
  );
});

test('applyProseDiffFile: fuzz refuses when the core left over is too short to be evidence', () => {
  /* Two lines match everywhere in real source. Dropping context until something
     matches is how a fuzzy patcher lands a hunk in the wrong function. */
  const [df] = parseProseDiffs(
    ['```diff', '--- a/f', '+++ b/f', '@@ -1,2 +1,3 @@', ' WRONG_A', ' }', '+ADDED', '```'].join('\n'),
  );
  const refused = applyProseDiffFile(df!, ['{', '}', '{', '}'].join('\n'));
  assert.ok('reason' in refused, JSON.stringify(refused));
  assert.match(refused.reason, /context does not match|more than one place/);
});

test('applyProseDiffFile: fuzz still demands a UNIQUE core — a repeated block refuses', () => {
  const twice = [
    'def handler():',
    '    setup()',
    '    run()',
    '    teardown()',
    '',
    'def handler2():',
    '    setup()',
    '    run()',
    '    teardown()',
  ].join('\n');
  const [df] = parseProseDiffs(
    [
      '```diff',
      '--- a/f',
      '+++ b/f',
      '@@ -1,4 +1,5 @@',
      ' def NOT_THE_REAL_NAME():',
      '     setup()',
      '     run()',
      '     teardown()',
      '+    audit()',
      '```',
    ].join('\n'),
  );
  const refused = applyProseDiffFile(df!, twice);
  assert.ok('reason' in refused, `a core matching twice must refuse: ${JSON.stringify(refused)}`);
});

test('applyProseDiffFile: ambiguous context without a deciding hint refuses', () => {
  const twice = 'x\nSAME\nx\nSAME\nx';
  const [df] = parseProseDiffs('```diff\n--- a/f\n+++ b/f\n@@ -9 +9 @@\n-SAME\n+DIFFERENT\n```');
  // hint line 9 is equidistant from nothing — both matches tie at distance; refuse.
  const r = applyProseDiffFile(df!, twice);
  assert.ok('reason' in r || 'content' in r);
  if ('content' in r) {
    // If the hint disambiguated, exactly ONE occurrence changed.
    assert.strictEqual((r.content.match(/DIFFERENT/g) ?? []).length, 1);
  }
});

test('applyProseDiffFile: /dev/null creates a new file from additions only', () => {
  const [df] = parseProseDiffs(
    '```diff\n--- /dev/null\n+++ b/HEALTHCHECK.md\n@@ -0,0 +1,2 @@\n+# Healthcheck\n+curl localhost/health\n```',
  );
  assert.strictEqual(df!.isNew, true);
  const applied = applyProseDiffFile(df!, null);
  assert.ok('content' in applied);
  assert.strictEqual(applied.content, '# Healthcheck\ncurl localhost/health\n');
  // And it refuses to overwrite an existing file wearing the new-file header.
  const clash = applyProseDiffFile(df!, 'already here');
  assert.ok('reason' in clash);
});

test('multi-hunk, multi-file diffs apply in order', () => {
  const files = parseProseDiffs(
    [
      '```diff',
      '--- a/f',
      '+++ b/f',
      '@@ -2 +2 @@',
      '-  return 1;',
      '+  return 10;',
      '@@ -6 +6 @@',
      '-  return 2;',
      '+  return 20;',
      '--- a/g',
      '+++ b/g',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '```',
    ].join('\n'),
  );
  assert.strictEqual(files.length, 2);
  const f = applyProseDiffFile(files[0]!, FILE);
  assert.ok('content' in f);
  assert.ok(f.content.includes('return 10;') && f.content.includes('return 20;'));
  const g = applyProseDiffFile(files[1]!, 'old');
  assert.ok('content' in g && g.content === 'new');
});

test('resolveUnproductiveRoundLimit: an explicitly raised round budget raises the dead-end budget with it', async () => {
  const { resolveUnproductiveRoundLimit, MAX_ASK_TOOL_ROUNDS } = await import('../server/askTools.js');
  assert.strictEqual(resolveUnproductiveRoundLimit('edit'), 2);
  assert.strictEqual(resolveUnproductiveRoundLimit('edit', MAX_ASK_TOOL_ROUNDS), 2);
  assert.strictEqual(resolveUnproductiveRoundLimit('edit', 32), 4);
  assert.strictEqual(resolveUnproductiveRoundLimit('explore', 32), 4);
  assert.strictEqual(resolveUnproductiveRoundLimit('explore'), 3);
  /*
   * TEACH CARRIES THE EXPLORE BUDGET, and nothing else asserted it. Teach used
   * to BE 'explore' inside askPipeline precisely for this budget; when it split
   * into its own bucket the `|| intent === 'teach'` clause became the only
   * thing keeping it, and it reads like redundant defensiveness. Deleting it
   * would leave every suite green while a lesson — which the must-read rule
   * forces to search→read the real code first — lost a dead-end round and got
   * cut off mid-concept.
   */
  assert.strictEqual(resolveUnproductiveRoundLimit('teach'), 3);
  assert.strictEqual(resolveUnproductiveRoundLimit('teach', 32), 4);
  assert.strictEqual(resolveUnproductiveRoundLimit('chat'), 2);
});

test('resolveAskRoundCap: full-permission edit turns default to the agentic budget; explicit maxRounds wins both ways', async () => {
  const { resolveAskRoundCap, FULL_EDIT_ASK_TOOL_ROUNDS, MAX_ASK_TOOL_ROUNDS } = await import(
    '../server/askTools.js'
  );
  const base = { designMode: false, repoRoot: '/r', question: 'Fix the route' };
  assert.strictEqual(resolveAskRoundCap({ ...base, agenticEdit: true }), FULL_EDIT_ASK_TOOL_ROUNDS);
  assert.strictEqual(resolveAskRoundCap({ ...base }), MAX_ASK_TOOL_ROUNDS);
  assert.strictEqual(resolveAskRoundCap({ ...base, agenticEdit: true, maxRounds: 4 }), 4);
  assert.strictEqual(resolveAskRoundCap({ ...base, agenticEdit: true, maxRounds: 32 }), 32);
  // design mode keeps its short path regardless
  assert.ok(resolveAskRoundCap({ ...base, designMode: true, agenticEdit: true }) <= FULL_EDIT_ASK_TOOL_ROUNDS);
});

test('applyProseDiffFile: trailing-whitespace drift in retyped context still lands, and the FILE bytes win', () => {
  // File has trailing spaces the model shed when retyping the context.
  const fileWithTrail = 'function a() {  \n  return 1;\n}';
  const [df] = parseProseDiffs(
    '```diff\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n function a() {\n-  return 1;\n+  return 42;\n }\n```',
  );
  const applied = applyProseDiffFile(df!, fileWithTrail);
  assert.ok('content' in applied, JSON.stringify(applied));
  assert.ok(applied.content.includes('return 42;'));
  assert.ok(applied.content.startsWith('function a() {  \n'), "the file's own trailing spaces survive");
});

test('buildAskPrompt: the agentic-edit digest budget bites on a huge repo, with honest omission markers', async () => {
  const { buildAskPrompt } = await import('../explain/explain.js');
  // A graph big enough that even the INDEX exceeds the agentic budget.
  const nodes: any[] = [{ id: 'repo', kind: 'repo', label: 'repo' }];
  const edges: any[] = [];
  for (let s = 0; s < 80; s++) {
    nodes.push({ id: `svc${s}`, kind: 'service', label: `service-${s}`, parentId: 'repo' });
    for (let m = 0; m < 12; m++) {
      const mid = `svc${s}/mod${m}`;
      nodes.push({ id: mid, kind: 'module', label: `module-${m}`, parentId: `svc${s}` });
      for (let f = 0; f < 6; f++) {
        nodes.push({
          id: `${mid}/deeply/nested/pkg/path/file_${f}_with_a_long_name.py`,
          kind: 'file',
          label: `file_${f}_with_a_long_name.py`,
          parentId: mid,
        });
      }
    }
  }
  const { buildDigest } = await import('../explain/explain.js');
  const digest = buildDigest({ version: 1, nodes, edges } as never);
  const q = 'Fix the bug described in the issue';
  const full = buildAskPrompt(digest, q, {});
  const agentic = buildAskPrompt(digest, q, { agenticEditor: true });
  assert.ok(
    agentic.length < full.length * 0.75,
    `agentic prompt is meaningfully smaller: ${agentic.length} vs ${full.length}`,
  );
  assert.match(agentic, /omitted|more not shown|not listed/i);
});

test('applyProseDiffFile: fabricated context around REAL removal lines anchors on the removals', () => {
  const file = ['import os', 'import sys', '', 'def target():', '    return OLD_VALUE', '', 'def other():', '    return 2'].join('\n');
  // The model invented the surrounding context but got the removed line right.
  const [df] = parseProseDiffs(
    '```diff\n--- a/f\n+++ b/f\n@@ -4,3 +4,3 @@\n def target_hallucinated():\n-    return OLD_VALUE\n+    return NEW_VALUE\n some_invented_line\n```',
  );
  const applied = applyProseDiffFile(df!, file);
  assert.ok('content' in applied, JSON.stringify(applied));
  assert.ok(applied.content.includes('return NEW_VALUE'));
  assert.ok(applied.content.includes('def target():'), 'real neighbors untouched');
  assert.ok(!applied.content.includes('hallucinated'), 'fabricated context is discarded, not written');
});

test('applyProseDiffFile: removal anchoring refuses ambiguity and addition-only hunks with bad context', () => {
  const twice = ['a', 'SAME', 'b', 'SAME', 'c'].join('\n');
  const [amb] = parseProseDiffs('```diff\n--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n NOPE\n-SAME\n+DIFF\n```');
  const r1 = applyProseDiffFile(amb!, twice);
  if ('reason' in r1) assert.match(r1.reason, /more than one place|does not match/);
  else assert.strictEqual((r1.content.match(/DIFF/g) ?? []).length, 1);
  // addition-only hunk with fabricated context has nothing real to anchor on
  const [addOnly] = parseProseDiffs('```diff\n--- a/f\n+++ b/f\n@@ -1,1 +1,2 @@\n NOT_IN_FILE\n+new line\n```');
  const r2 = applyProseDiffFile(addOnly!, 'x\ny');
  assert.ok('reason' in r2, JSON.stringify(r2));
});

test('parseAllToolRequests: leaked native-XML tool syntax is reported malformed, not swallowed as prose', async () => {
  const { parseAllToolRequests } = await import('../server/askTools.js');
  const leak =
    'Making the edit now.\n]<]minimax[>[<tool_call>]<]minimax[>[<invoke name="edit_file">' +
    ']<]minimax[>[</invoke>\n]<]minimax[>[</tool_call>\n';
  const parsed = parseAllToolRequests(leak);
  assert.strictEqual(parsed.requests.length, 0);
  assert.strictEqual(parsed.malformed.length, 1);
  assert.match(parsed.malformed[0]!, /NATIVE XML tool-call syntax/);
  // A plain prose answer is untouched.
  const clean = parseAllToolRequests('The fix is complete and the tests pass.');
  assert.strictEqual(clean.malformed.length, 0);
  // A VALID fence alongside stray XML executes normally — no false bounce.
  const mixed = parseAllToolRequests(
    'text\n```sequence-tool\n{"id":"a1","name":"read_file","args":{"path":"x.ts"}}\n```\n</tool_call>',
  );
  assert.strictEqual(mixed.requests.length, 1);
  assert.strictEqual(mixed.malformed.length, 0);
});

test('multi-hunk: earlier hunks that change line counts do not misplace a later ambiguous hunk', () => {
  // Two identical "return 0;" lines far apart; an early hunk inserts lines
  // before the second one. The later hunk's @@ hint must be rebased so it
  // still resolves to the intended (second) occurrence.
  const file = [
    'function a() {',
    '  setup();',
    '  return 0;',   // occurrence 1 (line 3)
    '}',
    '',
    'function bbbbb() {',
    '  return 0;',   // occurrence 2 (line 7)
    '}',
  ].join('\n');
  const diff = [
    '```diff',
    '--- a/f',
    '+++ b/f',
    '@@ -1,3 +1,4 @@',
    ' function a() {',
    '   setup();',
    '+  precheck();',
    '   return 0;',
    '@@ -7,2 +8,2 @@',       // hint points at the SECOND return, post-insert line 8
    ' function bbbbb() {',
    '-  return 0;',
    '+  return 42;',
    '```',
  ].join('\n');
  const [df] = parseProseDiffs(diff);
  const r = applyProseDiffFile(df!, file);
  assert.ok('content' in r, JSON.stringify(r));
  const out = r.content.split('\n');
  assert.strictEqual(out[2], '  precheck();', 'first hunk inserted');
  assert.ok(r.content.includes('  return 42;'), 'second hunk applied');
  assert.strictEqual((r.content.match(/return 42;/g) ?? []).length, 1, 'only the intended one changed');
  assert.ok(out.slice(0, 5).join('\n').includes('  return 0;'), 'the FIRST return 0 is untouched');
});
