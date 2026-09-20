/**
 * THE MCP TOOL TABLE IS THE TOOL LIST, OR IT IS A LIE.
 *
 * `packages/mcp/README.md` is what an integrator reads to decide what Sequence
 * can do for them from Cursor, Codex or Claude Code. On 2026-09-02 it listed
 * ELEVEN tools while `TOOLS` in `packages/mcp/src/index.ts` exported FIFTEEN:
 * `architecture_changed`, `coverage`, `find_negatives` and `path_between` were
 * shipped, registered and undocumented. Nobody was lying on purpose — four
 * tools were added and one table was not — which is exactly the drift that a
 * prose rule cannot catch and a test can.
 *
 * This is CANON's "instructions become infrastructure" law applied to the one
 * document that faces outward: every rule worth having is written twice, once
 * as guidance and once as a check. The guidance is the README; this is the
 * check.
 *
 * It compares the SET OF NAMES and nothing else.
 *
 * Not the descriptions: what a row says a tool does is prose a human must
 * write, and a test policing it would be either trivially satisfied or
 * permanently wrong.
 *
 * And not the ORDER, which the first draft of this file did assert. That draft
 * went red immediately on a real difference — the README lists `design_suggest`
 * before `classify_repo` and the source registers them the other way — and the
 * README is right. A registration array is ordered by how the code grew; a
 * table is ordered for the person reading it, who wants the scanning tools
 * together and the exporters together. Forcing one to follow the other would
 * make the outward-facing document worse to serve a checker's convenience, so
 * the checker gave way. What actually broke was membership, and membership is
 * what this locks.
 */
import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const SRC = path.join(ROOT, 'packages', 'mcp', 'src', 'index.ts');
const README = path.join(ROOT, 'packages', 'mcp', 'README.md');

/** The `name:` of every entry in the exported `TOOLS` array, in source order. */
function toolNames() {
  const src = fs.readFileSync(SRC, 'utf8');
  const start = src.indexOf('export const TOOLS');
  assert.notStrictEqual(start, -1, 'packages/mcp/src/index.ts must export TOOLS');
  /* Walk to the array's own closing bracket rather than regexing to the end of
     the file: everything after TOOLS also contains `name:` keys. */
  let depth = 0;
  let end = -1;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.notStrictEqual(end, -1, 'the TOOLS array must be closed');
  const body = src.slice(start, end);
  return [...body.matchAll(/\bname:\s*'([a-z_]+)'/g)].map((m) => m[1]);
}

/** The first backticked cell of every table row in the README, in file order. */
function documentedNames() {
  const md = fs.readFileSync(README, 'utf8');
  return [...md.matchAll(/^\|\s*`([a-z_]+)`\s*\|/gm)].map((m) => m[1]);
}

test('packages/mcp/README.md documents exactly the tools TOOLS exports', () => {
  const exported = toolNames();
  const documented = documentedNames();

  // Non-vacuity: a parser that silently found nothing would pass [] === [].
  assert.ok(exported.length >= 10, `expected the real TOOLS array, parsed ${exported.length}`);

  const undocumented = exported.filter((n) => !documented.includes(n));
  const invented = documented.filter((n) => !exported.includes(n));

  assert.deepStrictEqual(
    undocumented,
    [],
    `packages/mcp/README.md is missing shipped tools: ${undocumented.join(', ')}. ` +
      'An integrator reads that table to decide what Sequence can do for them; a tool that is ' +
      'registered and undocumented is a capability nobody can find.',
  );
  assert.deepStrictEqual(
    invented,
    [],
    `packages/mcp/README.md documents tools that do not exist: ${invented.join(', ')}. ` +
      'A table row promising a tool the server does not register is worse than a missing row.',
  );
  // Membership both ways is the whole contract; see the header on order.
  assert.strictEqual(
    documented.length,
    new Set(documented).size,
    'a tool is documented twice — two rows for one tool is two answers to one question',
  );
});
