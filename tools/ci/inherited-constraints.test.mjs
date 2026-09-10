/**
 * WAVE 0 ITEM 0.2 — the salvage doc must carry the six named constraints.
 *
 * `docs/PIVOT-V2.md` deletes the v1 surface outright, and the plan
 * (`docs/research/v2-architecture-and-gaps.md`, R8) names the failure mode:
 * "Hard-won knowledge lives in comments a rewrite is licensed to delete."
 * §4.5 and §7-R8 between them name SIX specific constraints. This test is the
 * lock: `docs/rebuild/inherited-constraints.md` must exist, must quote each of
 * the six, and must cite each one to a real `file:line`.
 *
 * It lives in tools/ci because that is the tier CI actually gates on
 * (`node --test tools/ci/*.test.mjs`); `.github/workflows/ci.yml` states in a
 * comment that web vitest is not required.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOC = path.join(ROOT, 'docs/rebuild/inherited-constraints.md');

function readDoc() {
  assert.ok(
    fs.existsSync(DOC),
    'docs/rebuild/inherited-constraints.md does not exist — Wave 0 item 0.2 has not landed',
  );
  // core.autocrlf=true — normalise before any assertion reads a line.
  return fs.readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n');
}

/**
 * Prose form: blockquote markers dropped and every whitespace run collapsed to
 * one space, so a quoted sentence matches whether or not the markdown source
 * wrapped it. This is a normalisation, NOT a relaxation — the required phrase
 * must still appear in full and in order, exactly as the original comment wrote
 * it. Without it the test would be asserting a line-wrap width.
 */
function prose(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/^\s*>\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ');
}

function normQ(s) {
  return s.replace(/\s+/g, ' ');
}

/**
 * Resolve a `path/to/file.ts:12` or `path/to/file.ts:12-34` citation against the
 * SOURCE, and assert the cited lines really carry what the doc says they carry.
 *
 * This is the difference between a provenance document and a plausible one. The
 * previous lock asserted only that the citation STRING appeared in the doc, so when
 * another Wave 0 item inserted 15 lines into `ArchCanvasBoard.tsx`, three citations
 * silently began pointing at the wrong code and every test stayed green — including
 * a hard-coded `:243-273` inside this very file, which was pinning the rot in place.
 *
 * A tolerance of ±4 lines is allowed, because a comment block legitimately drifts by
 * a line or two under an edit above it and failing on that would make the lock
 * unmaintainable. Anything further is not drift, it is a wrong citation.
 */
const CITE_SLACK = 4;
function resolveCite(cite, quotes, name) {
  const m = /^(.+?):(\d+)(?:-(\d+))?$/.exec(cite);
  assert.ok(m, `citation "${cite}" is not in file:line or file:line-line form`);
  const [, rel, fromRaw, toRaw] = m;
  const abs = path.join(ROOT, rel);
  assert.ok(fs.existsSync(abs), `constraint "${name}" cites ${rel}, which does not exist`);

  const lines = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const from = Number(fromRaw);
  const to = Number(toRaw ?? fromRaw);
  assert.ok(
    to <= lines.length,
    `constraint "${name}" cites ${rel}:${from}-${to}, but that file has only ${lines.length} lines`,
  );

  const window = lines
    .slice(Math.max(0, from - 1 - CITE_SLACK), to + CITE_SLACK)
    .join(' ')
    .replace(/\s+/g, ' ');

  // At least one of the doc's quoted phrases must be findable AT the cited lines.
  // Requiring all of them would fail on a quote the doc assembles from two places;
  // requiring none is the hole this function exists to close.
  const found = quotes.filter((q) => window.includes(normQ(q)));
  assert.ok(
    found.length > 0,
    `constraint "${name}" cites ${rel}:${from}${toRaw ? `-${to}` : ''}, but NONE of its quoted ` +
      `phrases appear there (±${CITE_SLACK} lines). The citation has rotted — find where the ` +
      `code moved to and update it. Quotes: ${JSON.stringify(quotes)}`,
  );
}

/**
 * The six constraints, each cited to WHERE IT LIVES NOW.
 *
 * REPOINTED 2026-08-20, when `packages/web` was deleted. Until then every entry
 * cited a v1 file, and the salvage doc's whole purpose was to carry the knowledge
 * out of that tree SO THAT it could be deleted. The moment it was, five of six
 * citations dangled and this test went red — the citation resolver working exactly
 * as designed.
 *
 * The fix is not to soften the resolver. It is to ask the question that now matters:
 * **did the constraint survive the rebuild?** Each entry therefore cites the v2 file
 * that honours it and quotes the phrase that proves it was carried, not lost. A
 * green run here now means the salvage worked; before, it only meant a dead file
 * still existed.
 *
 * Entries 4 and 5 changed subject, and honestly. v1's "dead stylesheet" note and its
 * `level = 'L2'` pin were facts about a tree that no longer exists — neither has a
 * v2 equivalent to carry. They are replaced by the two constraints that occupy the
 * same ground in v2: the argued stylesheet ORDER, and the LOD ladder being sheet
 * 05.8's rather than a lane's invention. Both were hard-won in this rebuild.
 *
 * `cite` is matched literally in the doc AND resolved against the source; `quotes`
 * must appear at the cited lines.
 */
const SIX = [
  {
    name: '1 · the eight inert <Handle> elements cannot be deleted',
    cite: 'packages/web2/src/canvas/NodeCard.tsx:236-248',
    quotes: ['every edge on the board disappears', 'before the custom edge ever mounts'],
  },
  {
    name: '2 · the elkjs self.document stub in the layout worker',
    cite: 'packages/web2/src/canvas/elkWorkerStub.test.ts:10-22',
    quotes: ['self-detects a Worker-like environment', '`self.onmessage`'],
  },
  {
    name: '3 · the card budget is derived arithmetic, not a round number',
    cite: 'packages/web2/src/canvas/canvasReduce.ts:138-141',
    quotes: ['DEFAULT_MAX_CARDS', 'computed rather than written down'],
  },
  {
    name: '4 · the stylesheet order is argued, not alphabetical',
    cite: 'packages/web2/src/app/App.tsx:1-32',
    quotes: ['the order below is load-bearing', 'a sheet whose position cannot be argued'],
  },
  {
    name: '5 · the LOD ladder is sheet 05.8, not an invented reading',
    cite: 'packages/web2/src/canvas/lod.ts:6-15',
    quotes: ['05.8'],
  },
  {
    name: '6 · explain.ts records what slice(0, 300) cost',
    cite: 'packages/analyzer/src/explain/explain.ts:768-788',
    quotes: ['graph.edges.slice(0, MAX_EDGES)', 'contributed', 'NOTHING'],
  },
];

test('docs/rebuild/inherited-constraints.md exists', () => {
  const text = readDoc();
  assert.ok(text.length > 0, 'the salvage doc is empty');
});

for (const c of SIX) {
  test(`§4.5/§7-R8 constraint ${c.name}`, () => {
    const text = prose(readDoc());
    assert.ok(
      text.includes(c.cite),
      `missing the source citation \`${c.cite}\` — every entry must quote its comment with the original file:line`,
    );
    // AND the citation must actually point at the thing it claims. Checking only
    // that the string appears in the doc is what let three citations rot the moment
    // another Wave 0 item inserted 15 lines into ArchCanvasBoard.tsx: the doc still
    // said :243-273 and this test still passed, pinning a wrong provenance in place.
    // For a document whose entire value IS file:line provenance, that is the defect
    // that matters. Resolve it against the source instead.
    resolveCite(c.cite, c.quotes, c.name);
    for (const q of c.quotes) {
      assert.ok(
        text.includes(normQ(q)),
        `constraint "${c.name}" is cited but not QUOTED: the doc does not contain ${JSON.stringify(q)}`,
      );
    }
  });
}

test('every constraint entry carries a file:line citation', () => {
  const text = prose(readDoc());
  // `path/to/file.ext:12` or `path/to/file.ext:12-34`, as written in the doc.
  const cites = text.match(/[A-Za-z0-9_./-]+\.(ts|tsx|css|html)\:\d+(-\d+)?/g) ?? [];
  assert.ok(
    cites.length >= 60,
    `only ${cites.length} file:line citations found; the salvage is meant to be the whole inherited constraint set, not the six headline items`,
  );
});

test('the doc does not import v1 as precedent — it quotes v1 as evidence', () => {
  const text = readDoc();
  // PIVOT-V2: no v2 work may cite the old UI as precedent for a layout or a
  // class name. A salvage doc records WHY, so it must say so on its own face.
  assert.match(
    text,
    /not a licence to copy|evidence, not precedent|constraint, not a design/i,
    'the doc must state that it carries constraints forward, not layout or chrome',
  );
});
